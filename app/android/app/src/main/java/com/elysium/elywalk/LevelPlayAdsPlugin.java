package com.elysium.elywalk;

import android.app.Activity;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.Nullable;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.ironsource.mediationsdk.ads.nativead.LevelPlayMediaView;
import com.ironsource.mediationsdk.ads.nativead.LevelPlayNativeAd;
import com.ironsource.mediationsdk.ads.nativead.LevelPlayNativeAdListener;
import com.ironsource.mediationsdk.ads.nativead.NativeAdLayout;
import com.ironsource.mediationsdk.ads.nativead.interfaces.NativeAdDataInterface;
import com.ironsource.mediationsdk.adunit.adapter.utility.AdInfo;
import com.ironsource.mediationsdk.logger.IronSourceError;
import com.unity3d.mediation.LevelPlay;
import com.unity3d.mediation.LevelPlayAdError;
import com.unity3d.mediation.LevelPlayAdInfo;
import com.unity3d.mediation.LevelPlayAdSize;
import com.unity3d.mediation.LevelPlayConfiguration;
import com.unity3d.mediation.LevelPlayInitError;
import com.unity3d.mediation.LevelPlayInitListener;
import com.unity3d.mediation.LevelPlayInitRequest;
import com.unity3d.mediation.LevelPlayPrivacySettings;
import com.unity3d.mediation.banner.LevelPlayBannerAdView;
import com.unity3d.mediation.banner.LevelPlayBannerAdViewListener;
import com.unity3d.mediation.interstitial.LevelPlayInterstitialAd;
import com.unity3d.mediation.interstitial.LevelPlayInterstitialAdListener;
import com.unity3d.mediation.rewarded.LevelPlayReward;
import com.unity3d.mediation.rewarded.LevelPlayRewardedAd;
import com.unity3d.mediation.rewarded.LevelPlayRewardedAdListener;

/**
 * Pont Capacitor vers <b>Unity LevelPlay</b> (plateforme de médiation) avec
 * <b>Meta Audience Network</b> branché en in-app bidding.
 *
 * <p>Depuis la 2.1.0, l'application ne dialogue plus avec le SDK Meta : c'est
 * LevelPlay qui arbitre les enchères (Meta via l'adaptateur
 * {@code facebook-adapter}) et sert les annonces. Les identifiants reçus de la
 * WebView sont des <b>ad units LevelPlay</b>.</p>
 *
 * <p>Formats exposés à la WebView :</p>
 * <ul>
 *   <li>{@code showBanner} / {@code hideBanner} — bannière 320×50 ancrée en bas
 *       (présente sur toutes les pages) ;</li>
 *   <li>{@code showNativeBanner} / {@code hideNativeBanner} — bandeau natif
 *       compact des listes ;</li>
 *   <li>{@code loadInterstitial} / {@code showInterstitial} — interstitiel
 *       plein écran (ouverture de l'app, validation des pas, fin de sortie) ;</li>
 *   <li>{@code loadRewarded} / {@code showRewarded} — vidéo récompensée
 *       (vidéo → ElyCoins, récompense « ElyCoin » × 1) ;</li>
 *   <li>{@code showMediumRectangle} — encart 300×250 avant un retrait ;</li>
 *   <li>{@code showNativeCard} — carte native de fin de sortie.</li>
 * </ul>
 *
 * <p>Aucune annonce n'est demandée tant que {@code initialize} n'a pas reçu un
 * choix de consentement explicite ({@code personalized}) : il est transmis au
 * SDK avant l'initialisation ({@link LevelPlayPrivacySettings#setGDPRConsent}),
 * qui le répercute sur chaque réseau (dont Meta).</p>
 */
@CapacitorPlugin(name = "LevelPlayAds")
public class LevelPlayAdsPlugin extends Plugin {

