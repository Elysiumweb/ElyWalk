import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import {
  AdMob,
  AdmobConsentStatus,
  InterstitialAdPluginEvents,
  RewardAdPluginEvents,
  AppOpenAdPluginEvents,
} from '@capacitor-community/admob';
import {
  AD_UNIT_INTERSTITIAL,
  AD_UNIT_REWARDED,
  AD_UNIT_APP_OPEN,
} from './constants';

/**
 * Couche publicitaire ElyWalk (Google Mobile Ads / AdMob).
 *
 * Points clés :
 * - `initAds()` est idempotent : un seul `AdMob.initialize()` par session, et
 *   une seule vérification de consentement (UMP / RGPD) réussie.
 * - Aucune annonce n'est demandée avant le consentement : si l'utilisateur le
 *   refuse, toutes les fonctions `show*` se résolvent immédiatement.
 * - Les interstitiels sont préchargés et espacés (cooldown) pour ne jamais
 *   casser un parcours utilisateur.
 * - Les annonces d'ouverture sont plafonnées (quotidien + cooldown).
 */

const isNative = () => Capacitor.isNativePlatform();

/** Dernier plein écran affiché (interstitiel ou récompensé). */
let lastFullScreenAdAt = 0;

// ---------------------------------------------------------------------------
// Initialisation + consentement RGPD (Google UMP / Funding Choices)
// ---------------------------------------------------------------------------

let initPromise: Promise<boolean> | null = null;
let sdkInitialized = false;
/** `true` dès que l'UMP a répondu (même pour un refus) → plus de formulaire. */
let consentAnswered = false;
/** `true` uniquement si l'utilisateur peut recevoir de la publicité. */
let adsAllowed = false;

/** Course entre une promesse et un délai, pour ne jamais bloquer le lancement. */
async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Interroge l'état du consentement et affiche le formulaire UMP si nécessaire.
 * Résout `true` si les annonces peuvent être chargées.
 */
async function refreshConsent(): Promise<boolean> {
  try {
    // Le SDK détecte lui-même la géolocalisation (EEE / UK). ElyWalk n'est pas
    // destinée aux enfants mais aux 15 ans et plus (cf. CGU).
    const info = await withTimeout(
      AdMob.requestConsentInfo({ tagForUnderAgeOfConsent: false }),
      12000,
      null
    );
    if (!info) {
      // Réseau lent : on garde l'état courant, une nouvelle tentative aura lieu
      // au prochain appel (l'utilisateur n'est pas bloqué).
      return adsAllowed;
    }
    if (info.isConsentFormAvailable && info.status === AdmobConsentStatus.REQUIRED) {
      const after = await AdMob.showConsentForm();
      consentAnswered = true;
      return after?.canRequestAds !== false;
    }
    consentAnswered = true;
    // NOT_REQUIRED (hors EEE/UK) ou OBTAINED (déjà consenti) : on peut diffuser.
    return info.canRequestAds !== false;
  } catch (e) {
    // Principe de prudence RGPD : en cas d'erreur, on ne diffuse aucune annonce.
    console.warn('[AdMob] consent error', e);
    return false;
  }
}

/**
 * Initialise le SDK Google Mobile Ads puis recueille le consentement.
 * Idempotent : les appels suivants réutilisent la même promesse.
 * Résout `true` si les annonces sont autorisées.
 */
export async function initAds(): Promise<boolean> {
  if (!isNative()) return false;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      if (!sdkInitialized) {
        // `initializeForTesting: false` : build de production, aucune requête
        // de test. L'ID d'application vient du manifeste Android.
        await AdMob.initialize({
          initializeForTesting: false,
          tagForUnderAgeOfConsent: false,
        });
        sdkInitialized = true;
      }
      if (!consentAnswered) {
        adsAllowed = await refreshConsent();
      }
      return adsAllowed;
    } catch (e) {
      console.warn('[AdMob] init error', e);
      return false;
    }
  })();

  let allowed = false;
  try {
    allowed = await initPromise;
  } finally {
    // Un échec transitoire (réseau, Play Services indisponible) doit pouvoir
    // être retenté : on libère la promesse. Un refus de consentement, lui,
    // est stable (consentAnswered === true) et ne redéclenchera pas l'UMP.
    if (!allowed) initPromise = null;
  }
  return allowed;
}

