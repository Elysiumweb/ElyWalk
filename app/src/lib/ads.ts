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

const isNative = () => Capacitor.isNativePlatform();

let initialized = false;
/** `true` uniquement si l'utilisateur peut recevoir de la publicité
 *  (consentement UMP RGPD obtenu, ou non requis hors EEE/UK). */
let adsAllowed = false;

// ---------------------------------------------------------------------------
// Consentement RGPD (Google UMP / Funding Choices)
// ---------------------------------------------------------------------------

/**
 * Demande l'état du consentement et affiche le formulaire UMP si nécessaire.
 * Doit être appelé après `AdMob.initialize()` et AVANT toute demande d'annonce.
 * Résout `true` si les annonces peuvent être chargées.
 */
async function requestAndShowConsent(): Promise<boolean> {
  try {
    const info = await AdMob.requestConsentInfo({
      // Le SDK détecte la géolocalisation de l'utilisateur (EEE/UK) par lui-même.
      // `tagForUnderAgeOfConsent` reste à false : ElyWalk n'est pas une app
      // destinée aux enfants, et l'âge minimum (15 ans) est vérifié côté CGU.
    });
    if (info.isConsentFormAvailable && info.status === AdmobConsentStatus.REQUIRED) {
      const after = await AdMob.showConsentForm();
      return after.canRequestAds !== false;
    }
    // NOT_REQUIRED (hors EEE/UK) ou OBTAINED (déjà consenti) : on peut diffuser.
    return info.canRequestAds !== false;
  } catch (e) {
    // Principe de prudence RGPD : en cas d'erreur, on ne diffuse aucune annonce.
    console.warn('[AdMob] consent error', e);
    return false;
  }
}

/** Ouvre le formulaire « Options de confidentialité » (révision du consentement). */
export async function showPrivacyOptionsForm(): Promise<void> {
  if (!isNative()) return;
  try {
    await AdMob.showPrivacyOptionsForm();
  } catch (e) {
    console.warn('[AdMob] privacy options error', e);
  }
}

/** Réinitialise le consentement (permet de re-choisir). Utile pour les tests. */
export async function resetConsent(): Promise<void> {
  if (!isNative()) return;
  try {
    await AdMob.resetConsentInfo();
  } catch (e) {
    console.warn('[AdMob] resetConsent error', e);
  }
}

/** Initialise le SDK Google Mobile Ads puis recueille le consentement. */
export async function initAds(): Promise<void> {
  if (!isNative() || initialized) return;
  try {
    await AdMob.initialize({});
    adsAllowed = await requestAndShowConsent();
    initialized = true;
  } catch (e) {
    console.warn('[AdMob] init error', e);
  }
}

/** `true` si le consentement a été obtenu et que la pub est autorisée. */
export function canShowAds(): boolean {
  return initialized && adsAllowed;
}

// ---------------------------------------------------------------------------
// Annonces (interstitielle + récompensée) — bloquées sans consentement
// ---------------------------------------------------------------------------

/**
 * Affiche une annonce interstitielle (validation des pas).
 * Résout quand la pub est fermée. Ne bloque jamais l'utilisateur :
 * en cas d'échec de chargement, on résout immédiatement.
 */
export async function showInterstitial(): Promise<void> {
  if (!isNative()) return;
  await initAds();
  if (!canShowAds()) return;
  return new Promise<void>(async (resolve) => {
    let done = false;
    const handles: { remove: () => Promise<void> }[] = [];
    const finish = () => {
      if (!done) {
        done = true;
        handles.forEach((h) => h.remove().catch(() => undefined));
        resolve();
      }
    };
    try {
      handles.push(await AdMob.addListener(InterstitialAdPluginEvents.Dismissed, finish));
      handles.push(await AdMob.addListener(InterstitialAdPluginEvents.FailedToShow, finish));
      await AdMob.prepareInterstitial({ adId: AD_UNIT_INTERSTITIAL });
      await AdMob.showInterstitial();
      // Sécurité : si aucun événement après 60 s, on libère.
      setTimeout(finish, 60000);
    } catch (e) {
      console.warn('[AdMob] interstitial error', e);
      finish();
    }
  });
}

/**
 * Affiche une annonce vidéo avec récompense.
 * Transmet l'identifiant utilisateur via `ssv.userId` afin que le callback
 * AdMob SSV (vérifié côté serveur) puisse créditer le bon compte.
 * Résout `true` uniquement si l'utilisateur a gagné la récompense.
 */
export async function showRewardedAd(uid: string): Promise<boolean> {
  if (!isNative()) return false;
  await initAds();
  if (!canShowAds()) return false;
  return new Promise<boolean>(async (resolve) => {
    let rewarded = false;
    let done = false;
    const handles: { remove: () => Promise<void> }[] = [];
    const finish = (ok: boolean) => {
      if (!done) {
        done = true;
        handles.forEach((h) => h.remove().catch(() => undefined));
        resolve(ok);
      }
    };
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
        ssv: { userId: uid },
      });
      await AdMob.showRewardVideoAd();
      setTimeout(() => finish(rewarded), 120000);
    } catch (e) {
      console.warn('[AdMob] rewarded error', e);
      finish(false);
    }
  });
}

// ---------------------------------------------------------------------------
// App Open Ad (ouverture / retour sur l'application)
// ---------------------------------------------------------------------------

// Garde-fous : plafond journalier + cooldown, pour éviter une UX punitive
// et un rejet Play Store (l'App Open Ad ne doit pas être intrusive).
const APP_OPEN_DAILY_CAP = 2; // maximum d'annonces d'ouverture par jour
const APP_OPEN_COOLDOWN_MS = 10 * 60 * 1000; // au moins 10 min entre deux
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
    console.warn('[AdMob] appOpen record error', e);
  }
}

let appOpenLoaded = false;

export async function loadAppOpenAd(): Promise<void> {
  if (!isNative()) return;
  await initAds();
  if (!canShowAds()) return;
  try {
    await AdMob.addListener(AppOpenAdPluginEvents.Loaded, () => {
      appOpenLoaded = true;
    });
    await AdMob.addListener(AppOpenAdPluginEvents.Closed, () => {
      appOpenLoaded = false;
      // Précharge la prochaine annonce d'ouverture.
      AdMob.loadAppOpen({ adId: AD_UNIT_APP_OPEN }).catch(() => undefined);
    });
    await AdMob.loadAppOpen({ adId: AD_UNIT_APP_OPEN });
  } catch (e) {
    console.warn('[AdMob] appOpen load error', e);
  }
}

export async function showAppOpenAdIfReady(): Promise<void> {
  if (!isNative()) return;
  await initAds();
  if (!canShowAds()) return;
  if (!(await shouldShowAppOpenAd())) return;
  try {
    const { value } = await AdMob.isAppOpenLoaded();
    if (value || appOpenLoaded) {
      await AdMob.showAppOpen();
      await recordAppOpenAdShown();
    } else {
      await AdMob.loadAppOpen({ adId: AD_UNIT_APP_OPEN });
    }
  } catch (e) {
    console.warn('[AdMob] appOpen show error', e);
  }
}
