import { describe, expect, it } from 'vitest';
import { distanceToRoute, routeStats } from './routes';
import type { ActivityPoint } from './types';
const point = (lat: number, lng: number, altitude?: number): ActivityPoint => ({ lat, lng, altitude, recordedAt: 0 });
describe('parcours enregistrés', () => {
  it('calcule distance et dénivelés en ignorant le bruit altimétrique', () => {
    const stats = routeStats([point(48.8566, 2.3522, 30), point(48.8576, 2.3522, 40), point(48.8586, 2.3522, 35), point(48.8587, 2.3522, 36)]);
    expect(stats.distanceM).toBeGreaterThan(200);
    expect(stats.distanceM).toBeLessThan(250);
    expect(stats.elevationGainM).toBe(10);
    expect(stats.elevationLossM).toBe(5);
  });
  it('mesure l’écart au tracé sans exposer la position', () => {
    expect(distanceToRoute(point(48.8566, 2.3522), [point(48.8566, 2.3522)])).toBe(0);
    expect(distanceToRoute(point(48.8566, 2.3522), [])).toBe(Infinity);
  });
});
