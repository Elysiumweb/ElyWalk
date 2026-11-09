import { Capacitor, registerPlugin } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import {
  META_PLACEMENT_BANNER,
  META_PLACEMENT_INTERSTITIAL,
  META_PLACEMENT_MEDIUM_RECTANGLE,
  META_PLACEMENT_NATIVE,
  META_PLACEMENT_NATIVE_BANNER,
  META_PLACEMENT_REWARDED_INTERSTITIAL,
} from './constants';
import { getAdConsent, subscribeAdConsent, type AdConsent } from './adConsent';

// ============================================================================
// Publicité — Meta Audience Network (régie unique depuis 1.5.0).
//
// Le SDK Meta est du code natif Android : la WebView ne peut pas l'appeler
// directement. Un plugin Capacitor maison (`MetaAdsPlugin.java`) expose donc :
//   • initialize / setConsent
//   • bannière 320×50 (bas de page, sur toutes les pages)
//   • native banner compact (listes)
//   • interstitiel plein écran
//   • interstitiel récompensé (vidéo → ElyCoins)
//   • medium rectangle 300×250 (avant un retrait)
//   • carte native (fin de sortie)
//
// Côté web (navigateur), tout est inerte : les fonctions résolvent sans rien
// afficher, l'app reste utilisable en `npm run dev`.
//
// ⚠️ Meta Audience Network ne propose PAS de Server-Side Verification pour les
// récompenses (contrairement à AdMob SSV) : la récompense ElyCoins est donc
// créditée côté client, bornée par la règle Firestore (1 récompense/heure et
// un slot `adClaims` unique par heure) et par l'attestation Play Integrity.
// ============================================================================

const isNative = () => Capacitor.isNativePlatform();

// ---------------------------------------------------------------------------
// Pont natif
// ---------------------------------------------------------------------------

interface MetaAdsPlugin {
  initialize(): Promise<void>;
  setConsent(options: { personalized: boolean }): Promise<void>;
  showBanner(options: { placementId: string }): Promise<{ height: number }>;
  hideBanner(): Promise<void>;
  showNativeBanner(options: { placementId: string }): Promise<{ height: number }>;
  hideNativeBanner(): Promise<void>;
  loadInterstitial(options: { placementId: string }): Promise<{ loaded: boolean }>;
  showInterstitial(): Promise<{ shown: boolean }>;
  loadRewarded(options: { placementId: string }): Promise<{ loaded: boolean }>;
  showRewarded(): Promise<{ rewarded: boolean }>;
  showMediumRectangle(options: { placementId: string }): Promise<{ shown: boolean }>;
  showNativeCard(options: { placementId: string }): Promise<{ shown: boolean }>;
}

const MetaAds = registerPlugin<MetaAdsPlugin>('MetaAds');

/**
 * Bornage côté WebView : le plugin natif a ses propres délais, mais une action
 * utilisateur (valider ses pas, demander un retrait) ne doit jamais attendre une
 * annonce au-delà de quelques secondes.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const finish = (value: T) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(fallback), ms);
    promise.then(finish).catch(() => finish(fallback));
  });
}

const LOAD_TIMEOUT_MS = 10000;

// ---------------------------------------------------------------------------
// État & consentement
// ---------------------------------------------------------------------------

let initialized = false;
/** `true` uniquement quand l'utilisateur a exprimé un choix (personnalisé ou non). */
let adsAllowed = false;
let appliedConsent: AdConsent | null = null;
let consentSubscribed = false;

/** Applique le consentement courant au SDK natif (LDU si refus). */
async function applyConsent(): Promise<void> {
  const consent = await getAdConsent();
  adsAllowed = consent !== 'unknown';
  if (!initialized) return;
  if (appliedConsent === consent) return;
  try {
    await MetaAds.setConsent({ personalized: consent === 'granted' });
    appliedConsent = consent;
  } catch (e) {
    console.warn('[MetaAds] setConsent error', e);
  }
  if (!adsAllowed) await hideBottomAd();
}

/** Initialise le SDK Meta puis applique le consentement RGPD. */
export async function initAds(): Promise<void> {
  if (!isNative() || initialized) return;
  try {
    await MetaAds.initialize();
    initialized = true;
    await applyConsent();
    if (!consentSubscribed) {
      consentSubscribed = true;
      subscribeAdConsent(() => { void applyConsent(); });
    }
  } catch (e) {
    console.warn('[MetaAds] init error', e);
  }
}

/** `true` si un choix de consentement autorise la diffusion d'annonces. */
export function canShowAds(): boolean {
  return initialized && adsAllowed;
}

