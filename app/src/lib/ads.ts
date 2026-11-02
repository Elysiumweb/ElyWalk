import { Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import {
  AdMob,
  AdmobConsentStatus,
  InterstitialAdPluginEvents,
  RewardAdPluginEvents,
  AppOpenAdPluginEvents,
} from '@capacitor-community/admob';
import type { AdmobConsentInfo } from '@capacitor-community/admob';
import {
  AD_UNIT_INTERSTITIAL,
  AD_UNIT_REWARDED,
  AD_UNIT_APP_OPEN,
} from './constants';

const isNative = () => Capacitor.isNativePlatform();

/** Emplacements publicitaires de l'application (journalisation + cadencement). */
export type AdPlacement =
  | 'steps-validation' // validation des pas du jour
  | 'activity-finished' // fin d'une sortie GPS
  | 'withdrawal' // demande de retrait / don
  | 'other';

// ---------------------------------------------------------------------------
// État interne
// ---------------------------------------------------------------------------

let initialized = false;
/** `true` uniquement si l'utilisateur peut recevoir de la publicité
 *  (consentement UMP RGPD obtenu, ou non requis hors EEE/UK). */
let adsAllowed = false;
/** Promesse d'initialisation en cours : évite les doubles `initialize()`
 *  (plusieurs écrans demandent des annonces en même temps au démarrage). */
let initPromise: Promise<boolean> | null = null;
/** Dernière tentative d'initialisation (ms) : permet de réessayer plus tard
 *  quand le consentement ou le réseau a échoué au lancement. */
let lastInitAttempt = 0;
let consentInfo: AdmobConsentInfo | null = null;
let lastError: string | null = null;

/** Une annonce plein écran est en cours d'affichage. */
let fullScreenAdVisible = false;
/** Horodatage de la dernière annonce plein écran affichée. */
let lastFullScreenAdAt = 0;

/** Délai minimal entre deux interstitiels (politique AdMob : ne pas saturer). */
const INTERSTITIAL_MIN_INTERVAL_MS = 60 * 1000;
/** Nouvelle tentative d'initialisation après un échec (réseau, consentement). */
const INIT_RETRY_MS = 60 * 1000;
/** Au-delà, on renonce à attendre le chargement d'une annonce. */
const LOAD_TIMEOUT_MS = 10 * 1000;
/** Sécurité : si aucun événement de fermeture n'arrive, on débloque l'UI. */
const SHOW_TIMEOUT_MS = 90 * 1000;

const warn = (scope: string, e: unknown) => {
  lastError = e instanceof Error ? e.message : String(e);
  console.warn(`[AdMob] ${scope}:`, lastError);
};

/** Résout `fallback` si la promesse n'a pas abouti dans le délai imparti. */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const done = (value: T) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const timer = setTimeout(() => done(fallback), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        done(value);
      })
      .catch(() => {
        clearTimeout(timer);
        done(fallback);
      });
  });
}

// ---------------------------------------------------------------------------
// Consentement RGPD (Google UMP / Funding Choices)
// ---------------------------------------------------------------------------

/**
 * Demande l'état du consentement et affiche le formulaire UMP si nécessaire.
 * Résout `true` si les annonces peuvent être chargées (`canRequestAds`).
 *
 * ⚠️ Pré-requis console AdMob : un message RGPD doit être **publié**
 * (Confidentialité et messages → Message RGPD) pour les utilisateurs de
 * l'EEE/UK. Sans message publié, `canRequestAds` reste `false` en Europe et
 * aucune annonce n'est diffusée.
 */
