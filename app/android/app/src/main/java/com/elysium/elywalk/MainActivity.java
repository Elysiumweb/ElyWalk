package com.elysium.elywalk;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(StepCounterPlugin.class);
        registerPlugin(TrackingPlugin.class);
        // Pont vers le SDK Meta Audience Network (remplace AdMob depuis 1.9.0).
        registerPlugin(MetaAdsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
