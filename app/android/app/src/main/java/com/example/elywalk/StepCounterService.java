package com.example.elywalk;

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

    public static void start(Context ctx) {
        Intent i = new Intent(ctx.getApplicationContext(), StepCounterService.class);
        ContextCompat.startForegroundService(ctx.getApplicationContext(), i);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        promoteToForeground();
        sensorManager = (SensorManager) getSystemService(SENSOR_SERVICE);
        if (sensorManager != null) {
            stepSensor = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER);
            if (stepSensor != null) {
                // SENSOR_DELAY_NORMAL : basse consommation, suffisant pour des pas.
                sensorManager.registerListener(this, stepSensor, SensorManager.SENSOR_DELAY_NORMAL);
            }
        }
        updateNotification(StepStore.getTodaySteps(this));
    }

    private void promoteToForeground() {
        Notification n = buildNotification(StepStore.getTodaySteps(this));
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH);
        } else {
            startForeground(NOTIF_ID, n);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        promoteToForeground();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (sensorManager != null) {
            sensorManager.unregisterListener(this);
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
        long value = (long) event.values[0];
        int today = StepStore.applySensorValue(this, value);
        StepsListener l = listener;
        if (l != null) {
            l.onSteps(today);
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
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(NOTIF_ID, buildNotification(steps));
    }
}
