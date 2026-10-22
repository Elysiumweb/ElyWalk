package com.elysium.elywalk;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.Build;
import android.os.IBinder;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Service de premier plan : enregistre le parcours GPS d'une sortie
 * (marche/course) même lorsque l'application est fermée ou l'écran
 * éteint. Une notification persistante maintient le process en vie.
 *
 * La trace est conservée en mémoire (champs statiques) ET persistée
 * sur disque pour reprendre après un éventuel kill du process.
 *
 * Pause / reprise : en pause, les mises à jour GPS sont coupées et le
 * temps de pause est exclu de la durée active et donc de l'allure.
 */
public class TrackingService extends Service {
    public static final String CHANNEL_ID = "elywalk_tracking";
    public static final int NOTIF_ID = 43;
    private static final String PREFS = "elywalk_tracking";
    private static final String KEY_TRACK = "track";

    public static final String ACTION_PAUSE = "com.elysium.elywalk.tracking.PAUSE";
    public static final String ACTION_RESUME = "com.elysium.elywalk.tracking.RESUME";
    public static final String ACTION_MODE = "com.elysium.elywalk.tracking.MODE";

    /** Ignore un point s'il est à plus de cette distance du précédent (bruit GPS). */
    private static final double MAX_SEGMENT_M = 150d;
    /** Au-delà de cette précision, le point reste tracé mais n'incrémente pas la distance. */
    private static final double MAX_ACCURACY_FOR_DISTANCE_M = 100d;
    /** Pas plus d'une mise à jour Firestore/notification courte que toutes ces ms. */
    private static final long EMIT_THROTTLE_MS = 2000L;
    private static final long PERSIST_THROTTLE_MS = 8000L;

    public interface SnapshotListener {
        void onSnapshot(JSObject snapshot);
    }

    public static volatile SnapshotListener listener;

    private static final Object LOCK = new Object();
    private static boolean running = false;
    private static boolean paused = false;
    private static boolean batterySaver = false;
    private static long startedAt = 0L;
    /** Temps cumulé des pauses terminées. */
    private static long pausedMs = 0L;
    /** Début de la pause en cours (0 si aucune). */
    private static long pauseStartedAt = 0L;
    private static String type = "walk";
    private static double distanceM = 0d;
    // [lat, lng, altitude(NaN si absente), recordedAt, accuracy(NaN si absente)]
    private static final List<double[]> points = new ArrayList<>();

    private FusedLocationProviderClient fusedClient;
    private LocationCallback locationCallback;
    private long lastEmit = 0L;
    private long lastPersist = 0L;

    /** Démarre une nouvelle sortie (depuis le plugin, permission déjà accordée). */
    public static void startSession(Context ctx, String typeArg, boolean batterySaverArg) {
        synchronized (LOCK) {
            running = true;
            paused = false;
            batterySaver = batterySaverArg;
            startedAt = System.currentTimeMillis();
            type = typeArg == null ? "walk" : typeArg;
            points.clear();
            distanceM = 0d;
            pausedMs = 0L;
            pauseStartedAt = 0L;
        }
        persistClear(ctx);
        Intent i = new Intent(ctx.getApplicationContext(), TrackingService.class);
        ContextCompat.startForegroundService(ctx.getApplicationContext(), i);
    }

    /** Met la sortie en pause : GPS coupé, chronomètre actif gelé. */
    public static void pauseSession(Context ctx) {
        synchronized (LOCK) {
            if (!running || paused) return;
            paused = true;
            pauseStartedAt = System.currentTimeMillis();
        }
        sendAction(ctx, ACTION_PAUSE);
    }

    /** Reprend une sortie en pause : le temps de pause est exclu de la durée. */
    public static void resumeSession(Context ctx) {
        synchronized (LOCK) {
            if (!running || !paused) return;
            if (pauseStartedAt > 0) pausedMs += Math.max(0L, System.currentTimeMillis() - pauseStartedAt);
            paused = false;
            pauseStartedAt = 0L;
        }
        sendAction(ctx, ACTION_RESUME);
    }

