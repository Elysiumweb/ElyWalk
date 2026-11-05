import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Doublures des plugins Capacitor (pas de natif dans les tests).
// ---------------------------------------------------------------------------

type Listener = (data?: unknown) => void;

const listeners = new Map<string, Listener[]>();
const emit = (event: string, data?: unknown) => {
  (listeners.get(event) || []).forEach((l) => l(data));
};

const prefsStore = new Map<string, string>();

const consent = {
  status: 'NOT_REQUIRED',
  canRequestAds: true,
  isConsentFormAvailable: false,
  privacyOptionsRequirementStatus: 'NOT_REQUIRED',
};

const admob = {
  initialize: vi.fn(async () => undefined),
  requestConsentInfo: vi.fn(async () => ({ ...consent })),
  showConsentForm: vi.fn(async () => ({ ...consent })),
  showPrivacyOptionsForm: vi.fn(async () => undefined),
  resetConsentInfo: vi.fn(async () => undefined),
  prepareInterstitial: vi.fn(async () => {
    emit('interstitialAdLoaded');
  }),
  showInterstitial: vi.fn(async () => {
    emit('interstitialAdShowed');
    emit('interstitialAdDismissed');
  }),
  prepareRewardVideoAd: vi.fn(async () => undefined),
  showRewardVideoAd: vi.fn(async () => {
    emit('onRewardedVideoAdShowed');
    emit('onRewardedVideoAdReward');
    emit('onRewardedVideoAdDismissed');
  }),
  loadAppOpen: vi.fn(async () => {
    emit('appOpenAdLoaded');
  }),
  isAppOpenLoaded: vi.fn(async () => ({ value: true })),
  showAppOpen: vi.fn(async () => {
    emit('appOpenAdOpened');
    emit('appOpenAdClosed');
  }),
  addListener: vi.fn(async (event: string, cb: Listener) => {
    listeners.set(event, [...(listeners.get(event) || []), cb]);
    return { remove: async () => undefined };
  }),
};

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
}));

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: prefsStore.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => {
      prefsStore.set(key, value);
    },
  },
}));

vi.mock('@capacitor-community/admob', () => ({
  AdMob: admob,
  AdmobConsentStatus: {
    NOT_REQUIRED: 'NOT_REQUIRED',
    OBTAINED: 'OBTAINED',
    REQUIRED: 'REQUIRED',
    UNKNOWN: 'UNKNOWN',
  },
  InterstitialAdPluginEvents: {
    Loaded: 'interstitialAdLoaded',
    FailedToLoad: 'interstitialAdFailedToLoad',
    Showed: 'interstitialAdShowed',
    FailedToShow: 'interstitialAdFailedToShow',
    Dismissed: 'interstitialAdDismissed',
  },
  RewardAdPluginEvents: {
    Loaded: 'onRewardedVideoAdLoaded',
    FailedToLoad: 'onRewardedVideoAdFailedToLoad',
    Showed: 'onRewardedVideoAdShowed',
    FailedToShow: 'onRewardedVideoAdFailedToShow',
    Dismissed: 'onRewardedVideoAdDismissed',
    Rewarded: 'onRewardedVideoAdReward',
  },
  AppOpenAdPluginEvents: {
    Loaded: 'appOpenAdLoaded',
    FailedToLoad: 'appOpenAdFailedToLoad',
    Opened: 'appOpenAdOpened',
    Closed: 'appOpenAdClosed',
    FailedToShow: 'appOpenAdFailedToShow',
  },
}));

const loadAds = async () => {
  vi.resetModules();
  listeners.clear();
  return import('./ads');
};

