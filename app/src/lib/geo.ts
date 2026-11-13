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

/**
 * Suivi **continu** de la position de l'appareil.
 *
 * `getCurrentPosition` ne renvoie qu'un point : la carte restait donc figée sur
 * la position du moment de l'ouverture (« on ne se voit pas bouger »).
 * `watchPosition` installe un vrai suivi :
 *
 * - navigateur : `navigator.geolocation.watchPosition` (mis à jour à chaque
 *   déplacement signalé par le système) ;
 * - application native : `@capacitor/geolocation` `watchPosition`, même
 *   mécanisme que l'enregistrement d'une sortie.
 *
 * La fonction renvoie immédiatement une fonction d'arrêt : aucun suivi ne
 * survit au démontage de l'écran (batterie) ni à la fermeture de la feuille.
 */
export interface PositionWatcher {
  /** Arrête le suivi et libère les ressources système. */
  stop: () => void;
}

export function watchPosition(
  onPosition: (coords: Coords) => void,
  onError?: (error: Error) => void,
  options: { highAccuracy?: boolean; intervalMs?: number } = {}
): PositionWatcher {
  const { highAccuracy = true, intervalMs = 4000 } = options;
  let stopped = false;
  let clear: (() => void) | null = null;

  const emit = (coords: Coords) => {
    if (stopped) return;
    if (!Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) return;
    onPosition(coords);
  };

  (async () => {
    if (Capacitor.isNativePlatform()) {
      const perm = await Geolocation.checkPermissions().catch(() => null);
      const granted = perm?.location === 'granted'
        ? true
        : (await Geolocation.requestPermissions().catch(() => null))?.location === 'granted';
      if (!granted) {
        onError?.(new Error('Autorisez la localisation pour vous suivre sur la carte.'));
        return;
      }
      if (stopped) return;
      const id = await Geolocation.watchPosition(
        { enableHighAccuracy: highAccuracy, timeout: 15000, maximumAge: 2000 },
        (pos, err) => {
          if (pos) emit({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
          else if (err) onError?.(new Error(err.message || 'Position indisponible.'));
        }
      ).catch((e) => {
        onError?.(e as Error);
        return null;
      });
      if (!id) return;
      clear = () => { void Geolocation.clearWatch({ id }).catch(() => undefined); };
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      onError?.(new Error('Géolocalisation indisponible sur cet appareil.'));
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => emit({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => onError?.(new Error(err.message || 'Position indisponible.')),
      // `maximumAge` court : sans cela, les navigateurs peuvent resservir une
      // position vieille de plusieurs minutes (carte figée).
      { enableHighAccuracy: highAccuracy, maximumAge: intervalMs, timeout: 20000 },
    );
    clear = () => navigator.geolocation.clearWatch(id);
  })().catch((e) => onError?.(e as Error));

  return {
    stop: () => {
      stopped = true;
      clear?.();
      clear = null;
    },
  };
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