/** Ouvre l'écran « Confidentialité des annonces » (ex-`showPrivacyOptionsForm`). */
export { openAdPrivacyOptions } from './adConsent';

// ---------------------------------------------------------------------------
// Bannière de bas de page (« une bannière sur chaque page »)
// ---------------------------------------------------------------------------

export type BottomAdKind = 'banner' | 'nativeBanner';

let bottomKind: BottomAdKind | null = null;

/** Hauteur réservée dans la WebView (en px CSS = dp Android). */
function setBannerHeight(height: number): void {
  try {
    document.documentElement.style.setProperty('--ad-banner-h', `${Math.max(0, Math.round(height))}px`);
  } catch {
    /* ignore */
  }
}

/** Affiche (ou remplace) la bannière ancrée en bas de l'écran. */
export async function showBottomAd(kind: BottomAdKind): Promise<void> {
  if (!isNative()) return;
  await initAds();
  if (!canShowAds()) {
    if (bottomKind) await hideBottomAd();
    return;
  }
  if (bottomKind === kind) return;
  try {
    if (kind === 'nativeBanner') {
      // Un seul ancrage bas à la fois : on retire l'autre format.
      if (bottomKind) await MetaAds.hideBanner().catch(() => undefined);
      const { height } = await MetaAds.showNativeBanner({ placementId: META_PLACEMENT_NATIVE_BANNER });
      // Pas de remplissage (no fill) : on ne mémorise rien pour pouvoir
      // retenter à la prochaine navigation.
      bottomKind = height > 0 ? 'nativeBanner' : null;
      setBannerHeight(height);
    } else {
      if (bottomKind) await MetaAds.hideNativeBanner().catch(() => undefined);
      const { height } = await MetaAds.showBanner({ placementId: META_PLACEMENT_BANNER });
      bottomKind = height > 0 ? 'banner' : null;
      setBannerHeight(height);
    }
  } catch (e) {
    console.warn('[MetaAds] bottom ad error', e);
    bottomKind = null;
    setBannerHeight(0);
  }
}

