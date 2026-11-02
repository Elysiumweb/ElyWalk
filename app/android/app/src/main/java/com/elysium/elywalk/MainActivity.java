package com.elysium.elywalk;

import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebView;

import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * Version de WebView (Chromium) à partir de laquelle les encarts système
     * sont correctement exposés au CSS via `env(safe-area-inset-*)`.
     * Même seuil que celui utilisé par Capacitor (plugin SystemBars).
     */
    private static final int WEBVIEW_VERSION_WITH_SAFE_AREA = 140;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(StepCounterPlugin.class);
        registerPlugin(TrackingPlugin.class);
        super.onCreate(savedInstanceState);
        enableEdgeToEdgeCompat();
    }

    /**
     * Affichage de bord à bord (edge-to-edge) **sans API obsolète**.
     *
     * <p>Android 15 (SDK 35) impose déjà le bord à bord aux applications qui
     * ciblent le SDK 35 et ignore {@code Window#setStatusBarColor} /
     * {@code setNavigationBarColor}. Sur les versions antérieures, on l'active
     * ici pour la rétrocompatibilité demandée par Google Play, en n'utilisant
     * que des API non dépréciées :</p>
     *
     * <ul>
     *   <li>{@code WindowCompat.setDecorFitsSystemWindows(window, false)} ;</li>
     *   <li>{@code LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS} (API 30+), qui
     *       remplace {@code LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES}
     *       déprécié dans Android 15 ;</li>
     *   <li>les couleurs transparentes des barres système viennent du thème
     *       ({@code res/values/styles.xml}), pas d'un appel d'API.</li>
     * </ul>
     *
     * <p>Les encarts sont consommés côté web : la page déclare
     * {@code viewport-fit=cover} et les feuilles de style utilisent
     * {@code env(safe-area-inset-*)}. Avant Android 15, on n'active le bord à
     * bord que si la WebView du téléphone sait transmettre ces encarts au CSS
     * ({@value #WEBVIEW_VERSION_WITH_SAFE_AREA}+) ; sinon Capacitor applique
     * lui-même les marges (SDK 35+) et l'affichage reste correct partout.</p>
     */
    private void enableEdgeToEdgeCompat() {
        boolean systemEnforcesEdgeToEdge = Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM;
        if (!systemEnforcesEdgeToEdge && !webViewSupportsSafeAreaInsets()) {
            return;
        }

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowManager.LayoutParams attributes = getWindow().getAttributes();
            attributes.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS;
            getWindow().setAttributes(attributes);
        }
    }

    /** {@code true} si la WebView installée expose les safe-area au CSS. */
    private boolean webViewSupportsSafeAreaInsets() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return false;
        }
        try {
            PackageInfo info = WebView.getCurrentWebViewPackage();
            if (info == null || info.versionName == null) {
                return false;
            }
            String major = info.versionName.split("\\.")[0];
            return Integer.parseInt(major) >= WEBVIEW_VERSION_WITH_SAFE_AREA;
        } catch (Exception e) {
            return false;
        }
    }
}
