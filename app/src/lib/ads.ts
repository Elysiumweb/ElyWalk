import { Capacitor, registerPlugin } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { Device } from '@capacitor/device';
import { ADS_S2S_REWARD_URL, AD_PLACEMENTS, META_REWARD_CURRENCY } from './constants';

/**
 * Couche publicitaire d'ElyWalk.
 *
 * <p>Régie actuelle : **Meta Audience Network**, branchée en direct via le
 * plugin natif `MetaAds` (`android/.../MetaAdsPlugin.java`). Aucune plateforme
 * de médiation n'est utilisée pour l'instant. Toute la logique de cadencement
 * (délais, plafonds, remise à zéro) est ici, indépendante du SDK : brancher une
 * médiation plus tard ne demandera que de remplacer l'implémentation du pont
 * `NativeAds` ci-dessous.</p>
 *
 * <p>Formats réellement proposés par Meta : bannière, rectangle moyen,
 * interstitiel et interstitiel récompensé. Il n'existe <b>ni</b> format
 * « ouverture d'application » <b>ni</b> « vidéo récompensée » séparée : l'ouverture
 * passe donc par l'interstitiel et le gain d'ElyCoins par l'interstitiel
 * récompensé.</p>
 */

const isNative = () => Capacitor.isNativePlatform();

/** Emplacements publicitaires de l'application (journalisation + cadencement). */
export type AdPlacement =
  | 'app-open' // lancement de l'application (interstitiel)
  | 'steps-validation' // validation des pas du jour
  | 'activity-finished' // fin d'une sortie GPS
  | 'withdrawal' // demande de retrait / don
  | 'other';

// ---------------------------------------------------------------------------
// Pont vers le plugin natif
// ---------------------------------------------------------------------------

interface NativeAdsPlugin {
  getStatus(): Promise<{
    initialized: boolean;
    bannerReady: boolean;
    interstitialReady: boolean;
    rewardedReady: boolean;
  }>;
  setDataProcessingOptions(options: { ldu?: boolean }): Promise<void>;
  prepareInterstitial(options: { placementId: string }): Promise<void>;
  showInterstitial(options: {
    placementId: string;
    reload?: boolean;
  }): Promise<{ shown: boolean }>;
  prepareRewardedInterstitial(options: {
    placementId: string;
    userId?: string;
    rewardId?: string;
    serverValidation?: boolean;
  }): Promise<void>;
  showRewardedInterstitial(options: {
    placementId: string;
    userId?: string;
    rewardId?: string;
    serverValidation?: boolean;
  }): Promise<{ rewarded: boolean }>;
  showBanner(options: { placementId: string; tablet?: boolean }): Promise<void>;
  hideBanner(): Promise<void>;
  getBannerHeight(options: {
    placementId: string;
    tablet?: boolean;
  }): Promise<{ height: number }>;
  addListener(
    eventName: string,
    listenerFunc: (data: unknown) => void
  ): Promise<{ remove: () => void }>;
}

const NativeAds = registerPlugin<NativeAdsPlugin>('MetaAds');

// ---------------------------------------------------------------------------
// État interne
// ---------------------------------------------------------------------------

let initialized = false;
/** `true` si l'utilisateur peut recevoir de la publicité (consentement RGPD). */
let adsAllowed = false;
let initPromise: Promise<boolean> | null = null;
let lastInitAttempt = 0;
let lastError: string | null = null;

/** Identifiant ElyWalk transmis à Meta pour la validation serveur (S2S). */
let adsUserId: string | null = null;

/** Une annonce plein écran est en cours d'affichage. */
let fullScreenAdVisible = false;
let lastFullScreenAdAt = 0;

/** Délai minimal entre deux annonces plein écran (hors ouverture). */
const INTERSTITIAL_MIN_INTERVAL_MS = 60 * 1000;
/** Nouvelle tentative d'initialisation après un échec (réseau, consentement). */
const INIT_RETRY_MS = 60 * 1000;
/** Au-delà, on renonce à attendre le chargement d'une annonce. */
const LOAD_TIMEOUT_MS = 10 * 1000;
/** Sécurité : si aucun événement de fermeture n'arrive, on débloque l'UI. */
const SHOW_TIMEOUT_MS = 90 * 1000;

/** Événement émis quand le choix de consentement est effacé. */
export const CONSENT_RESET_EVENT = 'elywalk:ads-consent-reset';

