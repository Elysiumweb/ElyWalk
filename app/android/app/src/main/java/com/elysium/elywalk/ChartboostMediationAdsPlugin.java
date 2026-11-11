package com.elysium.elywalk;

import android.app.Activity;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.util.Size;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.chartboost.chartboostmediationsdk.ChartboostMediationSdk;
import com.chartboost.chartboostmediationsdk.ad.ChartboostMediationAdShowResult;
import com.chartboost.chartboostmediationsdk.ad.ChartboostMediationBannerAdLoadListener;
import com.chartboost.chartboostmediationsdk.ad.ChartboostMediationBannerAdLoadRequest;
import com.chartboost.chartboostmediationsdk.ad.ChartboostMediationBannerAdLoadResult;
import com.chartboost.chartboostmediationsdk.ad.ChartboostMediationBannerAdView;
import com.chartboost.chartboostmediationsdk.ad.ChartboostMediationBannerAdViewListener;
import com.chartboost.chartboostmediationsdk.ad.ChartboostMediationFullscreenAd;
import com.chartboost.chartboostmediationsdk.ad.ChartboostMediationFullscreenAdListener;
import com.chartboost.chartboostmediationsdk.ad.ChartboostMediationFullscreenAdLoadListener;
import com.chartboost.chartboostmediationsdk.ad.ChartboostMediationFullscreenAdLoadRequest;
import com.chartboost.chartboostmediationsdk.ad.ChartboostMediationFullscreenAdLoadResult;
import com.chartboost.chartboostmediationsdk.ad.ChartboostMediationFullscreenAdShowListener;
import com.chartboost.chartboostmediationsdk.domain.ChartboostMediationAdException;
import com.chartboost.chartboostmediationsdk.domain.Keywords;
import com.chartboost.core.ChartboostCore;
import com.chartboost.core.initialization.ModuleInitializationResult;
import com.chartboost.core.initialization.ModuleObserver;
import com.chartboost.core.initialization.SdkConfiguration;
import com.facebook.ads.AdSettings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.HashSet;

/**
 * Pont Capacitor vers <b>Chartboost Mediation</b> (médiation depuis 2.1.0).
 *
 * <p>Chartboost Mediation arbitre chaque demande et revend l'inventaire à
 * <b>Meta Audience Network</b> via l'adaptateur officiel
 * {@code com.chartboost:chartboost-mediation-adapter-meta-audience-network},
 * conformément à la documentation Meta « Bidding → Partner mediation →
 * Chartboost » :</p>
 *
 * <pre>
 * https://developers.facebook.com/documentation/audience-network/bidding/partner-mediation/chartboost
 * </pre>
 *
 * <p>Le nom du plugin Capacitor reste {@code MetaAds} pour que
 * {@code src/lib/ads.ts} n'ait pas à changer : seul le moteur natif change.</p>
 *
 * <h3>Ad locations Chartboost (dashboard Mediation → Placements)</h3>
 * <table>
 *   <tr><th>Nom</th><th>Format déclaré</th><th>Enchère</th></tr>
 *   <tr><td>{@code inter}</td><td>INTERSTITIAL</td><td>BIDDING</td></tr>
 *   <tr><td>{@code reward}</td><td>REWARDED</td><td>BIDDING</td></tr>
 *   <tr><td>{@code banner}</td><td><b>INTERSTITIAL</b></td><td>BIDDING</td></tr>
 * </table>
 *
 * <p><b>Conséquence assumée :</b> aucune des trois ad locations n'est au format
 * bannière (la location {@code banner} a été créée en INTERSTITIAL). Le SDK ne
 * peut donc pas remplir de bandeau 320×50, et
 * {@link #showBanner} / {@link #showNativeBanner} résolvent immédiatement avec
 * une hauteur nulle : la WebView ne réserve alors aucun espace en bas d'écran
 * (variable CSS {@code --ad-banner-h}) et la barre d'onglets reste collée au
 * bord. La location {@code banner} est utilisée en plein écran, sur une action
 * explicite de l'utilisateur (retrait ElyCoins), là où l'ancien encart 300×250
 * s'affichait.</p>
 *
 * <p><b>Consentement.</b> Aucune annonce n'est demandée tant que {@link
 * #setConsent} n'a pas été appelé (garde-fou applicatif de
 * {@code src/lib/adConsent.ts}). Le refus est transmis à Meta Audience Network
 * via {@link AdSettings#setDataProcessingOptions} en mode <em>Limited Data
 * Use</em>. Une CMP IAB TCF v2 enregistrée peut être branchée plus tard en
 * passant un module {@code ConsentAdapter} à {@link SdkConfiguration} (voir
 * DEPLOYMENT.md) ; en attendant, Chartboost Core n'expose pas d'API publique
 * d'écriture du consentement, d'où ce double garde-fou applicatif + LDU.</p>
 */