    /** Active/désactive le mode économie de batterie (moins de points GPS). */
    public static void setBatterySaver(Context ctx, boolean enabled) {
        synchronized (LOCK) {
            batterySaver = enabled;
        }
        sendAction(ctx, ACTION_MODE);
    }

    private static void sendAction(Context ctx, String action) {
        Intent i = new Intent(ctx.getApplicationContext(), TrackingService.class);
        i.setAction(action);
        try {
            ContextCompat.startForegroundService(ctx.getApplicationContext(), i);
        } catch (Exception ignored) {
            // Service déjà vivant ou restrictions ROM : l'état statique reste correct.
        }
    }

    /** Demande l'arrêt du service (la trace reste accessible jusqu'à l'appel). */
    public static void stopSession(Context ctx) {
        synchronized (LOCK) {
            if (paused && pauseStartedAt > 0) {
                pausedMs += Math.max(0L, System.currentTimeMillis() - pauseStartedAt);
            }
            paused = false;
            pauseStartedAt = 0L;
            running = false;
        }
        persistClear(ctx);
        Intent i = new Intent(ctx.getApplicationContext(), TrackingService.class);
        ctx.stopService(i);
    }

    public static boolean isRunning() {
        synchronized (LOCK) {
            return running;
        }
    }

    public static boolean isPaused() {
        synchronized (LOCK) {
            return paused;
        }
    }

    /** Temps actif (pauses exclues) en millisecondes. */
    private static long activeElapsedMsLocked() {
        if (startedAt <= 0) return 0L;
        long elapsed = System.currentTimeMillis() - startedAt - pausedMs;
        if (paused && pauseStartedAt > 0) elapsed -= Math.max(0L, System.currentTimeMillis() - pauseStartedAt);
        return Math.max(0L, elapsed);
    }

    private static long pausedTotalMsLocked() {
        long total = pausedMs;
        if (paused && pauseStartedAt > 0) total += Math.max(0L, System.currentTimeMillis() - pauseStartedAt);
        return total;
    }

