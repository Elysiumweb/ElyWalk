import { Capacitor, registerPlugin } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';

/**
 * Service de comptage de pas.
 *
 * Sur Android, un service natif de premier plan (StepCounterService)
 * écoute TYPE_STEP_COUNTER même lorsque l'application est fermée.
 * Les totaux sont persistés en SharedPreferences côté natif.
 * Ce module n'est qu'un pont JS vers ce service.
 */

interface NativeStepCounterPlugin {
  start(): Promise<{ todaySteps: number }>;
  getTodaySteps(): Promise<{ todaySteps: number }>;
  resetToday(): Promise<{ todaySteps: number }>;
  checkPermission(): Promise<{ status: 'granted' | 'denied' | 'prompt' }>;
  requestPermission(): Promise<{ status: 'granted' | 'denied' | 'prompt' }>;
  requestBatteryExemption(): Promise<void>;
  addListener(
    eventName: 'steps',
    listenerFunc: (data: { todaySteps: number }) => void
  ): Promise<{ remove: () => void }>;
}

const Native = registerPlugin<NativeStepCounterPlugin>('StepCounter');

type Listener = (todaySteps: number) => void;

class PedometerService {
  private todaySteps = 0;
  private listeners = new Set<Listener>();
  private started = false;
  private nativeHandle: { remove: () => void } | null = null;
  private appHandle: { remove: () => void } | null = null;

  isNative(): boolean {
    return Capacitor.isNativePlatform();
  }

  async loadPersisted(): Promise<number> {
    if (!this.isNative()) return this.todaySteps;
    try {
      const r = await Native.getTodaySteps();
      this.todaySteps = Number(r.todaySteps) || 0;
      this.notify();
    } catch {
      // Plugin absent (web / preview).
    }
    return this.todaySteps;
  }

  async checkPermission(): Promise<'granted' | 'denied' | 'prompt'> {
    if (!this.isNative()) return 'denied';
    try {
      const r = await Native.checkPermission();
      return r.status || 'prompt';
    } catch {
      return 'denied';
    }
  }

  async requestPermission(): Promise<boolean> {
    if (!this.isNative()) return false;
    try {
      const r = await Native.requestPermission();
      return r.status === 'granted';
    } catch {
      return false;
    }
  }

  /** Démarre le service natif (permission déjà accordée). */
  async start(): Promise<void> {
    if (!this.isNative() || this.started) return;
    try {
      if (!this.nativeHandle) {
        this.nativeHandle = await Native.addListener('steps', (d) => {
          this.todaySteps = Number(d.todaySteps) || 0;
          this.notify();
        });
      }
      const r = await Native.start();
      this.todaySteps = Number(r.todaySteps) || 0;
      this.started = true;
      this.notify();
      Native.requestBatteryExemption().catch(() => undefined);
      if (!this.appHandle) {
        this.appHandle = await CapApp.addListener('appStateChange', ({ isActive }) => {
          if (isActive) this.loadPersisted();
        });
      }
    } catch (e) {
      console.warn('[Pedometer] start error', e);
    }
  }

  getTodaySteps(): number {
    return this.todaySteps;
  }

  /** Remet le compteur du jour à zéro (après validation des pas). */
  async resetToday(): Promise<void> {
    if (this.isNative()) {
      try {
        await Native.resetToday();
      } catch {
        // ignore
      }
    }
    this.todaySteps = 0;
    this.notify();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn(this.todaySteps);
  }
}

export const pedometer = new PedometerService();