async function requestAndShowConsent(): Promise<boolean> {
  try {
    // Le SDK détecte la géolocalisation de l'utilisateur (EEE/UK) par lui-même.
    // `tagForUnderAgeOfConsent` reste à false : ElyWalk n'est pas une app
    // destinée aux enfants, et l'âge minimum (15 ans) est vérifié côté CGU.
    const info = await AdMob.requestConsentInfo();
    consentInfo = info;

    const needsForm =
      info.status === AdmobConsentStatus.REQUIRED || info.status === AdmobConsentStatus.UNKNOWN;

    if (needsForm) {
      try {
        // `showConsentForm` appelle `loadAndShowConsentFormIfRequired` :
        // sans effet si le formulaire n'est pas requis.
        const after = await AdMob.showConsentForm();
        consentInfo = { ...info, ...after };
        return after.canRequestAds !== false;
      } catch (e) {
        // Formulaire indisponible (message RGPD non publié) ou réseau coupé :
        // on ne bloque pas définitivement, on se fie à l'état connu de l'UMP
        // et une nouvelle tentative aura lieu plus tard (INIT_RETRY_MS).
        warn('consent form', e);
        return info.canRequestAds === true;
      }
    }

    // NOT_REQUIRED (hors EEE/UK) ou OBTAINED (déjà consenti) : on peut diffuser.
    return info.canRequestAds !== false;
  } catch (e) {
    // Principe de prudence RGPD : en cas d'erreur, on ne diffuse aucune annonce.
    warn('consent', e);
    return false;
  }
}

/** Ouvre le formulaire « Options de confidentialité » (révision du consentement). */
export async function showPrivacyOptionsForm(): Promise<void> {
  if (!isNative()) return;
  try {
    await AdMob.showPrivacyOptionsForm();
    // Le choix a pu changer : on réévalue le droit de diffuser.
    adsAllowed = await requestAndShowConsent();
    if (adsAllowed) void preloadInterstitial();
  } catch (e) {
    warn('privacy options', e);
  }
}

/** Réinitialise le consentement (permet de re-choisir). Utile pour les tests. */
export async function resetConsent(): Promise<void> {
  if (!isNative()) return;
  try {
    await AdMob.resetConsentInfo();
    initialized = false;
    initPromise = null;
    adsAllowed = false;
    lastInitAttempt = 0;
  } catch (e) {
    warn('resetConsent', e);
  }
}

// ---------------------------------------------------------------------------
// Initialisation du SDK Google Mobile Ads
// ---------------------------------------------------------------------------

/**
 * Initialise le SDK puis recueille le consentement. Idempotent et « mono-vol » :
 * les appels concurrents partagent la même promesse. Si le consentement a
 * échoué, une nouvelle tentative est faite au bout d'une minute.
 */
