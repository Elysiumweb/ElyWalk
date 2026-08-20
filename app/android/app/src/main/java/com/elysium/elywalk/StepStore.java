package com.elysium.elywalk;

import android.content.Context;
import android.content.SharedPreferences;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Persistance native des pas du jour.
 * SOURCE DE VÉRITÉ : survit à la fermeture de l'app, au swipe recents
 * et au redémarrage du service. Le capteur TYPE_STEP_COUNTER est un
 * cumul depuis le dernier reboot ; on en déduit le delta.
 */
public final class StepStore {
    private static final String PREFS = "elywalk_steps";
    private static final String KEY_DATE = "date";
    private static final String KEY_TODAY = "today";
    private static final String KEY_LAST_SENSOR = "last_sensor";
    private static final String KEY_BATTERY_ASKED = "battery_asked";
    /** Garde-fou : un delta absurde (capteur défaillant) est ignoré. */
    private static final long MAX_DELTA = 50_000L;

    private StepStore() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static String todayStr() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }

    public static synchronized int getTodaySteps(Context ctx) {
        SharedPreferences p = prefs(ctx);
        if (!todayStr().equals(p.getString(KEY_DATE, ""))) {
            return 0;
        }
        return p.getInt(KEY_TODAY, 0);
    }

    public static synchronized long getLastSensor(Context ctx) {
        return prefs(ctx).getLong(KEY_LAST_SENSOR, -1L);
    }

    /**
     * Applique une nouvelle lecture TYPE_STEP_COUNTER.
     * @return le total de pas du jour après application
     */
    public static synchronized int applySensorValue(Context ctx, long sensorValue) {
        SharedPreferences p = prefs(ctx);
        String today = todayStr();
        String storedDate = p.getString(KEY_DATE, "");
        int todaySteps = today.equals(storedDate) ? p.getInt(KEY_TODAY, 0) : 0;
        long last = p.getLong(KEY_LAST_SENSOR, -1L);

        if (last < 0 || sensorValue < last) {
            // Première lecture, ou compteur réinitialisé (reboot appareil).
            last = sensorValue;
        } else {
            long delta = sensorValue - last;
            if (delta > 0 && delta < MAX_DELTA) {
                todaySteps += (int) delta;
            }
            last = sensorValue;
        }

        p.edit()
            .putString(KEY_DATE, today)
            .putInt(KEY_TODAY, todaySteps)
            .putLong(KEY_LAST_SENSOR, last)
            .apply();
        return todaySteps;
    }

    /** Remet le compteur du jour à zéro sans perdre le baseline capteur. */
    public static synchronized void resetToday(Context ctx) {
        prefs(ctx).edit()
            .putString(KEY_DATE, todayStr())
            .putInt(KEY_TODAY, 0)
            .apply();
    }

    public static synchronized boolean wasBatteryAsked(Context ctx) {
        return prefs(ctx).getBoolean(KEY_BATTERY_ASKED, false);
    }

    public static synchronized void markBatteryAsked(Context ctx) {
        prefs(ctx).edit().putBoolean(KEY_BATTERY_ASKED, true).apply();
    }
}
