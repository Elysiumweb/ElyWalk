package com.elysium.elywalk;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(StepCounterPlugin.class);
        registerPlugin(TrackingPlugin.class);
        // Pont vers Unity LevelPlay (médiation ; Meta Audience Network y est
        // branché en in-app bidding depuis 2.1.0).
        registerPlugin(LevelPlayAdsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
