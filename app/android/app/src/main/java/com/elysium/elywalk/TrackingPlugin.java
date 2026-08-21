package com.elysium.elywalk;

import android.Manifest;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Pont JS vers le service natif de sortie GPS en arrière-plan.
 * Le GPS reste actif (service de premier plan) même lorsque l'app
 * est fermée ; la trace est renvoyée à l'arrêt ou sur demande.
 */
@CapacitorPlugin(
    name = "Tracking",
    permissions = {
        @Permission(
            alias = "location",
            strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }
        )
    }
)
public class TrackingPlugin extends Plugin {

    @Override
    public void load() {
        TrackingService.listener = snapshot -> {
            try {
                notifyListeners("track", snapshot);
            } catch (Exception ignored) {
            }
        };
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (!hasLocationPermission()) {
            requestPermissionForAlias("location", call, "onStartPerms");
            return;
        }
        TrackingService.startSession(getContext(), call.getString("type", "walk"));
        call.resolve(TrackingService.snapshot());
    }

    @PermissionCallback
    private void onStartPerms(PluginCall call) {
        if (!hasLocationPermission()) {
            call.reject("Permission de localisation refusée");
            return;
        }
        TrackingService.startSession(getContext(), call.getString("type", "walk"));
        call.resolve(TrackingService.snapshot());
    }

    @PluginMethod
    public void stop(PluginCall call) {
        JSObject snap = TrackingService.snapshot();
        TrackingService.stopSession(getContext());
        call.resolve(snap);
    }

    @PluginMethod
    public void getSnapshot(PluginCall call) {
        call.resolve(TrackingService.snapshot());
    }

    @PluginMethod
    public void isTracking(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("running", TrackingService.isRunning());
        call.resolve(ret);
    }

    private boolean hasLocationPermission() {
        return getPermissionState("location") == PermissionState.GRANTED;
    }
}