    public static JSObject snapshot() {
        JSObject snap = new JSObject();
        synchronized (LOCK) {
            long elapsedMs = activeElapsedMsLocked();
            snap.put("running", running);
            snap.put("paused", paused);
            snap.put("batterySaver", batterySaver);
            snap.put("type", type);
            snap.put("startedAt", startedAt);
            snap.put("distanceM", distanceM);
            snap.put("durationSec", elapsedMs / 1000L);
            snap.put("pausedSec", pausedTotalMsLocked() / 1000L);
            JSArray arr = new JSArray();
            double lastAccuracy = Double.NaN;
            for (double[] p : points) {
                JSObject pt = new JSObject();
                pt.put("lat", p[0]);
                pt.put("lng", p[1]);
                if (!Double.isNaN(p[2])) pt.put("altitude", p[2]);
                pt.put("recordedAt", (long) p[3]);
                if (p.length > 4 && !Double.isNaN(p[4])) {
                    pt.put("accuracy", p[4]);
                    lastAccuracy = p[4];
                }
                arr.put(pt);
            }
            snap.put("points", arr);
            snap.put("pointCount", points.size());
            if (!Double.isNaN(lastAccuracy)) snap.put("accuracyM", lastAccuracy);
        }
        return snap;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        // Reprise après un éventuel kill du process (START_STICKY).
        restoreIfNeeded();
        promoteToForeground(currentDistanceKm(), currentDurationMin(), isPaused());
        fusedClient = LocationServices.getFusedLocationProviderClient(this);
        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(@NonNull LocationResult locationResult) {
                for (Location loc : locationResult.getLocations()) {
                    handleLocation(loc);
                }
            }
        };
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_PAUSE.equals(action)) {
            removeLocationUpdates();
            persist();
        } else if (ACTION_RESUME.equals(action) || ACTION_MODE.equals(action)) {
            applyLocationState();
            persist();
        } else {
            applyLocationState();
        }
        if (isRunning()) {
            promoteToForeground(currentDistanceKm(), currentDurationMin(), isPaused());
        }
        return START_STICKY;
    }

    /** (Re)configure les mises à jour GPS selon l'état pause et le mode batterie. */
    private void applyLocationState() {
        removeLocationUpdates();
        if (!isRunning() || isPaused()) return;
        long interval = isBatterySaver() ? 10000L : 5000L;
        long minInterval = isBatterySaver() ? 5000L : 2000L;
        float minDistance = isBatterySaver() ? 15f : 3f;
        LocationRequest req = new LocationRequest.Builder(
            isBatterySaver() ? Priority.PRIORITY_BALANCED_POWER_ACCURACY : Priority.PRIORITY_HIGH_ACCURACY,
            interval
        )
            .setMinUpdateIntervalMillis(minInterval)
            .setMinUpdateDistanceMeters(minDistance)
            .setWaitForAccurateLocation(false)
            .build();
        try {
            if (fusedClient != null && locationCallback != null) {
                fusedClient.requestLocationUpdates(req, locationCallback, getMainLooper());
            }
        } catch (SecurityException se) {
            // Permission révoquée en cours de route : on stoppe proprement.
            stopSession(TrackingService.this);
        }
    }

    private void removeLocationUpdates() {
        if (fusedClient != null && locationCallback != null) {
            try {
                fusedClient.removeLocationUpdates(locationCallback);
            } catch (Exception ignored) {
            }
        }
    }

    private static boolean isBatterySaver() {
        synchronized (LOCK) {
            return batterySaver;
        }
    }

    private void promoteToForeground(double km, double min, boolean isPaused) {
        Notification n = buildNotification(km, min, isPaused);
        if (buildForegroundType() > 0) {
            startForeground(NOTIF_ID, n, buildForegroundType());
        } else {
            startForeground(NOTIF_ID, n);
        }
    }

    private int buildForegroundType() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            return ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION;
        }
        return 0;
    }

    private void handleLocation(Location loc) {
        if (loc == null || isPaused()) return;
        double lat = loc.getLatitude();
        double lng = loc.getLongitude();
        double alt = loc.hasAltitude() ? loc.getAltitude() : Double.NaN;
        double accuracy = loc.hasAccuracy() ? loc.getAccuracy() : Double.NaN;
        long t = System.currentTimeMillis();
        boolean emit;
        synchronized (LOCK) {
            if (!points.isEmpty()) {
                double[] last = points.get(points.size() - 1);
                double d = haversine(last[0], last[1], lat, lng);
                // Un point très imprécis ne doit pas gonfler la distance.
                boolean preciseEnough = Double.isNaN(accuracy) || accuracy <= MAX_ACCURACY_FOR_DISTANCE_M;
                if (d < MAX_SEGMENT_M && preciseEnough) distanceM += d;
            }
            points.add(new double[]{lat, lng, alt, (double) t, accuracy});
            emit = (t - lastEmit) > EMIT_THROTTLE_MS;
            if (emit) lastEmit = t;
        }
        if ((t - lastPersist) > PERSIST_THROTTLE_MS) {
            lastPersist = t;
            persist();
        }
        double km = currentDistanceKm();
        double min = currentDurationMin();
        updateNotification(km, min, isPaused());
        if (emit) {
            SnapshotListener l = listener;
            if (l != null) {
                try {
                    l.onSnapshot(snapshot());
                } catch (Exception ignored) {
                }
            }
        }
    }

    private static double haversine(double lat1, double lng1, double lat2, double lng2) {
        double R = 6371000d;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLng = Math.toRadians(lng2 - lng1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
            + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
            * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    private double currentDistanceKm() {
        synchronized (LOCK) {
            return distanceM / 1000d;
        }
    }

    private double currentDurationMin() {
        synchronized (LOCK) {
            return activeElapsedMsLocked() / 60000d;
        }
    }

    @Override
    public void onDestroy() {
        removeLocationUpdates();
        boolean stillRunning;
        synchronized (LOCK) {
            stillRunning = running;
        }
        if (stillRunning) persist();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel ch = new NotificationChannel(
            CHANNEL_ID,
            getString(R.string.tracking_channel_name),
            NotificationManager.IMPORTANCE_LOW
        );
        ch.setDescription(getString(R.string.tracking_channel_desc));
        ch.setShowBadge(false);
        ch.setSound(null, null);
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) nm.createNotificationChannel(ch);
    }

    private Notification buildNotification(double km, double min, boolean isPaused) {
        Intent launch = new Intent(this, MainActivity.class);
        launch.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(
            this, 1, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        String text = getString(
            isPaused ? R.string.tracking_notif_paused_text : R.string.tracking_notif_text,
            String.format(Locale.FRANCE, "%.2f", km),
            (int) Math.ceil(min)
        );
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_steps)
            .setContentTitle(getString(isPaused ? R.string.tracking_notif_paused_title : R.string.tracking_notif_title))
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setContentIntent(pi)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    private void updateNotification(double km, double min, boolean isPaused) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(NOTIF_ID, buildNotification(km, min, isPaused));
    }

    // ---- Persistance (reprise après kill du process) ----

    private void persist() {
        try {
            JSONArray pts = new JSONArray();
            synchronized (LOCK) {
                for (double[] p : points) {
                    JSONObject o = new JSONObject();
                    o.put("lat", p[0]);
                    o.put("lng", p[1]);
                    o.put("t", (long) p[3]);
                    if (!Double.isNaN(p[2])) o.put("alt", p[2]);
                    if (p.length > 4 && !Double.isNaN(p[4])) o.put("acc", p[4]);
                    pts.put(o);
                }
                JSONObject root = new JSONObject();
                root.put("running", running);
                root.put("paused", paused);
                root.put("batterySaver", batterySaver);
                root.put("startedAt", startedAt);
                root.put("pausedMs", pausedMs);
                root.put("pauseStartedAt", pauseStartedAt);
                root.put("type", type);
                root.put("distanceM", distanceM);
                root.put("points", pts);
                prefs().edit().putString(KEY_TRACK, root.toString()).apply();
            }
        } catch (Exception ignored) {
        }
    }

    private static void persistClear(Context ctx) {
        ctx.getApplicationContext()
            .getSharedPreferences(PREFS, MODE_PRIVATE)
            .edit()
            .remove(KEY_TRACK)
            .apply();
    }

    private void restoreIfNeeded() {
        synchronized (LOCK) {
            if (running) return; // déjà présent en mémoire
            String json = prefs().getString(KEY_TRACK, null);
            if (json == null) return;
            try {
                JSONObject root = new JSONObject(json);
                running = root.optBoolean("running", false);
                paused = root.optBoolean("paused", false);
                batterySaver = root.optBoolean("batterySaver", false);
                startedAt = root.optLong("startedAt", 0L);
                pausedMs = root.optLong("pausedMs", 0L);
                pauseStartedAt = root.optLong("pauseStartedAt", 0L);
                type = root.optString("type", "walk");
                distanceM = root.optDouble("distanceM", 0d);
                points.clear();
                JSONArray pts = root.optJSONArray("points");
                if (pts != null) {
                    for (int i = 0; i < pts.length(); i++) {
                        JSONObject o = pts.getJSONObject(i);
                        double alt = o.has("alt") ? o.getDouble("alt") : Double.NaN;
                        double acc = o.has("acc") ? o.getDouble("acc") : Double.NaN;
                        points.add(new double[]{o.getDouble("lat"), o.getDouble("lng"), alt, o.optLong("t"), acc});
                    }
                }
            } catch (Exception ignored) {
            }
        }
    }

    private SharedPreferences prefs() {
        return getApplicationContext().getSharedPreferences(PREFS, MODE_PRIVATE);
    }
}
