package com.elysium.elywalk;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "StepCounter",
    permissions = {
        @Permission(
            alias = "activity",
            strings = { Manifest.permission.ACTIVITY_RECOGNITION }
        ),
        @Permission(
            alias = "notifications",
            strings = { Manifest.permission.POST_NOTIFICATIONS }
        )
    }
)
public class StepCounterPlugin extends Plugin {

    @Override
    public void load() {
        StepCounterService.listener = today -> {
            JSObject data = new JSObject();
            data.put("todaySteps", today);
            notifyListeners("steps", data);
        };
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (needsActivityPermission() && getPermissionState("activity") != PermissionState.GRANTED) {
            requestNeededPermissions(call, "onStartPerms");
            return;
        }
        launchService();
        resolveToday(call);
    }

    @PermissionCallback
    private void onStartPerms(PluginCall call) {
        if (needsActivityPermission() && getPermissionState("activity") != PermissionState.GRANTED) {
            call.reject("Permission ACTIVITY_RECOGNITION refusée");
            return;
        }
        launchService();
        resolveToday(call);
    }

    @PluginMethod
    public void getTodaySteps(PluginCall call) {
        resolveToday(call);
    }

    @PluginMethod
    public void resetToday(PluginCall call) {
        StepStore.resetToday(getContext());
        ElyWalkWidget.updateAll(getContext());
        JSObject ret = new JSObject();
        ret.put("todaySteps", 0);
        notifyListeners("steps", ret);
        call.resolve(ret);
    }

    @PluginMethod
    public void checkPermission(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("status", activityStatus());
        call.resolve(ret);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (!needsActivityPermission() || getPermissionState("activity") == PermissionState.GRANTED) {
            JSObject ret = new JSObject();
            ret.put("status", "granted");
            call.resolve(ret);
            return;
        }
        requestNeededPermissions(call, "onReqPerms");
    }

    @PermissionCallback
    private void onReqPerms(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("status", activityStatus());
        call.resolve(ret);
    }

    @PluginMethod
    public void requestBatteryExemption(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                && !StepStore.wasBatteryAsked(getContext())) {
                PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
                String pkg = getContext().getPackageName();
                if (pm != null && !pm.isIgnoringBatteryOptimizations(pkg)) {
                    Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    i.setData(Uri.parse("package:" + pkg));
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(i);
                }
                StepStore.markBatteryAsked(getContext());
            }
        } catch (Exception ignored) {
            // Certaines ROM bloquent cette intent — on ignore.
        }
        call.resolve();
    }

    private void requestNeededPermissions(PluginCall call, String callback) {
        if (Build.VERSION.SDK_INT >= 33) {
            requestPermissionForAliases(new String[] { "activity", "notifications" }, call, callback);
        } else {
            requestPermissionForAlias("activity", call, callback);
        }
    }

    private void launchService() {
        try {
            StepCounterService.start(getContext());
        } catch (Exception ignored) {
            // Relancé au prochain onStart / boot.
        }
    }

    private void resolveToday(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("todaySteps", StepStore.getTodaySteps(getContext()));
        call.resolve(ret);
    }

    private boolean needsActivityPermission() {
        return Build.VERSION.SDK_INT >= 29;
    }

    private String activityStatus() {
        if (!needsActivityPermission()) return "granted";
        PermissionState st = getPermissionState("activity");
        if (st == PermissionState.GRANTED) return "granted";
        if (st == PermissionState.DENIED) return "denied";
        return "prompt";
    }
}
