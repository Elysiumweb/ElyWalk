import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Doublures des plugins Capacitor (pas de natif dans les tests).
// ---------------------------------------------------------------------------

const prefsStore = new Map<string, string>();

/**
 * Région système simulée. `lib/ads.ts` la déduit de la locale du navigateur
 * (`fr-FR` -> FR), qui est la source réellement disponible sur l'appareil.
 */
const setLocale = (locale: string) => {
  const [language, region] = locale.split('-');
  Object.defineProperty(navigator, 'language', { value: locale, configurable: true });
  Object.defineProperty(navigator, 'languages', {
    value: region ? [locale, language] : [language],
    configurable: true,
  });
};

/** Réponses du plugin natif MetaAds, remplaçables par test. */
const native = {
  getStatus: vi.fn(async () => ({
    initialized: true,
    bannerReady: false,
    interstitialReady: true,
    rewardedReady: true,
  })),
  setDataProcessingOptions: vi.fn(async () => undefined),
  prepareInterstitial: vi.fn(async () => undefined),
  showInterstitial: vi.fn(async () => ({ shown: true })),
  prepareRewardedInterstitial: vi.fn(async () => undefined),
  showRewardedInterstitial: vi.fn(async () => ({ rewarded: true })),
  showBanner: vi.fn(async () => undefined),
  hideBanner: vi.fn(async () => undefined),
  getBannerHeight: vi.fn(async () => ({ height: 50 })),
  addListener: vi.fn(async () => ({ remove: async () => undefined })),
};

/** Écouteurs enregistrés par `lib/ads.ts`, par nom d'événement. */
const listeners = new Map<string, Set<() => void>>();

/** Simule un événement émis par le plugin natif. */
const emit = (event: string) => {
  for (const handler of listeners.get(event) ?? []) handler();
};

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => native,
}));

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: prefsStore.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => {
      prefsStore.set(key, value);
    },
    remove: async ({ key }: { key: string }) => {
      prefsStore.delete(key);
    },
  },
}));

vi.mock('@capacitor/device', () => ({
  Device: {
    getInfo: async () => ({ platform: 'android', model: 'Pixel 7' }),
  },
}));

const loadAds = async () => {
  vi.resetModules();
  return import('./ads');
};

const resetNativeMocks = () => {
  listeners.clear();
  // `addListener` est générique côté Capacitor : on la redéfinit avec la
  // signature réelle (nom d'événement + rappel) plutôt que de la mocker.
  native.addListener.mockReset();
  native.addListener.mockImplementation(((...args: unknown[]) => {
    const [event, handler] = args as [string, () => void];
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(handler);
    return Promise.resolve({
      remove: async () => {
        listeners.get(event)?.delete(handler);
      },
    });
  }) as never);
  native.setDataProcessingOptions.mockReset().mockResolvedValue(undefined);
  native.prepareInterstitial.mockReset().mockResolvedValue(undefined);
  native.showInterstitial.mockReset().mockImplementation(async () => {
    // Le natif résout dès l'affichage, puis émet la fermeture plus tard.
    setTimeout(() => emit('interstitialDismissed'), 0);
    return { shown: true };
  });
  native.prepareRewardedInterstitial.mockReset().mockResolvedValue(undefined);
  native.showRewardedInterstitial.mockReset().mockResolvedValue({ rewarded: true });
  native.showBanner.mockReset().mockResolvedValue(undefined);
  native.getBannerHeight.mockReset().mockResolvedValue({ height: 50 });
};

beforeEach(() => {
  vi.clearAllMocks();
  resetNativeMocks();
  prefsStore.clear();
  setLocale('fr-FR');
});

describe('ads — identifiants Meta Audience Network', () => {
  it('utilise les placements du Monetization Manager', async () => {
    const { AD_PLACEMENTS, META_APP_ID } = await import('./constants');
    expect(META_APP_ID).toBe('1712220190424595');
    expect(AD_PLACEMENTS.banner).toBe('1712220190424595_1712220347091246');
    expect(AD_PLACEMENTS.interstitial).toBe('1712220190424595_1712220353757912');
    expect(AD_PLACEMENTS.rewarded).toBe('1712220190424595_1712220367091244');
  });

  it('ne conserve aucun identifiant AdMob dans les constantes', async () => {
    const constants = await import('./constants');
    const values = Object.entries(constants)
      .filter(([, v]) => typeof v === 'string')
      .map(([, v]) => v as string);
    expect(values.some((v) => v.includes('ca-app-pub'))).toBe(false);
  });
});

