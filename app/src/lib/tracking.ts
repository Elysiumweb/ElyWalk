import { Capacitor, registerPlugin } from '@capacitor/core';
import type { ActivityPoint, ActivityType } from './types';

/**
 * Pont JS vers le service natif de sortie GPS (TrackingService).
 *
 * Sur Android, un service de premier plan de type "location" enregistre
 * le parcours même lorsque l'application est fermée. Ce module expose
 * le démarrage, l'arrêt et la récupération de la trace.
 */

export interface TrackingSnapshot {
  running: boolean;
  type: ActivityType;
  startedAt: number;
  distanceM: number;
  durationSec: number;
  points: ActivityPoint[];
  pointCount?: number;
}

interface TrackingPlugin {
  start(opts: { type: ActivityType }): Promise<TrackingSnapshot>;
  stop(): Promise<TrackingSnapshot>;
  getSnapshot(): Promise<TrackingSnapshot>;
  isTracking(): Promise<{ running: boolean }>;
  addListener(eventName: 'track', listener: (s: TrackingSnapshot) => void): Promise<{ remove: () => void }>;
}

const Tracking = registerPlugin<TrackingPlugin>('Tracking', {
  // Aucune implémentation web : le suivi en arrière-plan est natif.
  web: {
    start: async () => ({ running: false, type: 'walk', startedAt: 0, distanceM: 0, durationSec: 0, points: [] }),
    stop: async () => ({ running: false, type: 'walk', startedAt: 0, distanceM: 0, durationSec: 0, points: [] }),
    getSnapshot: async () => ({ running: false, type: 'walk', startedAt: 0, distanceM: 0, durationSec: 0, points: [] }),
    isTracking: async () => ({ running: false }),
    addListener: async () => ({ remove: () => undefined }),
  },
});

export function isTrackingSupported(): boolean {
  return Capacitor.isNativePlatform();
}

export const tracking = {
  supported: isTrackingSupported(),
  async start(type: ActivityType): Promise<TrackingSnapshot> {
    return Tracking.start({ type });
  },
  async stop(): Promise<TrackingSnapshot> {
    return Tracking.stop();
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
