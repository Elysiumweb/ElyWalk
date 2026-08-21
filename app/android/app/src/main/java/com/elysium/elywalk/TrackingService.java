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
 */
public class TrackingService extends Service {
    public static final String CHANNEL_ID = "elywalk_tracking";
    public static final int NOTIF_ID = 43;
    private static final String PREFS = "elywalk_tracking";
    private static final String KEY_TRACK = "track";
    /** Ignore un point s'il est à plus de cette distance du précédent (bruit GPS). */
    private static final double MAX_SEGMENT_M = 150d;
    /** Pas plus d'une mise à jour Firestore/notification courte que toutes ces ms. */
    private static final long EMIT_THROTTLE_MS = 2000L;
    private static final long PERSIST_THROTTLE_MS = 8000L;

    public interface SnapshotListener {
        void onSnapshot(JSObject snapshot);
    }

    public static volatile SnapshotListener listener;

    private static final Object LOCK = new Object();
    private static boolean running = false;
    private static long startedAt = 0L;
    private static String type = "walk";
    private static double distanceM = 0d;
    // [lat, lng, altitude(NaN si absente), recordedAt]
    private static final List<double[]> points = new ArrayList<>();

    private FusedLocationProviderClient fusedClient;
    private LocationCallback locationCallback;
    private long lastEmit = 0L;
    private long lastPersist = 0L;

    /** Démarre une nouvelle sortie (depuis le plugin, permission déjà accordée). */
    public static void startSession(Context ctx, String typeArg) {
        synchronized (LOCK) {
            running = true;
            startedAt = System.currentTimeMillis();
            type = typeArg == null ? "walk" : typeArg;
            points.clear();
            distanceM = 0d;
        }
        persistClear(ctx);
        Intent i = new Intent(ctx.getApplicationContext(), TrackingService.class);
        ContextCompat.startForegroundService(ctx.getApplicationContext(), i);
    }

    /** Demande l'arrêt du service (la trace reste accessible jusqu'à l'appel). */
    public static void stopSession(Context ctx) {
        synchronized (LOCK) {
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

    public static JSObject snapshot() {
        JSObject snap = new JSObject();
        synchronized (LOCK) {
            snap.put("running", running);
            snap.put("type", type);
            snap.put("startedAt", startedAt);
            snap.put("distanceM", distanceM);
            snap.put("durationSec", startedAt > 0 ? (System.currentTimeMillis() - startedAt) / 1000 : 0);
            JSArray arr = new JSArray();
            for (double[] p : points) {
                JSObject pt = new JSObject();
                pt.put("lat", p[0]);
                pt.put("lng", p[1]);
                if (!Double.isNaN(p[2])) pt.put("altitude", p[2]);
                pt.put("recordedAt", (long) p[3]);
                arr.put(pt);
            }
            snap.put("points", arr);
            snap.put("pointCount", points.size());
        }
        return snap;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        // Reprise après un éventuel kill du process (START_STICKY).
        restoreIfNeeded();
        promoteToForeground(currentDistanceKm(), currentDurationMin());
        fusedClient = LocationServices.getFusedLocationProviderClient(this);
        LocationRequest req = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 5000L)
            .setMinUpdateIntervalMillis(2000L)
            .setMinUpdateDistanceMeters(3f)
            .setWaitForAccurateLocation(false)
            .build();
        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(@NonNull LocationResult locationResult) {
                for (Location loc : locationResult.getLocations()) {
                    handleLocation(loc);
                }
            }
        };
        try {
            fusedClient.requestLocationUpdates(req, locationCallback, getMainLooper());
        } catch (SecurityException se) {
            // Permission révoquée en cours de route : on stoppe proprement.
            stopSession(TrackingService.this);
        }
    }

    private void promoteToForeground(double km, double min) {
        Notification n = buildNotification(km, min);
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
        if (loc == null) return;
        double lat = loc.getLatitude();
        double lng = loc.getLongitude();
        double alt = loc.hasAltitude() ? loc.getAltitude() : Double.NaN;
        long t = System.currentTimeMillis();
        boolean emit;
        synchronized (LOCK) {
            if (!points.isEmpty()) {
                double[] last = points.get(points.size() - 1);
                double d = haversine(last[0], last[1], lat, lng);
                if (d < MAX_SEGMENT_M) distanceM += d;
            }
            points.add(new double[]{lat, lng, alt, (double) t});
            emit = (t - lastEmit) > EMIT_THROTTLE_MS;
            if (emit) lastEmit = t;
        }
        if ((t - lastPersist) > PERSIST_THROTTLE_MS) {
            lastPersist = t;
            persist();
        }
        double km = currentDistanceKm();
        double min = currentDurationMin();
        updateNotification(km, min);
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
            return startedAt > 0 ? (System.currentTimeMillis() - startedAt) / 60000d : 0d;
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        promoteToForeground(currentDistanceKm(), currentDurationMin());
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (fusedClient != null && locationCallback != null) {
            try {
                fusedClient.removeLocationUpdates(locationCallback);
            } catch (SecurityException ignored) {
            }
        }
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

    private Notification buildNotification(double km, double min) {
        Intent launch = new Intent(this, MainActivity.class);
        launch.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(
            this, 1, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        String text = getString(R.string.tracking_notif_text, String.format(Locale.FRANCE, "%.2f", km), (int) Math.ceil(min));
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_steps)
            .setContentTitle(getString(R.string.tracking_notif_title))
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setContentIntent(pi)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    private void updateNotification(double km, double min) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(NOTIF_ID, buildNotification(km, min));
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
                    pts.put(o);
                }
                JSONObject root = new JSONObject();
                root.put("running", running);
                root.put("startedAt", startedAt);
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
                startedAt = root.optLong("startedAt", 0L);
                type = root.optString("type", "walk");
                distanceM = root.optDouble("distanceM", 0d);
                points.clear();
                JSONArray pts = root.optJSONArray("points");
                if (pts != null) {
                    for (int i = 0; i < pts.length(); i++) {
                        JSONObject o = pts.getJSONObject(i);
                        double alt = o.has("alt") ? o.getDouble("alt") : Double.NaN;
                        points.add(new double[]{o.getDouble("lat"), o.getDouble("lng"), alt, o.optLong("t")});
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
