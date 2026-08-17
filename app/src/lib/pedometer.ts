import { Capacitor } from '@capacitor/core';
import { CapacitorPedometer } from '@capgo/capacitor-pedometer';
import { Preferences } from '@capacitor/preferences';
import { dateStr } from './coins';

/**
 * Service de comptage de pas — capteur système Android (TYPE_STEP_COUNTER),
 * permission "Activité physique" (ACTIVITY_RECOGNITION). Pas de Health Connect.
 *
 * Le capteur fournit un cumul : on persiste la dernière valeur vue et le total
 * du jour dans les Preferences pour survivre aux fermetures de l'app.
 */

const KEY_DATE = 'elywalk.steps.date';
const KEY_TODAY = 'elywalk.steps.today';
const KEY_LAST_SENSOR = 'elywalk.steps.lastSensor';

type Listener = (todaySteps: number) => void;

class PedometerService {
  private todaySteps = 0;
  private today = dateStr();
  private lastSensor: number | null = null;
  private listeners = new Set<Listener>();
  private started = false;
  private loaded = false;

  isNative(): boolean {
    return Capacitor.isNativePlatform();
  }

  async loadPersisted(): Promise<number> {
    if (this.loaded) return this.todaySteps;
    const [d, t, ls] = await Promise.all([
      Preferences.get({ key: KEY_DATE }),
      Preferences.get({ key: KEY_TODAY }),
      Preferences.get({ key: KEY_LAST_SENSOR }),
    ]);
    const storedDate = d.value;
    if (storedDate === dateStr()) {
      this.todaySteps = Number(t.value || 0) || 0;
    } else {
      this.todaySteps = 0;
    }
    this.today = dateStr();
    this.lastSensor = ls.value != null && ls.value !== '' ? Number(ls.value) : null;
    this.loaded = true;
    return this.todaySteps;
  }

  private async persist(): Promise<void> {
    await Promise.all([
      Preferences.set({ key: KEY_DATE, value: this.today }),
      Preferences.set({ key: KEY_TODAY, value: String(this.todaySteps) }),
      Preferences.set({
        key: KEY_LAST_SENSOR,
        value: this.lastSensor == null ? '' : String(this.lastSensor),
      }),
    ]);
  }

  async checkPermission(): Promise<'granted' | 'denied' | 'prompt'> {
    if (!this.isNative()) return 'denied';
    try {
      const st = await CapacitorPedometer.checkPermissions();
      const v = st.activityRecognition || 'prompt';
      if (v === 'granted') return 'granted';
      if (v === 'denied') return 'denied';
      return 'prompt';
    } catch {
      return 'denied';
    }
  }

  async requestPermission(): Promise<boolean> {
    if (!this.isNative()) return false;
    try {
      const st = await CapacitorPedometer.requestPermissions();
      return st.activityRecognition === 'granted';
    } catch {
      return false;
    }
  }

  /** Démarre l'écoute du capteur (permission déjà accordée). */
  async start(): Promise<void> {
    if (!this.isNative() || this.started) return;
    await this.loadPersisted();
    try {
      const avail = await CapacitorPedometer.isAvailable();
      if (!avail.stepCounting) return;
      await CapacitorPedometer.addListener('measurement', (m) => {
        this.onMeasurement(m.numberOfSteps);
      });
      await CapacitorPedometer.startMeasurementUpdates();
      this.started = true;
    } catch (e) {
      console.warn('[Pedometer] start error', e);
    }
  }

  private onMeasurement(sensorValue?: number): void {
    if (sensorValue == null || Number.isNaN(sensorValue)) return;
    this.rolloverIfNeeded();
    if (this.lastSensor == null || sensorValue < this.lastSensor) {
      // Première mesure ou capteur réinitialisé (redémarrage appareil).
      this.lastSensor = sensorValue;
      this.persist();
      this.notify();
      return;
    }
    const delta = sensorValue - this.lastSensor;
    this.lastSensor = sensorValue;
    if (delta > 0) {
      this.todaySteps += delta;
    }
    this.persist();
    this.notify();
  }

  private rolloverIfNeeded(): void {
    const now = dateStr();
    if (now !== this.today) {
      this.today = now;
      this.todaySteps = 0;
    }
  }

  getTodaySteps(): number {
    this.rolloverIfNeeded();
    return this.todaySteps;
  }

  /** Remet le compteur du jour à zéro (après validation des pas). */
  async resetToday(): Promise<void> {
    this.todaySteps = 0;
    await this.persist();
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
