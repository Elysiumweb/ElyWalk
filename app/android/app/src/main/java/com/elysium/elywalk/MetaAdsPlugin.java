package com.elysium.elywalk;

import android.content.Context;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;

import com.facebook.ads.Ad;
import com.facebook.ads.AdError;
import com.facebook.ads.AdListener;
import com.facebook.ads.AdSettings;
import com.facebook.ads.AdSize;
import com.facebook.ads.AdView;
import com.facebook.ads.AudienceNetworkAds;
import com.facebook.ads.InterstitialAd;
import com.facebook.ads.InterstitialAdListener;
import com.facebook.ads.RewardData;
import com.facebook.ads.RewardedInterstitialAd;
import com.facebook.ads.S2SRewardedInterstitialAdListener;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Pont JavaScript vers le SDK <b>Meta Audience Network</b>.
 *
 * <p>ElyWalk n'utilise ni AdMob ni aucune plateforme de médiation : le SDK Meta
 * est intégré en direct et sert l'inventaire des annonceurs Meta. Les formats
 * exposés ici sont exactement ceux que Meta propose aux éditeurs :</p>
 * <ul>
 *   <li>{@code banner} — bannière 320×50 ancrée en bas de la WebView ;</li>
 *   <li>{@code interstitial} — plein écran (ouverture, validation, retrait,
 *       fin de sortie, rectangle moyen) ;</li>
 *   <li>{@code rewardedInterstitial} — plein écran récompensé
 *       (« regarder une pub pour gagner des ElyCoins »).</li>
 * </ul>
 *
 * <p>Meta n'a <b>pas</b> de format « App Open » ni de « vidéo récompensée »
 * séparée : l'ouverture de l'application et le gain d'ElyCoins passent donc
 * respectivement par l'interstitiel et par l'interstitiel récompensé.</p>
 *
 * <p>⚠️ Une annonce chargée est valable <b>60 minutes</b> ; au-delà, Meta ne
 * paie pas l'affichage. C'est pourquoi chaque format vérifie
 * {@code isAdInvalidated()} avant de s'afficher et recharge ensuite.</p>
 */
@CapacitorPlugin(name = "MetaAds")
public class MetaAdsPlugin extends Plugin {

    private static final String TAG = "ElyWalkAds";
    /** Durée de validité d'une annonce chargée chez Meta. */
    private static final long AD_TTL_MS = 60L * 60L * 1000L;
    /** Attente maximale de la validation serveur après fermeture de l'annonce. */
    private static final long SERVER_REWARD_TIMEOUT_MS = 10_000L;

    // --- Interstitiel -----------------------------------------------------
    private InterstitialAd interstitial;
    private String interstitialPlacementId;
    private long interstitialLoadedAt;
    private boolean interstitialLoading;

    // --- Interstitiel récompensé -----------------------------------------
    private RewardedInterstitialAd rewarded;
    private String rewardedPlacementId;
    private long rewardedLoadedAt;
    private boolean rewardedLoading;
    private boolean rewardEarned;
    /** Validation serveur (S2S) demandée : Meta interroge notre Worker. */
    private boolean serverRewardValidation;
    private PluginCall pendingRewardCall;

    // --- Bannière ---------------------------------------------------------
    private AdView bannerView;
    private String bannerPlacementId;
    private FrameLayout bannerContainer;

    private boolean initialized;

    // ---------------------------------------------------------------------
    // Cycle de vie
    // ---------------------------------------------------------------------

    @Override
    public void load() {
        // `initialize()` doit précéder toute autre opération du SDK. Un échec
        // (réseau, Play Services, pays non éligible) ne doit jamais faire
        // planter l'application : on continue sans annonces.
        try {
            Context ctx = getActivity() != null ? getActivity() : getContext();
            if (ctx != null && !AudienceNetworkAds.isInitialized(ctx)) {
                AudienceNetworkAds.initialize(ctx);
            }
            initialized = true;
        } catch (Throwable t) {
            Log.w(TAG, "Initialisation Meta Audience Network impossible", t);
        }
    }