const warn = (scope: string, e: unknown) => {
  lastError = e instanceof Error ? e.message : String(e);
  console.warn(`[Ads] ${scope}:`, lastError);
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
// Consentement (RGPD / CCPA)
// ---------------------------------------------------------------------------

const CONSENT_PREFS = 'ads.consent.v1';

/** Choix conservé localement : `true` = publicité personnalisée. */
let consentGranted: boolean | null = null;
/** Le choix a déjà été demandé à l'utilisateur. */
let consentDecided = false;

/**
 * Zone réglementaire de l'appareil.
 *
 * <p>Meta n'est pas membre de l'IAB Europe : il n'existe pas de signal TCF à
 * transmettre. On applique donc la règle classique : consentement explicite
 * pour l'EEE, le Royaume-Uni et la Suisse ; traitement complet ailleurs, avec
 * « Limited Data Use » pour les États-Unis.</p>
 */
export interface ConsentRegion {
  /** Pays ISO-3166 alpha-2, ou `null` si indéterminé. */
  country: string | null;
  /** Un consentement explicite est requis avant de charger une annonce. */
  requiresConsent: boolean;
  /** Limited Data Use (lois des États américains). */
  ldu: boolean;
}

const EEA_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
  'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
  'SI', 'ES', 'SE', // Union européenne
  'IS', 'LI', 'NO', // Espace économique européen
  'GB', 'CH', // Royaume-Uni, Suisse
]);

const US_COUNTRIES = new Set(['US']);

let cachedRegion: ConsentRegion | null = null;

/** Détermine la zone réglementaire à partir du pays de l'appareil. */
async function detectRegion(): Promise<ConsentRegion> {
  if (cachedRegion) return cachedRegion;
  let country: string | null = null;
  try {
    // La locale système porte la région : `fr-FR` -> FR, `en-US` -> US.
    // (Le plugin Device n'expose pas le pays, et une API de géolocalisation
    // serait disproportionnée : la langue/région suffit à choisir la règle.)
    const locales =
      typeof navigator !== 'undefined'
        ? [...(navigator.languages ?? []), navigator.language]
        : [];
    for (const locale of locales) {
      const region = String(locale || '').split('-')[1];
      if (region && region.length === 2) {
        country = region.toUpperCase();
        break;
      }
    }
  } catch (e) {
    warn('region', e);
  }
  /**
   * Pays inconnu = prudence maximale : on demande le consentement. Aucune
   * annonce n'est chargée tant qu'il n'a pas été donné, ce qui évite de
   * diffuser une publicité non consentie à un utilisateur européen dont
   * l'appareil n'a pas exposé le pays.
   */
  const requiresConsent = country === null || EEA_COUNTRIES.has(country);
  cachedRegion = {
    country,
    requiresConsent,
    ldu: country !== null && US_COUNTRIES.has(country),
  };
  return cachedRegion;
}

/** Applique les options de traitement Meta (LDU) — à faire avant tout chargement. */
async function applyDataProcessingOptions(region: ConsentRegion): Promise<void> {
  try {
    await NativeAds.setDataProcessingOptions({ ldu: region.ldu });
  } catch (e) {
    warn('data processing options', e);
  }
}

async function readStoredConsent(): Promise<boolean | null> {
  try {
    const { value } = await Preferences.get({ key: CONSENT_PREFS });
    if (value === 'granted') return true;
    if (value === 'denied') return false;
  } catch (e) {
    warn('consent read', e);
  }
  return null;
}

async function storeConsent(granted: boolean): Promise<void> {
  try {
    await Preferences.set({ key: CONSENT_PREFS, value: granted ? 'granted' : 'denied' });
  } catch (e) {
    warn('consent write', e);
  }
}

/** Le formulaire de consentement a-t-il déjà été présenté à l'utilisateur ? */
export async function hasConsentDecision(): Promise<boolean> {
  await ensureConsentLoaded();
  return consentDecided;
}

/** Le consentement a-t-il été accordé ? `null` tant qu'aucun choix n'est fait. */
export async function getConsentChoice(): Promise<boolean | null> {
  await ensureConsentLoaded();
  return consentGranted;
}