async function ensureAds(): Promise<boolean> {
  if (!isNative()) return false;
  if (adsAllowed) return true;
  if (initPromise) return initPromise;
  if (initialized && Date.now() - lastInitAttempt < INIT_RETRY_MS) return false;

  lastInitAttempt = Date.now();
  initPromise = (async () => {
    try {
      if (!initialized) {
        await AdMob.initialize({});
        registerAdListeners();
        initialized = true;
      }
      adsAllowed = await requestAndShowConsent();
      if (adsAllowed) {
        lastError = null;
        // Précharge dès maintenant : l'interstitiel doit être instantané.
        void preloadInterstitial();
      }
      return adsAllowed;
    } catch (e) {
      warn('init', e);
      return false;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

/** Initialise le SDK publicitaire (à appeler au lancement de l'application). */
export async function initAds(): Promise<void> {
  await ensureAds();
}

/** `true` si le consentement a été obtenu et que la pub est autorisée. */
export function canShowAds(): boolean {
  return initialized && adsAllowed;
}

export interface AdsDiagnostics {
  native: boolean;
  initialized: boolean;
  adsAllowed: boolean;
  consentStatus: string | null;
  canRequestAds: boolean | null;
  consentFormAvailable: boolean | null;
  privacyOptionsRequired: boolean;
  interstitialReady: boolean;
  lastError: string | null;
}

/** État détaillé de la régie — affiché dans Profil → Confidentialité des annonces. */
export function getAdsDiagnostics(): AdsDiagnostics {
  return {
    native: isNative(),
    initialized,
    adsAllowed,
    consentStatus: consentInfo?.status ?? null,
    canRequestAds: consentInfo ? consentInfo.canRequestAds !== false : null,
    consentFormAvailable: consentInfo?.isConsentFormAvailable ?? null,
    privacyOptionsRequired: consentInfo?.privacyOptionsRequirementStatus === 'REQUIRED',
    interstitialReady,
    lastError,
  };
}

// ---------------------------------------------------------------------------
// Écouteurs globaux (enregistrés une seule fois)
// ---------------------------------------------------------------------------

let listenersRegistered = false;
let interstitialReady = false;
let interstitialLoading: Promise<boolean> | null = null;
let appOpenReady = false;
let resolveInterstitialShown: (() => void) | null = null;
let rewardEarned = false;
let resolveRewardShown: ((earned: boolean) => void) | null = null;

let previousFullScreenAdAt = 0;

function beginFullScreenAd() {
  if (!fullScreenAdVisible) previousFullScreenAdAt = lastFullScreenAdAt;
  fullScreenAdVisible = true;
  lastFullScreenAdAt = Date.now();
}

function endFullScreenAd() {
  fullScreenAdVisible = false;
  lastFullScreenAdAt = Date.now();
}

/** L'annonce n'a finalement pas été affichée : on ne consomme pas le délai. */
function cancelFullScreenAd() {
  fullScreenAdVisible = false;
  lastFullScreenAdAt = previousFullScreenAdAt;
}

function registerAdListeners() {
  if (listenersRegistered) return;
  listenersRegistered = true;

  const track = (handle: Promise<PluginListenerHandle>) => {
    handle.catch((e) => warn('addListener', e));
  };

  // --- Interstitiel ---
  track(
    AdMob.addListener(InterstitialAdPluginEvents.Loaded, () => {
      interstitialReady = true;
    })
  );
  track(
    AdMob.addListener(InterstitialAdPluginEvents.FailedToLoad, () => {
      interstitialReady = false;
    })
  );
  track(AdMob.addListener(InterstitialAdPluginEvents.Showed, () => beginFullScreenAd()));
  track(
    AdMob.addListener(InterstitialAdPluginEvents.Dismissed, () => {
      interstitialReady = false;
      endFullScreenAd();
      resolveInterstitialShown?.();
      resolveInterstitialShown = null;
      // Prépare la suivante pour que l'affichage reste instantané.
      void preloadInterstitial();
    })
  );
  track(
    AdMob.addListener(InterstitialAdPluginEvents.FailedToShow, () => {
      interstitialReady = false;
      endFullScreenAd();
      resolveInterstitialShown?.();
      resolveInterstitialShown = null;
      void preloadInterstitial();
    })
  );

  // --- Vidéo avec récompense ---
  track(AdMob.addListener(RewardAdPluginEvents.Showed, () => beginFullScreenAd()));
  track(
    AdMob.addListener(RewardAdPluginEvents.Rewarded, () => {
      rewardEarned = true;
    })
  );
  track(
    AdMob.addListener(RewardAdPluginEvents.Dismissed, () => {
      endFullScreenAd();
      resolveRewardShown?.(rewardEarned);
      resolveRewardShown = null;
    })
  );
  track(
    AdMob.addListener(RewardAdPluginEvents.FailedToShow, () => {
      endFullScreenAd();
      resolveRewardShown?.(false);
      resolveRewardShown = null;
    })
  );

  // --- Annonce à l'ouverture ---
  track(
    AdMob.addListener(AppOpenAdPluginEvents.Loaded, () => {
      appOpenReady = true;
    })
  );
  track(
    AdMob.addListener(AppOpenAdPluginEvents.FailedToLoad, () => {
      appOpenReady = false;
    })
  );
  track(AdMob.addListener(AppOpenAdPluginEvents.Opened, () => beginFullScreenAd()));
  track(
    AdMob.addListener(AppOpenAdPluginEvents.Closed, () => {
      appOpenReady = false;
      endFullScreenAd();
      // Précharge la prochaine annonce d'ouverture.
      void AdMob.loadAppOpen({ adId: AD_UNIT_APP_OPEN }).catch(() => undefined);
    })
  );
  track(
    AdMob.addListener(AppOpenAdPluginEvents.FailedToShow, () => {
      appOpenReady = false;
      endFullScreenAd();
    })
  );
}

// ---------------------------------------------------------------------------
// Interstitiel — validation des pas, fin de sortie, retrait
// ---------------------------------------------------------------------------

/** Charge (ou recharge) un interstitiel en tâche de fond. */
async function preloadInterstitial(): Promise<boolean> {
  if (!isNative() || !adsAllowed) return false;
  if (interstitialReady) return true;
  if (interstitialLoading) return interstitialLoading;

  interstitialLoading = (async () => {
    try {
      await AdMob.prepareInterstitial({ adId: AD_UNIT_INTERSTITIAL });
      interstitialReady = true;
      return true;
    } catch (e) {
      warn('interstitial load', e);
      interstitialReady = false;
      return false;
    } finally {
      interstitialLoading = null;
    }
  })();

  return interstitialLoading;
}

/** Précharge les annonces en tâche de fond (appelé après le démarrage). */
export async function prefetchAds(): Promise<void> {
  if (!(await ensureAds())) return;
  await preloadInterstitial();
}

/**
 * Affiche une annonce interstitielle.
 * Résout quand la pub est fermée. Ne bloque jamais l'utilisateur : en cas
 * d'échec de chargement ou de cadencement trop rapproché, on résout tout de
 * suite sans rien afficher.
 */
export async function showInterstitial(placement: AdPlacement = 'other'): Promise<void> {
  if (!isNative()) return;
  if (!(await ensureAds())) return;
  // Jamais deux annonces plein écran l'une sur l'autre.
  if (fullScreenAdVisible) return;
  if (Date.now() - lastFullScreenAdAt < INTERSTITIAL_MIN_INTERVAL_MS) {
    void preloadInterstitial();
    return;
  }

  const ready = interstitialReady || (await withTimeout(preloadInterstitial(), LOAD_TIMEOUT_MS, false));
  if (!ready) return;

  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (resolveInterstitialShown === finish) resolveInterstitialShown = null;
      resolve();
    };
    resolveInterstitialShown = finish;
    // Filet de sécurité : l'UI ne doit jamais rester bloquée.
    setTimeout(finish, SHOW_TIMEOUT_MS);

    beginFullScreenAd();
    AdMob.showInterstitial().catch((e) => {
      warn(`interstitial show (${placement})`, e);
      interstitialReady = false;
      cancelFullScreenAd();
      void preloadInterstitial();
      finish();
    });
  });
}

// ---------------------------------------------------------------------------
// Vidéo avec récompense — « Regarder une pub pour gagner 0,1 ElyCoins »
// ---------------------------------------------------------------------------

/**
 * Affiche une annonce vidéo avec récompense.
 * Transmet l'identifiant utilisateur via `ssv.userId` afin que le callback
 * AdMob SSV (vérifié côté serveur) puisse créditer le bon compte.
 * Résout `true` uniquement si l'utilisateur a gagné la récompense.
 */
export async function showRewardedAd(uid: string): Promise<boolean> {
  if (!isNative()) return false;
  if (!(await ensureAds())) return false;
  if (fullScreenAdVisible) return false;

  try {
    // La récompense est nominative (SSV) : on prépare juste avant l'affichage.
    await AdMob.prepareRewardVideoAd({
      adId: AD_UNIT_REWARDED,
      ssv: { userId: uid },
    });
  } catch (e) {
    warn('rewarded load', e);
    return false;
  }

  return new Promise<boolean>((resolve) => {
    let done = false;
    rewardEarned = false;
    const finish = (earned: boolean) => {
      if (done) return;
      done = true;
      if (resolveRewardShown === finish) resolveRewardShown = null;
      resolve(earned);
    };
    resolveRewardShown = finish;
    setTimeout(() => finish(rewardEarned), SHOW_TIMEOUT_MS);

    beginFullScreenAd();
    AdMob.showRewardVideoAd().catch((e) => {
      warn('rewarded show', e);
      cancelFullScreenAd();
      finish(false);
    });
  });
}

// ---------------------------------------------------------------------------
// App Open Ad (ouverture / retour sur l'application)
// ---------------------------------------------------------------------------

// Garde-fous : plafond journalier + cooldown, pour éviter une UX punitive
// et un rejet Play Store (l'App Open Ad ne doit pas être intrusive).
const APP_OPEN_DAILY_CAP = 2; // maximum d'annonces d'ouverture par jour
const APP_OPEN_COOLDOWN_MS = 10 * 60 * 1000; // au moins 10 min entre deux
/** Après une autre annonce plein écran, pas d'annonce d'ouverture : le retour
 *  dans l'app après un interstitiel ne doit pas déclencher une 2ᵉ annonce. */
const APP_OPEN_AFTER_AD_MS = 60 * 1000;
const APP_OPEN_PREFS = 'appOpenAd.v1';

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
      /* état corrompu -> on repart de zéro */
    }
  }
  return { date: todayKey(), count: 0, lastShownAt: 0 };
}

