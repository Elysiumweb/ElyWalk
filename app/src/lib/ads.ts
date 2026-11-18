import { Capacitor, registerPlugin } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import {
  AD_REWARD_COINS,
  LEVELPLAY_AD_UNIT_BANNER,
  LEVELPLAY_AD_UNIT_INTERSTITIAL,
  LEVELPLAY_AD_UNIT_MEDIUM_RECTANGLE,
  LEVELPLAY_AD_UNIT_NATIVE,
  LEVELPLAY_AD_UNIT_NATIVE_BANNER,
  LEVELPLAY_AD_UNIT_REWARDED,
  LEVELPLAY_APP_KEY,
  LEVELPLAY_REWARD_NAME,
} from './constants';
import { getAdConsent, subscribeAdConsent, type AdConsent } from './adConsent';

// ============================================================================
// Publicité — Unity LevelPlay (médiation).
// Les SDK partenaires sont chargés par les adaptateurs Android de LevelPlay.
// Le code WebView utilise uniquement les ad units LevelPlay.
//
// Le SDK LevelPlay est du code natif Android : la WebView ne peut pas l'appeler
// directement. Un plugin Capacitor maison (`LevelPlayAdsPlugin.java`) expose :
//   • initialize / setConsent
//   • bannière 320×50 (bas de page, sur toutes les pages)
//   • natif compact (listes) + carte native (fin de sortie)
//   • interstitiel plein écran
//   • vidéo récompensée (vidéo → ElyCoins)
//   • medium rectangle 300×250 (avant un retrait)
//
// Côté web (navigateur), tout est inerte : les fonctions résolvent sans rien
// afficher, l'app reste utilisable en `npm run dev`.
//
// ⚠️ LevelPlay ne fournit pas de SSV signée vers notre backend pour la
// récompense : le crédit reste côté client, borné par la règle Firestore
// (1 récompense/heure, slot `adClaims` unique) et par l'attestation Play
// Integrity.
// ============================================================================

const isNative = () => Capacitor.isNativePlatform();

// ---------------------------------------------------------------------------
// Pont natif
// ---------------------------------------------------------------------------

export interface LevelPlayRewardResult {
  rewarded: boolean;
  rewardName?: string | null;
  rewardAmount?: number | null;
}

interface LevelPlayAdsPlugin {
  initialize(options: { appKey: string; userId?: string; personalized: boolean }): Promise<void>;
  setUserId(options: { userId: string }): Promise<void>;
  setConsent(options: { personalized: boolean }): Promise<void>;
  showBanner(options: { adUnitId: string; adaptive?: boolean }): Promise<{ height: number }>;
  hideBanner(): Promise<void>;
  showNativeBanner(options: { adUnitId: string; placementName?: string }): Promise<{ height: number }>;
  hideNativeBanner(): Promise<void>;
  loadInterstitial(options: { adUnitId: string }): Promise<{ loaded: boolean }>;
  showInterstitial(): Promise<{ shown: boolean }>;
  loadRewarded(options: { adUnitId: string }): Promise<{ loaded: boolean }>;
  showRewarded(): Promise<LevelPlayRewardResult>;
  showMediumRectangle(options: { adUnitId: string }): Promise<{ shown: boolean }>;
  showNativeCard(options: { adUnitId: string; placementName?: string }): Promise<{ shown: boolean }>;
}

const LevelPlayAds = registerPlugin<LevelPlayAdsPlugin>('LevelPlayAds');

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
let configuration: Promise<void> | null = null;
let currentConsent: AdConsent | undefined;
let appliedConsent: AdConsent = 'unknown';
let consentSubscribed = false;
let currentUserId: string | undefined;
let appliedUserId: string | undefined;

/**
 * Initialise LevelPlay après un choix explicite et synchronise le réglage
 * natif avant tout chargement d'annonce. Les appels simultanés au démarrage
 * attendent la même configuration.
 */