/** Retire la bannière de bas de page et libère l'espace réservé. */
export async function hideBottomAd(): Promise<void> {
  bottomKind = null;
  setBannerHeight(0);
  if (!isNative()) return;
  await MetaAds.hideBanner().catch(() => undefined);
  await MetaAds.hideNativeBanner().catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Interstitiel plein écran
// ---------------------------------------------------------------------------

/**
 * Affiche un interstitiel (ouverture de l'app, validation des pas, fin de
 * sortie). Résout toujours : en cas d'absence de fill ou d'erreur, l'action
 * de l'utilisateur n'est jamais bloquée.
 */
export async function showInterstitial(): Promise<void> {
  if (!isNative()) return;
  await initAds();
  if (!canShowAds()) return;
  try {
    const { loaded } = await withTimeout(
      MetaAds.loadInterstitial({ placementId: META_PLACEMENT_INTERSTITIAL }),
      LOAD_TIMEOUT_MS,
      { loaded: false }
    );
    if (!loaded) return;
    await MetaAds.showInterstitial();
  } catch (e) {
    console.warn('[MetaAds] interstitial error', e);
  }
}

// ---------------------------------------------------------------------------
// Interstitiel récompensé (vidéo → ElyCoins)
// ---------------------------------------------------------------------------

/**
 * Affiche la vidéo récompensée. Résout `true` uniquement si la vidéo a été
 * visionnée jusqu'au bout (callback `onRewardedInterstitialCompleted`).
 *
 * Le paramètre `uid` n'est plus transmis au réseau (Meta n'offre pas de
 * callback serveur signé) : il reste accepté pour compatibilité d'appel.
 */
export async function showRewardedAd(_uid?: string): Promise<boolean> {
  if (!isNative()) return false;
  await initAds();
  if (!canShowAds()) return false;
  try {
    const { loaded } = await withTimeout(
      MetaAds.loadRewarded({ placementId: META_PLACEMENT_REWARDED_INTERSTITIAL }),
      LOAD_TIMEOUT_MS,
      { loaded: false }
    );
    if (!loaded) return false;
    const { rewarded } = await MetaAds.showRewarded();
    return !!rewarded;
  } catch (e) {
    console.warn('[MetaAds] rewarded error', e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Medium rectangle 300×250 (retrait d'ElyCoins)
// ---------------------------------------------------------------------------

/** Encart 300×250 dans une surcouche refermable, avant un retrait. */
export async function showWithdrawalAd(): Promise<void> {
  if (!isNative()) return;
  await initAds();
  if (!canShowAds()) return;
  try {
    // L'encart s'affiche au-dessus de la feuille de retrait ; on n'attend pas
    // plus de 8 s pour ne pas retarder la demande de l'utilisateur.
    await withTimeout(
      MetaAds.showMediumRectangle({ placementId: META_PLACEMENT_MEDIUM_RECTANGLE }),
      8000,
      { shown: false }
    );
  } catch (e) {
    console.warn('[MetaAds] medium rectangle error', e);
  }
}

// ---------------------------------------------------------------------------
// Carte native (fin de sortie)
// ---------------------------------------------------------------------------

/** Carte native (titre, visuel, CTA) affichée à la fin d'une sortie GPS. */
export async function showEndOfActivityAd(): Promise<void> {
  if (!isNative()) return;
  await initAds();
  if (!canShowAds()) return;
  try {
    await MetaAds.showNativeCard({ placementId: META_PLACEMENT_NATIVE });
  } catch (e) {
    console.warn('[MetaAds] native card error', e);
  }
}

// ---------------------------------------------------------------------------
// « App open » : interstitiel à l'ouverture / au retour dans l'application
// ---------------------------------------------------------------------------

// Garde-fous : plafond journalier + cooldown, pour éviter une UX punitive et
// un rejet Play Store (aucune annonce ne doit s'afficher immédiatement au
// premier lancement, cf. politique Meta / Play).
const APP_OPEN_DAILY_CAP = 2;
const APP_OPEN_COOLDOWN_MS = 10 * 60 * 1000;
const APP_OPEN_PREFS = 'appOpenAd.v2';

type DateKey = string;

function todayKey(): DateKey {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

interface AppOpenState {
  date: DateKey;
  count: number;
  lastShownAt: number;
}

/** État persisté (exporté pour les tests unitaires). */
export async function readAppOpenState(): Promise<AppOpenState> {
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

/** Décide si une annonce d'ouverture peut être affichée (pure, testable). */
export function isAppOpenAllowed(state: AppOpenState, now = Date.now()): boolean {
  const today = new Date(now).toISOString().slice(0, 10);
  if (state.date !== today) return true;
  if (state.count >= APP_OPEN_DAILY_CAP) return false;
  return now - state.lastShownAt >= APP_OPEN_COOLDOWN_MS;
}

export async function shouldShowAppOpenAd(): Promise<boolean> {
  if (!isNative() || !canShowAds()) return false;
  try {
    return isAppOpenAllowed(await readAppOpenState());
  } catch (e) {
    console.warn('[MetaAds] appOpen state error', e);
    return false;
  }
}

/** Mémorise l'affichage (plafond journalier). */
export async function recordAppOpenAdShown(now = Date.now()): Promise<void> {
  try {
    const state = await readAppOpenState();
    const today = new Date(now).toISOString().slice(0, 10);
    await Preferences.set({
      key: APP_OPEN_PREFS,
      value: JSON.stringify({
        date: today,
        count: state.date === today ? state.count + 1 : 1,
        lastShownAt: now,
      } satisfies AppOpenState),
    });
  } catch (e) {
    console.warn('[MetaAds] appOpen record error', e);
  }
}

let appOpenPreloaded = false;

/** Précharge l'interstitiel pour l'ouverture (appelé après le login). */
export async function loadAppOpenAd(): Promise<void> {
  if (!isNative()) return;
  await initAds();
  if (!canShowAds()) return;
  try {
    const { loaded } = await withTimeout(
      MetaAds.loadInterstitial({ placementId: META_PLACEMENT_INTERSTITIAL }),
      LOAD_TIMEOUT_MS,
      { loaded: false }
    );
    appOpenPreloaded = loaded;
  } catch (e) {
    console.warn('[MetaAds] appOpen load error', e);
  }
}

/** Affiche l'interstitiel d'ouverture si le plafond/cooldown l'autorise. */
export async function showAppOpenAdIfReady(): Promise<void> {
  if (!isNative()) return;
  await initAds();
  if (!canShowAds()) return;
  if (!(await shouldShowAppOpenAd())) return;
  try {
    if (!appOpenPreloaded) {
      const { loaded } = await withTimeout(
        MetaAds.loadInterstitial({ placementId: META_PLACEMENT_INTERSTITIAL }),
        LOAD_TIMEOUT_MS,
        { loaded: false }
      );
      if (!loaded) return;
    }
    appOpenPreloaded = false;
    const { shown } = await MetaAds.showInterstitial();
    if (shown) await recordAppOpenAdShown();
  } catch (e) {
    console.warn('[MetaAds] appOpen show error', e);
  }
}