/** `true` si le SDK est prêt et le consentement obtenu. */
export function canShowAds(): boolean {
  return sdkInitialized && adsAllowed;
}

/** Ouvre le formulaire « Options de confidentialité » (révision du consentement). */
export async function showPrivacyOptionsForm(): Promise<void> {
  if (!isNative()) return;
  try {
    await AdMob.showPrivacyOptionsForm();
    // L'utilisateur a pu changer d'avis : on réévalue le consentement.
    consentAnswered = false;
    initPromise = null;
    adsAllowed = await refreshConsent();
    if (adsAllowed) void warmUpAds();
  } catch (e) {
    console.warn('[AdMob] privacy options error', e);
  }
}

/** Réinitialise le consentement (permet de re-choisir). Utile pour les tests. */
export async function resetConsent(): Promise<void> {
  if (!isNative()) return;
  try {
    await AdMob.resetConsentInfo();
    consentAnswered = false;
    initPromise = null;
    adsAllowed = false;
  } catch (e) {
    console.warn('[AdMob] resetConsent error', e);
  }
}

// ---------------------------------------------------------------------------
// Interstitiel
// ---------------------------------------------------------------------------

/** Espacement minimal entre deux interstitiels (UX + règles AdMob). */
const INTERSTITIAL_COOLDOWN_MS = 45 * 1000;

let interstitialReady = false;
let interstitialLoading: Promise<boolean> | null = null;

/** Précharge un interstitiel (silencieux, ne bloque jamais l'appelant). */
export async function prepareInterstitial(): Promise<boolean> {
  if (!isNative()) return false;
  if (interstitialReady) return true;
  if (interstitialLoading) return interstitialLoading;
  if (!(await initAds()) || !adsAllowed) return false;

  interstitialLoading = (async () => {
    try {
      await AdMob.prepareInterstitial({ adId: AD_UNIT_INTERSTITIAL });
      interstitialReady = true;
      return true;
    } catch (e) {
      // Code 3 = « No fill » : fréquent, jamais bloquant.
      console.warn('[AdMob] interstitial load error', e);
      interstitialReady = false;
      return false;
    } finally {
      interstitialLoading = null;
    }
  })();

  return interstitialLoading;
}

export interface InterstitialOptions {
  /** Délai minimal depuis le dernier interstitiel (ms). */
  minIntervalMs?: number;
}

/**
 * Affiche une annonce interstitielle sur une transition naturelle
 * (validation des pas, fin de sortie GPS, demande de retrait).
 * Résout quand la pub est fermée — jamais bloquant : en cas d'échec,
 * résout immédiatement. Renvoie `true` si une annonce a bien été montrée.
 */
export async function showInterstitial(options: InterstitialOptions = {}): Promise<boolean> {
  if (!isNative()) return false;
  if (!(await initAds()) || !adsAllowed) return false;

  const minInterval = options.minIntervalMs ?? INTERSTITIAL_COOLDOWN_MS;
  if (Date.now() - lastFullScreenAdAt < minInterval) return false;

  const ready = await prepareInterstitial();
  if (!ready) return false;

  return new Promise<boolean>((resolve) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const handles: { remove: () => Promise<void> }[] = [];
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      handles.forEach((h) => h.remove().catch(() => undefined));
    };
    const finish = (shown: boolean) => {
      if (done) return;
      done = true;
      cleanup();
      // L'annonce préparée est consommée (affichée ou invalidée) : on repart
      // d'un état non chargé pour ne jamais bloquer les interstitiels suivants.
      interstitialReady = false;
      if (shown) lastFullScreenAdAt = Date.now();
      resolve(shown);
      // Recharge le suivant en arrière-plan.
      if (shown) setTimeout(() => void prepareInterstitial(), 1200);
    };

    (async () => {
      try {
        handles.push(await AdMob.addListener(InterstitialAdPluginEvents.Dismissed, () => finish(true)));
        handles.push(await AdMob.addListener(InterstitialAdPluginEvents.FailedToShow, () => finish(false)));
        // Sécurité : si aucun évènement (SDK bloqué), on libère l'UI.
        timer = setTimeout(() => finish(false), 90000);
        await AdMob.showInterstitial({ adId: AD_UNIT_INTERSTITIAL });
        lastFullScreenAdAt = Date.now();
      } catch (e) {
        console.warn('[AdMob] interstitial error', e);
        finish(false);
      }
    })();
  });
}