export async function initAds(userId?: string): Promise<void> {
  if (!isNative()) return;
  if (userId) currentUserId = userId;
  if (!consentSubscribed) {
    consentSubscribed = true;
    subscribeAdConsent((choice) => {
      currentConsent = choice;
      void initAds();
    });
  }
  if (configuration) return configuration;

  configuration = (async () => {
    try {
      const savedChoice = await getAdConsent();
      currentConsent ??= savedChoice;
      if (currentConsent === 'unknown') return;

      if (!initialized) {
        const choice = currentConsent;
        const initialUserId = currentUserId;
        await LevelPlayAds.initialize({
          appKey: LEVELPLAY_APP_KEY,
          userId: initialUserId,
          personalized: choice === 'granted',
        });
        initialized = true;
        appliedConsent = choice;
        appliedUserId = initialUserId;
      }

      // Le choix a pu changer pendant l'initialisation ou une mise à jour.
      while (currentConsent !== appliedConsent) {
        const choice = currentConsent;
        appOpenPreloaded = false;
        await hideBottomAd();
        await LevelPlayAds.setConsent({ personalized: choice === 'granted' });
        appliedConsent = choice;
      }

      if (currentUserId && currentUserId !== appliedUserId) {
        appliedUserId = currentUserId;
        void LevelPlayAds.setUserId({ userId: currentUserId }).catch(() => undefined);
      }
    } catch (e) {
      console.warn('[LevelPlay] configuration error', e);
    } finally {
      configuration = null;
    }
  })();
  return configuration;
}

/** Indique si le SDK a bien reçu le dernier choix explicite. */
export function canShowAds(): boolean {
  return initialized && !configuration && appliedConsent !== 'unknown' && appliedConsent === currentConsent;
}

/**
 * F04 — porte unique avant **toute** action récompensée (vidéo → ElyCoins).
 *
 * Trois cas sont distingués à l'écran, parce qu'ils demandent trois gestes
 * différents : le SDK n'a pas pu démarrer (réseau), aucun choix de consentement
 * n'existe encore (ouvrir la feuille de consentement), ou le consentement
 * autorise la diffusion. Auparavant, tout échec se soldait par un silence et
 * l'utilisateur regardait une vidéo qui ne créditait rien.
 */
export type AdGate = 'ready' | 'no-consent' | 'unavailable';

export async function adGate(): Promise<AdGate> {
  if (!isNative()) return 'unavailable';
  await initAds();
  if (!currentConsent || currentConsent === 'unknown') return 'no-consent';
  return canShowAds() ? 'ready' : 'unavailable';
}

/** Ouvre l'écran « Confidentialité des annonces ». */
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

async function showBannerKind(kind: BottomAdKind): Promise<number> {
  if (kind === 'nativeBanner') {
    // Un seul ancrage bas à la fois : on retire l'autre format.
    await LevelPlayAds.hideBanner().catch(() => undefined);
    const { height } = await LevelPlayAds.showNativeBanner({ adUnitId: LEVELPLAY_AD_UNIT_NATIVE_BANNER });
    return height;
  }
  await LevelPlayAds.hideNativeBanner().catch(() => undefined);
  const { height } = await LevelPlayAds.showBanner({ adUnitId: LEVELPLAY_AD_UNIT_BANNER });
  return height;
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
    let height = await showBannerKind(kind);
    let effective: BottomAdKind | null = height > 0 ? kind : null;
    // Sans remplissage sur le format natif, on retombe sur la bannière 320×50.
    if (height <= 0 && kind === 'nativeBanner') {
      height = await showBannerKind('banner');
      effective = height > 0 ? 'banner' : null;
    }
    bottomKind = effective;
    setBannerHeight(height);
  } catch (e) {
    console.warn('[LevelPlay] bottom ad error', e);
    bottomKind = null;
    setBannerHeight(0);
  }
}

