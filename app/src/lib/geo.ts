import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';

export interface Coords {
  lat: number;
  lng: number;
  accuracy?: number;
}

/**
 * Position de l'appareil, en une seule fonction pour toute l'application.
 *
 * - Application native (Capacitor) : plugin `@capacitor/geolocation`, qui gère
 *   la permission système et les réglages Android.
 * - Navigateur : `navigator.geolocation`.
 *
 * `silent` renvoie `null` plutôt que de demander la permission (utilisé au
 * premier affichage de la carte, pour ne pas harceler l'utilisateur).
 */
export async function getCurrentPosition(options: { silent?: boolean; highAccuracy?: boolean; timeoutMs?: number } = {}): Promise<Coords | null> {
  const { silent = false, highAccuracy = true, timeoutMs = 12000 } = options;

  if (Capacitor.isNativePlatform()) {
    const perm = await Geolocation.checkPermissions().catch(() => null);
    if (!perm || perm.location !== 'granted') {
      if (silent) return null;
      const req = await Geolocation.requestPermissions().catch(() => null);
      if (!req || req.location !== 'granted') {
        throw new Error('Autorisez la localisation pour vous situer sur la carte.');
      }
    }
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: highAccuracy,
      timeout: timeoutMs,
      maximumAge: 30000,
    });
    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
    };
  }

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    throw new Error('Géolocalisation indisponible sur cet appareil.');
  }
  const pos = await new Promise<GeolocationPosition>((res, rej) =>
    navigator.geolocation.getCurrentPosition(res, rej, {
      enableHighAccuracy: highAccuracy,
      timeout: timeoutMs,
      maximumAge: 30000,
    })
  );
  return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
}

/** Distance à vol d'oiseau (mètres), formule de haversine. */
export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
