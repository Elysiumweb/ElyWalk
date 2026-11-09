import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  addListener: vi.fn(),
  requestBatteryExemption: vi.fn(),
  appListener: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => ({ start: mocks.start, addListener: mocks.addListener, requestBatteryExemption: mocks.requestBatteryExemption }),
}));
vi.mock('@capacitor/app', () => ({ App: { addListener: mocks.appListener } }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.addListener.mockResolvedValue({ remove: vi.fn() });
  mocks.requestBatteryExemption.mockResolvedValue(undefined);
  mocks.appListener.mockResolvedValue({ remove: vi.fn() });
});

describe('démarrage du compteur', () => {
  it('regroupe les demandes simultanées', async () => {
    mocks.start.mockResolvedValue({ todaySteps: 123 });
    const { pedometer } = await import('./pedometer');
    expect(await Promise.all([pedometer.start(), pedometer.start()])).toEqual([true, true]);
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(pedometer.getTodaySteps()).toBe(123);
  });

  it('signale un échec natif et autorise une nouvelle tentative', async () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      mocks.start.mockRejectedValueOnce(new Error('service refusé')).mockResolvedValueOnce({ todaySteps: 7 });
      const { pedometer } = await import('./pedometer');
      expect(await pedometer.start()).toBe(false);
      expect(await pedometer.start()).toBe(true);
      expect(mocks.start).toHaveBeenCalledTimes(2);
    } finally { log.mockRestore(); }
  });
});