    @Override
    protected void handleOnDestroy() {
        destroyBanner();
        destroyInterstitial();
        destroyRewarded();
        super.handleOnDestroy();
    }

    /** État du SDK, affiché dans Profil → Confidentialité des annonces. */
    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("initialized", initialized);
        ret.put("bannerReady", bannerView != null && bannerPlacementId != null);
        ret.put("interstitialReady", isInterstitialReady());
        ret.put("rewardedReady", isRewardedReady());
        call.resolve(ret);
    }

    // ---------------------------------------------------------------------
    // Options de traitement des données (RGPD / CCPA)
    // ---------------------------------------------------------------------

    /**
     * Applique les options de traitement Meta.
     *
     * <ul>
     *   <li>{@code ldu = true} : Limited Data Use (Californie et autres États
     *       américains). Meta l'ignore hors États-Unis.</li>
     *   <li>{@code ldu = false} : traitement complet (consentement obtenu).</li>
     * </ul>
     *
     * <p>À appeler <b>avant</b> tout chargement d'annonce : l'option est lue
     * par le SDK au moment de la requête.</p>
     */
    @PluginMethod
    public void setDataProcessingOptions(PluginCall call) {
        Boolean ldu = call.getBoolean("ldu", false);
        try {
            if (Boolean.TRUE.equals(ldu)) {
                AdSettings.setDataProcessingOptions(new String[] { "LDU" });
            } else {
                AdSettings.setDataProcessingOptions(new String[] {});
            }
            call.resolve();
        } catch (Throwable t) {
            call.reject("Options de traitement indisponibles", t);
        }
    }

    // ---------------------------------------------------------------------
    // Bannière
    // ---------------------------------------------------------------------

    /**
     * Affiche (ou remplace) la bannière ancrée en bas de l'écran.
     *
     * <p>La vue est ajoutée au conteneur de l'activité
     * ({@code android.R.id.content}), par-dessus la WebView : elle reste donc
     * visible quelle que soit la page affichée, et occupe une bande de 50 dp
     * réservée grâce à {@link #getBannerHeight}.</p>
     */
    @PluginMethod
    public void showBanner(final PluginCall call) {
        final String placementId = call.getString("placementId");
        if (placementId == null || placementId.isEmpty()) {
            call.reject("placementId manquant");
            return;
        }
        final boolean tablet = call.getBoolean("tablet", false);

        if (getActivity() == null || getActivity().isFinishing()) {
            call.reject("Activité indisponible");
            return;
        }

        getActivity().runOnUiThread(() -> {
            try {
                if (getActivity() == null || getActivity().isFinishing()) {
                    call.reject("Activité détruite");
                    return;
                }
                if (bannerView != null && placementId.equals(bannerPlacementId)) {
                    call.resolve(); // déjà affichée : rien à faire
                    return;
                }
                destroyBanner();

                Context context = getActivity();
                AdView view = new AdView(
                    context,
                    placementId,
                    tablet ? AdSize.BANNER_HEIGHT_90 : AdSize.BANNER_HEIGHT_50
                );
                AdListener listener = new AdListener() {
                    @Override
                    public void onError(Ad ad, AdError adError) {
                        Log.w(TAG, "Bannière : " + (adError != null ? adError.getErrorMessage() : "erreur"));
                    }

                    @Override
                    public void onAdLoaded(Ad ad) {
                        Log.d(TAG, "Bannière chargée");
                    }

                    @Override
                    public void onAdClicked(Ad ad) { }

                    @Override
                    public void onLoggingImpression(Ad ad) { }
                };

                FrameLayout container = ensureBannerContainer();
                if (container == null) {
                    call.reject("Conteneur de bannière indisponible");
                    return;
                }
                if (view.getParent() instanceof ViewGroup) {
                    ((ViewGroup) view.getParent()).removeView(view);
                }
                FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    dpToPx(tablet ? 90 : 50),
                    Gravity.BOTTOM
                );
                container.addView(view, params);
                container.setVisibility(View.VISIBLE);

                bannerView = view;
                bannerPlacementId = placementId;
                // Même schéma que les autres formats : la configuration porte
                // l'écouteur, puis `loadAd` reçoit l'objet construit.
                view.loadAd(view.buildLoadAdConfig().withAdListener(listener).build());
                call.resolve();
            } catch (Throwable t) {
                Log.e(TAG, "Affichage de la bannière impossible", t);
                call.reject("Bannière indisponible", t);
            }
        });
    }

    /** Retire la bannière et libère la place réservée. */
    @PluginMethod
    public void hideBanner(PluginCall call) {
        if (getActivity() == null) {
            call.resolve();
            return;
        }
        getActivity().runOnUiThread(() -> {
            destroyBanner();
            call.resolve();
        });
    }

    /**
     * Hauteur réellement occupée par la bannière, en pixels CSS.
     *
     * <p>Le web s'en sert pour réserver la place et ne pas passer sous la
     * bannière (même logique que les encarts système).</p>
     */
    @PluginMethod
    public void getBannerHeight(PluginCall call) {
        String placementId = call.getString("placementId");
        boolean tablet = call.getBoolean("tablet", false);
        int dp = tablet ? 90 : 50;
        JSObject ret = new JSObject();
        ret.put("height", dp);
        ret.put("placementId", placementId);
        call.resolve(ret);
    }

    private FrameLayout ensureBannerContainer() {
        if (bannerContainer != null && bannerContainer.getParent() != null) {
            return bannerContainer;
        }
        if (getActivity() == null) return null;
        View root = getActivity().findViewById(android.R.id.content);
        if (!(root instanceof ViewGroup)) {
            return null;
        }
        FrameLayout container = new FrameLayout(getActivity());
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM
        );
        ((ViewGroup) root).addView(container, params);
        bannerContainer = container;
        return container;
    }

    private void destroyBanner() {
        if (bannerView != null) {
            try {
                bannerView.destroy();
            } catch (Throwable ignored) { }
            bannerView = null;
        }
        bannerPlacementId = null;
        if (bannerContainer != null) {
            try {
                bannerContainer.removeAllViews();
                if (bannerContainer.getParent() instanceof ViewGroup) {
                    ((ViewGroup) bannerContainer.getParent()).removeView(bannerContainer);
                }
            } catch (Throwable ignored) { }
            bannerContainer = null;
        }
    }

    private int dpToPx(int dp) {
        DisplayMetrics metrics = getActivity().getResources().getDisplayMetrics();
        return Math.round(dp * metrics.density);
    }

    // ---------------------------------------------------------------------
    // Interstitiel
    // ---------------------------------------------------------------------

    /** Précharge un interstitiel (aucune erreur si le chargement échoue). */
    @PluginMethod
    public void prepareInterstitial(PluginCall call) {
        final String placementId = call.getString("placementId");
        if (placementId == null || placementId.isEmpty()) {
            call.reject("placementId manquant");
            return;
        }
        if (getActivity() == null || getActivity().isFinishing()) {
            call.reject("Activité indisponible");
            return;
        }
        getActivity().runOnUiThread(() -> {
            loadInterstitial(placementId);
            call.resolve();
        });
    }

    /**
     * Affiche l'interstitiel. Résout avec {@code shown: true} si l'annonce a
     * bien été présentée, {@code false} si aucune annonce valide n'était
     * disponible.
     */
    @PluginMethod
    public void showInterstitial(final PluginCall call) {
        final String placementId = call.getString("placementId");
        final boolean forceReload = Boolean.TRUE.equals(call.getBoolean("reload", true));

        if (getActivity() == null || getActivity().isFinishing()) {
            call.reject("Activité indisponible");
            return;
        }

        getActivity().runOnUiThread(() -> {
            if (getActivity() == null || getActivity().isFinishing()) {
                call.reject("Activité détruite");
                return;
            }
            boolean ready = isInterstitialReady() && placementId != null && placementId.equals(interstitialPlacementId);
            if (!ready && forceReload && placementId != null) {
                // Repli utile pour l'ouverture de l'application : le temps que
                // la première requête aboutisse, on charge à la volée.
                loadInterstitial(placementId);
                ready = isInterstitialReady();
            }
            if (!ready) {
                JSObject ret = new JSObject();
                ret.put("shown", false);
                call.resolve(ret);
                return;
            }
            try {
                interstitial.show();
                JSObject ret = new JSObject();
                ret.put("shown", true);
                call.resolve(ret);
            } catch (Throwable t) {
                Log.e(TAG, "Affichage de l'interstitiel impossible", t);
                destroyInterstitial();
                JSObject ret = new JSObject();
                ret.put("shown", false);
                call.resolve(ret);
            }
        });
    }

    private void loadInterstitial(String placementId) {
        if (interstitialLoading) return;
        if (interstitial != null && placementId.equals(interstitialPlacementId) && isInterstitialReady()) return;
        if (getActivity() == null || getActivity().isFinishing()) return;

        destroyInterstitial();
        interstitialLoading = true;
        interstitialPlacementId = placementId;

        try {
            InterstitialAd ad = new InterstitialAd(getActivity(), placementId);
            ad.loadAd(ad.buildLoadAdConfig().withAdListener(new InterstitialAdListener() {
                @Override
                public void onInterstitialDisplayed(Ad ad) {
                    notifyListeners("interstitialShown", new JSObject());
                }

                @Override
                public void onInterstitialDismissed(Ad ad) {
                    // L'objet est consommé : on en prépare un autre pour la
                    // prochaine fois, sans bloquer l'interface.
                    destroyInterstitial();
                    try {
                        loadInterstitial(placementId);
                    } catch (Throwable t) {
                        Log.w(TAG, "Rechargement interstitiel impossible", t);
                    }
                    notifyListeners("interstitialDismissed", new JSObject());
                }

                @Override
                public void onError(Ad ad, AdError adError) {
                    Log.w(TAG, "Interstitiel : " + adError.getErrorMessage());
                    interstitialLoading = false;
                    destroyInterstitial();
                    JSObject ret = new JSObject();
                    ret.put("code", adError.getErrorCode());
                    ret.put("message", adError.getErrorMessage());
                    notifyListeners("adError", ret);
                }

                @Override
                public void onAdLoaded(Ad ad) {
                    interstitialLoading = false;
                    interstitialLoadedAt = System.currentTimeMillis();
                    notifyListeners("interstitialLoaded", new JSObject());
                }

                @Override
                public void onAdClicked(Ad ad) { }

                @Override
                public void onLoggingImpression(Ad ad) {
                    notifyListeners("interstitialImpression", new JSObject());
                }
            }).build());
            interstitial = ad;
        } catch (Throwable t) {
            interstitialLoading = false;
            Log.e(TAG, "Chargement de l'interstitiel impossible", t);
        }
    }

    private boolean isInterstitialReady() {
        if (interstitial == null) return false;
        try {
            if (!interstitial.isAdLoaded() || interstitial.isAdInvalidated()) return false;
            // Sécurité supplémentaire : au-delà de 60 min, Meta ne paie plus.
            return System.currentTimeMillis() - interstitialLoadedAt < AD_TTL_MS;
        } catch (Throwable t) {
            return false;
        }
    }

    private void destroyInterstitial() {
        if (interstitial != null) {
            try {
                interstitial.destroy();
            } catch (Throwable ignored) { }
            interstitial = null;
        }
        interstitialLoadedAt = 0L;
    }

    // ---------------------------------------------------------------------
    // Interstitiel récompensé (ElyCoins)
    // ---------------------------------------------------------------------

    /**
     * Précharge un interstitiel récompensé.
     *
     * @param userId identifiant ElyWalk de l'utilisateur, transmis à Meta puis
     *               relayé à notre serveur lors de la validation S2S (champ
     *               {@code puid}).
     * @param rewardId devise de la récompense ({@code Coins} par défaut).
     * @param serverValidation {@code true} pour la validation serveur : Meta
     *               interroge l'URL déclarée dans le Monetization Manager et
     *               n'émet {@code onRewardServerSuccess} que si elle répond 200.
     */
    @PluginMethod
    public void prepareRewardedInterstitial(PluginCall call) {
        final String placementId = call.getString("placementId");
        if (placementId == null || placementId.isEmpty()) {
            call.reject("placementId manquant");
            return;
        }
        if (getActivity() == null || getActivity().isFinishing()) {
            call.reject("Activité indisponible");
            return;
        }
        final String userId = call.getString("userId", "");
        final String rewardId = call.getString("rewardId", "Coins");
        final boolean serverValidation = Boolean.TRUE.equals(call.getBoolean("serverValidation", false));

        getActivity().runOnUiThread(() -> {
            serverRewardValidation = serverValidation;
            loadRewarded(placementId, userId, rewardId);
            call.resolve();
        });
    }

    /**
     * Affiche l'interstitiel récompensé.
     *
     * <p>Résout avec {@code rewarded: true} <b>uniquement</b> si la vidéo a été
     * vue jusqu'au bout (validation serveur : après le 200 de notre Worker). La
     * valeur n'est renvoyée qu'à la fermeture de
     * l'annonce : le crédit d'ElyCoins intervient donc après le retour dans
     * l'application, jamais pendant la lecture de la vidéo.</p>
     */
    @PluginMethod
    public void showRewardedInterstitial(final PluginCall call) {
        final String placementId = call.getString("placementId");

        if (getActivity() == null || getActivity().isFinishing()) {
            call.reject("Activité indisponible");
            return;
        }

        getActivity().runOnUiThread(() -> {
            if (getActivity() == null || getActivity().isFinishing()) {
                call.reject("Activité détruite");
                return;
            }
            if (!isRewardedReady() || placementId == null || !placementId.equals(rewardedPlacementId)) {
                if (placementId != null) {
                    loadRewarded(placementId, call.getString("userId", ""), call.getString("rewardId", "Coins"));
                }
                JSObject ret = new JSObject();
                ret.put("rewarded", false);
                call.resolve(ret);
                return;
            }
            rewardEarned = false;
            pendingRewardCall = call;
            try {
                rewarded.show();
            } catch (Throwable t) {
                Log.e(TAG, "Affichage de la récompense impossible", t);
                pendingRewardCall = null;
                destroyRewarded();
                JSObject ret = new JSObject();
                ret.put("rewarded", false);
                call.resolve(ret);
            }
        });
    }

    private void loadRewarded(String placementId, String userId, String rewardId) {
        if (rewardedLoading) return;
        if (rewarded != null && placementId.equals(rewardedPlacementId) && isRewardedReady()) return;
        if (getActivity() == null || getActivity().isFinishing()) return;

        destroyRewarded();
        rewardedLoading = true;
        rewardedPlacementId = placementId;

        final String userIdFinal = userId == null ? "" : userId;
        final String rewardIdFinal = (rewardId == null || rewardId.isEmpty()) ? "Coins" : rewardId;

        try {
            RewardedInterstitialAd ad = new RewardedInterstitialAd(getActivity(), placementId);
            // S2SRewardedInterstitialAdListener étend RewardedInterstitialAdListener :
            // il ajoute onRewardServerSuccess / onRewardServerFailed, que Meta
            // n'émet que si la validation serveur est activée.
            S2SRewardedInterstitialAdListener listener = new S2SRewardedInterstitialAdListener() {
                @Override
                public void onRewardServerSuccess() {
                    // Notre Worker a répondu 200 : la récompense est validée.
                    rewardEarned = true;
                    settleReward(true);
                }

                @Override
                public void onRewardServerFailed() {
                    // Worker injoignable ou réponse non 200 : pas de crédit.
                    rewardEarned = false;
                    Log.w(TAG, "Validation serveur de la récompense en échec");
                    settleReward(false);
                }

                @Override
                public void onAdLoaded(Ad ad) {
                    rewardedLoading = false;
                    rewardedLoadedAt = System.currentTimeMillis();
                    notifyListeners("rewardedLoaded", new JSObject());
                }

                @Override
                public void onRewardedInterstitialCompleted() {
                    // Vidéo vue jusqu'au bout. Avec la validation serveur,
                    // `onRewardedInterstitialCompleted` ne prouve rien : seule
                    // la réponse 200 de notre Worker fait foi (elle arrive
                    // après la fermeture de l'écran de fin).
                    if (!serverRewardValidation) {
                        rewardEarned = true;
                    }
                    notifyListeners("rewardedEarned", new JSObject());
                }

                @Override
                public void onError(Ad ad, AdError adError) {
                    Log.w(TAG, "Récompense : " + adError.getErrorMessage());
                    rewardedLoading = false;
                    destroyRewarded();
                    settleReward(false);
                }

                @Override
                public void onRewardedInterstitialClosed() {
                    if (serverRewardValidation) {
                        // Meta interroge notre Worker après la fermeture : on
                        // laisse un court délai à onRewardServerSuccess /
                        // onRewardServerFailed avant de conclure à l'échec.
                        final PluginCall pending = pendingRewardCall;
                        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                            if (pendingRewardCall == pending) settleReward(false);
                            destroyRewarded();
                            loadRewarded(placementId, userIdFinal, rewardIdFinal);
                        }, SERVER_REWARD_TIMEOUT_MS);
                        return;
                    }
                    boolean earned = rewardEarned;
                    settleReward(earned);
                    destroyRewarded();
                    loadRewarded(placementId, userIdFinal, rewardIdFinal);
                }

                @Override
                public void onAdClicked(Ad ad) { }

                @Override
                public void onLoggingImpression(Ad ad) { }
            };

            // `RewardedInterstitialLoadAdConfig` est le type *construit* : la
            // configuration se compose sur le builder, puis `build()` produit
            // l'objet attendu par `loadAd`.
            //
            // `withFailOnCacheFailureEnabled` : une vidéo qui n'a pas pu être
            // mise en cache ne doit pas être présentée (mieux vaut une erreur
            // franche qu'un écran vide).
            //
            // `RewardData` (identifiant utilisateur, devise, montant) n'est
            // utile qu'en validation serveur : sans elle, Meta n'interroge
            // personne. Le montant envoyé à Meta (`pc`) sert de garde-fou ; le
            // crédit réel reste décidé par le Worker (AD_REWARD_COINS).
            RewardedInterstitialAd.RewardedInterstitialLoadAdConfig config;
            if (serverRewardValidation && !userIdFinal.isEmpty()) {
                config = ad.buildLoadAdConfig()
                    .withAdListener(listener)
                    .withFailOnCacheFailureEnabled(true)
                    .withRewardData(new RewardData(userIdFinal, rewardIdFinal, 1))
                    .build();
            } else {
                config = ad.buildLoadAdConfig()
                    .withAdListener(listener)
                    .withFailOnCacheFailureEnabled(true)
                    .build();
            }

            ad.loadAd(config);
            rewarded = ad;
        } catch (Throwable t) {
            rewardedLoading = false;
            Log.e(TAG, "Chargement de la récompense impossible", t);
        }
    }

    private boolean isRewardedReady() {
        if (rewarded == null) return false;
        try {
            if (!rewarded.isAdLoaded() || rewarded.isAdInvalidated()) return false;
            return System.currentTimeMillis() - rewardedLoadedAt < AD_TTL_MS;
        } catch (Throwable t) {
            return false;
        }
    }

    /** Répond une seule fois à l'appel en attente (jamais deux crédits). */
    private void settleReward(boolean earned) {
        PluginCall call = pendingRewardCall;
        pendingRewardCall = null;
        if (call == null) return;
        JSObject ret = new JSObject();
        ret.put("rewarded", earned);
        call.resolve(ret);
    }

    private void destroyRewarded() {
        if (rewarded != null) {
            try {
                rewarded.destroy();
            } catch (Throwable ignored) { }
            rewarded = null;
        }
        rewardedLoadedAt = 0L;
        rewardEarned = false;
    }
}
