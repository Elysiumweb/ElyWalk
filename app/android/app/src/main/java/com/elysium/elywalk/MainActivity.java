package com.elysium.elywalk;

import android.content.pm.PackageInfo;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;

import androidx.activity.EdgeToEdge;
import androidx.activity.SystemBarStyle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * Première version de WebView capable d'appliquer correctement
     * `viewport-fit=cover` + `env(safe-area-inset-*)` en bord à bord.
     * En dessous, les encarts ne seraient pas remontés au CSS : on conserve
     * alors le rendu système classique (contenu sous les barres).
     */
    private static final int MIN_WEBVIEW_FOR_EDGE_TO_EDGE = 140;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(StepCounterPlugin.class);
        registerPlugin(TrackingPlugin.class);
        super.onCreate(savedInstanceState);
        enableEdgeToEdgeBackport();
    }

    /**
     * Android 15 (SDK 35) impose le bord à bord aux applis qui ciblent le SDK 35+.
     * Pour les versions antérieures, on l'active explicitement (rétrocompatibilité)
     * afin que tous les utilisateurs bénéficient du même rendu.
     *
     * Les encarts (barre d'état, barre de navigation, encoche) sont consommés
     * côté web via les variables `--safe-area-inset-*` injectées par le plugin
     * SystemBars de Capacitor (voir capacitor.config.ts et src/styles.css).
     */
    private void enableEdgeToEdgeBackport() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            // Déjà imposé par le système : rien à faire.
            return;
        }
        if (!webViewSupportsSafeAreaCss()) {
            return;
        }
        try {
            // Thème noir ElyWalk : barres transparentes + icônes claires
            // (`SystemBarStyle.dark` = contenu clair, indépendamment du mode
            // sombre du système).
            EdgeToEdge.enable(
                this,
                SystemBarStyle.dark(Color.TRANSPARENT),
                SystemBarStyle.dark(Color.TRANSPARENT)
            );
        } catch (Throwable ignored) {
            // Jamais bloquant : on garde le comportement système par défaut.
        }
    }

    private boolean webViewSupportsSafeAreaCss() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return false;
        }
        try {
            PackageInfo info = WebView.getCurrentWebViewPackage();
            if (info == null || info.versionName == null) return false;
            int dot = info.versionName.indexOf('.');
            String major = dot > 0 ? info.versionName.substring(0, dot) : info.versionName;
            return Integer.parseInt(major) >= MIN_WEBVIEW_FOR_EDGE_TO_EDGE;
        } catch (Throwable t) {
            return false;
        }
    }
}
