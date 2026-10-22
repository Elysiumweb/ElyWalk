import { Capacitor, registerPlugin } from '@capacitor/core';
import type { ActivityPoint, ActivityType } from './types';

/**
 * Pont JS vers le service natif de sortie GPS (TrackingService).
 *
 * Sur Android, un service de premier plan de type "location" enregistre
 * le parcours même lorsque l'application est fermée. Ce module expose
 * le démarrage, la pause/reprise, le mode économie de batterie et la
 * récupération de la trace.
 */

export interface TrackingSnapshot {
  running: boolean;
  /** Vrai entre une pause et la reprise : le GPS est coupé, le chrono aussi. */
  paused: boolean;
  type: ActivityType;
  startedAt: number;
  distanceM: number;
  /** Durée active (pauses exclues) en secondes. */
  durationSec: number;
  /** Temps cumulé en pause, en secondes. */
  pausedSec: number;
  /** Précision du dernier point GPS (m), null si inconnue. */
  accuracyM: number | null;
  batterySaver: boolean;
  points: ActivityPoint[];
  pointCount?: number;
}

export interface TrackingOptions {
  type: ActivityType;
  /** Moins de points GPS (et précision moindre) pour préserver la batterie. */
  batterySaver?: boolean;
}

const EMPTY: TrackingSnapshot = {
  running: false,
  paused: false,
  type: 'walk',
  startedAt: 0,
  distanceM: 0,
  durationSec: 0,
  pausedSec: 0,
  accuracyM: null,
  batterySaver: false,
  points: [],
};

interface TrackingPlugin {
  start(opts: TrackingOptions): Promise<TrackingSnapshot>;
  stop(): Promise<TrackingSnapshot>;
  pause(): Promise<TrackingSnapshot>;
  resume(): Promise<TrackingSnapshot>;
  setBatterySaver(opts: { enabled: boolean }): Promise<TrackingSnapshot>;
  getSnapshot(): Promise<TrackingSnapshot>;
  isTracking(): Promise<{ running: boolean }>;
  addListener(eventName: 'track', listener: (s: TrackingSnapshot) => void): Promise<{ remove: () => void }>;
}

const Tracking = registerPlugin<TrackingPlugin>('Tracking', {
  // Aucune implémentation web : le suivi en arrière-plan est natif.
  web: {
    start: async () => ({ ...EMPTY }),
    stop: async () => ({ ...EMPTY }),
    pause: async () => ({ ...EMPTY }),
    resume: async () => ({ ...EMPTY }),
    setBatterySaver: async () => ({ ...EMPTY }),
    getSnapshot: async () => ({ ...EMPTY }),
    isTracking: async () => ({ running: false }),
    addListener: async () => ({ remove: () => undefined }),
  },
});

export function isTrackingSupported(): boolean {
  return Capacitor.isNativePlatform();
}

export const tracking = {
  supported: isTrackingSupported(),
  async start(type: ActivityType, batterySaver = false): Promise<TrackingSnapshot> {
    return Tracking.start({ type, batterySaver });
  },
  async stop(): Promise<TrackingSnapshot> {
    return Tracking.stop();
  },
  async pause(): Promise<TrackingSnapshot> {
    return Tracking.pause();
  },
  async resume(): Promise<TrackingSnapshot> {
    return Tracking.resume();
  },
  async setBatterySaver(enabled: boolean): Promise<TrackingSnapshot> {
    return Tracking.setBatterySaver({ enabled });
  },
  async getSnapshot(): Promise<TrackingSnapshot> {
    return Tracking.getSnapshot();
  },
  async isTracking(): Promise<boolean> {
    return (await Tracking.isTracking()).running;
  },
  addListener(listener: (s: TrackingSnapshot) => void): Promise<{ remove: () => void }> {
    return Tracking.addListener('track', listener);
  },
};
