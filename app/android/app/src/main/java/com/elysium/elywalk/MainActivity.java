package com.elysium.elywalk;

import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

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
     * Affichage de bord à bord (edge-to-edge) pour <b>tous</b> les utilisateurs
     * et <b>sans API obsolète</b>.
     *
     * <p>Android 15 (SDK 35) impose déjà le bord à bord aux applications qui
     * ciblent le SDK 35 ; en dessous, c'est à l'application de l'activer, d'où
     * l'avertissement Play « l'affichage de bord à bord peut ne pas être
     * disponible pour tous les utilisateurs ». On l'active donc ici sur toutes
     * les versions d'Android, en n'utilisant que des API non dépréciées :</p>
     *
     * <ul>
     *   <li>{@code WindowCompat.setDecorFitsSystemWindows(window, false)} ;</li>
     *   <li>{@code LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS} (API 30+), qui
     *       remplace {@code LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES},
     *       déprécié dans Android 15 (le thème le pose aussi, pour la fenêtre
     *       de lancement) ;</li>
     *   <li>les couleurs transparentes des barres système viennent du thème
     *       ({@code res/values/styles.xml}), jamais de
     *       {@code Window#setStatusBarColor} / {@code setNavigationBarColor}.</li>
     * </ul>
     *
     * <p>Les encarts sont ensuite consommés côté web : la page déclare
     * {@code viewport-fit=cover} et les feuilles de style utilisent
     * {@code env(safe-area-inset-*)} (Capacitor injecte également
     * {@code --safe-area-inset-*}).</p>
     */
    private void enableEdgeToEdgeCompat() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowManager.LayoutParams attributes = getWindow().getAttributes();
            attributes.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS;
            getWindow().setAttributes(attributes);
        }

        applyInsetsFallback();
    }

    /**
     * Repli pour les appareils antérieurs à Android 15 équipés d'une WebView
     * trop ancienne pour exposer les safe-area au CSS : sans cela, le contenu
     * passerait sous la barre d'état. Capacitor applique déjà des marges à
     * partir d'Android 15 ; en dessous, c'est à nous de le faire.
     *
     * <p>L'écouteur est posé sur {@code android.R.id.content}, c'est-à-dire le
     * parent de la vue de Capacitor : les deux cohabitent sans se marcher
     * dessus (Capacitor conserve son écouteur sur la WebView).</p>
     */
    private void applyInsetsFallback() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            return; // Android 15+ : marges appliquées par Capacitor si besoin.
        }
        if (webViewSupportsSafeAreaInsets()) {
            return; // La WebView transmet les encarts au CSS : rien à faire.
        }

        View content = findViewById(android.R.id.content);
        if (content == null) {
            return;
        }

        ViewCompat.setOnApplyWindowInsetsListener(content, (view, insets) -> {
            Insets bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            int bottom = bars.bottom;
            if (insets.isVisible(WindowInsetsCompat.Type.ime())) {
                bottom = Math.max(bottom, insets.getInsets(WindowInsetsCompat.Type.ime()).bottom);
            }
            view.setPadding(bars.left, bars.top, bars.right, bottom);
            return insets;
        });
        ViewCompat.requestApplyInsets(content);
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