    private static final String TAG = "ElyWalkLevelPlay";
    private static final int BANNER_HEIGHT_DP = 50;
    private static final int RECTANGLE_WIDTH_DP = 300;
    private static final int RECTANGLE_HEIGHT_DP = 250;
    private static final long LOAD_TIMEOUT_MS = 15000L;
    private static final long SHOW_TIMEOUT_MS = 180000L;

    private final Handler main = new Handler(Looper.getMainLooper());

    private boolean initialized;
    private boolean personalized;
    private String appKey;

    private LevelPlayInterstitialAd interstitialAd;
    private LevelPlayRewardedAd rewardedAd;
    private LevelPlayBannerAdView bannerAdView;
    private LevelPlayBannerAdView rectangleAdView;
    private LevelPlayNativeAd nativeBannerAd;
    private LevelPlayNativeAd nativeCardAd;
    private View nativeBannerView;

    /** Hôte transparent superposé à la WebView (bannière, bandeau, surcouches). */
    private FrameLayout adHost;
    /** Conteneur ancré en bas (bannière ou bandeau natif). */
    private FrameLayout bottomContainer;
    /** Surcouche plein écran (medium rectangle, carte native). */
    private FrameLayout overlayContainer;

    private PluginCall pendingInterstitialShow;
    private PluginCall pendingRewardedShow;
    private boolean rewardedCompleted;
    private String rewardedName;
    private int rewardedAmount;

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

    /**
     * Conteneur hôte unique, ajouté une seule fois au-dessus de la WebView.
     *
     * <p>{@code ViewGroup.generateLayoutParams(...)} étant {@code protected}, on
     * n'essaie pas de convertir les {@link FrameLayout.LayoutParams} pour un
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
     * fermeture explicite, exigé par les règles LevelPlay / Play sur les formats
     * non plein écran.
     */
    private LinearLayout buildOverlayCard(View content, int widthPx) {
        Context context = getContext();
        LinearLayout card = new LinearLayout(context);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setBackgroundColor(Color.parseColor("#1A1A1C"));
        card.setPadding(dp(8), dp(8), dp(8), dp(8));

        TextView close = new TextView(context);
        close.setText("✕ Fermer");
        close.setTextColor(Color.parseColor("#98948A"));
        close.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        close.setGravity(Gravity.END);
        close.setPadding(dp(8), dp(4), dp(8), dp(10));
        close.setOnClickListener(v -> closeOverlay());
        card.addView(close, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        card.addView(content, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        ));
        card.setMinimumWidth(widthPx);
        return card;
    }

    /** Centre la carte dans la surcouche et renvoie true. */
    private boolean centerInOverlay(View card) {
        if (overlayContainer == null) return false;
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        params.gravity = Gravity.CENTER;
        overlayContainer.addView(card, params);
        return true;
    }

    // ------------------------------------------------------------------------
    // Cycle de vie
    // ------------------------------------------------------------------------