@CapacitorPlugin(name = "MetaAds")
public class ChartboostMediationAdsPlugin extends Plugin {

    private static final String TAG = "ElyWalkChartboost";
    private static final int BANNER_HEIGHT_DP = 50;
    private static final int RECTANGLE_WIDTH_DP = 300;
    private static final long LOAD_TIMEOUT_MS = 15000L;
    /** Délai d'affichage : court tant que l'annonce est à l'écran. */
    private static final long SHOW_TIMEOUT_MS = 120000L;

    private final Handler main = new Handler(Looper.getMainLooper());

    private ChartboostMediationFullscreenAd interstitialAd;
    private ChartboostMediationFullscreenAd rewardedAd;

    private ChartboostMediationBannerAdView bannerView;
    private ChartboostMediationBannerAdView rectangleView;

    /** Hôte transparent superposé à la WebView (bannière, surcouches). */
    private FrameLayout adHost;
    /** Conteneur ancré en bas (réservé au bandeau, vide aujourd'hui). */
    private FrameLayout bottomContainer;
    /** Surcouche plein écran (encart de retrait, carte de fin de sortie). */
    private FrameLayout overlayContainer;

    private PluginCall pendingInterstitialShow;
    private PluginCall pendingRewardedShow;
    private boolean rewardedCompleted;
    private boolean personalized = false;
    private boolean initialized = false;

    // ------------------------------------------------------------------------
    // Utilitaires
    // ------------------------------------------------------------------------

    private float density() {
        Context context = getContext();
        return context == null || context.getResources() == null
                ? 1f
                : context.getResources().getDisplayMetrics().density;
    }

    private int dp(float value) {
        return Math.round(value * density());
    }

