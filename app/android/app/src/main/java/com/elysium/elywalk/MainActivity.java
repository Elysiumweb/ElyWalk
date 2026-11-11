package com.elysium.elywalk;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(StepCounterPlugin.class);
        registerPlugin(TrackingPlugin.class);
        // Pont vers Chartboost Mediation (médiation Meta Audience Network
        // depuis 2.1.0). Le nom Capacitor reste « MetaAds ».
        registerPlugin(ChartboostMediationAdsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