/** Retire la bannière de bas de page et libère l'espace réservé. */
export async function hideBottomAd(): Promise<void> {
  bottomKind = null;
  setBannerHeight(0);
  if (!isNative()) return;
  await LevelPlayAds.hideBanner().catch(() => undefined);
  await LevelPlayAds.hideNativeBanner().catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Interstitiel plein écran
// ---------------------------------------------------------------------------

/**
 * Affiche un interstitiel (ouverture de l'app, validation des pas, fin de
 * sortie). Résout toujours : en cas d'absence de fill ou d'erreur, l'action de
 * l'utilisateur n'est jamais bloquée.
 */
export async function showInterstitial(): Promise<void> {
  if (!isNative()) return;
  await initAds();
  if (!canShowAds()) return;
  try {
    const { loaded } = await withTimeout(
      LevelPlayAds.loadInterstitial({ adUnitId: LEVELPLAY_AD_UNIT_INTERSTITIAL }),
      LOAD_TIMEOUT_MS,
      { loaded: false }
    );
    if (!loaded) return;
    await LevelPlayAds.showInterstitial();
  } catch (e) {
    console.warn('[LevelPlay] interstitial error', e);
  }
}

// ---------------------------------------------------------------------------
// Vidéo récompensée (vidéo → ElyCoins)
// ---------------------------------------------------------------------------

/**
 * Convertit une récompense LevelPlay en ElyCoins.
 *
 * L'ad unit déclare *ElyCoin* / *1* : une unité LevelPlay vaut donc
 * `AD_REWARD_COINS` (0,1 EC). Toute autre récompense renvoie 0 (rien n'est
 * crédité) pour éviter qu'une configuration distante erronée ne crédite un
 * montant arbitraire — la règle Firestore n'accepte de toute façon que 0,1.
 */
export function rewardCoinsFrom(reward: { rewardName?: string | null; rewardAmount?: number | null }): number {
  const name = (reward.rewardName || '').trim().toLowerCase();
  const amount = Number(reward.rewardAmount ?? 0);
  if (name !== LEVELPLAY_REWARD_NAME.toLowerCase() || !Number.isFinite(amount) || amount <= 0) return 0;
  return AD_REWARD_COINS * amount;
}

/**
 * Affiche la vidéo récompensée. Résout `{ rewarded: false }` si la vidéo n'a pas
 * été visionnée jusqu'au bout ou si la récompense annoncée n'est pas celle
 * configurée pour ElyWalk.
 */
export async function showRewardedAd(_uid?: string): Promise<LevelPlayRewardResult & { coins: number }> {
  if (!isNative()) return { rewarded: false, coins: 0 };
  await initAds(_uid);
  if (!canShowAds()) return { rewarded: false, coins: 0 };
  try {
    const { loaded } = await withTimeout(
      LevelPlayAds.loadRewarded({ adUnitId: LEVELPLAY_AD_UNIT_REWARDED }),
      LOAD_TIMEOUT_MS,
      { loaded: false }
    );
    if (!loaded) return { rewarded: false, coins: 0 };
    const result = await LevelPlayAds.showRewarded();
    const coins = rewardCoinsFrom(result);
    if (result.rewarded && coins === 0) {
      console.warn('[LevelPlay] récompense inattendue', result.rewardName, result.rewardAmount);
    }
    return { ...result, rewarded: result.rewarded && coins > 0, coins };
  } catch (e) {
    console.warn('[LevelPlay] rewarded error', e);
    return { rewarded: false, coins: 0 };
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
      LevelPlayAds.showMediumRectangle({ adUnitId: LEVELPLAY_AD_UNIT_MEDIUM_RECTANGLE }),
      8000,
      { shown: false }
    );
  } catch (e) {
    console.warn('[LevelPlay] medium rectangle error', e);
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
    await LevelPlayAds.showNativeCard({ adUnitId: LEVELPLAY_AD_UNIT_NATIVE });
  } catch (e) {
    console.warn('[LevelPlay] native card error', e);
  }
}

// ---------------------------------------------------------------------------
// « App open » : interstitiel à l'ouverture / au retour dans l'application
// ---------------------------------------------------------------------------

// Garde-fous : plafond journalier + cooldown, pour éviter une UX punitive et
// un rejet Play Store (aucune annonce ne doit s'afficher immédiatement au
// premier lancement, cf. politique LevelPlay / Play).
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
    console.warn('[LevelPlay] appOpen state error', e);
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
    console.warn('[LevelPlay] appOpen record error', e);
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
      LevelPlayAds.loadInterstitial({ adUnitId: LEVELPLAY_AD_UNIT_INTERSTITIAL }),
      LOAD_TIMEOUT_MS,
      { loaded: false }
    );
    appOpenPreloaded = loaded;
  } catch (e) {
    console.warn('[LevelPlay] appOpen load error', e);
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
        LevelPlayAds.loadInterstitial({ adUnitId: LEVELPLAY_AD_UNIT_INTERSTITIAL }),
        LOAD_TIMEOUT_MS,
        { loaded: false }
      );
      if (!loaded) return;
    }
    appOpenPreloaded = false;
    const { shown } = await LevelPlayAds.showInterstitial();
    if (shown) await recordAppOpenAdShown();
  } catch (e) {
    console.warn('[LevelPlay] appOpen show error', e);
  }
}
