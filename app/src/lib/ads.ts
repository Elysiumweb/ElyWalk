import { Capacitor } from '@capacitor/core';
import {
  AdMob,
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

/** Initialise le SDK Google Mobile Ads (Android uniquement). */
export async function initAds(): Promise<void> {
  if (!isNative() || initialized) return;
  try {
    await AdMob.initialize({});
    initialized = true;
  } catch (e) {
    console.warn('[AdMob] init error', e);
  }
}

/**
 * Affiche une annonce interstitielle (validation des pas).
 * Résout quand la pub est fermée. Ne bloque jamais l'utilisateur :
 * en cas d'échec de chargement, on résout immédiatement.
 */
export async function showInterstitial(): Promise<void> {
  if (!isNative()) return;
  await initAds();
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
 * Résout `true` uniquement si l'utilisateur a gagné la récompense.
 */
export async function showRewardedAd(): Promise<boolean> {
  if (!isNative()) return false;
  await initAds();
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
      await AdMob.prepareRewardVideoAd({ adId: AD_UNIT_REWARDED });
      await AdMob.showRewardVideoAd();
      setTimeout(() => finish(rewarded), 120000);
    } catch (e) {
      console.warn('[AdMob] rewarded error', e);
      finish(false);
    }
  });
}

// --- App Open Ad (ouverture / retour sur l'application) ---

let appOpenLoaded = false;

export async function loadAppOpenAd(): Promise<void> {
  if (!isNative()) return;
  await initAds();
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
  try {
    const { value } = await AdMob.isAppOpenLoaded();
    if (value || appOpenLoaded) {
      await AdMob.showAppOpen();
    } else {
      await AdMob.loadAppOpen({ adId: AD_UNIT_APP_OPEN });
    }
  } catch (e) {
    console.warn('[AdMob] appOpen show error', e);
  }
}
