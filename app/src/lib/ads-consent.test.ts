import { beforeEach, describe, expect, it, vi } from 'vitest';

const { native, bridge, preferences } = vi.hoisted(() => ({
  native: vi.fn(),
  bridge: {
    initialize: vi.fn(),
    setConsent: vi.fn(),
    hideBanner: vi.fn(),
    hideNativeBanner: vi.fn(),
    loadRewarded: vi.fn(),
  },
  preferences: { get: vi.fn(), set: vi.fn() },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: native },
  registerPlugin: () => bridge,
}));
vi.mock('@capacitor/preferences', () => ({ Preferences: preferences }));

let ads: typeof import('./ads');
let setAdConsent: typeof import('./adConsent').setAdConsent;

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  native.mockReturnValue(true);
  preferences.get.mockResolvedValue({ value: null });
  preferences.set.mockResolvedValue(undefined);
  bridge.initialize.mockResolvedValue(undefined);
  bridge.setConsent.mockResolvedValue(undefined);
  bridge.hideBanner.mockResolvedValue(undefined);
  bridge.hideNativeBanner.mockResolvedValue(undefined);
  ads = await import('./ads');
  ({ setAdConsent } = await import('./adConsent'));
});

describe('Configuration de LevelPlay et consentement', () => {
  it('ne démarre ni SDK ni annonce avec un ancien choix v1', async () => {
    preferences.get.mockImplementation(async ({ key }) => ({
      value: key === 'ads.consent.v1' ? 'granted' : null,
    }));

    expect(await ads.adGate()).toBe('no-consent');
    expect(await ads.showRewardedAd()).toMatchObject({ rewarded: false, coins: 0 });
    expect(bridge.initialize).not.toHaveBeenCalled();
    expect(bridge.loadRewarded).not.toHaveBeenCalled();
  });

  it.each([['granted', true], ['refused', false]] as const)(
    'initialise après le premier choix %s et transmet le réglage au SDK',
    async (choice, personalized) => {
      await ads.initAds('account-id');
      expect(bridge.initialize).not.toHaveBeenCalled();

      await setAdConsent(choice);
      expect(await ads.adGate()).toBe('ready');

      expect(bridge.initialize).toHaveBeenCalledTimes(1);
      expect(bridge.initialize).toHaveBeenCalledWith({
        appKey: expect.any(String),
        userId: 'account-id',
        personalized,
      });
    },
  );

  it('applique un refus reçu pendant l’initialisation avant d’autoriser les annonces', async () => {
    preferences.get.mockResolvedValue({ value: 'granted' });
    let finishInit!: () => void;
    bridge.initialize.mockReturnValue(new Promise<void>((resolve) => { finishInit = resolve; }));
    const gate = ads.adGate();
    await vi.waitFor(() => expect(bridge.initialize).toHaveBeenCalledOnce());

    await setAdConsent('refused');
    expect(ads.canShowAds()).toBe(false);
    finishInit();

    expect(await gate).toBe('ready');
    expect(bridge.setConsent).toHaveBeenCalledExactlyOnceWith({ personalized: false });
  });

  it('bloque les annonces si le SDK ne peut pas appliquer le nouveau choix', async () => {
    preferences.get.mockResolvedValue({ value: 'granted' });
    expect(await ads.adGate()).toBe('ready');
    bridge.setConsent.mockRejectedValue(new Error('native error'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await setAdConsent('refused');
      expect(await ads.adGate()).toBe('unavailable');
      expect(ads.canShowAds()).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });

  it('ne touche pas au SDK sur le web', async () => {
    native.mockReturnValue(false);
    await ads.initAds();
    expect(await ads.adGate()).toBe('unavailable');
    expect(bridge.initialize).not.toHaveBeenCalled();
  });
});
