import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import {
  AdMob,
  AppOpenAdPluginEvents,
  InterstitialAdPluginEvents,
  RewardAdPluginEvents,
} from '@capacitor-community/admob';
import {
  AD_UNIT_APP_OPEN,
  AD_UNIT_INTERSTITIAL,
  AD_UNIT_REWARDED,
} from './constants';

const isNative = () => Capacitor.isNativePlatform();

// Aucun parcours produit ne doit être bloqué durablement par une régie
// publicitaire. Ces délais ne coupent pas une annonce affichée normalement :
// ils libèrent seulement l'action si le SDK ou le réseau ne répond plus.
const AD_LOAD_TIMEOUT_MS = 20_000;
const AD_SHOW_TIMEOUT_MS = 90_000;

let consentProcessed = false;
let sdkInitialized = false;
/** `true` uniquement si l'utilisateur peut recevoir de la publicité
 * (consentement UMP RGPD obtenu, ou non requis hors EEE/UK). */
let adsAllowed = false;
let initializationPromise: Promise<void> | null = null;

// Une seule publicité plein écran à la fois. Cela évite notamment qu'une App
// Open Ad se superpose à une interstitielle, une récompensée ou son retour.
let fullScreenAdInFlight = false;

function waitWithTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(`${label} a expiré.`)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

async function removeListeners(handles: PluginListenerHandle[]): Promise<void> {
  await Promise.all(handles.map((handle) => handle.remove().catch(() => undefined)));
}

// ---------------------------------------------------------------------------
// Consentement RGPD (Google UMP / Funding Choices)
// ---------------------------------------------------------------------------

/**
 * Demande l'état du consentement et affiche le formulaire UMP si nécessaire.
 * Doit être appelé avant l'initialisation du SDK et avant toute demande
 * d'annonce. Résout `true` si le SDK peut demander des annonces.
 */
async function requestAndShowConsent(): Promise<boolean> {
  let info = await AdMob.requestConsentInfo({
    // ElyWalk n'est pas destinée aux enfants ; l'âge minimum (15 ans) est
    // vérifié par les CGU. Le SDK applique de lui-même les règles EEE/UK.
    tagForUnderAgeOfConsent: false,
  });

  // `canRequestAds` est l'indicateur UMP de référence : un refus de
  // personnalisation peut tout de même autoriser des annonces non
  // personnalisées. On ne charge donc jamais d'annonce tant qu'il est faux.
  if (!info.canRequestAds && info.isConsentFormAvailable) {
    info = await AdMob.showConsentForm();
  }

  return info.canRequestAds;
}

/** Ouvre le formulaire « Options de confidentialité » (révision du consentement). */
export async function showPrivacyOptionsForm(): Promise<void> {
  if (!isNative()) return;

  // UMP peut afficher les options avant Mobile Ads ; initAds() garantit que les
  // informations de consentement sont tout de même récupérées au préalable.
  await initAds();
  try {
    await AdMob.showPrivacyOptionsForm();
    const info = await AdMob.requestConsentInfo();
    consentProcessed = true;
    adsAllowed = info.canRequestAds;

    // Si la personne vient d'autoriser les annonces, initialise le SDK à ce
    // moment-là sans redemander le formulaire.
    if (adsAllowed && !sdkInitialized) await initAds();
  } catch (error) {
    console.warn('[AdMob] privacy options error', error);
  }
}

/** Réinitialise le consentement (permet de re-choisir, utile pour les tests). */
export async function resetConsent(): Promise<void> {
  if (!isNative()) return;
  try {
    await AdMob.resetConsentInfo();
    consentProcessed = false;
    adsAllowed = false;
  } catch (error) {
    console.warn('[AdMob] resetConsent error', error);
  }
}

/**
 * Initialise UMP puis Google Mobile Ads, une seule fois même lorsque plusieurs
 * écrans se montent en parallèle au lancement de l'application.
 */
export async function initAds(): Promise<void> {
  if (!isNative()) return;
  if (consentProcessed && (sdkInitialized || !adsAllowed)) return;
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    if (!consentProcessed) {
      try {
        adsAllowed = await requestAndShowConsent();
        consentProcessed = true;
      } catch (error) {
        // Une erreur UMP est réessayable au prochain passage, mais aucune pub
        // n'est chargée d'ici là (principe de prudence RGPD).
        adsAllowed = false;
        consentProcessed = false;
        console.warn('[AdMob] consent error', error);
        return;
      }
    }

    if (!adsAllowed || sdkInitialized) return;

    try {
      await waitWithTimeout(AdMob.initialize({}), AD_LOAD_TIMEOUT_MS, 'Initialisation AdMob');
      sdkInitialized = true;
    } catch (error) {
      // Le SDK 8.2+ peut refuser si l'Activity/WebView n'est pas encore prête.
      // L'état reste réessayable lors de la prochaine action publicitaire.
      console.warn('[AdMob] init error', error);
    }
  })();

  try {
    await initializationPromise;
  } finally {
    initializationPromise = null;
  }
}