    @Override
    protected void handleOnDestroy() {
        resolvePendingInterstitial(false);
        resolvePendingRewarded(false);
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

    /**
     * Initialise le SDK LevelPlay. {@code personalized} traduit le choix RGPD de
     * l'utilisateur et doit être appliqué <b>avant</b> l'init : LevelPlay le
     * transmet ensuite aux réseaux médiés (dont Meta, en LDU si refus).
     */
    @PluginMethod
    public void initialize(PluginCall call) {
        String key = call.getString("appKey");
        if (key == null || key.isEmpty()) {
            call.reject("appKey LevelPlay manquant");
            return;
        }
        final String userId = call.getString("userId");
        final boolean wantsPersonalized = Boolean.TRUE.equals(call.getBoolean("personalized", false));
        this.appKey = key;
        this.personalized = wantsPersonalized;

        if (initialized) {
            applyPrivacy(wantsPersonalized);
            call.resolve();
            return;
        }

        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activité indisponible");
            return;
        }

        final Once once = new Once();
        runOnUi(() -> {
            applyPrivacy(wantsPersonalized);
            if (userId != null && !userId.isEmpty()) {
                try {
                    LevelPlay.setDynamicUserId(userId);
                } catch (Throwable t) {
                    Log.w(TAG, "setDynamicUserId: " + t.getMessage());
                }
            }
            try {
                LevelPlayInitRequest request = new LevelPlayInitRequest.Builder(appKey).build();
                LevelPlay.init(activity, request, new LevelPlayInitListener() {
                    @Override
                    public void onInitSuccess(LevelPlayConfiguration configuration) {
                        initialized = true;
                        Log.d(TAG, "SDK LevelPlay initialisé");
                        if (once.claim()) call.resolve();
                    }

                    @Override
                    public void onInitFailed(LevelPlayInitError error) {
                        Log.e(TAG, "Échec d'initialisation LevelPlay: " + error.getErrorMessage());
                        if (once.claim()) {
                            call.reject("Échec d'initialisation LevelPlay: " + error.getErrorMessage());
                        }
                    }
                });
            } catch (Throwable t) {
                Log.e(TAG, "LevelPlay.init", t);
                if (once.claim()) call.reject("Échec d'initialisation LevelPlay: " + t.getMessage());
                return;
            }
            main.postDelayed(() -> {
                if (once.claim()) {
                    Log.e(TAG, "Initialisation LevelPlay: délai dépassé");
                    call.reject("Délai dépassé pendant l'initialisation de LevelPlay");
                }
            }, LOAD_TIMEOUT_MS);
        });
    }

    /**
     * Met à jour le consentement RGPD à chaud (l'utilisateur peut changer d'avis
     * depuis Profil → Confidentialité des annonces).
     */
    @PluginMethod
    public void setConsent(PluginCall call) {
        personalized = Boolean.TRUE.equals(call.getBoolean("personalized", false));
        runOnUi(() -> {
            applyPrivacy(personalized);
            Log.d(TAG, "Consentement publicitaire: " + (personalized ? "personnalisé" : "non personnalisé"));
            call.resolve();
        });
    }

    /**
     * Met à jour l'identifiant application de l'utilisateur
     * ({@code LevelPlay.setDynamicUserId}). Utile après connexion : LevelPlay
     * l'utilise pour les callbacks server-to-server et Ad Quality.
     */
    @PluginMethod
    public void setUserId(PluginCall call) {
        final String userId = call.getString("userId");
        runOnUi(() -> {
            try {
                LevelPlay.setDynamicUserId(userId);
            } catch (Throwable t) {
                Log.w(TAG, "setDynamicUserId: " + t.getMessage());
            }
            call.resolve();
        });
    }

    /** Applique le consentement RGPD au SDK (personnalisé ou annonces limitées). */
    private void applyPrivacy(boolean wantsPersonalized) {
        try {
            LevelPlayPrivacySettings.setGDPRConsent(wantsPersonalized);
        } catch (Throwable t) {
            Log.w(TAG, "setGDPRConsent: " + t.getMessage());
        }
        try {
            // Refus de la vente / du partage des données personnelles quand
            // l'utilisateur a choisi des annonces non personnalisées (CCPA et
            // lois équivalentes). API dédiée depuis le SDK 9.4.0.
            LevelPlayPrivacySettings.setCCPA(!wantsPersonalized);
        } catch (Throwable t) {
            Log.w(TAG, "setCCPA: " + t.getMessage());
        }
        try {
            // ElyWalk n'est pas destinée aux enfants.
            LevelPlayPrivacySettings.setCOPPA(false);
        } catch (Throwable t) {
            Log.w(TAG, "setCOPPA: " + t.getMessage());
        }
    }

    // ------------------------------------------------------------------------
    // Bannière 320×50 (bas de page, toutes les pages)
    // ------------------------------------------------------------------------