// ---------------------------------------------------------------------------
// Vidéo avec récompense
// ---------------------------------------------------------------------------

/**
 * Affiche une annonce vidéo avec récompense.
 * Transmet l'identifiant utilisateur via `ssv.userId` afin que le callback
 * AdMob SSV (vérifié côté serveur) puisse créditer le bon compte.
 * Résout `true` uniquement si l'utilisateur a gagné la récompense.
 */
export async function showRewardedAd(uid?: string): Promise<boolean> {
  if (!isNative()) return false;
  if (!(await initAds()) || !adsAllowed) return false;

  return new Promise<boolean>((resolve) => {
    let rewarded = false;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const handles: { remove: () => Promise<void> }[] = [];
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      handles.forEach((h) => h.remove().catch(() => undefined));
    };
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      cleanup();
      if (ok) lastFullScreenAdAt = Date.now();
      resolve(ok);
    };

    (async () => {
      try {
        handles.push(
          await AdMob.addListener(RewardAdPluginEvents.Rewarded, () => {
            rewarded = true;
          })
        );
        handles.push(await AdMob.addListener(RewardAdPluginEvents.Dismissed, () => finish(rewarded)));
        handles.push(await AdMob.addListener(RewardAdPluginEvents.FailedToShow, () => finish(false)));
        await AdMob.prepareRewardVideoAd({
          adId: AD_UNIT_REWARDED,
          ...(uid ? { ssv: { userId: uid } } : {}),
        });
        await AdMob.showRewardVideoAd({ adId: AD_UNIT_REWARDED });
        lastFullScreenAdAt = Date.now();
        // Sécurité : aucune récompense si l'évènement Rewarded n'arrive pas.
        timer = setTimeout(() => finish(rewarded), 120000);
      } catch (e) {
        console.warn('[AdMob] rewarded error', e);
        finish(false);
      }
    })();
  });
}

// ---------------------------------------------------------------------------
// App Open Ad (ouverture / retour sur l'application)
// ---------------------------------------------------------------------------

// Garde-fous : plafond journalier + cooldown, pour éviter une UX punitive
// et un rejet Play Store (l'App Open Ad ne doit pas être intrusive).
const APP_OPEN_DAILY_CAP = 3; // maximum d'annonces d'ouverture par jour
const APP_OPEN_COOLDOWN_MS = 30 * 60 * 1000; // au moins 30 min entre deux
const APP_OPEN_AFTER_OTHER_AD_MS = 20 * 1000; // jamais juste après un interstitiel
const APP_OPEN_PREFS = 'appOpenAd.v2';

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

interface AppOpenState {
  date: string;
  count: number;
  lastShownAt: number;
}

async function readAppOpenState(): Promise<AppOpenState> {
  const { value } = await Preferences.get({ key: APP_OPEN_PREFS });
  if (value) {
    try {
      return JSON.parse(value) as AppOpenState;
    } catch {
      /* état corrompu → on repart de zéro */
    }
  }
  return { date: todayKey(), count: 0, lastShownAt: 0 };
}

/** Décide si l'App Open Ad peut être affichée (plafond + cooldown). */
export async function shouldShowAppOpenAd(): Promise<boolean> {
  if (!isNative() || !canShowAds()) return false;
  if (Date.now() - lastFullScreenAdAt < APP_OPEN_AFTER_OTHER_AD_MS) return false;
  try {
    const s = await readAppOpenState();
    if (s.date !== todayKey()) return true;
    if (s.count >= APP_OPEN_DAILY_CAP) return false;
    return Date.now() - s.lastShownAt >= APP_OPEN_COOLDOWN_MS;
  } catch (e) {
    console.warn('[AdMob] appOpen state error', e);
    return false;
  }
}

