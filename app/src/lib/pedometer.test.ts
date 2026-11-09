import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  addListener: vi.fn(),
  start: vi.fn(),
  requestBatteryExemption: vi.fn(),
  getTodaySteps: vi.fn(),
}));
const appListener = vi.hoisted(() => vi.fn());

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => ({
    addListener: native.addListener,
    start: native.start,
    requestBatteryExemption: native.requestBatteryExemption,
    getTodaySteps: native.getTodaySteps,
  }),
}));
vi.mock('@capacitor/app', () => ({ App: { addListener: appListener } }));

async function loadPedometer() {
  vi.resetModules();
  return (await import('./pedometer')).pedometer;
}

describe('pedometer — démarrage après restauration de session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    native.addListener.mockResolvedValue({ remove: vi.fn() });
    native.start.mockResolvedValue({ todaySteps: 12 });
    native.requestBatteryExemption.mockResolvedValue(undefined);
    appListener.mockResolvedValue({ remove: vi.fn() });
  });

  it('partage une seule initialisation entre Shell et HomePage', async () => {
    const pedometer = await loadPedometer();
    let release!: (value: { todaySteps: number }) => void;
    native.start.mockReturnValue(new Promise<{ todaySteps: number }>((resolve) => { release = resolve; }));

    const fromShell = pedometer.start();
    const fromHome = pedometer.start();
    await Promise.resolve();
    release({ todaySteps: 12 });
    await Promise.all([fromShell, fromHome]);

    expect(native.addListener).toHaveBeenCalledTimes(1);
    expect(native.start).toHaveBeenCalledTimes(1);
    expect(appListener).toHaveBeenCalledTimes(1);
    expect(pedometer.getTodaySteps()).toBe(12);
  });

  it('absorbe un refus Android et permet une nouvelle tentative', async () => {
    const pedometer = await loadPedometer();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    native.start.mockRejectedValueOnce(new Error('Foreground service refusé'));

    await expect(pedometer.start()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();

    await pedometer.start();
    expect(native.start).toHaveBeenCalledTimes(2);
    expect(pedometer.getTodaySteps()).toBe(12);
  });
});