describe('ads — consentement', () => {
  it('ne charge aucune annonce sans consentement en Europe', async () => {
    const ads = await loadAds();
    expect(await ads.needsConsentPrompt()).toBe(true);
    await ads.initAds();
    expect(ads.canShowAds()).toBe(false);
    await ads.showInterstitial('steps-validation');
    expect(native.showInterstitial).not.toHaveBeenCalled();
  });

  it('diffuse après acceptation', async () => {
    const ads = await loadAds();
    await ads.setConsent(true);
    await ads.initAds();
    expect(ads.canShowAds()).toBe(true);
    await ads.showInterstitial('steps-validation');
    expect(native.showInterstitial).toHaveBeenCalledWith({
      placementId: '1712220190424595_1712220353757912',
    });
  });

  it('ne redemande pas le consentement une fois refusé', async () => {
    const ads = await loadAds();
    await ads.setConsent(false);
    expect(await ads.needsConsentPrompt()).toBe(false);
    expect(await ads.getConsentChoice()).toBe(false);
    expect(ads.getAdsDiagnostics().consentStatus).toBe('denied');
  });

  it('n’exige pas de consentement hors EEE et active Limited Data Use aux États-Unis', async () => {
    setLocale('en-US');
    const ads = await loadAds();
    expect(await ads.needsConsentPrompt()).toBe(false);
    await ads.initAds();
    expect(native.setDataProcessingOptions).toHaveBeenCalledWith({ ldu: true });
    expect(ads.canShowAds()).toBe(true);
  });

  it('signale l’effacement du choix pour réafficher l’écran', async () => {
    const ads = await loadAds();
    await ads.setConsent(false);
    const seen: string[] = [];
    const listener = () => seen.push('reset');
    window.addEventListener(ads.CONSENT_RESET_EVENT, listener);
    await ads.resetConsent();
    window.removeEventListener(ads.CONSENT_RESET_EVENT, listener);
    expect(seen).toHaveLength(1);
    expect(await ads.needsConsentPrompt()).toBe(true);
  });

  it('demande le consentement quand le pays est indéterminé', async () => {
    setLocale('fr');
    const ads = await loadAds();
    expect(await ads.needsConsentPrompt()).toBe(true);
  });
});

describe('ads — interstitiel', () => {
  it('respecte un délai minimal entre deux annonces hors ouverture', async () => {
    const ads = await loadAds();
    await ads.setConsent(true);
    await ads.showInterstitial('steps-validation');
    await ads.showInterstitial('activity-finished');
    expect(native.showInterstitial).toHaveBeenCalledTimes(1);
  });

  it('ne bloque jamais l’utilisateur si aucune annonce n’est disponible', async () => {
    native.showInterstitial.mockResolvedValue({ shown: false });
    const ads = await loadAds();
    await ads.setConsent(true);
    await expect(ads.showInterstitial('withdrawal')).resolves.toBeUndefined();
  });

  it('autorise l’annonce d’ouverture même juste après une autre', async () => {
    const ads = await loadAds();
    await ads.setConsent(true);
    await ads.showInterstitial('steps-validation');
    await ads.showInterstitial('app-open');
    expect(native.showInterstitial).toHaveBeenCalledTimes(2);
  });
});