/** Rétablit les comportements par défaut (certains tests les remplacent). */
const resetAdmobMocks = () => {
  admob.initialize.mockReset().mockResolvedValue(undefined);
  admob.requestConsentInfo.mockReset().mockImplementation(async () => ({ ...consent }));
  admob.showConsentForm.mockReset().mockImplementation(async () => ({ ...consent }));
  admob.prepareInterstitial.mockReset().mockImplementation(async () => {
    emit('interstitialAdLoaded');
  });
  admob.showInterstitial.mockReset().mockImplementation(async () => {
    emit('interstitialAdShowed');
    emit('interstitialAdDismissed');
  });
  admob.prepareRewardVideoAd.mockReset().mockResolvedValue(undefined);
  admob.showRewardVideoAd.mockReset().mockImplementation(async () => {
    emit('onRewardedVideoAdShowed');
    emit('onRewardedVideoAdReward');
    emit('onRewardedVideoAdDismissed');
  });
  admob.loadAppOpen.mockReset().mockImplementation(async () => {
    emit('appOpenAdLoaded');
  });
  admob.isAppOpenLoaded.mockReset().mockResolvedValue({ value: true });
  admob.showAppOpen.mockReset().mockImplementation(async () => {
    emit('appOpenAdOpened');
    emit('appOpenAdClosed');
  });
  admob.addListener.mockReset().mockImplementation(async (event: string, cb: Listener) => {
    listeners.set(event, [...(listeners.get(event) || []), cb]);
    return { remove: async () => undefined };
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  resetAdmobMocks();
  prefsStore.clear();
  consent.status = 'NOT_REQUIRED';
  consent.canRequestAds = true;
  consent.isConsentFormAvailable = false;
  consent.privacyOptionsRequirementStatus = 'NOT_REQUIRED';
});

describe('ads — identifiants et initialisation', () => {
  it('utilise les blocs d’annonces du compte AdMob ElyWalk', async () => {
    const { AD_UNIT_APP_OPEN, AD_UNIT_INTERSTITIAL, AD_UNIT_REWARDED, ADMOB_APP_ID } = await import(
      './constants'
    );
    expect(ADMOB_APP_ID).toBe('ca-app-pub-5316598937383510~4963026878');
    expect(AD_UNIT_APP_OPEN).toBe('ca-app-pub-5316598937383510/6986554989');
    expect(AD_UNIT_INTERSTITIAL).toBe('ca-app-pub-5316598937383510/7972992736');
    expect(AD_UNIT_REWARDED).toBe('ca-app-pub-5316598937383510/9832210178');
  });

  it('n’utilise les blocs de test Google que si VITE_TEST_ADS=1', async () => {
    const { AD_UNITS, USE_TEST_ADS, AD_UNIT_INTERSTITIAL } = await import('./constants');
    expect(USE_TEST_ADS).toBe(false);
    expect(AD_UNITS.interstitial).toBe(AD_UNIT_INTERSTITIAL);
    expect(AD_UNITS.interstitial).not.toContain('3940256099942544');
  });

  it('n’initialise le SDK qu’une seule fois malgré les appels concurrents', async () => {
    const ads = await loadAds();
    await Promise.all([ads.initAds(), ads.initAds(), ads.prefetchAds()]);
    expect(admob.initialize).toHaveBeenCalledTimes(1);
    expect(ads.canShowAds()).toBe(true);
  });
});

describe('ads — interstitiel', () => {
  it('affiche une annonce et attend sa fermeture', async () => {
    const ads = await loadAds();
    await ads.showInterstitial('steps-validation');
    expect(admob.prepareInterstitial).toHaveBeenCalledWith({
      adId: 'ca-app-pub-5316598937383510/7972992736',
    });
    expect(admob.showInterstitial).toHaveBeenCalledTimes(1);
  });

  it('respecte un délai minimal entre deux interstitiels', async () => {
    const ads = await loadAds();
    await ads.showInterstitial('steps-validation');
    await ads.showInterstitial('activity-finished');
    expect(admob.showInterstitial).toHaveBeenCalledTimes(1);
  });

  it('ne bloque jamais l’utilisateur si l’annonce ne charge pas', async () => {
    admob.prepareInterstitial.mockRejectedValue(new Error('No ad to show'));
    const ads = await loadAds();
    await expect(ads.showInterstitial('withdrawal')).resolves.toBeUndefined();
    expect(admob.showInterstitial).not.toHaveBeenCalled();
  });
});

describe('ads — consentement RGPD', () => {
  it('ne diffuse aucune annonce tant que le consentement n’est pas obtenu', async () => {
    consent.status = 'REQUIRED';
    consent.canRequestAds = false;
    consent.isConsentFormAvailable = false;
    admob.showConsentForm.mockRejectedValueOnce(new Error('no form available'));

    const ads = await loadAds();
    await ads.showInterstitial('steps-validation');

    expect(ads.canShowAds()).toBe(false);
    expect(admob.showInterstitial).not.toHaveBeenCalled();
    expect(ads.getAdsDiagnostics().consentStatus).toBe('REQUIRED');
  });

  it('diffuse après affichage du formulaire de consentement', async () => {
    consent.status = 'REQUIRED';
    consent.canRequestAds = false;
    consent.isConsentFormAvailable = true;
    admob.showConsentForm.mockResolvedValueOnce({
      status: 'OBTAINED',
      canRequestAds: true,
      isConsentFormAvailable: true,
      privacyOptionsRequirementStatus: 'REQUIRED',
    });

    const ads = await loadAds();
    await ads.showInterstitial('steps-validation');

    expect(admob.showConsentForm).toHaveBeenCalledTimes(1);
    expect(admob.showInterstitial).toHaveBeenCalledTimes(1);
  });
});

describe('ads — vidéo avec récompense', () => {
  it('transmet l’identifiant utilisateur (SSV) et confirme la récompense', async () => {
    const ads = await loadAds();
    const rewarded = await ads.showRewardedAd('uid-123');
    expect(rewarded).toBe(true);
    expect(admob.prepareRewardVideoAd).toHaveBeenCalledWith({
      adId: 'ca-app-pub-5316598937383510/9832210178',
      ssv: { userId: 'uid-123' },
    });
  });

  it('ne récompense pas quand la vidéo est abandonnée', async () => {
    admob.showRewardVideoAd.mockImplementationOnce(async () => {
      emit('onRewardedVideoAdShowed');
      emit('onRewardedVideoAdDismissed');
    });
    const ads = await loadAds();
    await expect(ads.showRewardedAd('uid-123')).resolves.toBe(false);
  });
});

describe('ads — annonce à l’ouverture', () => {
  it('n’enchaîne pas sur une autre annonce plein écran', async () => {
    const ads = await loadAds();
    await ads.showInterstitial('activity-finished');
    await expect(ads.shouldShowAppOpenAd()).resolves.toBe(false);
    await ads.showAppOpenAdIfReady();
    expect(admob.showAppOpen).not.toHaveBeenCalled();
  });

  it('plafonne les annonces d’ouverture sur la journée', async () => {
    const ads = await loadAds();
    await ads.initAds();
    await ads.recordAppOpenAdShown();
    await ads.recordAppOpenAdShown();
    await expect(ads.shouldShowAppOpenAd()).resolves.toBe(false);
  });
});

describe('ads — diagnostic affiché dans Profil', () => {
  const base = {
    native: true,
    initialized: true,
    adsAllowed: true,
    consentStatus: 'OBTAINED',
    canRequestAds: true,
    consentFormAvailable: true,
    privacyOptionsRequired: false,
    interstitialReady: true,
    lastError: null,
  };

  it('désigne le message RGPD non publié quand le formulaire manque', async () => {
    const ads = await loadAds();
    const msg = ads.explainAdsState({
      ...base,
      consentStatus: 'REQUIRED',
      consentFormAvailable: false,
      adsAllowed: false,
      canRequestAds: false,
    });
    expect(msg).toMatch(/message\s+RGPD/i);
  });

  it('désigne l’absence de remplissage quand la régie répond « no fill »', async () => {
    const ads = await loadAds();
    const msg = ads.explainAdsState({ ...base, lastError: 'Ad failed to load : no fill' });
    expect(msg).toMatch(/no fill/i);
    expect(msg).toMatch(/Play/);
  });

  it('désigne l’absence de message RGPD quand l’UMP n’expose rien', async () => {
    const ads = await loadAds();
    const msg = ads.explainAdsState({
      ...base,
      consentStatus: 'NOT_REQUIRED',
      consentFormAvailable: false,
      privacyOptionsRequired: false,
      interstitialReady: false,
    });
    expect(msg).toMatch(/message de consentement/i);
    expect(msg).toMatch(/EEE\/UK/);
  });

  it('distingue un consentement refusé d’une erreur technique', async () => {
    const ads = await loadAds();
    expect(ads.explainAdsState({ ...base, canRequestAds: false, adsAllowed: false }))
      .toMatch(/Consentement non accordé/i);
    expect(ads.explainAdsState({ ...base, initialized: false })).toMatch(/pas encore initialisé/i);
  });

  it('confirme l’état nominal et expose un diagnostic copiable', async () => {
    const ads = await loadAds();
    expect(ads.explainAdsState(base)).toMatch(/opérationnelles/i);
    const dump = ads.formatAdsDiagnostics(base);
    expect(dump).toContain('canRequestAds  : oui');
    expect(dump).toContain('dernière erreur: aucune');
  });
});
