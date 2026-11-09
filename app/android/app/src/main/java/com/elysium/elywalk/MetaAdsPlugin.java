package com.elysium.elywalk;

import android.content.Context;
import android.graphics.Color;
import android.os.Build;
import android.graphics.Typeface;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.facebook.ads.Ad;
import com.facebook.ads.AdError;
import com.facebook.ads.AdListener;
import com.facebook.ads.AdOptionsView;
import com.facebook.ads.AdSettings;
import com.facebook.ads.AdSize;
import com.facebook.ads.AdView;
import com.facebook.ads.AudienceNetworkAds;
import com.facebook.ads.InterstitialAd;
import com.facebook.ads.InterstitialAdListener;
import com.facebook.ads.MediaView;
import com.facebook.ads.NativeAd;
import com.facebook.ads.NativeAdBase;
import com.facebook.ads.NativeAdLayout;
import com.facebook.ads.NativeAdListener;
import com.facebook.ads.NativeBannerAd;
import com.facebook.ads.RewardedInterstitialAd;
import com.facebook.ads.RewardedInterstitialAdListener;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;

/**
 * Pont Capacitor vers le SDK <b>Meta Audience Network</b> (ex-Google AdMob).
 *
 * <p>Formats exposés à la WebView :</p>
 * <ul>
 *   <li>{@code showBanner} / {@code hideBanner} — bannière 320×50 ancrée en bas
 *       (présente sur toutes les pages) ;</li>
 *   <li>{@code showNativeBanner} / {@code hideNativeBanner} — bandeau natif
 *       compact des listes ;</li>
 *   <li>{@code loadInterstitial} / {@code showInterstitial} — interstitiel
 *       plein écran (ouverture de l'app, validation des pas, fin de sortie) ;</li>
 *   <li>{@code loadRewarded} / {@code showRewarded} — interstitiel récompensé
 *       (vidéo → ElyCoins) ;</li>
 *   <li>{@code showMediumRectangle} — encart 300×250 avant un retrait ;</li>
 *   <li>{@code showNativeCard} — carte native de fin de sortie.</li>
 * </ul>
 *
 * <p>Aucune annonce n'est demandée tant que {@link #setConsent} n'a pas été
 * appelé : le SDK ne reçoit d'identifiant publicitaire (AAID) qu'après un
 * choix explicite de l'utilisateur (voir {@code src/lib/adConsent.ts}).</p>
 */
@CapacitorPlugin(name = "MetaAds")
public class MetaAdsPlugin extends Plugin {

    private static final String TAG = "ElyWalkMetaAds";
    private static final int BANNER_HEIGHT_DP = 50;
    private static final int RECTANGLE_WIDTH_DP = 300;
    private static final int RECTANGLE_HEIGHT_DP = 250;
    private static final long LOAD_TIMEOUT_MS = 15000L;
    private static final long SHOW_TIMEOUT_MS = 120000L;

    private final Handler main = new Handler(Looper.getMainLooper());

    private InterstitialAd interstitialAd;
    private RewardedInterstitialAd rewardedAd;
    private AdView bannerAdView;
    private NativeBannerAd nativeBannerAd;
    private NativeAd nativeCardAd;
    private AdView rectangleAdView;

    /** Hôte transparent superposé à la WebView (bannière, bandeau, surcouches). */
    private FrameLayout adHost;
    /** Conteneur ancré en bas (bannière ou bandeau natif). */
    private FrameLayout bottomContainer;
    /** Surcouche plein écran (medium rectangle, carte native). */
    private FrameLayout overlayContainer;

    private PluginCall pendingInterstitialShow;
    private PluginCall pendingRewardedShow;
    private boolean rewardedCompleted;
    private boolean personalized = false;

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

    /** Convertit une hauteur en pixels physiques vers des px CSS (= dp Android). */
    private int pxToCss(int px) {
        float d = density();
        return d > 0f ? Math.round(px / d) : px;
    }

