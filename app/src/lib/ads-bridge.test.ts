// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sdk, native, prefs } = vi.hoisted(() => ({
  sdk: {
    initialize: vi.fn(), setConsent: vi.fn(), setUserId: vi.fn(),
    showNativeBanner: vi.fn(), hideNativeBanner: vi.fn(), showNativeCard: vi.fn(),
    showBanner: vi.fn(), hideBanner: vi.fn(), loadRewarded: vi.fn(), showRewarded: vi.fn(),
  },
  native: vi.fn(),
  prefs: { get: vi.fn(), set: vi.fn() },
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: native }, registerPlugin: () => sdk }));
vi.mock('@capacitor/preferences', () => ({ Preferences: prefs }));

beforeEach(() => {
  vi.resetModules(); // Une session SDK et un cache de consentement neufs par test.
  vi.resetAllMocks();
  native.mockReturnValue(true);
  prefs.get.mockResolvedValue({ value: null });
  sdk.hideBanner.mockResolvedValue(undefined);
  sdk.hideNativeBanner.mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('pont Capacitor → LevelPlay', () => {
  it('reste inerte sur le web', async () => {
    native.mockReturnValue(false);
    const ads = await import('./ads');
    await ads.showBottomAd('nativeBanner');
    expect(await ads.adGate()).toBe('unavailable');
    expect(prefs.get).not.toHaveBeenCalled();
    expect(sdk.initialize).not.toHaveBeenCalled();
  });

  it.each(['granted', 'refused'] as const)('attend le premier choix (%s) avant la moindre init', async (choice) => {
    const ads = await import('./ads');
    const { setAdConsent } = await import('./adConsent');
    const { LEVELPLAY_APP_KEY } = await import('./constants');
    await ads.initAds('user');
    await ads.showEndOfActivityAd();
    expect(await ads.adGate()).toBe('no-consent');
    expect(sdk.initialize).not.toHaveBeenCalled();
    expect(sdk.showNativeCard).not.toHaveBeenCalled();

    await setAdConsent(choice);
    expect(await ads.adGate()).toBe('ready');
    expect(sdk.initialize).toHaveBeenCalledTimes(1);
    expect(sdk.initialize).toHaveBeenCalledWith({ appKey: LEVELPLAY_APP_KEY, personalized: choice === 'granted', userId: 'user' });
  });

  it('ne remplace pas un choix explicite par une ancienne valeur lue plus tard', async () => {
    let finishRead!: (state: { value: string }) => void;
    prefs.get.mockImplementation(() => new Promise((resolve) => { finishRead = resolve; }));
    const ads = await import('./ads');
    const { getAdConsent, setAdConsent } = await import('./adConsent');
    const starting = ads.initAds();
    await setAdConsent('refused');
    finishRead({ value: 'granted' });
    await starting;
    expect(await getAdConsent()).toBe('refused');
    expect(sdk.initialize).toHaveBeenCalledWith(expect.objectContaining({ personalized: false }));
  });

  it('applique un changement pendant l’init avant de charger une annonce', async () => {
    prefs.get.mockResolvedValue({ value: 'granted' });
    let finishInit!: () => void;
    sdk.initialize.mockImplementation(() => new Promise<void>((resolve) => { finishInit = resolve; }));
    const ads = await import('./ads');
    const { setAdConsent } = await import('./adConsent');
    const loading = ads.showEndOfActivityAd();
    await vi.waitFor(() => expect(sdk.initialize).toHaveBeenCalledTimes(1));
    await setAdConsent('refused');
    expect(sdk.showNativeCard).not.toHaveBeenCalled();
    finishInit();
    await loading;
    expect(sdk.initialize).toHaveBeenCalledTimes(1);
    expect(sdk.setConsent).toHaveBeenCalledWith({ personalized: false });
    expect(sdk.setConsent.mock.invocationCallOrder[0]).toBeLessThan(sdk.showNativeCard.mock.invocationCallOrder[0]);
  });

  it('ne charge pas avec un choix périmé si le changement de confidentialité échoue', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    prefs.get.mockResolvedValue({ value: 'granted' });
    sdk.setConsent.mockRejectedValue(new Error('SDK indisponible'));
    const ads = await import('./ads');
    const { setAdConsent } = await import('./adConsent');
    await ads.initAds();
    await setAdConsent('refused');
    await ads.showEndOfActivityAd();
    expect(sdk.showNativeCard).not.toHaveBeenCalled();
    expect(await ads.adGate()).toBe('unavailable');
    sdk.setConsent.mockResolvedValue(undefined);
    expect(await ads.adGate()).toBe('ready');
  });

  it('n’affiche pas une vidéo chargée sous l’ancien choix', async () => {
    prefs.get.mockResolvedValue({ value: 'granted' });
    let finishLoad!: (result: { loaded: boolean }) => void;
    sdk.loadRewarded.mockImplementation(() => new Promise((resolve) => { finishLoad = resolve; }));
    const ads = await import('./ads');
    const { setAdConsent } = await import('./adConsent');
    const showing = ads.showRewardedAd();
    await vi.waitFor(() => expect(sdk.loadRewarded).toHaveBeenCalledOnce());
    await setAdConsent('refused');
    await ads.initAds();
    finishLoad({ loaded: true });
    expect(await showing).toEqual({ rewarded: false, coins: 0 });
    expect(sdk.showRewarded).not.toHaveBeenCalled();
  });

  it('transmet les noms de placements natifs, sans les confondre avec les identifiants', async () => {
    vi.stubEnv('VITE_LEVELPLAY_NATIVE_BANNER_PLACEMENT', 'Liste');
    vi.stubEnv('VITE_LEVELPLAY_NATIVE_CARD_PLACEMENT', 'Fin de sortie');
    prefs.get.mockResolvedValue({ value: 'refused' });
    sdk.showNativeBanner.mockResolvedValue({ height: 80 });
    const ads = await import('./ads');
    await ads.showBottomAd('nativeBanner');
    await ads.showEndOfActivityAd();
    expect(sdk.showNativeBanner).toHaveBeenCalledWith({ placementName: 'Liste' });
    expect(sdk.showNativeCard).toHaveBeenCalledWith({ placementName: 'Fin de sortie' });
    expect(sdk.showBanner).not.toHaveBeenCalled();
  });

  it('utilise le placement par défaut sans nom et garde le repli bannière en cas de no fill', async () => {
    vi.stubEnv('VITE_LEVELPLAY_NATIVE_BANNER_PLACEMENT', '');
    prefs.get.mockResolvedValue({ value: 'granted' });
    sdk.showNativeBanner.mockResolvedValue({ height: 0 });
    sdk.showBanner.mockResolvedValue({ height: 50 });
    const ads = await import('./ads');
    const { LEVELPLAY_AD_UNIT_BANNER } = await import('./constants');
    await ads.showBottomAd('nativeBanner');
    expect(sdk.showNativeBanner).toHaveBeenCalledWith({ placementName: undefined });
    expect(sdk.showBanner).toHaveBeenCalledWith({ adUnitId: LEVELPLAY_AD_UNIT_BANNER });
  });
});
