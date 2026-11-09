package com.elysium.elywalk;

import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "ElyWalk";

    /**
     * Version de WebView (Chromium) à partir de laquelle les encarts système
     * sont correctement exposés au CSS via `env(safe-area-inset-*)`.
     * Même seuil que celui utilisé par Capacitor (plugin SystemBars).
     */
    private static final int WEBVIEW_VERSION_WITH_SAFE_AREA = 140;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins natifs ElyWalk (podomètre + sortie GPS en arrière-plan).
        registerPlugin(StepCounterPlugin.class);
        registerPlugin(TrackingPlugin.class);
        // Régie publicitaire Meta Audience Network (bannière, interstitiel,
        // interstitiel récompensé).
        registerPlugin(MetaAdsPlugin.class);

        // Initialisation anticipée avec le contexte d'activité (évite les
        // plantages du SDK Meta sur Android 10+ lors de l'instanciation d'AdView).
        try {
            if (!com.facebook.ads.AudienceNetworkAds.isInitialized(this)) {
                com.facebook.ads.AudienceNetworkAds.initialize(this);
            }
        } catch (Throwable t) {
            Log.w(TAG, "Initialisation anticipée Meta Audience Network ignorée", t);
        }

        // Repli si le moteur de rendu de la WebView meurt (mémoire insuffisante,
        // pilote graphique instable…). Sans ce rappel, Android termine le
        // processus de l'application : l'utilisateur voit l'appli se fermer
        // toute seule, ce qui ressemble à un plantage au lancement.
        bridgeBuilder.addWebViewListener(new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
                boolean crashed = detail != null && detail.didCrash();
                Log.e(TAG, "Moteur de rendu WebView interrompu (crash=" + crashed + ")");
                runOnUiThread(() -> recreate());
                return true; // état géré : le système ne tue plus l'application
            }
        });

        super.onCreate(savedInstanceState);

        enableEdgeToEdgeCompat();
    }

    /**
     * Affichage de bord à bord (edge-to-edge) pour <b>tous</b> les utilisateurs
     * et <b>sans API obsolète</b> — traite les deux avertissements Google Play
     * de la version 7 (1.7.0).
     *
     * <p>Depuis Android 15 (SDK 35), le bord à bord est imposé aux applications
     * qui ciblent ce niveau ; en dessous, c'est à l'application de l'activer.
     * Google Play signale « l'affichage de bord à bord peut ne pas être
     * disponible pour tous les utilisateurs » lorsque l'application n'appelle
     * pas l'API dédiée et se contente du comportement par défaut.</p>
     *
     * <p>On utilise donc {@link WindowCompat#enableEdgeToEdge(Window)}
     * (androidx.core 1.17.0), l'API recommandée par Google : elle applique le
     * bord à bord de façon rétrocompatible sur toutes les versions d'Android,
     * gère les barres transparentes et les contrastes, sans que le code de
     * l'application n'appelle directement {@code setDecorFitsSystemWindows},
     * {@code setStatusBarColor} ou {@code setNavigationBarColor} — toutes
     * dépréciées dans Android 15 et signalées par Play.</p>
     *
     * <p>Les icônes des barres système sont ensuite forcées en clair (thème
     * sombre de l'application). Les encarts sont consommés côté web : la page
     * déclare {@code viewport-fit=cover} et les feuilles de style utilisent
     * {@code env(safe-area-inset-*)} ; Capacitor injecte également
     * {@code --safe-area-inset-*} via le plugin SystemBars.</p>
     */
    private void enableEdgeToEdgeCompat() {
        Window window = getWindow();
        try {
            WindowCompat.enableEdgeToEdge(window);
        } catch (Throwable t) {
            // Repli : ne doit jamais empêcher l'interface de démarrer.
            // (On ne rappelle pas volontairement une autre API de fenêtre :
            // elles sont toutes dépréciées dans Android 15 et signalées par
            // Play. Sans bord à bord, l'application reste parfaitement
            // utilisable : seule la zone sous les barres n'est pas exploitée.)
            Log.w(TAG, "Bord à bord indisponible, affichage encarté conservé", t);
        }

        // Interface sombre : icônes claires dans les barres système, quel que
        // soit le mode clair/sombre choisi pour le système.
        try {
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
            if (controller != null) {
                controller.setAppearanceLightStatusBars(false);
                controller.setAppearanceLightNavigationBars(false);
            }
        } catch (Throwable t) {
            Log.w(TAG, "Apparence des barres système non appliquée", t);
        }

        // Affichage dans les encoches : `always`, remplaçant non déprécié de
        // `shortEdges` (le thème le pose aussi pour la fenêtre de lancement).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                WindowManager.LayoutParams attributes = window.getAttributes();
                attributes.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS;
                window.setAttributes(attributes);
            } catch (Throwable t) {
                Log.w(TAG, "Mode encoche non appliqué", t);
            }
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

        try {
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
        } catch (Throwable t) {
            Log.w(TAG, "Repli des encarts système non appliqué", t);
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
