package com.elysium.elywalk;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.security.NetworkSecurityPolicy;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class MetaNetworkPolicyTest {
    @Test
    public void allowsHttpForLocalMediaCacheButNotForAdServers() {
        NetworkSecurityPolicy policy = NetworkSecurityPolicy.getInstance();
        assertTrue(policy.isCleartextTrafficPermitted("127.0.0.1"));
        assertFalse(policy.isCleartextTrafficPermitted("graph.facebook.com"));
    }
}