/** Mémorise l'affichage d'une App Open Ad (plafond journalier). */
export async function recordAppOpenAdShown(): Promise<void> {
  try {
    const s = await readAppOpenState();
    await Preferences.set({
      key: APP_OPEN_PREFS,
      value: JSON.stringify({
        date: s.date === todayKey() ? s.date : todayKey(),
        count: s.date === todayKey() ? s.count + 1 : 1,
        lastShownAt: Date.now(),
      } satisfies AppOpenState),
    });
  } catch (e) {
    console.warn('[AdMob] appOpen record error', e);
  }
}

let appOpenLoaded = false;
let appOpenListenersBound = false;
let appOpenLoading: Promise<void> | null = null;

/** Branche les écouteurs App Open une seule fois (évite les doublons). */
async function bindAppOpenListeners(): Promise<void> {
  if (appOpenListenersBound) return;
  appOpenListenersBound = true;
  try {
    await AdMob.addListener(AppOpenAdPluginEvents.Loaded, () => {
      appOpenLoaded = true;
    });
    await AdMob.addListener(AppOpenAdPluginEvents.FailedToLoad, () => {
      appOpenLoaded = false;
    });
    await AdMob.addListener(AppOpenAdPluginEvents.FailedToShow, () => {
      appOpenLoaded = false;
    });
    await AdMob.addListener(AppOpenAdPluginEvents.Closed, () => {
      appOpenLoaded = false;
      // Précharge la suivante.
      AdMob.loadAppOpen({ adId: AD_UNIT_APP_OPEN }).catch(() => undefined);
    });
  } catch (e) {
    appOpenListenersBound = false;
    console.warn('[AdMob] appOpen listeners error', e);
  }
}

/** Charge (ou recharge) une annonce d'ouverture en arrière-plan. */
export async function loadAppOpenAd(): Promise<void> {
  if (!isNative()) return;
  if (appOpenLoading) return appOpenLoading;
  if (!(await initAds()) || !adsAllowed) return;

  appOpenLoading = (async () => {
    await bindAppOpenListeners();
    try {
      await AdMob.loadAppOpen({ adId: AD_UNIT_APP_OPEN });
      appOpenLoaded = true;
    } catch (e) {
      // 1 = déjà en cours de chargement, 2 = pas de fill : non bloquant.
      console.warn('[AdMob] appOpen load error', e);
      appOpenLoaded = false;
    } finally {
      appOpenLoading = null;
    }
  })();

  return appOpenLoading;
}

/** Affiche l'annonce d'ouverture si elle est chargée et autorisée. */
export async function showAppOpenAdIfReady(): Promise<void> {
  if (!isNative()) return;
  if (!(await initAds()) || !adsAllowed) return;
  if (!(await shouldShowAppOpenAd())) return;

  try {
    let loaded = appOpenLoaded;
    if (!loaded) {
      try {
        const res = await AdMob.isAppOpenLoaded({ adId: AD_UNIT_APP_OPEN });
        loaded = !!res?.value;
      } catch {
        loaded = false;
      }
    }
    if (!loaded) {
      await loadAppOpenAd();
      return;
    }
    await AdMob.showAppOpen({ adId: AD_UNIT_APP_OPEN });
    appOpenLoaded = false;
    lastFullScreenAdAt = Date.now();
    await recordAppOpenAdShown();
  } catch (e) {
    console.warn('[AdMob] appOpen show error', e);
    appOpenLoaded = false;
    // Échec d'affichage : on retente un chargement pour la prochaine ouverture.
    void loadAppOpenAd();
  }
}

// ---------------------------------------------------------------------------
// Amorçage
// ---------------------------------------------------------------------------

/**
 * Prépare toutes les annonces après le consentement : interstitiel + ouverture.
 * À appeler quand l'utilisateur est connecté et l'onboarding terminé.
 */
export async function warmUpAds(): Promise<void> {
  if (!isNative()) return;
  if (!(await initAds()) || !adsAllowed) return;
  await Promise.allSettled([prepareInterstitial(), loadAppOpenAd()]);
}