    private void runOnUi(Runnable action) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            action.run();
        } else {
            main.post(action);
        }
    }

    private JSObject object(String key, Object value) {
        JSObject result = new JSObject();
        result.put(key, value);
        return result;
    }

    /** Garantit une résolution unique d'un appel (les callbacks SDK peuvent doubler). */
    private static final class Once {
        private boolean used;

        boolean claim() {
            if (used) return false;
            used = true;
            return true;
        }
    }

    private Activity activity() {
        if (getActivity() != null) return getActivity();
        return getBridge() == null ? null : getBridge().getActivity();
    }

    private static boolean isDebuggable(Context context) {
        return (context.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    /**
     * Hôte unique ajouté au-dessus de la WebView.
     *
     * <p>{@code ViewGroup.generateLayoutParams(...)} étant {@code protected}, le
     * parent est casté s'il s'agit déjà d'un {@code FrameLayout} (cas de
     * Capacitor) ; sinon l'hôte est ajouté sans paramètres puis redimensionné.</p>
     */
    private FrameLayout ensureAdHost() {
        if (adHost != null) return adHost;
        if (getBridge() == null) return null;

        View webView = getBridge().getWebView();
        if (webView == null || !(webView.getParent() instanceof ViewGroup)) return null;
        ViewGroup parent = (ViewGroup) webView.getParent();

        adHost = new FrameLayout(getContext());
        adHost.setClipChildren(false);
        adHost.setClipToPadding(false);

        if (parent instanceof FrameLayout) {
            parent.addView(adHost, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
            ));
        } else {
            parent.addView(adHost);
            ViewGroup.LayoutParams lp = adHost.getLayoutParams();
            if (lp == null) {
                adHost.setLayoutParams(new ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                ));
            } else {
                lp.width = ViewGroup.LayoutParams.MATCH_PARENT;
                lp.height = ViewGroup.LayoutParams.MATCH_PARENT;
                adHost.setLayoutParams(lp);
            }
        }
        return adHost;
    }

    private FrameLayout ensureBottomContainer() {
        if (bottomContainer == null) {
            FrameLayout host = ensureAdHost();
            if (host == null) return null;
            bottomContainer = new FrameLayout(getContext());
            FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
            );
            params.gravity = Gravity.BOTTOM;
            // Android 15+ impose l'affichage sous les barres système : le
            // bandeau est remonté au-dessus de la barre de navigation.
            bottomContainer.setOnApplyWindowInsetsListener((view, insets) -> {
                int bottom;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    bottom = insets.getInsets(WindowInsets.Type.systemBars()).bottom;
                } else {
                    bottom = insets.getSystemWindowInsetBottom();
                }
                view.setPadding(0, 0, 0, bottom);
                return insets;
            });
            host.addView(bottomContainer, params);
            bottomContainer.requestApplyInsets();
        }
        if (overlayContainer == null) bottomContainer.bringToFront();
        return bottomContainer;
    }

    private FrameLayout ensureOverlay() {
        if (overlayContainer == null) {
            FrameLayout host = ensureAdHost();
            if (host == null) return null;
            overlayContainer = new FrameLayout(getContext());
            overlayContainer.setBackgroundColor(Color.parseColor("#CC000000"));
            overlayContainer.setClickable(true);
            overlayContainer.setFocusable(true);
            FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
            );
            host.addView(overlayContainer, params);
        }
        overlayContainer.removeAllViews();
        overlayContainer.setVisibility(View.VISIBLE);
        overlayContainer.bringToFront();
        return overlayContainer;
    }

    private void closeOverlay() {
        destroyRectangle();
        if (overlayContainer == null) return;
        overlayContainer.removeAllViews();
        ViewGroup parent = (ViewGroup) overlayContainer.getParent();
        if (parent != null) parent.removeView(overlayContainer);
        overlayContainer = null;
    }

    /** Carte sombre arrondie (fond de la surcouche) + bouton de fermeture explicite. */
    private LinearLayout buildOverlayCard(View content, int widthPx) {
        Context context = getContext();
        LinearLayout card = new LinearLayout(context);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setGravity(Gravity.CENTER_HORIZONTAL);
        card.setBackgroundResource(R.drawable.meta_ad_card_bg);
        int padding = dp(12);
        card.setPadding(padding, padding, padding, padding);

        LinearLayout header = new LinearLayout(context);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);

        TextView label = new TextView(context);
        label.setText("Publicité");
        label.setTextColor(Color.parseColor("#B0ACA2"));
        label.setTextSize(12f);
        label.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        header.addView(label, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        TextView close = new TextView(context);
        close.setText("✕");
        close.setTextColor(Color.parseColor("#D8CA82"));
        close.setTextSize(17f);
        close.setGravity(Gravity.CENTER);
        close.setContentDescription("Fermer la publicité");
        close.setOnClickListener(v -> closeOverlay());
        header.addView(close, new LinearLayout.LayoutParams(dp(40), dp(40)));

        card.addView(header, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        if (content != null) {
            card.addView(content, new LinearLayout.LayoutParams(
                    widthPx > 0 ? widthPx : ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
            ));
        }
        return card;
    }

    private boolean centerInOverlay(View card) {
        FrameLayout overlay = ensureOverlay();
        if (overlay == null) return false;
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        params.gravity = Gravity.CENTER;
        int margin = dp(16);
        params.setMargins(margin, margin, margin, margin);
        overlay.addView(card, params);
        return true;
    }

    // ------------------------------------------------------------------------
    // Cycle de vie
    // ------------------------------------------------------------------------

    @Override
    protected void handleOnDestroy() {
        destroyInterstitial();
        destroyRewarded();
        destroyBanner();
        destroyRectangle();
        closeOverlay();
        if (bottomContainer != null) {
            bottomContainer.removeAllViews();
            bottomContainer = null;
        }
        if (adHost != null) {
            adHost.removeAllViews();
            ViewGroup parent = (ViewGroup) adHost.getParent();
            if (parent != null) parent.removeView(adHost);
            adHost = null;
        }
        super.handleOnDestroy();
    }

    // ------------------------------------------------------------------------
    // Initialisation & consentement
    // ------------------------------------------------------------------------

    /**
     * Initialise Chartboost Core, qui initialise Chartboost Mediation puis
     * l'adaptateur Meta Audience Network. Résout seulement quand le module
     * Mediation a répondu : la WebView n'envoie jamais de demande d'annonce
     * avant que le SDK soit réellement prêt.
     */
    @PluginMethod
    public void initialize(final PluginCall call) {
        final Context context = getContext();
        if (context == null) {
            call.reject("Contexte indisponible");
            return;
        }
        if (initialized) {
            call.resolve();
            return;
        }
        final String appId = call.getString("appId");
        if (appId == null || appId.trim().isEmpty()) {
            // Sans identifiant Chartboost, aucune publicité ne peut être
            // demandée : on le signale sans bloquer l'application.
            Log.w(TAG, "Chartboost appId manquant — publicités désactivées");
            call.resolve();
            return;
        }

        final Once once = new Once();
        try {
            final SdkConfiguration configuration = new SdkConfiguration(
                    appId.trim(),
                    new ArrayList<>(),
                    new HashSet<>()
            );

            ChartboostCore.initializeSdkFromJava(context, configuration, new ModuleObserver() {
                @Override
                public void onModuleInitializationCompleted(@NonNull ModuleInitializationResult result) {
                    if (!ChartboostMediationSdk.CORE_MODULE_ID.equals(result.getModuleId())) return;
                    if (result.getException() != null) {
                        Log.w(TAG, "Mediation init: " + result.getException().getMessage());
                    } else {
                        Log.d(TAG, "Chartboost Mediation prêt (v" + result.getModuleVersion() + ")");
                    }
                    // Test mode : le SDK ignore l'appel hors compilation debug.
                    if (isDebuggable(context)) {
                        ChartboostMediationSdk.setTestMode(context, true);
                    }
                    applyConsentToMeta();
                    initialized = true;
                    runOnUi(() -> {
                        if (once.claim()) call.resolve();
                    });
                }
            });

            main.postDelayed(() -> {
                if (once.claim()) {
                    Log.e(TAG, "Chartboost init timed out");
                    call.reject("Délai dépassé pendant l'initialisation de Chartboost Mediation");
                }
            }, LOAD_TIMEOUT_MS);
        } catch (Throwable t) {
            Log.e(TAG, "Chartboost init failed", t);
            if (once.claim()) {
                call.reject("Échec d'initialisation de Chartboost Mediation: " + t.getMessage());
            }
        }
    }

    /**
     * Applique le choix RGPD au partenaire qui sert réellement l'inventaire :
     * Meta Audience Network. En cas de refus, le mode <em>Limited Data Use</em>
     * est activé (aucun identifiant publicitaire exploité pour du ciblage).
     */
    private void applyConsentToMeta() {
        try {
            if (personalized) {
                AdSettings.setDataProcessingOptions(new String[]{}, 0, 0);
            } else {
                AdSettings.setDataProcessingOptions(new String[]{"LDU"}, 0, 0);
            }
        } catch (Throwable t) {
            Log.w(TAG, "AdSettings.setDataProcessingOptions: " + t.getMessage());
        }
    }

    @PluginMethod
    public void setConsent(PluginCall call) {
        personalized = Boolean.TRUE.equals(call.getBoolean("personalized", false));
        applyConsentToMeta();
        Log.d(TAG, "Consentement publicitaire: "
                + (personalized ? "personnalisé" : "non personnalisé (LDU)"));
        call.resolve();
    }

    // ------------------------------------------------------------------------
    // Bandeau bas de page — aucune ad location « banner » disponible
    // ------------------------------------------------------------------------

    /**
     * Aucune ad location au format bannière n'existe côté Chartboost : la
     * promesse « une bannière sur chaque page » ne peut pas être tenue par
     * l'inventaire actuel. On résout avec une hauteur nulle pour ne pas laisser
     * de bande vide en bas de l'écran, sans jamais bloquer la navigation.
     */
    @PluginMethod
    public void showBanner(final PluginCall call) {
        Log.d(TAG, "showBanner: pas d'ad location bannière — hauteur 0");
        call.resolve(object("height", 0));
    }

    @PluginMethod
    public void showNativeBanner(final PluginCall call) {
        Log.d(TAG, "showNativeBanner: pas d'ad location bannière — hauteur 0");
        call.resolve(object("height", 0));
    }

    @PluginMethod
    public void hideBanner(PluginCall call) {
        runOnUi(() -> {
            destroyBanner();
            call.resolve();
        });
    }

    @PluginMethod
    public void hideNativeBanner(PluginCall call) {
        runOnUi(() -> {
            destroyBanner();
            call.resolve();
        });
    }

    private void destroyBanner() {
        if (bannerView != null) {
            try {
                bannerView.clearAd();
                bannerView.destroy();
            } catch (Throwable ignored) {
                /* déjà détruite */
            }
            if (bottomContainer != null) bottomContainer.removeView(bannerView);
            bannerView = null;
        }
    }

    // ------------------------------------------------------------------------
    // Interstitiel plein écran (ad location `inter`)
    // ------------------------------------------------------------------------

    @PluginMethod
    public void loadInterstitial(final PluginCall call) {
        final String placement = call.getString("placementId");
        if (placement == null) {
            call.reject("placementId manquant");
            return;
        }
        loadFullscreen(placement, false, call);
    }

    @PluginMethod
    public void showInterstitial(final PluginCall call) {
        runOnUi(() -> {
            if (interstitialAd == null) {
                call.resolve(object("shown", false));
                return;
            }
            pendingInterstitialShow = call;
            showFullscreen(interstitialAd);
            main.postDelayed(() -> resolvePendingInterstitial(true), SHOW_TIMEOUT_MS);
        });
    }

    // ------------------------------------------------------------------------
    // Interstitiel récompensé (ad location `reward`)
    // ------------------------------------------------------------------------

    @PluginMethod
    public void loadRewarded(final PluginCall call) {
        final String placement = call.getString("placementId");
        if (placement == null) {
            call.reject("placementId manquant");
            return;
        }
        loadFullscreen(placement, true, call);
    }

    @PluginMethod
    public void showRewarded(final PluginCall call) {
        runOnUi(() -> {
            if (rewardedAd == null) {
                call.resolve(object("rewarded", false));
                return;
            }
            pendingRewardedShow = call;
            rewardedCompleted = false;
            showFullscreen(rewardedAd);
            main.postDelayed(() -> resolvePendingRewarded(rewardedCompleted), SHOW_TIMEOUT_MS);
        });
    }

    /**
     * Charge un interstitiel ou un récompensé : Chartboost Mediation déduit le
     * format de l'ad location créée sur le dashboard, la méthode est commune.
     */
    private void loadFullscreen(final String placement, final boolean rewarded, final PluginCall call) {
        final Once once = new Once();
        final String key = rewarded ? "rewarded" : "loaded";

        try {
            final ChartboostMediationFullscreenAdLoadRequest request =
                    new ChartboostMediationFullscreenAdLoadRequest(placement, new Keywords());

            ChartboostMediationFullscreenAd.loadFullscreenAdFromJava(
                    getContext(),
                    request,
                    new ChartboostMediationFullscreenAdListener() {
                        @Override
                        public void onAdClicked(@NonNull ChartboostMediationFullscreenAd ad) {
                        }

                        @Override
                        public void onAdClosed(@NonNull ChartboostMediationFullscreenAd ad,
                                               @Nullable ChartboostMediationAdException error) {
                            if (rewarded) {
                                resolvePendingRewarded(rewardedCompleted);
                            } else {
                                resolvePendingInterstitial(true);
                            }
                        }

                        @Override
                        public void onAdRewarded(@NonNull ChartboostMediationFullscreenAd ad) {
                            rewardedCompleted = true;
                        }

                        @Override
                        public void onAdImpressionRecorded(@NonNull ChartboostMediationFullscreenAd ad) {
                        }

                        @Override
                        public void onAdExpired(@NonNull ChartboostMediationFullscreenAd ad) {
                            Log.d(TAG, "Annonce expirée: " + placement);
                            rewardedCompleted = false;
                        }
                    },
                    new ChartboostMediationFullscreenAdLoadListener() {
                        @Override
                        public void onAdLoaded(@NonNull ChartboostMediationFullscreenAdLoadResult result) {
                            if (result.getError() != null || result.getAd() == null) {
                                Log.w(TAG, "Chargement " + placement + ": "
                                        + (result.getError() == null
                                        ? "aucune annonce"
                                        : result.getError().getMessage()));
                                if (once.claim()) call.resolve(object(key, false));
                                return;
                            }
                            final ChartboostMediationFullscreenAd ad = result.getAd();
                            if (rewarded) {
                                destroyRewarded();
                                rewardedAd = ad;
                            } else {
                                destroyInterstitial();
                                interstitialAd = ad;
                            }
                            Log.d(TAG, "Annonce chargée: " + placement);
                            if (once.claim()) call.resolve(object(key, true));
                        }
                    }
            );

            main.postDelayed(() -> {
                if (once.claim()) call.resolve(object(key, false));
            }, LOAD_TIMEOUT_MS);
        } catch (Throwable t) {
            Log.e(TAG, "loadFullscreen: " + t.getMessage());
            if (once.claim()) call.resolve(object(key, false));
        }
    }

    private void showFullscreen(ChartboostMediationFullscreenAd ad) {
        final Activity activity = activity();
        if (activity == null) {
            resolvePendingInterstitial(false);
            resolvePendingRewarded(rewardedCompleted);
            return;
        }
        try {
            ad.showFullscreenAdFromJava(activity, new ChartboostMediationFullscreenAdShowListener() {
                @Override
                public void onAdShown(@NonNull ChartboostMediationAdShowResult result) {
                    if (result.getError() != null) {
                        Log.w(TAG, "Affichage: " + result.getError().getMessage());
                        resolvePendingInterstitial(false);
                        resolvePendingRewarded(rewardedCompleted);
                    }
                }
            });
        } catch (Throwable t) {
            Log.e(TAG, "show: " + t.getMessage());
            resolvePendingInterstitial(false);
            resolvePendingRewarded(rewardedCompleted);
        }
    }

    private void resolvePendingInterstitial(boolean shown) {
        if (pendingInterstitialShow == null) return;
        PluginCall call = pendingInterstitialShow;
        pendingInterstitialShow = null;
        call.resolve(object("shown", shown));
        destroyInterstitial();
    }

    private void resolvePendingRewarded(boolean rewarded) {
        if (pendingRewardedShow == null) return;
        PluginCall call = pendingRewardedShow;
        pendingRewardedShow = null;
        call.resolve(object("rewarded", rewarded));
        destroyRewarded();
    }

    private void destroyInterstitial() {
        if (interstitialAd != null) {
            try {
                interstitialAd.invalidate();
            } catch (Throwable ignored) {
                /* déjà invalidée */
            }
            interstitialAd = null;
        }
    }

    private void destroyRewarded() {
        if (rewardedAd != null) {
            try {
                rewardedAd.invalidate();
            } catch (Throwable ignored) {
                /* déjà invalidée */
            }
            rewardedAd = null;
        }
        rewardedCompleted = false;
    }

    // ------------------------------------------------------------------------
    // Encart avant retrait d'ElyCoins
    // ------------------------------------------------------------------------

    /**
     * Avant un retrait, l'application demandait un medium rectangle 300×250.
     * Aucune ad location de ce format n'existe : on tente d'abord une bannière
     * MEDIUM sur la location transmise, puis on retombe sur le plein écran de
     * cette location (créée en INTERSTITIAL) sur une action explicite de
     * l'utilisateur — jamais au démarrage, jamais en boucle.
     */
    @PluginMethod
    public void showMediumRectangle(final PluginCall call) {
        final String placement = call.getString("placementId");
        if (placement == null) {
            call.reject("placementId manquant");
            return;
        }
        final Once once = new Once();

        runOnUi(() -> {
            destroyRectangle();
            if (ensureOverlay() == null) {
                if (once.claim()) call.resolve(object("shown", false));
                return;
            }

            final ChartboostMediationBannerAdView view = new ChartboostMediationBannerAdView(
                    getContext(),
                    placement,
                    ChartboostMediationBannerAdView.ChartboostMediationBannerSize.MEDIUM,
                    bannerViewListener()
            );
            rectangleView = view;

            final LinearLayout card = buildOverlayCard(view, dp(RECTANGLE_WIDTH_DP));
            centerInOverlay(card);

            view.loadFromJava(
                    new ChartboostMediationBannerAdLoadRequest(
                            placement,
                            new Keywords(),
                            ChartboostMediationBannerAdView.ChartboostMediationBannerSize.MEDIUM
                    ),
                    new ChartboostMediationBannerAdLoadListener() {
                        @Override
                        public void onAdLoaded(@NonNull ChartboostMediationBannerAdLoadResult result) {
                            if (result.getError() != null) {
                                Log.d(TAG, "Medium rectangle indisponible ("
                                        + result.getError().getMessage()
                                        + ") — repli sur le plein écran");
                                closeOverlay();
                                destroyRectangle();
                                // Repli : plein écran de la même location.
                                loadAndShowOnce(placement);
                                if (once.claim()) call.resolve(object("shown", false));
                                return;
                            }
                            if (once.claim()) call.resolve(object("shown", true));
                        }
                    }
            );

            main.postDelayed(() -> {
                if (once.claim()) {
                    closeOverlay();
                    destroyRectangle();
                    call.resolve(object("shown", false));
                }
            }, LOAD_TIMEOUT_MS);
        });
    }

    /** Charge puis affiche immédiatement un plein écran, sans attendre la WebView. */
    private void loadAndShowOnce(final String placement) {
        final ChartboostMediationFullscreenAdLoadRequest request =
                new ChartboostMediationFullscreenAdLoadRequest(placement, new Keywords());
        try {
            ChartboostMediationFullscreenAd.loadFullscreenAdFromJava(
                    getContext(),
                    request,
                    fullscreenAdListener(false),
                    new ChartboostMediationFullscreenAdLoadListener() {
                        @Override
                        public void onAdLoaded(@NonNull ChartboostMediationFullscreenAdLoadResult result) {
                            if (result.getError() != null || result.getAd() == null) {
                                Log.w(TAG, "Repli plein écran " + placement + ": "
                                        + (result.getError() == null
                                        ? "aucune annonce"
                                        : result.getError().getMessage()));
                                return;
                            }
                            final Activity activity = activity();
                            if (activity == null) return;
                            final ChartboostMediationFullscreenAd ad = result.getAd();
                            destroyInterstitial();
                            interstitialAd = ad;
                            try {
                                ad.showFullscreenAdFromJava(activity, shown -> {
                                    if (shown.getError() != null) {
                                        Log.w(TAG, "Affichage " + placement + ": "
                                                + shown.getError().getMessage());
                                    }
                                });
                            } catch (Throwable t) {
                                Log.e(TAG, "show (repli): " + t.getMessage());
                            }
                        }
                    }
            );
        } catch (Throwable t) {
            Log.e(TAG, "loadAndShowOnce: " + t.getMessage());
        }
    }

    private void destroyRectangle() {
        if (rectangleView != null) {
            try {
                rectangleView.clearAd();
                rectangleView.destroy();
            } catch (Throwable ignored) {
                /* déjà détruit */
            }
            rectangleView = null;
        }
    }

    private ChartboostMediationBannerAdViewListener bannerViewListener() {
        return new ChartboostMediationBannerAdViewListener() {
            @Override
            public void onAdClicked(@NonNull String placement) {
            }

            @Override
            public void onAdImpressionRecorded(@NonNull String placement) {
            }

            @Override
            public void onAdViewAdded(@NonNull String placement, @Nullable View child) {
            }
        };
    }

    private ChartboostMediationFullscreenAdListener fullscreenAdListener(final boolean rewarded) {
        return new ChartboostMediationFullscreenAdListener() {
            @Override
            public void onAdClicked(@NonNull ChartboostMediationFullscreenAd ad) {
            }

            @Override
            public void onAdClosed(@NonNull ChartboostMediationFullscreenAd ad,
                                   @Nullable ChartboostMediationAdException error) {
                if (rewarded) {
                    resolvePendingRewarded(rewardedCompleted);
                } else {
                    resolvePendingInterstitial(true);
                }
            }

            @Override
            public void onAdRewarded(@NonNull ChartboostMediationFullscreenAd ad) {
                rewardedCompleted = true;
            }

            @Override
            public void onAdImpressionRecorded(@NonNull ChartboostMediationFullscreenAd ad) {
            }

            @Override
            public void onAdExpired(@NonNull ChartboostMediationFullscreenAd ad) {
                rewardedCompleted = false;
            }
        };
    }

    // ------------------------------------------------------------------------
    // Fin de sortie GPS — carte servie par l'application
    // ------------------------------------------------------------------------

    /**
     * Carte de fin de sortie GPS.
     *
     * <p>Aucun format natif n'existe sur le dashboard Chartboost : la carte est
     * peinte par l'application (bandeau « Publicité » fermable), sans requête
     * d'annonce supplémentaire — l'interstitiel de fin de sortie est déclenché
     * par {@code showInterstitial()} côté WebView.</p>
     */
    @PluginMethod
    public void showNativeCard(final PluginCall call) {
        runOnUi(() -> {
            final FrameLayout overlay = ensureOverlay();
            if (overlay == null) {
                call.resolve(object("shown", false));
                return;
            }

            final Context context = getContext();
            LinearLayout body = new LinearLayout(context);
            body.setOrientation(LinearLayout.VERTICAL);

            TextView title = new TextView(context);
            title.setText("ElyWalk × Elysium");
            title.setTextColor(Color.parseColor("#D8CA82"));
            title.setTextSize(17f);
            title.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
            body.addView(title);

            TextView text = new TextView(context);
            text.setText("Sortie enregistrée. Merci de marcher avec nous : "
                    + "la publicité finance vos ElyCoins.");
            text.setTextColor(Color.parseColor("#F2EFE7"));
            text.setTextSize(14f);
            text.setLineSpacing(dp(3), 1f);
            LinearLayout.LayoutParams textParams = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
            );
            textParams.topMargin = dp(8);
            body.addView(text, textParams);

            TextView close = new TextView(context);
            close.setText("Continuer");
            close.setTextColor(Color.parseColor("#111111"));
            close.setTextSize(14f);
            close.setGravity(Gravity.CENTER);
            close.setBackgroundResource(R.drawable.meta_ad_card_bg);
            close.setPadding(dp(12), dp(14), dp(12), dp(14));
            close.setContentDescription("Fermer la carte de fin de sortie");
            close.setOnClickListener(v -> closeOverlay());
            LinearLayout.LayoutParams closeParams = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
            );
            closeParams.topMargin = dp(14);
            body.addView(close, closeParams);

            final boolean shown = centerInOverlay(buildOverlayCard(body, dp(RECTANGLE_WIDTH_DP)));
            call.resolve(object("shown", shown));
        });
    }
}