/** `true` si le consentement a été traité et que le SDK peut diffuser une pub. */
export function canShowAds(): boolean {
  return sdkInitialized && adsAllowed;
}

// ---------------------------------------------------------------------------
// Annonces plein écran : interstitielles et récompensées
// ---------------------------------------------------------------------------

/**
 * Affiche une interstitielle de production. Ne bloque jamais le parcours : un
 * refus de consentement, un no-fill ou une erreur réseau résout simplement.
 */
export async function showInterstitial(): Promise<void> {
  if (!isNative() || fullScreenAdInFlight) return;

  await initAds();
  // Recontrôle après l'attente d'initialisation : deux actions utilisateur
  // peuvent arriver pendant la même promesse d'initialisation.
  if (!canShowAds() || fullScreenAdInFlight) return;

  fullScreenAdInFlight = true;
  const handles: PluginListenerHandle[] = [];
  let settled = false;
  let finish!: () => void;
  const terminalEvent = new Promise<void>((resolve) => {
    finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
  });

  try {
    handles.push(await AdMob.addListener(InterstitialAdPluginEvents.Dismissed, finish));
    handles.push(await AdMob.addListener(InterstitialAdPluginEvents.FailedToShow, finish));
    handles.push(await AdMob.addListener(InterstitialAdPluginEvents.FailedToLoad, finish));

    await waitWithTimeout(
      AdMob.prepareInterstitial({ adId: AD_UNIT_INTERSTITIAL }),
      AD_LOAD_TIMEOUT_MS,
      'Chargement de l’annonce interstitielle',
    );
    await waitWithTimeout(
      AdMob.showInterstitial({ adId: AD_UNIT_INTERSTITIAL }),
      AD_LOAD_TIMEOUT_MS,
      'Affichage de l’annonce interstitielle',
    );
    await waitWithTimeout(terminalEvent, AD_SHOW_TIMEOUT_MS, 'Annonce interstitielle');
  } catch (error) {
    console.warn('[AdMob] interstitial error', error);
  } finally {
    await removeListeners(handles);
    fullScreenAdInFlight = false;
  }
}

/**
 * Affiche une vidéo récompensée de production et renvoie `true` uniquement si
 * le SDK confirme la récompense. L'UID est transmis à AdMob pour son callback
 * SSV : le crédit serveur peut ainsi être associé au bon compte.
 */
export async function showRewardedAd(uid: string): Promise<boolean> {
  if (!isNative() || fullScreenAdInFlight) return false;

  await initAds();
  if (!canShowAds() || fullScreenAdInFlight) return false;

  fullScreenAdInFlight = true;
  const handles: PluginListenerHandle[] = [];
  let rewarded = false;
  let settled = false;
  let finish!: (value: boolean) => void;
  let timeout: number | undefined;
  const terminalEvent = new Promise<boolean>((resolve) => {
    finish = (value) => {
      if (settled) return;
      settled = true;
      if (timeout !== undefined) window.clearTimeout(timeout);
      resolve(value);
    };
  });

  try {
    handles.push(await AdMob.addListener(RewardAdPluginEvents.Rewarded, () => {
      rewarded = true;
    }));
    handles.push(await AdMob.addListener(RewardAdPluginEvents.Dismissed, () => finish(rewarded)));
    handles.push(await AdMob.addListener(RewardAdPluginEvents.FailedToShow, () => finish(false)));
    handles.push(await AdMob.addListener(RewardAdPluginEvents.FailedToLoad, () => finish(false)));

    await waitWithTimeout(
      AdMob.prepareRewardVideoAd({
        adId: AD_UNIT_REWARDED,
        ssv: { userId: uid },
      }),
      AD_LOAD_TIMEOUT_MS,
      'Chargement de la publicité récompensée',
    );

    // Le plugin résout sa promesse au gain de récompense, mais ne la résout pas
    // forcément lorsqu'une vidéo est simplement fermée. Les événements ci-dessus
    // restent donc la source de vérité pour terminer ce flux.
    void AdMob.showRewardVideoAd({ adId: AD_UNIT_REWARDED }).catch((error: unknown) => {
      console.warn('[AdMob] rewarded show error', error);
      finish(false);
    });
    timeout = window.setTimeout(() => finish(rewarded), AD_SHOW_TIMEOUT_MS);

    return await terminalEvent;
  } catch (error) {
    console.warn('[AdMob] rewarded error', error);
    return false;
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
    await removeListeners(handles);
    fullScreenAdInFlight = false;
  }
}

// ---------------------------------------------------------------------------
// App Open Ad (ouverture / retour sur l'application)
// ---------------------------------------------------------------------------

// Garde-fous : plafond journalier + cooldown, pour éviter une UX punitive et
// respecter les règles Google Play relatives aux App Open Ads.
const APP_OPEN_DAILY_CAP = 2;
const APP_OPEN_COOLDOWN_MS = 10 * 60 * 1000;
// v2 remet à zéro un ancien plafond enregistré avec les anciens IDs AdMob.
const APP_OPEN_PREFS = 'appOpenAd.v2';