describe('ads — récompense', () => {
  it('confirme la récompense quand la vidéo est terminée', async () => {
    const ads = await loadAds();
    await ads.setConsent(true);
    await expect(ads.showRewardedAd()).resolves.toBe(true);
    expect(native.showRewardedInterstitial).toHaveBeenCalledWith({
      placementId: '1712220190424595_1712220367091244',
      userId: '',
      rewardId: 'Coins',
      // Sans URL de Worker configurée, pas de validation serveur : la
      // récompense est créditée côté client après la vidéo.
      serverValidation: false,
    });
  });

  it('transmet l’utilisateur quand la validation serveur est active', async () => {
    vi.resetModules();
    vi.doMock('./constants', async () => {
      const real = await vi.importActual<typeof import('./constants')>('./constants');
      return { ...real, ADS_S2S_REWARD_URL: 'https://worker.test/meta-reward' };
    });
    const ads = await import('./ads');
    ads.setAdsUser('uid-42');
    await ads.setConsent(true);
    await ads.showRewardedAd();
    expect(native.showRewardedInterstitial).toHaveBeenCalledWith({
      placementId: '1712220190424595_1712220367091244',
      userId: 'uid-42',
      rewardId: 'Coins',
      serverValidation: true,
    });
    vi.doUnmock('./constants');
  });

  it('ne récompense pas quand la vidéo est abandonnée', async () => {
    native.showRewardedInterstitial.mockResolvedValue({ rewarded: false });
    const ads = await loadAds();
    await ads.setConsent(true);
    await expect(ads.showRewardedAd()).resolves.toBe(false);
  });

  it('ne demande aucune récompense sans consentement', async () => {
    const ads = await loadAds();
    await ads.initAds();
    await expect(ads.showRewardedAd()).resolves.toBe(false);
    expect(native.showRewardedInterstitial).not.toHaveBeenCalled();
  });
});

describe('ads — bannière', () => {
  it('affiche la bannière une seule fois et réserve sa hauteur', async () => {
    const ads = await loadAds();
    await ads.setConsent(true);
    await ads.showBanner();
    await ads.showBanner();
    expect(native.showBanner).toHaveBeenCalledTimes(1);
    expect(native.showBanner).toHaveBeenCalledWith({
      placementId: '1712220190424595_1712220347091246',
      tablet: false,
    });
    expect(native.getBannerHeight).toHaveBeenCalled();
  });

  it('n’affiche pas de bannière sans consentement', async () => {
    const ads = await loadAds();
    await ads.initAds();
    await ads.showBanner();
    expect(native.showBanner).not.toHaveBeenCalled();
  });
});

describe('ads — annonce d’ouverture', () => {
  it('plafonne les annonces d’ouverture sur la journée', async () => {
    const ads = await loadAds();
    await ads.setConsent(true);
    await ads.initAds();
    await ads.recordAppOpenAdShown();
    await ads.recordAppOpenAdShown();
    await expect(ads.shouldShowAppOpenAd()).resolves.toBe(false);
  });

  it('n’enchaîne pas sur une annonce d’ouverture juste après un interstitiel', async () => {
    const ads = await loadAds();
    await ads.setConsent(true);
    await ads.showInterstitial('activity-finished');
    await expect(ads.shouldShowAppOpenAd()).resolves.toBe(false);
  });
});

describe('ads — diagnostic affiché dans Profil', () => {
  const base = {
    native: true,
    initialized: true,
    adsAllowed: true,
    consentStatus: 'granted' as const,
    region: 'FR',
    requiresConsent: true,
    limitedDataUse: false,
    interstitialReady: true,
    rewardedReady: true,
    bannerShown: true,
    lastError: null,
  };

  it('explique l’attente de décision', async () => {
    const ads = await loadAds();
    const msg = ads.explainAdsState({ ...base, consentStatus: 'pending', adsAllowed: false });
    expect(msg).toMatch(/consentement/i);
  });

  it('explique un refus', async () => {
    const ads = await loadAds();
    const msg = ads.explainAdsState({ ...base, consentStatus: 'denied', adsAllowed: false });
    expect(msg).toMatch(/refus/i);
  });

  it('désigne l’absence de remplissage', async () => {
    const ads = await loadAds();
    const msg = ads.explainAdsState({ ...base, lastError: 'No fill' });
    expect(msg).toMatch(/no fill/i);
    expect(msg).toMatch(/Meta/);
  });

  it('signale une régie opérationnelle', async () => {
    const ads = await loadAds();
    expect(ads.explainAdsState(base)).toMatch(/opérationnelles/);
  });
});
