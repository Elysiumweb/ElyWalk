package com.elysium.elywalk;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

/**
 * Service de premier plan : écoute TYPE_STEP_COUNTER même lorsque
 * l'activité Capacitor est détruite. Une notification persistante
 * (exigence Android 8+) maintient le process en vie.
 */
public class StepCounterService extends Service implements SensorEventListener {
    public static final String CHANNEL_ID = "elywalk_steps";
    public static final int NOTIF_ID = 42;

    public interface StepsListener {
        void onSteps(int todaySteps);
    }

    public static volatile StepsListener listener;

    private SensorManager sensorManager;
    private Sensor stepSensor;
    private int lastNotifiedSteps = -1;
    private boolean ready;

    public static void start(Context ctx) {
        Intent i = new Intent(ctx.getApplicationContext(), StepCounterService.class);
        ContextCompat.startForegroundService(ctx.getApplicationContext(), i);
    }

    /**
     * Démarre le compteur sans faire remonter les refus des ROM Android.
     * Le comptage est une fonctionnalité secondaire au démarrage : un service
     * de premier plan refusé ne doit jamais fermer l'application.
     */
    public static boolean startQuietly(Context ctx) {
        try {
            start(ctx);
            return true;
        } catch (RuntimeException e) {
            Log.w("ElyWalkSteps", "Démarrage du service de pas différé", e);
            return false;
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        // Android impose une promotion en premier plan dans les 5 secondes.
        // buildNotification() crée le canal nécessaire avant startForeground().
        if (!promoteToForeground()) return;
        sensorManager = (SensorManager) getSystemService(SENSOR_SERVICE);
        if (sensorManager != null) {
            stepSensor = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER);
            if (stepSensor != null) {
                // SENSOR_DELAY_NORMAL : basse consommation, suffisant pour des pas.
                try {
                    sensorManager.registerListener(this, stepSensor, SensorManager.SENSOR_DELAY_NORMAL);
                } catch (RuntimeException e) {
                    // Permission retirée ou capteur défaillant : l'accueil reste
                    // utilisable, seul le comptage automatique est indisponible.
                    Log.w("ElyWalkSteps", "Step counter sensor unavailable", e);
                }
            }
        }
        ready = true;
        updateNotification(StepStore.getTodaySteps(this));
    }

    private boolean promoteToForeground() {
        try {
            Notification n = buildNotification(StepStore.getTodaySteps(this));
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH);
            } else {
                startForeground(NOTIF_ID, n);
            }
            return true;
        } catch (RuntimeException e) {
            Log.e("ElyWalkSteps", "Foreground service unavailable", e);
            stopSelf();
            return false;
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return ready && promoteToForeground() ? START_STICKY : START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        if (sensorManager != null) {
            try {
                sensorManager.unregisterListener(this);
            } catch (RuntimeException e) {
                Log.w("ElyWalkSteps", "Impossible de libérer le capteur", e);
            }
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        if (event == null || event.sensor == null) return;
        if (event.sensor.getType() != Sensor.TYPE_STEP_COUNTER) return;
        if (event.values == null || event.values.length == 0) return;
        long value = (long) event.values[0];
        int today;
        try {
            today = StepStore.applySensorValue(this, value);
        } catch (RuntimeException e) {
            Log.e("ElyWalkSteps", "Lecture des pas impossible", e);
            return;
        }
        StepsListener l = listener;
        if (l != null) {
            try {
                l.onSteps(today);
            } catch (RuntimeException e) {
                // Un pont WebView détruit ne doit pas tuer le service natif.
                Log.w("ElyWalkSteps", "Notification du pont JS en échec", e);
            }
        }
        try {
            ElyWalkWidget.updateAll(this);
        } catch (RuntimeException e) {
            Log.w("ElyWalkSteps", "Mise à jour du widget impossible", e);
        }
        if (lastNotifiedSteps < 0 || Math.abs(today - lastNotifiedSteps) >= 10) {
            lastNotifiedSteps = today;
            updateNotification(today);
        }
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {}

    private void createChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel ch = new NotificationChannel(
            CHANNEL_ID,
            getString(R.string.step_channel_name),
            NotificationManager.IMPORTANCE_LOW
        );
        ch.setDescription(getString(R.string.step_channel_desc));
        ch.setShowBadge(false);
        ch.setSound(null, null);
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) nm.createNotificationChannel(ch);
    }

    private Notification buildNotification(int steps) {
        // Le canal doit exister avant la notification sur Android 8+.
        createChannel();
        Intent launch = new Intent(this, MainActivity.class);
        launch.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(
            this,
            0,
            launch,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_steps)
            .setContentTitle(getString(R.string.step_notif_title))
            .setContentText(getString(R.string.step_notif_text, steps))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setContentIntent(pi)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    private void updateNotification(int steps) {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTIF_ID, buildNotification(steps));
        } catch (RuntimeException e) {
            Log.w("ElyWalkSteps", "Notification de pas indisponible", e);
        }
    }
}