let consentLoaded = false;
async function ensureConsentLoaded(): Promise<void> {
  if (consentLoaded) return;
  const stored = await readStoredConsent();
  consentGranted = stored;
  consentDecided = stored !== null;
  consentLoaded = true;
}

/**
 * Enregistre le choix de l'utilisateur et réévalue le droit de diffuser.
 * Appelé par l'écran de consentement affiché au lancement.
 */
export async function setConsent(granted: boolean): Promise<void> {
  consentGranted = granted;
  consentDecided = true;
  consentLoaded = true;
  await storeConsent(granted);
  adsAllowed = granted && initialized;
  if (adsAllowed) {
    void preloadInterstitial();
    void preloadRewarded();
  }
}

/**
 * Efface le choix de consentement. Émet `CONSENT_RESET_EVENT` pour que
 * l'application réaffiche l'écran de choix : sans cela, l'utilisateur qui
 * révoque son consentement depuis le profil se retrouverait sans publicité et
 * sans moyen d'en redonner.
 */
export async function resetConsent(): Promise<void> {
  try {
    await Preferences.remove({ key: CONSENT_PREFS });
  } catch (e) {
    warn('resetConsent', e);
  }
  consentGranted = null;
  consentDecided = false;
  consentLoaded = true;
  adsAllowed = false;
  initialized = false;
  initPromise = null;
  lastInitAttempt = 0;
  try {
    window.dispatchEvent(new Event(CONSENT_RESET_EVENT));
  } catch {
    /* pas de DOM (tests) : sans effet */
  }
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/**
 * Initialise le SDK puis vérifie le droit de diffuser. Idempotent et
 * « mono-vol » : les appels concurrents partagent la même promesse.
 */
async function ensureAds(): Promise<boolean> {
  if (!isNative()) return false;
  if (adsAllowed) return true;
  if (initPromise) return initPromise;
  if (initialized && Date.now() - lastInitAttempt < INIT_RETRY_MS) return false;

  lastInitAttempt = Date.now();
  initPromise = (async () => {
    try {
      await ensureConsentLoaded();
      initialized = true;
      // Sans cet abonnement, la fermeture d'un interstitiel ne serait jamais
      // connue et les pages resteraient bloquées jusqu'au délai de sécurité.
      registerAdListeners();
      const region = await detectRegion();
      await applyDataProcessingOptions(region);

      if (region.requiresConsent) {
        // Aucun choix enregistré : on ne diffuse rien et l'écran de
        // consentement prend le relais (voir `maybeShowConsent`).
        adsAllowed = consentGranted === true;
      } else {
        // Hors zone à consentement : le choix explicite l'emporte s'il existe,
        // sinon on applique la règle locale (publicité autorisée).
        adsAllowed = consentGranted !== false;
      }

      if (adsAllowed) {
        lastError = null;
        void preloadInterstitial();
        void preloadRewarded();
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

/** Initialise la régie publicitaire (à appeler au lancement). */
export async function initAds(): Promise<void> {
  await ensureAds();
}

/**
 * Faut-il afficher l'écran de consentement ? Vrai une seule fois par
 * installation, et seulement si la zone l'exige.
 */
export async function needsConsentPrompt(): Promise<boolean> {
  if (!isNative()) return false;
  await ensureConsentLoaded();
  if (consentDecided) return false;
  const region = await detectRegion();
  return region.requiresConsent;
}

/** `true` si le consentement a été obtenu et que la pub est autorisée. */
export function canShowAds(): boolean {
  return initialized && adsAllowed;
}

// ---------------------------------------------------------------------------
// Diagnostic (Profil → Confidentialité des annonces)
// ---------------------------------------------------------------------------

export interface AdsDiagnostics {
  native: boolean;
  initialized: boolean;
  adsAllowed: boolean;
  consentStatus: 'granted' | 'denied' | 'pending' | null;
  region: string | null;
  requiresConsent: boolean;
  limitedDataUse: boolean;
  interstitialReady: boolean;
  rewardedReady: boolean;
  bannerShown: boolean;
  lastError: string | null;
}

export function getAdsDiagnostics(): AdsDiagnostics {
  return {
    native: isNative(),
    initialized,
    adsAllowed,
    consentStatus: !consentDecided ? 'pending' : consentGranted ? 'granted' : 'denied',
    region: cachedRegion?.country ?? null,
    requiresConsent: cachedRegion?.requiresConsent ?? true,
    limitedDataUse: cachedRegion?.ldu ?? false,
    interstitialReady,
    rewardedReady,
    bannerShown: bannerVisible,
    lastError,
  };
}

/** Traduit l'état de la régie en une phrase actionnable. */
export function explainAdsState(d: AdsDiagnostics = getAdsDiagnostics()): string {
  if (!d.native) {
    return 'Les publicités ne sont diffusées que dans l’application Android.';
  }
  if (!d.initialized) {
    return 'Régie publicitaire pas encore initialisée — relancez l’application.';
  }
  if (d.consentStatus === 'pending' && d.requiresConsent) {
    return (
      'En attente de votre choix dans l’écran de consentement : aucune annonce ' +
      'n’est demandée tant que la publicité personnalisée n’est pas acceptée.'
    );
  }
  if (d.consentStatus === 'denied') {
    return 'Publicité refusée : aucune annonce ne sera diffusée. Vous pouvez changer d’avis à tout moment.';
  }
  if (d.lastError && /no.?fill/i.test(d.lastError)) {
    return (
      'Meta Audience Network ne renvoie aucune annonce (« no fill ») : cela arrive ' +
      'tant que l’application n’est pas validée côté Meta, ou si aucune campagne ' +
      'n’enchère pour ce profil.'
    );
  }
  if (d.lastError) {
    return 'Dernière erreur de la régie : ' + d.lastError;
  }
  if (!d.adsAllowed) {
    return 'Annonces indisponibles pour l’instant (consentement ou réseau).';
  }
  if (!d.interstitialReady && !d.rewardedReady) {
    return 'Annonces autorisées — chargement en cours.';
  }
  return 'Annonces opérationnelles (Meta Audience Network).';
}

/** Diagnostic brut, copiable tel quel dans un message d'assistance. */
export function formatAdsDiagnostics(d: AdsDiagnostics = getAdsDiagnostics()): string {
  const yn = (v: boolean | null) => (v === null ? 'inconnu' : v ? 'oui' : 'non');
  return [
    `régie          : Meta Audience Network`,
    `natif          : ${yn(d.native)}`,
    `initialisé     : ${yn(d.initialized)}`,
    `pays           : ${d.region ?? 'inconnu'}`,
    `consentement   : ${d.consentStatus ?? 'inconnu'}`,
    `LDU (US)       : ${yn(d.limitedDataUse)}`,
    `interstitiel   : ${yn(d.interstitialReady)}`,
    `récompense     : ${yn(d.rewardedReady)}`,
    `bannière       : ${yn(d.bannerShown)}`,
    `dernière erreur: ${d.lastError ?? 'aucune'}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Écouteurs natifs
// ---------------------------------------------------------------------------

let listenersRegistered = false;
let interstitialReady = false;
let rewardedReady = false;
let bannerVisible = false;
let resolveInterstitialShown: (() => void) | null = null;
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

  const track = (event: string, handler: () => void) => {
    NativeAds.addListener(event, handler).catch((e) => warn('addListener', e));
  };

  // La fermeture de l'interstitiel est le seul signal fiable de fin
  // d'affichage : `showInterstitial()` résout dès que l'annonce est *affichée*,
  // pas quand elle est fermée. Sans cet événement, la promesse rendue aux pages
  // (validation des pas, fin de sortie, retrait) bloquerait l'interface jusqu'au
  // délai de sécurité de 90 s.
  track('interstitialDismissed', () => {
    if (resolveInterstitialShown) resolveInterstitialShown();
  });

  // Événements informatifs : on s'y abonne pour ne pas les laisser sans
  // écouteur côté pont, sans autre effet.
  ['interstitialLoaded', 'interstitialShown', 'interstitialImpression', 'rewardedLoaded', 'rewardedEarned', 'adError'].forEach(
    (event) => track(event, () => undefined)
  );
}

// ---------------------------------------------------------------------------
// Interstitiel — lancement, validation des pas, fin de sortie, retrait
// ---------------------------------------------------------------------------

/** Charge (ou recharge) un interstitiel en tâche de fond. */
async function preloadInterstitial(): Promise<void> {
  if (!isNative() || !adsAllowed) return;
  try {
    await NativeAds.prepareInterstitial({ placementId: AD_PLACEMENTS.interstitial });
    interstitialReady = true;
  } catch (e) {
    warn('interstitial load', e);
    interstitialReady = false;
  }
}

/** Précharge les annonces en tâche de fond (appelé après le démarrage). */
export async function prefetchAds(): Promise<void> {
  if (!(await ensureAds())) return;
  await Promise.all([preloadInterstitial(), preloadRewarded()]);
}

/**
 * Affiche une annonce interstitielle.
 *
 * Résout quand la pub est fermée. Ne bloque jamais l'utilisateur : en cas
 * d'absence d'annonce ou de cadencement trop rapproché, on résout tout de
 * suite sans rien afficher.
 */
export async function showInterstitial(placement: AdPlacement = 'other'): Promise<void> {
  if (!isNative()) return;
  if (!(await ensureAds())) return;
  if (fullScreenAdVisible) return;

  // L'annonce d'ouverture n'est pas soumise au délai anti-spam : c'est le
  // premier écran publicitaire de la session.
  if (placement !== 'app-open' && Date.now() - lastFullScreenAdAt < INTERSTITIAL_MIN_INTERVAL_MS) {
    void preloadInterstitial();
    return;
  }

  return new Promise<void>((resolve) => {
    let done = false;
    /** Attente de fermeture : garde-fou si l'événement n'arrive jamais. */
    let dismissGuard: ReturnType<typeof setTimeout> | undefined;

    const finish = () => {
      if (done) return;
      done = true;
      if (dismissGuard) clearTimeout(dismissGuard);
      if (resolveInterstitialShown === finish) resolveInterstitialShown = null;
      resolve();
    };
    /** Appelé par `interstitialDismissed` (voir `registerAdListeners`). */
    const onDismissed = () => {
      endFullScreenAd();
      interstitialReady = false;
      finish();
      void preloadInterstitial();
    };
    resolveInterstitialShown = onDismissed;

    beginFullScreenAd();
    withTimeout(
      NativeAds.showInterstitial({ placementId: AD_PLACEMENTS.interstitial }),
      LOAD_TIMEOUT_MS,
      { shown: false }
    )
      .then((result) => {
        if (!result.shown) {
          // Aucune annonce valide : l'utilisateur n'a rien vu, on ne consomme
          // donc pas le délai anti-spam.
          cancelFullScreenAd();
          finish();
          void preloadInterstitial();
          return;
        }
        // L'annonce est à l'écran. La promesse ne doit être tenue qu'à sa
        // fermeture : sinon la page reprendrait la main derrière l'overlay
        // (double navigation, double crédit). Sécurité : sans événement de
        // fermeture, l'interface est rendue au bout de SHOW_TIMEOUT_MS.
        dismissGuard = setTimeout(onDismissed, SHOW_TIMEOUT_MS);
      })
      .catch((e) => {
        warn(`interstitial show (${placement})`, e);
        cancelFullScreenAd();
        interstitialReady = false;
        finish();
        void preloadInterstitial();
      });
  });
}

// ---------------------------------------------------------------------------
// Interstitiel récompensé — « Regarder une pub pour gagner des ElyCoins »
// ---------------------------------------------------------------------------

/**
 * Déclare l'utilisateur courant. Son identifiant accompagne la demande de
 * récompense : Meta le renvoie à notre Worker (paramètre `puid`), qui crédite
 * alors le bon compte après un 200.
 */
export function setAdsUser(uid: string | null): void {
  adsUserId = uid || null;
}

/** La validation serveur n'a de sens que si le Worker et l'utilisateur existent. */
function useServerReward(): boolean {
  return Boolean(ADS_S2S_REWARD_URL && adsUserId);
}

/** Paramètres Meta communs aux deux appels récompensés. */
function rewardOptions() {
  const serverValidation = useServerReward();
  return {
    placementId: AD_PLACEMENTS.rewarded,
    userId: adsUserId ?? '',
    rewardId: META_REWARD_CURRENCY,
    serverValidation,
  };
}

async function preloadRewarded(): Promise<void> {
  if (!isNative() || !adsAllowed) return;
  try {
    await NativeAds.prepareRewardedInterstitial(rewardOptions());
    rewardedReady = true;
  } catch (e) {
    warn('rewarded load', e);
    rewardedReady = false;
  }
}

/**
 * Affiche un interstitiel récompensé.
 * Résout `true` uniquement si Meta a confirmé la fin de la vidéo.
 */
export async function showRewardedAd(): Promise<boolean> {
  if (!isNative()) return false;
  if (!(await ensureAds())) return false;
  if (fullScreenAdVisible) return false;

  // Charge l'annonce juste avant : Meta ne paie pas une annonce périmée
  // (validité de 60 minutes).
  await withTimeout(preloadRewarded(), LOAD_TIMEOUT_MS, undefined);

  return new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (earned: boolean) => {
      if (done) return;
      done = true;
      resolve(earned);
    };
    setTimeout(() => finish(false), SHOW_TIMEOUT_MS);

    beginFullScreenAd();
    withTimeout(
      NativeAds.showRewardedInterstitial(rewardOptions()),
      LOAD_TIMEOUT_MS,
      { rewarded: false }
    )
      .then((result) => {
        endFullScreenAd();
        rewardedReady = false;
        finish(result.rewarded === true);
        void preloadRewarded();
      })
      .catch((e) => {
        warn('rewarded show', e);
        cancelFullScreenAd();
        rewardedReady = false;
        finish(false);
        void preloadRewarded();
      });
  });
}

// ---------------------------------------------------------------------------
// Bannière — affichée sur chaque écran de l'application
// ---------------------------------------------------------------------------

/** Affiche la bannière ancrée en bas de l'écran (une seule fois par session). */
export async function showBanner(): Promise<void> {
  if (!isNative()) return;
  if (!(await ensureAds())) return;
  if (bannerVisible) return;
  try {
    const info = await Device.getInfo();
    const tablet = info.platform === 'android' && /tablet/i.test(info.model ?? '');
    await NativeAds.showBanner({ placementId: AD_PLACEMENTS.banner, tablet });
    bannerVisible = true;
    // Réserve la place occupée par la bannière côté CSS.
    const { height } = await NativeAds.getBannerHeight({
      placementId: AD_PLACEMENTS.banner,
      tablet,
    });
    applyBannerInset(height);
  } catch (e) {
    warn('banner show', e);
    bannerVisible = false;
  }
}

/** Retire la bannière et libère la place réservée. */
export async function hideBanner(): Promise<void> {
  if (!isNative()) return;
  try {
    await NativeAds.hideBanner();
  } catch (e) {
    warn('banner hide', e);
  }
  bannerVisible = false;
  applyBannerInset(0);
}

/**
 * Publie la hauteur de la bannière dans une variable CSS. Les écrans réservent
 * cette place (`--ad-banner-height`) pour ne jamais passer sous l'annonce.
 */
function applyBannerInset(height: number) {
  try {
    document.documentElement.style.setProperty('--ad-banner-height', `${height}px`);
  } catch {
    /* pas de DOM (tests) : sans effet */
  }
}

// ---------------------------------------------------------------------------
// Annonce d'ouverture
// ---------------------------------------------------------------------------

// Garde-fous : plafond journalier + cooldown, pour éviter une UX punitive.
const APP_OPEN_DAILY_CAP = 2; // maximum d'annonces d'ouverture par jour
const APP_OPEN_COOLDOWN_MS = 10 * 60 * 1000; // au moins 10 min entre deux
/** Après une autre annonce plein écran, pas d'annonce d'ouverture. */
const APP_OPEN_AFTER_AD_MS = 60 * 1000;
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
      /* état corrompu -> on repart de zéro */
    }
  }
  return { date: todayKey(), count: 0, lastShownAt: 0 };
}

/** Décide si l'annonce d'ouverture peut être affichée (plafond + cooldown). */
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

/** Mémorise l'affichage d'une annonce d'ouverture (plafond journalier). */
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

/**
 * Affiche l'annonce d'ouverture si elle est autorisée.
 *
 * Meta n'ayant pas de format « app open », c'est l'interstitiel qui est utilisé
 * au lancement : il est préchargé pendant l'écran de connexion pour être prêt
 * au premier affichage.
 */
export async function showAppOpenAdIfReady(): Promise<void> {
  if (!(await ensureAds())) return;
  if (!(await shouldShowAppOpenAd())) return;
  await showInterstitial('app-open');
  await recordAppOpenAdShown();
}

/** Charge l'annonce d'ouverture en avance (même slot que l'interstitiel). */
export async function loadAppOpenAd(): Promise<void> {
  if (!(await ensureAds())) return;
  await preloadInterstitial();
}