/** Décide si l'App Open Ad peut être affichée (plafond + cooldown). */
export async function shouldShowAppOpenAd(): Promise<boolean> {
  if (!isNative() || !canShowAds()) return false;
  if (fullScreenAdVisible) return false;
  if (Date.now() - lastFullScreenAdAt < APP_OPEN_AFTER_AD_MS) return false;
  try {
    const s = await readAppOpenState();
    if (s.date !== todayKey()) return true;
    if (s.count >= APP_OPEN_DAILY_CAP) return false;
    return Date.now() - s.lastShownAt >= APP_OPEN_COOLDOWN_MS;
  } catch (e) {
    warn('appOpen state', e);
    return false;
  }
}

/** Mémorise l'affichage d'une App Open Ad (plafond journalier). */
export async function recordAppOpenAdShown(): Promise<void> {
  try {
    const s = await readAppOpenState();
    const now = Date.now();
    await Preferences.set({
      key: APP_OPEN_PREFS,
      value: JSON.stringify({
        date: s.date === todayKey() ? s.date : todayKey(),
        count: s.date === todayKey() ? s.count + 1 : 1,
        lastShownAt: now,
      } satisfies AppOpenState),
    });
  } catch (e) {
    warn('appOpen record', e);
  }
}

/** Précharge l'annonce d'ouverture (à appeler au démarrage). */
export async function loadAppOpenAd(): Promise<void> {
  if (!(await ensureAds())) return;
  if (appOpenReady) return;
  try {
    await AdMob.loadAppOpen({ adId: AD_UNIT_APP_OPEN });
    appOpenReady = true;
  } catch (e) {
    warn('appOpen load', e);
  }
}

/** Affiche l'annonce d'ouverture si elle est prête et autorisée. */
export async function showAppOpenAdIfReady(): Promise<void> {
  if (!(await ensureAds())) return;
  if (!(await shouldShowAppOpenAd())) return;
  try {
    let loaded = appOpenReady;
    if (!loaded) {
      const { value } = await AdMob.isAppOpenLoaded();
      loaded = value === true;
    }
    if (!loaded) {
      // Pas encore prête : on la charge pour la prochaine ouverture.
      await loadAppOpenAd();
      return;
    }
    beginFullScreenAd();
    await AdMob.showAppOpen();
    await recordAppOpenAdShown();
  } catch (e) {
    cancelFullScreenAd();
    appOpenReady = false;
    warn('appOpen show', e);
  }
}
