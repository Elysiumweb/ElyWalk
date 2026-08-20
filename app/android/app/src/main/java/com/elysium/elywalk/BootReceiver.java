package com.elysium.elywalk;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.content.ContextCompat;

/**
 * Relance le service de pas après un reboot ou une mise à jour de l'app.
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
            && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
            && !"android.intent.action.QUICKBOOT_POWERON".equals(action)) {
            return;
        }
        if (Build.VERSION.SDK_INT >= 29) {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACTIVITY_RECOGNITION)
                != PackageManager.PERMISSION_GRANTED) {
                return;
            }
        }
        try {
            StepCounterService.start(context);
        } catch (Exception ignored) {
            // Sur certaines ROM le FGS ne peut pas démarrer depuis le boot
            // tant que l'utilisateur n'a pas rouvert l'app — ce n'est pas fatal.
        }
    }
}