    @PluginMethod
    public void showBanner(final PluginCall call) {
        final String adUnitId = call.getString("adUnitId");
        if (adUnitId == null || adUnitId.isEmpty()) {
            call.reject("adUnitId manquant");
            return;
        }
        final boolean adaptive = Boolean.TRUE.equals(call.getBoolean("adaptive", false));
        final Once once = new Once();

        runOnUi(() -> {
            destroyBanner();
            destroyNativeBanner();

            final FrameLayout container = ensureBottomContainer();
            if (container == null) {
                if (once.claim()) call.resolve(object("height", 0));
                return;
            }

            Activity activity = getActivity();
            LevelPlayAdSize size = adaptive && activity != null
                    ? LevelPlayAdSize.createAdaptiveAdSize(activity)
                    : LevelPlayAdSize.BANNER;
            // `createAdaptiveAdSize` peut renvoyer null si le conteneur est trop
            // étroit : on retombe alors sur la bannière 320×50 standard.
            if (size == null) size = LevelPlayAdSize.BANNER;

            LevelPlayBannerAdView.Config config = new LevelPlayBannerAdView.Config.Builder()
                    .setAdSize(size)
                    .build();
            final LevelPlayBannerAdView view = new LevelPlayBannerAdView(getContext(), adUnitId, config);
            bannerAdView = view;
            view.setBannerListener(new LevelPlayBannerAdViewListener() {
                @Override
                public void onAdLoaded(LevelPlayAdInfo adInfo) {
                    view.post(() -> {
                        int height = pxToCss(view.getHeight());
                        if (height <= 0) height = BANNER_HEIGHT_DP;
                        if (once.claim()) call.resolve(object("height", height));
                    });
                }

                @Override
                public void onAdLoadFailed(LevelPlayAdError error) {
                    Log.w(TAG, "Bannière: " + error.getErrorMessage());
                    container.removeAllViews();
                    if (once.claim()) call.resolve(object("height", 0));
                }

                @Override
                public void onAdDisplayFailed(LevelPlayAdInfo adInfo, LevelPlayAdError error) {
                    Log.w(TAG, "Bannière (affichage): " + error.getErrorMessage());
                }
            });

            container.removeAllViews();
            container.addView(view, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
            ));
            view.loadAd();

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
    // Natif compact (listes) et carte native (fin de sortie)
    // ------------------------------------------------------------------------

    /**
     * Crée un objet natif LevelPlay.
     *
     * <p>Le format natif LevelPlay se configure par <b>placement</b> (nom déclaré
     * dans le tableau de bord sur l'ad unit native) : il n'existe pas de
     * paramètre d'ad unit dans le builder du SDK.</p>
     */
    private LevelPlayNativeAd buildNativeAd(@Nullable String placementName, LevelPlayNativeAdListener listener) {
        LevelPlayNativeAd.Builder builder = new LevelPlayNativeAd.Builder();
        Activity activity = getActivity();
        if (activity != null) builder.withActivity(activity);
        if (placementName != null && !placementName.isEmpty()) {
            builder.withPlacementName(placementName);
        }
        return builder.withListener(listener).build();
    }

    /**
     * Construit une vue native aux couleurs d'ElyWalk (badge « Publicité »,
     * icône, titre, annonceur, visuel, texte, bouton d'action) et l'enregistre
     * auprès du SDK.
     */
    private NativeAdLayout buildNativeLayout(LevelPlayNativeAd ad, boolean compact) {
        Context context = getContext();
        NativeAdLayout layout = new NativeAdLayout(context);

        LinearLayout root = new LinearLayout(context);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(12), dp(8), dp(12), dp(10));
        root.setBackgroundColor(Color.parseColor("#1A1A1C"));

        TextView badge = new TextView(context);
        badge.setText("Publicité");
        badge.setTextColor(Color.parseColor("#98948A"));
        badge.setTextSize(TypedValue.COMPLEX_UNIT_SP, 10);
        root.addView(badge);

        LinearLayout head = new LinearLayout(context);
        head.setOrientation(LinearLayout.HORIZONTAL);
        head.setGravity(Gravity.CENTER_VERTICAL);
        head.setPadding(0, dp(4), 0, 0);

        ImageView icon = new ImageView(context);
        LinearLayout.LayoutParams iconParams = new LinearLayout.LayoutParams(dp(40), dp(40));
        iconParams.rightMargin = dp(10);
        head.addView(icon, iconParams);

        LinearLayout titles = new LinearLayout(context);
        titles.setOrientation(LinearLayout.VERTICAL);

        TextView title = new TextView(context);
        title.setTextColor(Color.WHITE);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        title.setMaxLines(1);
        title.setEllipsize(TextUtils.TruncateAt.END);
        titles.addView(title);

        TextView advertiser = new TextView(context);
        advertiser.setTextColor(Color.parseColor("#98948A"));
        advertiser.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        advertiser.setMaxLines(1);
        titles.addView(advertiser);

        head.addView(titles, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        root.addView(head);

        LevelPlayMediaView media = new LevelPlayMediaView(context);
        LinearLayout.LayoutParams mediaParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(compact ? 70 : 150)
        );
        mediaParams.topMargin = dp(8);
        root.addView(media, mediaParams);

        TextView body = new TextView(context);
        body.setTextColor(Color.parseColor("#B0ACA2"));
        body.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        body.setMaxLines(compact ? 2 : 3);
        body.setEllipsize(TextUtils.TruncateAt.END);
        body.setPadding(0, dp(6), 0, dp(6));
        root.addView(body);

        Button cta = new Button(context);
        cta.setAllCaps(false);
        cta.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        cta.setTextColor(Color.parseColor("#111111"));
        cta.setBackgroundColor(Color.parseColor("#D8CA82"));
        cta.setVisibility(View.GONE);
        root.addView(cta, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        layout.addView(root);

        // Les assets sont optionnels (dépend du réseau gagnant) : on ne déclare
        // au SDK que les vues réellement remplies.
        if (ad.getTitle() != null) {
            title.setText(ad.getTitle());
            layout.setTitleView(title);
        }
        if (ad.getBody() != null) {
            body.setText(ad.getBody());
            layout.setBodyView(body);
        }
        if (ad.getAdvertiser() != null) {
            advertiser.setText(ad.getAdvertiser());
            layout.setAdvertiserView(advertiser);
        }
        if (ad.getCallToAction() != null) {
            cta.setText(ad.getCallToAction());
            cta.setVisibility(View.VISIBLE);
            layout.setCallToActionView(cta);
        }
        NativeAdDataInterface.Image iconImage = ad.getIcon();
        if (iconImage != null && iconImage.getDrawable() != null) {
            icon.setImageDrawable(iconImage.getDrawable());
            layout.setIconView(icon);
        }
        layout.setMediaView(media);
        try {
            layout.registerNativeAdViews(ad);
        } catch (Throwable t) {
            Log.w(TAG, "registerNativeAdViews: " + t.getMessage());
        }
        return layout;
    }

    @PluginMethod
    public void showNativeBanner(final PluginCall call) {
        final String placementName = call.getString("placementName");
        final Once once = new Once();

        runOnUi(() -> {
            destroyNativeBanner();
            destroyBanner();

            final FrameLayout container = ensureBottomContainer();
            if (container == null) {
                if (once.claim()) call.resolve(object("height", 0));
                return;
            }

            LevelPlayNativeAd ad = buildNativeAd(placementName, new LevelPlayNativeAdListener() {
                @Override
                public void onAdLoaded(LevelPlayNativeAd nativeAd, AdInfo adInfo) {
                    if (nativeAd != nativeBannerAd) return;
                    View view = buildNativeLayout(nativeAd, true);
                    nativeBannerView = view;
                    container.removeAllViews();
                    container.addView(view, new FrameLayout.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.WRAP_CONTENT
                    ));
                    view.post(() -> {
                        int height = pxToCss(view.getHeight());
                        if (once.claim()) call.resolve(object("height", height > 0 ? height : BANNER_HEIGHT_DP));
                    });
                }

                @Override
                public void onAdLoadFailed(LevelPlayNativeAd nativeAd, IronSourceError error) {
                    Log.w(TAG, "Native banner: " + (error == null ? "erreur" : error.getErrorMessage()));
                    if (once.claim()) call.resolve(object("height", 0));
                }

                @Override
                public void onAdImpression(LevelPlayNativeAd nativeAd, AdInfo adInfo) {
                }

                @Override
                public void onAdClicked(LevelPlayNativeAd nativeAd, AdInfo adInfo) {
                }
            });
            nativeBannerAd = ad;
            ad.loadAd();

            main.postDelayed(() -> {
                if (once.claim()) call.resolve(object("height", 0));
            }, LOAD_TIMEOUT_MS);
        });
    }

    @PluginMethod
    public void hideNativeBanner(PluginCall call) {
        runOnUi(() -> {
            destroyNativeBanner();
            call.resolve();
        });
    }

    private void destroyNativeBanner() {
        if (nativeBannerView != null) {
            if (bottomContainer != null) bottomContainer.removeView(nativeBannerView);
            nativeBannerView = null;
        }
        if (nativeBannerAd != null) {
            try {
                nativeBannerAd.destroyAd();
            } catch (Throwable ignored) {
                /* déjà détruit */
            }
            nativeBannerAd = null;
        }
    }

    @PluginMethod
    public void showNativeCard(final PluginCall call) {
        final String placementName = call.getString("placementName");
        final Once once = new Once();

        runOnUi(() -> {
            destroyNativeCard();
            if (ensureOverlay() == null) {
                if (once.claim()) call.resolve(object("shown", false));
                return;
            }

            LevelPlayNativeAd ad = buildNativeAd(placementName, new LevelPlayNativeAdListener() {
                @Override
                public void onAdLoaded(LevelPlayNativeAd nativeAd, AdInfo adInfo) {
                    if (nativeAd != nativeCardAd) return;
                    View unit = buildNativeLayout(nativeAd, false);
                    LinearLayout card = buildOverlayCard(unit, dp(RECTANGLE_WIDTH_DP));
                    boolean shown = centerInOverlay(card);
                    if (once.claim()) call.resolve(object("shown", shown));
                }

                @Override
                public void onAdLoadFailed(LevelPlayNativeAd nativeAd, IronSourceError error) {
                    Log.w(TAG, "Carte native: " + (error == null ? "erreur" : error.getErrorMessage()));
                    closeOverlay();
                    if (once.claim()) call.resolve(object("shown", false));
                }

                @Override
                public void onAdImpression(LevelPlayNativeAd nativeAd, AdInfo adInfo) {
                }

                @Override
                public void onAdClicked(LevelPlayNativeAd nativeAd, AdInfo adInfo) {
                }
            });
            nativeCardAd = ad;
            ad.loadAd();

            main.postDelayed(() -> {
                if (once.claim()) {
                    closeOverlay();
                    call.resolve(object("shown", false));
                }
            }, LOAD_TIMEOUT_MS);
        });
    }

    private void destroyNativeCard() {
        if (nativeCardAd != null) {
            try {
                nativeCardAd.destroyAd();
            } catch (Throwable ignored) {
                /* déjà détruit */
            }
            nativeCardAd = null;
        }
    }

    // ------------------------------------------------------------------------
    // Interstitiel plein écran
    // ------------------------------------------------------------------------

    @PluginMethod
    public void loadInterstitial(final PluginCall call) {
        final String adUnitId = call.getString("adUnitId");
        if (adUnitId == null || adUnitId.isEmpty()) {
            call.reject("adUnitId manquant");
            return;
        }
        final Once once = new Once();

        runOnUi(() -> {
            destroyInterstitial();
            LevelPlayInterstitialAd ad = new LevelPlayInterstitialAd(adUnitId);
            interstitialAd = ad;
            ad.setListener(new LevelPlayInterstitialAdListener() {
                @Override
                public void onAdLoaded(LevelPlayAdInfo adInfo) {
                    if (once.claim()) call.resolve(object("loaded", true));
                }

                @Override
                public void onAdLoadFailed(LevelPlayAdError error) {
                    Log.w(TAG, "Interstitiel: " + error.getErrorMessage());
                    if (once.claim()) call.resolve(object("loaded", false));
                }

                @Override
                public void onAdDisplayed(LevelPlayAdInfo adInfo) {
                }

                @Override
                public void onAdDisplayFailed(LevelPlayAdError error, LevelPlayAdInfo adInfo) {
                    Log.w(TAG, "Interstitiel (affichage): " + error.getErrorMessage());
                    resolvePendingInterstitial(false);
                }

                @Override
                public void onAdClosed(LevelPlayAdInfo adInfo) {
                    resolvePendingInterstitial(true);
                }
            });
            ad.loadAd();

            main.postDelayed(() -> {
                if (once.claim()) call.resolve(object("loaded", false));
            }, LOAD_TIMEOUT_MS);
        });
    }

    @PluginMethod
    public void showInterstitial(final PluginCall call) {
        runOnUi(() -> {
            if (interstitialAd == null || !interstitialAd.isAdReady()) {
                call.resolve(object("shown", false));
                return;
            }
            Activity activity = getActivity();
            if (activity == null) {
                call.resolve(object("shown", false));
                return;
            }
            pendingInterstitialShow = call;
            try {
                interstitialAd.showAd(activity);
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
        // Les objets plein écran LevelPlay n'exposent pas de destroy() : on
        // relâche la référence, le SDK libère les ressources de l'ad unit.
        interstitialAd = null;
    }

    // ------------------------------------------------------------------------
    // Vidéo récompensée (vidéo → ElyCoins)
    // ------------------------------------------------------------------------

    @PluginMethod
    public void loadRewarded(final PluginCall call) {
        final String adUnitId = call.getString("adUnitId");
        if (adUnitId == null || adUnitId.isEmpty()) {
            call.reject("adUnitId manquant");
            return;
        }
        final Once once = new Once();

        runOnUi(() -> {
            destroyRewarded();
            LevelPlayRewardedAd ad = new LevelPlayRewardedAd(adUnitId);
            rewardedAd = ad;
            ad.setListener(new LevelPlayRewardedAdListener() {
                @Override
                public void onAdLoaded(LevelPlayAdInfo adInfo) {
                    if (once.claim()) call.resolve(object("loaded", true));
                }

                @Override
                public void onAdLoadFailed(LevelPlayAdError error) {
                    Log.w(TAG, "Récompensée: " + error.getErrorMessage());
                    if (once.claim()) call.resolve(object("loaded", false));
                }

                @Override
                public void onAdDisplayed(LevelPlayAdInfo adInfo) {
                }

                @Override
                public void onAdRewarded(LevelPlayReward reward, LevelPlayAdInfo adInfo) {
                    if (reward == null) return;
                    // Récompense configurée dans LevelPlay : « ElyCoin » × 1.
                    // La conversion en ElyCoins (0,1) est faite côté WebView.
                    rewardedCompleted = true;
                    rewardedName = reward.getName();
                    rewardedAmount = reward.getAmount();
                }

                @Override
                public void onAdDisplayFailed(LevelPlayAdError error, LevelPlayAdInfo adInfo) {
                    Log.w(TAG, "Récompensée (affichage): " + error.getErrorMessage());
                    resolvePendingRewarded(false);
                }

                @Override
                public void onAdClosed(LevelPlayAdInfo adInfo) {
                    resolvePendingRewarded(rewardedCompleted);
                }
            });
            ad.loadAd();

            main.postDelayed(() -> {
                if (once.claim()) call.resolve(object("loaded", false));
            }, LOAD_TIMEOUT_MS);
        });
    }

    @PluginMethod
    public void showRewarded(final PluginCall call) {
        runOnUi(() -> {
            if (rewardedAd == null || !rewardedAd.isAdReady()) {
                call.resolve(rewardedResult(false));
                return;
            }
            Activity activity = getActivity();
            if (activity == null) {
                call.resolve(rewardedResult(false));
                return;
            }
            rewardedCompleted = false;
            rewardedName = null;
            rewardedAmount = 0;
            pendingRewardedShow = call;
            try {
                rewardedAd.showAd(activity);
            } catch (Throwable t) {
                Log.e(TAG, "showRewarded: " + t.getMessage());
                resolvePendingRewarded(false);
                return;
            }
            main.postDelayed(() -> resolvePendingRewarded(rewardedCompleted), SHOW_TIMEOUT_MS);
        });
    }

    private JSObject rewardedResult(boolean rewarded) {
        JSObject result = object("rewarded", rewarded);
        if (rewardedName != null) result.put("rewardName", rewardedName);
        if (rewardedAmount > 0) result.put("rewardAmount", rewardedAmount);
        return result;
    }

    private void resolvePendingRewarded(boolean rewarded) {
        if (pendingRewardedShow == null) return;
        PluginCall call = pendingRewardedShow;
        pendingRewardedShow = null;
        call.resolve(rewardedResult(rewarded));
    }

    private void destroyRewarded() {
        resolvePendingRewarded(false);
        // Comme pour l'interstitiel, l'objet récompensé LevelPlay n'a pas de
        // destroy() : la référence suffit à repartir d'un objet neuf au
        // prochain chargement.
        rewardedAd = null;
    }

    // ------------------------------------------------------------------------
    // Medium rectangle 300×250 (retrait d'ElyCoins)
    // ------------------------------------------------------------------------

    @PluginMethod
    public void showMediumRectangle(final PluginCall call) {
        final String adUnitId = call.getString("adUnitId");
        if (adUnitId == null || adUnitId.isEmpty()) {
            call.reject("adUnitId manquant");
            return;
        }
        final Once once = new Once();

        runOnUi(() -> {
            destroyRectangle();
            if (ensureOverlay() == null) {
                if (once.claim()) call.resolve(object("shown", false));
                return;
            }

            LevelPlayBannerAdView.Config config = new LevelPlayBannerAdView.Config.Builder()
                    .setAdSize(LevelPlayAdSize.MEDIUM_RECTANGLE)
                    .build();
            final LevelPlayBannerAdView adView = new LevelPlayBannerAdView(getContext(), adUnitId, config);
            rectangleAdView = adView;
            adView.setBannerListener(new LevelPlayBannerAdViewListener() {
                @Override
                public void onAdLoaded(LevelPlayAdInfo adInfo) {
                    if (once.claim()) call.resolve(object("shown", true));
                }

                @Override
                public void onAdLoadFailed(LevelPlayAdError error) {
                    Log.w(TAG, "Medium rectangle: " + error.getErrorMessage());
                    closeOverlay();
                    destroyRectangle();
                    if (once.claim()) call.resolve(object("shown", false));
                }
            });

            LinearLayout card = buildOverlayCard(adView, dp(RECTANGLE_WIDTH_DP));
            centerInOverlay(card);
            adView.post(() -> {
                ViewGroup.LayoutParams params = adView.getLayoutParams();
                if (params == null) return;
                params.width = dp(RECTANGLE_WIDTH_DP);
                params.height = dp(RECTANGLE_HEIGHT_DP);
                adView.setLayoutParams(params);
            });
            adView.loadAd();

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
}