function todayKey(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
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
      // État corrompu : on repart de zéro.
    }
  }
  return { date: todayKey(), count: 0, lastShownAt: 0 };
}

/** Décide si l'App Open Ad peut être affichée (plafond + cooldown). */
export async function shouldShowAppOpenAd(): Promise<boolean> {
  if (!isNative() || !canShowAds()) return false;
  try {
    const state = await readAppOpenState();
    if (state.date !== todayKey()) return true;
    if (state.count >= APP_OPEN_DAILY_CAP) return false;
    return Date.now() - state.lastShownAt >= APP_OPEN_COOLDOWN_MS;
  } catch (error) {
    console.warn('[AdMob] app open state error', error);
    return false;
  }
}

/** Mémorise l'affichage d'une App Open Ad (plafond journalier). */
export async function recordAppOpenAdShown(): Promise<void> {
  try {
    const state = await readAppOpenState();
    const today = todayKey();
    await Preferences.set({
      key: APP_OPEN_PREFS,
      value: JSON.stringify({
        date: today,
        count: state.date === today ? state.count + 1 : 1,
        lastShownAt: Date.now(),
      } satisfies AppOpenState),
    });
  } catch (error) {
    console.warn('[AdMob] app open record error', error);
  }
}

let appOpenLoaded = false;
let appOpenListenersPromise: Promise<void> | null = null;
let appOpenLoadPromise: Promise<void> | null = null;

async function ensureAppOpenListeners(): Promise<void> {
  if (appOpenListenersPromise) return appOpenListenersPromise;

  appOpenListenersPromise = (async () => {
    await Promise.all([
      AdMob.addListener(AppOpenAdPluginEvents.Loaded, () => {
        appOpenLoaded = true;
      }),
      AdMob.addListener(AppOpenAdPluginEvents.FailedToLoad, () => {
        appOpenLoaded = false;
      }),
      AdMob.addListener(AppOpenAdPluginEvents.Closed, () => {
        appOpenLoaded = false;
        // Précharge la prochaine annonce sans attendre le prochain retour.
        void loadAppOpenAd();
      }),
      AdMob.addListener(AppOpenAdPluginEvents.FailedToShow, () => {
        appOpenLoaded = false;
        void loadAppOpenAd();
      }),
    ]);
  })().catch((error) => {
    appOpenListenersPromise = null;
    throw error;
  });

  return appOpenListenersPromise;
}

/** Précharge l'App Open Ad de production si aucune annonce n'est déjà prête. */
export async function loadAppOpenAd(): Promise<void> {
  if (!isNative()) return;

  await initAds();
  if (!canShowAds()) return;

  try {
    await ensureAppOpenListeners();
  } catch (error) {
    console.warn('[AdMob] app open listener error', error);
    return;
  }

  if (appOpenLoaded) return;
  if (appOpenLoadPromise) return appOpenLoadPromise;

  const loadPromise = (async () => {
    try {
      await waitWithTimeout(
        AdMob.loadAppOpen({ adId: AD_UNIT_APP_OPEN }),
        AD_LOAD_TIMEOUT_MS,
        'Chargement de l’annonce à l’ouverture',
      );
      appOpenLoaded = true;
    } catch (error) {
      appOpenLoaded = false;
      console.warn('[AdMob] app open load error', error);
    }
  })();

  appOpenLoadPromise = loadPromise;
  try {
    await loadPromise;
  } finally {
    if (appOpenLoadPromise === loadPromise) appOpenLoadPromise = null;
  }
}

/** Affiche l'App Open Ad déjà chargée, sans jamais bloquer l'application. */
export async function showAppOpenAdIfReady(): Promise<void> {
  if (!isNative() || fullScreenAdInFlight) return;

  await initAds();
  if (!canShowAds() || !(await shouldShowAppOpenAd())) return;

  try {
    await ensureAppOpenListeners();
    const { value } = await AdMob.isAppOpenLoaded({ adId: AD_UNIT_APP_OPEN });
    appOpenLoaded = value;
  } catch (error) {
    console.warn('[AdMob] app open status error', error);
    return;
  }

  if (!appOpenLoaded) {
    void loadAppOpenAd();
    return;
  }

  // Une interstitielle/récompensée a pu démarrer pendant la vérification de
  // l'état de l'App Open Ad ; ne superpose jamais deux formats plein écran.
  if (fullScreenAdInFlight) return;
  fullScreenAdInFlight = true;
  try {
    await waitWithTimeout(
      AdMob.showAppOpen({ adId: AD_UNIT_APP_OPEN }),
      AD_SHOW_TIMEOUT_MS,
      'Annonce à l’ouverture',
    );
    await recordAppOpenAdShown();
  } catch (error) {
    console.warn('[AdMob] app open show error', error);
    appOpenLoaded = false;
    void loadAppOpenAd();
  } finally {
    fullScreenAdInFlight = false;
  }
}