    private void runOnUi(Runnable action) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            action.run();
        } else {
            main.post(action);
        }
    }

    /**
     * Conteneur hôte unique, ajouté une seule fois au-dessus de la WebView.
     *
     * <p>{@code ViewGroup.generateLayoutParams(...)} étant {@code protected}, on
     * n'essaie plus de convertir les {@link FrameLayout.LayoutParams} pour un
     * parent quelconque : le parent est casté s'il s'agit déjà d'un
     * {@code FrameLayout} (cas de Capacitor), sinon on ajoute l'hôte sans
     * paramètres puis on fixe sa taille sur les {@code LayoutParams} générés par
     * le parent lui-même.</p>
     */
    private FrameLayout ensureAdHost() {
        if (adHost != null) return adHost;

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
            // Parent d'un autre type (LinearLayout de customisation, etc.) :
            // addView() sans paramètres laisse le parent générer les siens,
            // qu'on redimensionne ensuite.
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

    /** Garantit une résolution unique d'un appel (les callbacks SDK peuvent doubler). */
    private static final class Once {
        private boolean used;

        boolean claim() {
            if (used) return false;
            used = true;
            return true;
        }
    }

    private JSObject object(String key, Object value) {
        JSObject result = new JSObject();
        result.put(key, value);
        return result;
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
            // Android 15+ impose l'affichage sous les barres système : on
            // remonte la bannière au-dessus de la barre de navigation.
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
        // La surcouche publicitaire doit rester au-dessus de la bannière.
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
        destroyNativeCard();
        if (overlayContainer == null) return;
        overlayContainer.removeAllViews();
        ViewGroup parent = (ViewGroup) overlayContainer.getParent();
        if (parent != null) parent.removeView(overlayContainer);
        overlayContainer = null;
    }

    /**
     * Carte sombre arrondie (fond de la surcouche publicitaire) + bouton de
     * fermeture explicite, exigé par les règles Meta / Play sur les formats
     * non plein écran.
     */
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
        header.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        TextView label = new TextView(context);
        label.setText("Publicité");
        label.setTextColor(Color.parseColor("#98948A"));
        label.setTextSize(11f);
        label.setTypeface(Typeface.DEFAULT_BOLD);
        LinearLayout.LayoutParams labelParams = new LinearLayout.LayoutParams(
                0,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                1f
        );
        header.addView(label, labelParams);

        TextView close = new TextView(context);
        close.setText("✕");
        close.setTextColor(Color.parseColor("#D8CA82"));
        close.setTextSize(16f);
        close.setGravity(Gravity.CENTER);
        close.setContentDescription("Fermer la publicité");
        close.setOnClickListener(v -> closeOverlay());
        header.addView(close, new LinearLayout.LayoutParams(dp(32), dp(32)));

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
        destroyNativeBanner();
        destroyNativeCard();
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

    @PluginMethod
    public void initialize(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Contexte indisponible");
            return;
        }
        if (!AudienceNetworkAds.isInitialized(context)) {
            AudienceNetworkAds.buildInitSettings(context)
                    .withInitListener(new AudienceNetworkAds.InitListener() {
                        @Override
                        public void onInitialized(AudienceNetworkAds.InitResult result) {
                            Log.d(TAG, "SDK init: " + result.getMessage());
                        }
                    })
                    .initialize();
        }
        call.resolve();
    }

    /**
     * Applique le choix RGPD au SDK : annonces personnalisées, ou Limited Data
     * Use (annonces contextuelles) en cas de refus. Aucun identifiant
     * publicitaire n'est exploité avant cet appel.
     */
    @PluginMethod
    public void setConsent(PluginCall call) {
        personalized = Boolean.TRUE.equals(call.getBoolean("personalized", false));
        try {
            if (personalized) {
                AdSettings.setDataProcessingOptions(new String[]{}, 0, 0);
            } else {
                AdSettings.setDataProcessingOptions(new String[]{"LDU"}, 0, 0);
            }
        } catch (Throwable t) {
            Log.w(TAG, "AdSettings.setDataProcessingOptions: " + t.getMessage());
        }
        Log.d(TAG, "Consentement publicitaire: " + (personalized ? "personnalisé" : "non personnalisé"));
        call.resolve();
    }

    // ------------------------------------------------------------------------
    // Bannière 320×50 (bas de page, toutes les pages)
    // ------------------------------------------------------------------------

    @PluginMethod
    public void showBanner(final PluginCall call) {
        final String placementId = call.getString("placementId");
        if (placementId == null) {
            call.reject("placementId manquant");
            return;
        }
        final Once once = new Once();
        final boolean[] notified = {false};

        runOnUi(() -> {
            destroyBanner();
            destroyNativeBanner();

            final FrameLayout container = ensureBottomContainer();
            if (container == null) {
                if (once.claim()) call.resolve(object("height", 0));
                return;
            }

            final AdView adView = new AdView(getContext(), placementId, AdSize.BANNER_HEIGHT_50);
            bannerAdView = adView;
            container.removeAllViews();
            container.addView(adView, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    dp(BANNER_HEIGHT_DP)
            ));

            adView.loadAd(adView.buildLoadAdConfig()
                    .withAdListener(new AdListener() {
                        @Override
                        public void onError(Ad ad, AdError adError) {
                            Log.w(TAG, "Bannière: " + adError.getErrorMessage());
                            if (!notified[0]) {
                                notified[0] = true;
                                container.removeAllViews();
                            }
                            if (once.claim()) call.resolve(object("height", 0));
                        }

                        @Override
                        public void onAdLoaded(Ad ad) {
                            if (!notified[0]) notified[0] = true;
                            if (once.claim()) call.resolve(object("height", BANNER_HEIGHT_DP));
                        }

                        @Override
                        public void onAdClicked(Ad ad) {
                        }

                        @Override
                        public void onLoggingImpression(Ad ad) {
                        }
                    })
                    .build());

            main.postDelayed(() -> {
                if (once.claim()) call.resolve(object("height", 0));
            }, LOAD_TIMEOUT_MS);
        });
    }

    @PluginMethod
    public void hideBanner(PluginCall call) {
        runOnUi(() -> {
            destroyBanner();
            call.resolve();
        });
    }

    private void destroyBanner() {
        if (bannerAdView != null) {
            try {
                bannerAdView.destroy();
            } catch (Throwable ignored) {
                /* déjà détruite */
            }
            if (bottomContainer != null) bottomContainer.removeView(bannerAdView);
            bannerAdView = null;
        }
    }

    // ------------------------------------------------------------------------
    // Native banner compact (listes)
    // ------------------------------------------------------------------------

    @PluginMethod
    public void showNativeBanner(final PluginCall call) {
        final String placementId = call.getString("placementId");
        if (placementId == null) {
            call.reject("placementId manquant");
            return;
        }
        final Once once = new Once();

        runOnUi(() -> {
            destroyNativeBanner();
            destroyBanner();

            final NativeBannerAd nativeBanner = new NativeBannerAd(getContext(), placementId);
            nativeBannerAd = nativeBanner;

            nativeBanner.loadAd(nativeBanner.buildLoadAdConfig()
                    .withAdListener(new NativeAdListener() {
                        @Override
                        public void onMediaDownloaded(Ad ad) {
                        }

                        @Override
                        public void onError(Ad ad, AdError adError) {
                            Log.w(TAG, "Native banner: " + adError.getErrorMessage());
                            if (once.claim()) call.resolve(object("height", 0));
                        }

                        @Override
                        public void onAdLoaded(Ad ad) {
                            if (ad != nativeBannerAd) return;
                            if (once.claim()) {
                                call.resolve(object("height", inflateNativeBanner(nativeBanner)));
                            }
                        }

                        @Override
                        public void onAdClicked(Ad ad) {
                        }

                        @Override
                        public void onLoggingImpression(Ad ad) {
                        }
                    })
                    .build());

            main.postDelayed(() -> {
                if (once.claim()) call.resolve(object("height", 0));
            }, LOAD_TIMEOUT_MS);
        });
    }

    /** Gonfle le bandeau natif compact et le renvoie (hauteur en px CSS). */
    private int inflateNativeBanner(NativeBannerAd nativeBanner) {
        try {
            LayoutInflater inflater = LayoutInflater.from(getContext());
            NativeAdLayout container = (NativeAdLayout) inflater.inflate(
                    R.layout.meta_ad_native_banner_container, null);
            View unit = inflater.inflate(R.layout.meta_ad_native_banner_unit, container, false);
            container.addView(unit);

            nativeBanner.unregisterView();

            MediaView icon = unit.findViewById(R.id.meta_ad_icon);
            TextView title = unit.findViewById(R.id.meta_ad_title);
            TextView socialContext = unit.findViewById(R.id.meta_ad_social_context);
            TextView sponsored = unit.findViewById(R.id.meta_ad_sponsored);
            Button cta = unit.findViewById(R.id.meta_ad_cta);
            LinearLayout adChoicesContainer = unit.findViewById(R.id.ad_choices_container);

            title.setText(nativeBanner.getAdvertiserName());
            socialContext.setText(nativeBanner.getAdSocialContext());
            sponsored.setText(nativeBanner.getSponsoredTranslation());
            if (nativeBanner.hasCallToAction()) {
                cta.setVisibility(View.VISIBLE);
                cta.setText(nativeBanner.getAdCallToAction());
            } else {
                cta.setVisibility(View.GONE);
            }

            AdOptionsView adOptions = new AdOptionsView(getContext(), nativeBanner, container);
            adChoicesContainer.removeAllViews();
            adChoicesContainer.addView(adOptions, 0);

            List<View> clickableViews = new ArrayList<>();
            clickableViews.add(title);
            clickableViews.add(cta);
            nativeBanner.registerViewForInteraction(unit, icon, clickableViews);

            FrameLayout bottom = ensureBottomContainer();
            if (bottom == null) return 0;
            bottom.removeAllViews();
            bottom.addView(container, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
            ));

            final int[] height = {dp(76)};
            bottom.post(() -> {
                if (bottom.getHeight() > 0) height[0] = bottom.getHeight();
            });
            return pxToCss(height[0]);
        } catch (Throwable t) {
            Log.e(TAG, "inflateNativeBanner: " + t.getMessage());
            return 0;
        }
    }

    @PluginMethod
    public void hideNativeBanner(PluginCall call) {
        runOnUi(() -> {
            destroyNativeBanner();
            call.resolve();
        });
    }

    private void destroyNativeBanner() {
        if (nativeBannerAd != null) {
            try {
                nativeBannerAd.unregisterView();
            } catch (Throwable ignored) {
                /* vue déjà détachée */
            }
            try {
                nativeBannerAd.destroy();
            } catch (Throwable ignored) {
                /* déjà détruit */
            }
            nativeBannerAd = null;
        }
        if (bottomContainer != null) bottomContainer.removeAllViews();
    }

    // ------------------------------------------------------------------------
    // Interstitiel plein écran
    // ------------------------------------------------------------------------

    @PluginMethod
    public void loadInterstitial(final PluginCall call) {
        final String placementId = call.getString("placementId");
        if (placementId == null) {
            call.reject("placementId manquant");
            return;
        }
        final Once once = new Once();

        runOnUi(() -> {
            destroyInterstitial();
            final InterstitialAd ad = new InterstitialAd(getContext(), placementId);
            interstitialAd = ad;

            ad.loadAd(ad.buildLoadAdConfig()
                    .withAdListener(new InterstitialAdListener() {
                        @Override
                        public void onInterstitialDisplayed(Ad ad) {
                        }

                        @Override
                        public void onInterstitialDismissed(Ad ad) {
                            resolvePendingInterstitial(true);
                        }

                        @Override
                        public void onError(Ad ad, AdError adError) {
                            Log.w(TAG, "Interstitiel: " + adError.getErrorMessage());
                            if (once.claim()) call.resolve(object("loaded", false));
                            resolvePendingInterstitial(false);
                        }

                        @Override
                        public void onAdLoaded(Ad ad) {
                            if (once.claim()) call.resolve(object("loaded", true));
                        }

                        @Override
                        public void onAdClicked(Ad ad) {
                        }

                        @Override
                        public void onLoggingImpression(Ad ad) {
                        }
                    })
                    .build());

            main.postDelayed(() -> {
                if (once.claim()) call.resolve(object("loaded", false));
            }, LOAD_TIMEOUT_MS);
        });
    }

    @PluginMethod
    public void showInterstitial(final PluginCall call) {
        runOnUi(() -> {
            if (interstitialAd == null || !interstitialAd.isAdLoaded() || interstitialAd.isAdInvalidated()) {
                call.resolve(object("shown", false));
                return;
            }
            pendingInterstitialShow = call;
            try {
                interstitialAd.show();
            } catch (Throwable t) {
                Log.e(TAG, "showInterstitial: " + t.getMessage());
                resolvePendingInterstitial(false);
                return;
            }
            main.postDelayed(() -> resolvePendingInterstitial(false), SHOW_TIMEOUT_MS);
        });
    }

    private void resolvePendingInterstitial(boolean shown) {
        if (pendingInterstitialShow == null) return;
        PluginCall call = pendingInterstitialShow;
        pendingInterstitialShow = null;
        call.resolve(object("shown", shown));
    }

    private void destroyInterstitial() {
        resolvePendingInterstitial(false);
        if (interstitialAd != null) {
            try {
                interstitialAd.destroy();
            } catch (Throwable ignored) {
                /* déjà détruit */
            }
            interstitialAd = null;
        }
    }

    // ------------------------------------------------------------------------
    // Interstitiel récompensé (vidéo → ElyCoins)
    // ------------------------------------------------------------------------

    @PluginMethod
    public void loadRewarded(final PluginCall call) {
        final String placementId = call.getString("placementId");
        if (placementId == null) {
            call.reject("placementId manquant");
            return;
        }
        final Once once = new Once();

        runOnUi(() -> {
            destroyRewarded();
            rewardedCompleted = false;
            final RewardedInterstitialAd ad = new RewardedInterstitialAd(getContext(), placementId);
            rewardedAd = ad;

            ad.loadAd(ad.buildLoadAdConfig()
                    .withAdListener(new RewardedInterstitialAdListener() {
                        @Override
                        public void onError(Ad ad, AdError error) {
                            Log.w(TAG, "Récompensée: " + error.getErrorMessage());
                            if (once.claim()) call.resolve(object("loaded", false));
                            resolvePendingRewarded(false);
                        }

                        @Override
                        public void onAdLoaded(Ad ad) {
                            if (once.claim()) call.resolve(object("loaded", true));
                        }

                        @Override
                        public void onAdClicked(Ad ad) {
                        }

                        @Override
                        public void onLoggingImpression(Ad ad) {
                        }

                        @Override
                        public void onRewardedInterstitialCompleted() {
                            // Vidéo visionnée jusqu'au bout : la récompense peut
                            // être créditée (voir HomePage.onWatchAd).
                            rewardedCompleted = true;
                        }

                        @Override
                        public void onRewardedInterstitialClosed() {
                            resolvePendingRewarded(rewardedCompleted);
                        }
                    })
                    .build());

            main.postDelayed(() -> {
                if (once.claim()) call.resolve(object("loaded", false));
            }, LOAD_TIMEOUT_MS);
        });
    }

    @PluginMethod
    public void showRewarded(final PluginCall call) {
        runOnUi(() -> {
            if (rewardedAd == null || !rewardedAd.isAdLoaded() || rewardedAd.isAdInvalidated()) {
                call.resolve(object("rewarded", false));
                return;
            }
            pendingRewardedShow = call;
            try {
                rewardedAd.show(rewardedAd.buildShowAdConfig().build());
            } catch (Throwable t) {
                Log.e(TAG, "showRewarded: " + t.getMessage());
                resolvePendingRewarded(false);
                return;
            }
            main.postDelayed(() -> resolvePendingRewarded(rewardedCompleted), SHOW_TIMEOUT_MS);
        });
    }

    private void resolvePendingRewarded(boolean rewarded) {
        if (pendingRewardedShow == null) return;
        PluginCall call = pendingRewardedShow;
        pendingRewardedShow = null;
        call.resolve(object("rewarded", rewarded));
    }

    private void destroyRewarded() {
        resolvePendingRewarded(false);
        if (rewardedAd != null) {
            try {
                rewardedAd.destroy();
            } catch (Throwable ignored) {
                /* déjà détruit */
            }
            rewardedAd = null;
        }
    }

    // ------------------------------------------------------------------------
    // Medium rectangle 300×250 (retrait d'ElyCoins)
    // ------------------------------------------------------------------------

    @PluginMethod
    public void showMediumRectangle(final PluginCall call) {
        final String placementId = call.getString("placementId");
        if (placementId == null) {
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

            final AdView adView = new AdView(getContext(), placementId, AdSize.RECTANGLE_HEIGHT_250);
            rectangleAdView = adView;

            LinearLayout card = buildOverlayCard(adView, dp(RECTANGLE_WIDTH_DP));
            centerInOverlay(card);

            adView.post(() -> {
                ViewGroup.LayoutParams params = adView.getLayoutParams();
                params.width = dp(RECTANGLE_WIDTH_DP);
                params.height = dp(RECTANGLE_HEIGHT_DP);
                adView.setLayoutParams(params);
            });

            adView.loadAd(adView.buildLoadAdConfig()
                    .withAdListener(new AdListener() {
                        @Override
                        public void onError(Ad ad, AdError adError) {
                            Log.w(TAG, "Medium rectangle: " + adError.getErrorMessage());
                            closeOverlay();
                            destroyRectangle();
                            if (once.claim()) call.resolve(object("shown", false));
                        }

                        @Override
                        public void onAdLoaded(Ad ad) {
                            if (once.claim()) call.resolve(object("shown", true));
                        }

                        @Override
                        public void onAdClicked(Ad ad) {
                        }

                        @Override
                        public void onLoggingImpression(Ad ad) {
                        }
                    })
                    .build());

            main.postDelayed(() -> {
                if (once.claim()) {
                    closeOverlay();
                    destroyRectangle();
                    call.resolve(object("shown", false));
                }
            }, LOAD_TIMEOUT_MS);
        });
    }

    private void destroyRectangle() {
        if (rectangleAdView != null) {
            try {
                rectangleAdView.destroy();
            } catch (Throwable ignored) {
                /* déjà détruit */
            }
            rectangleAdView = null;
        }
    }

    // ------------------------------------------------------------------------
    // Carte native (fin de sortie)
    // ------------------------------------------------------------------------

    @PluginMethod
    public void showNativeCard(final PluginCall call) {
        final String placementId = call.getString("placementId");
        if (placementId == null) {
            call.reject("placementId manquant");
            return;
        }
        final Once once = new Once();

        runOnUi(() -> {
            destroyNativeCard();
            final NativeAd ad = new NativeAd(getContext(), placementId);
            nativeCardAd = ad;

            ad.loadAd(ad.buildLoadAdConfig()
                    .withAdListener(new NativeAdListener() {
                        @Override
                        public void onMediaDownloaded(Ad ad) {
                        }

                        @Override
                        public void onError(Ad a, AdError adError) {
                            Log.w(TAG, "Carte native: " + adError.getErrorMessage());
                            closeOverlay();
                            destroyNativeCard();
                            if (once.claim()) call.resolve(object("shown", false));
                        }

                        @Override
                        public void onAdLoaded(Ad a) {
                            if (a != nativeCardAd) return;
                            if (once.claim()) {
                                call.resolve(object("shown", inflateNativeCard(ad)));
                            }
                        }

                        @Override
                        public void onAdClicked(Ad ad) {
                        }

                        @Override
                        public void onLoggingImpression(Ad ad) {
                        }
                    })
                    .build());

            main.postDelayed(() -> {
                if (once.claim()) {
                    closeOverlay();
                    destroyNativeCard();
                    call.resolve(object("shown", false));
                }
            }, LOAD_TIMEOUT_MS);
        });
    }

    /** Gonfle la carte native dans une surcouche refermable. */
    private boolean inflateNativeCard(NativeAd nativeAd) {
        try {
            LayoutInflater inflater = LayoutInflater.from(getContext());
            NativeAdLayout container = (NativeAdLayout) inflater.inflate(
                    R.layout.meta_ad_native_card_container, null);
            View unit = inflater.inflate(R.layout.meta_ad_native_card_unit, container, false);
            container.addView(unit);

            nativeAd.unregisterView();

            MediaView icon = unit.findViewById(R.id.meta_ad_icon);
            MediaView media = unit.findViewById(R.id.meta_ad_media);
            TextView title = unit.findViewById(R.id.meta_ad_title);
            TextView body = unit.findViewById(R.id.meta_ad_body);
            TextView socialContext = unit.findViewById(R.id.meta_ad_social_context);
            TextView sponsored = unit.findViewById(R.id.meta_ad_sponsored);
            Button cta = unit.findViewById(R.id.meta_ad_cta);
            LinearLayout adChoicesContainer = unit.findViewById(R.id.ad_choices_container);

            title.setText(nativeAd.getAdvertiserName());
            body.setText(nativeAd.getAdBodyText());
            socialContext.setText(nativeAd.getAdSocialContext());
            sponsored.setText(nativeAd.getSponsoredTranslation());
            if (nativeAd.hasCallToAction()) {
                cta.setVisibility(View.VISIBLE);
                cta.setText(nativeAd.getAdCallToAction());
            } else {
                cta.setVisibility(View.GONE);
            }

            AdOptionsView adOptions = new AdOptionsView(getContext(), nativeAd, container);
            adChoicesContainer.removeAllViews();
            adChoicesContainer.addView(adOptions, 0);

            List<View> clickableViews = new ArrayList<>();
            clickableViews.add(title);
            clickableViews.add(cta);
            nativeAd.registerViewForInteraction(unit, media, icon, clickableViews);

            LinearLayout card = buildOverlayCard(container, dp(RECTANGLE_WIDTH_DP));
            return centerInOverlay(card);
        } catch (Throwable t) {
            Log.e(TAG, "inflateNativeCard: " + t.getMessage());
            closeOverlay();
            return false;
        }
    }

    private void destroyNativeCard() {
        if (nativeCardAd != null) {
            try {
                nativeCardAd.unregisterView();
            } catch (Throwable ignored) {
                /* vue déjà détachée */
            }
            try {
                nativeCardAd.destroy();
            } catch (Throwable ignored) {
                /* déjà détruit */
            }
            nativeCardAd = null;
        }
    }
}
