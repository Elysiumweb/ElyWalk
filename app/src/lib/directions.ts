/**
 * Itinéraires calculés dans l'application — sans redirection vers Google Maps.
 *
 * Fournisseurs (aucune clé API, aucun compte) :
 * - **OSRM** (serveur de démonstration OpenStreetMap) pour le tracé et la durée
 *   à pied / à vélo / en voiture. La géométrie est renvoyée en GeoJSON.
 * - **OpenTripPlanner** (instance publique d'Île-de-France Mobilités, jeu de
 *   données Transilien / RER / métro / bus) pour les transports en commun :
 *   marche jusqu'à l'arrêt, lignes, correspondances et durée.
 * - **Nominatim** (OpenStreetMap) pour l'adresse réelle et le géocodage d'une
 *   adresse saisie à la main.
 *
 * Chaque appel est borné dans le temps (`timeout`) : si un fournisseur ne
 * répond pas, l'interface reçoit une erreur lisible et propose le repli
 * « Afficher le trajet dans Maps ». Rien n'est mis en cache côté serveur : seuls
 * les index du module gardent en mémoire les réponses pour la session.
 */

import type { Coords } from './geo';

export type TravelMode = 'walk' | 'bike' | 'car' | 'transit';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RouteStep {
  /** Consigne lisible (« Tournez à droite sur… »). */
  instruction: string;
  distanceM: number;
  durationS: number;
  mode?: TravelMode;
  /** Ligne empruntée pour les transports (ex. « RER C »). */
  line?: string;
  /** Couleur officielle de la ligne, si connue. */
  color?: string;
  from?: string;
  to?: string;
}

export interface TransitLeg {
  mode: 'walk' | 'bus' | 'tram' | 'metro' | 'rail' | 'train' | 'transit';
  line?: string;
  color?: string;
  headsign?: string;
  from?: string;
  to?: string;
  distanceM: number;
  durationS: number;
}

export interface RoutePlan {
  mode: TravelMode;
  distanceM: number;
  durationS: number;
  /** Tracé à dessiner sur la carte (ordre du trajet). */
  geometry: LatLng[];
  steps: RouteStep[];
  /** Détail des correspondances (transports). */
  transitLegs?: TransitLeg[];
  /** Nom lisible du fournisseur, affiché sous le résultat. */
  provider: string;
  /** Adresse/poste d'arrivée résolu par le fournisseur. */
  resolvedDestination?: string;
}

export const TRAVEL_MODES: Array<{ id: TravelMode; label: string; short: string; icon: string }> = [
  { id: 'walk', label: 'À pied', short: 'Pied', icon: '🚶' },
  { id: 'bike', label: 'À vélo', short: 'Vélo', icon: '🚲' },
  { id: 'car', label: 'En voiture', short: 'Voiture', icon: '🚗' },
  { id: 'transit', label: 'Transports', short: 'Transports', icon: '🚇' },
];

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
const OSRM_URL = 'https://router.project-osrm.org';

async function fetchJson(url: string, timeoutMs = 12_000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Un `User-Agent` ne peut pas être imposé par `fetch` dans une WebView :
    // on identifie l'application par l'en-tête `X-Client`, autorisé par CORS
    // sur les services publics, et par l'origine HTTPS du site.
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'X-Client': 'ElyWalk/2.1.3' },
    });
    if (!res.ok) throw new Error(`Service indisponible (${res.status}).`);
    return await res.json();
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('Le service d’itinéraire ne répond pas. Réessayez.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Adresse postale réelle d'un point, via Nominatim (OpenStreetMap). */
export async function reverseGeocode(point: LatLng): Promise<string | null> {
  try {
    const data = await fetchJson(
      `${NOMINATIM_URL}/reverse?format=jsonv2&lat=${point.lat}&lon=${point.lng}&zoom=18&addressdetails=0`,
      8000
    );
    const label: string | undefined = data?.display_name;
    return label ? tidyAddress(label) : null;
  } catch {
    return null;
  }
}

/** Géocode une adresse saisie à la main. */
export async function geocodeAddress(query: string): Promise<{ lat: number; lng: number; label: string } | null> {
  const clean = query.trim();
  if (clean.length < 3) return null;
  const data = await fetchJson(
    `${NOMINATIM_URL}/search?format=jsonv2&limit=1&q=${encodeURIComponent(clean)}`,
    10_000
  );
  const first = Array.isArray(data) ? data[0] : null;
  if (!first) return null;
  return { lat: parseFloat(first.lat), lng: parseFloat(first.lon), label: first.display_name };
}

/** Raccourcit une adresse Nominatim pour l'affichage mobile. */
export function tidyAddress(label: string): string {
  const parts = label
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  // « 12, Rue de Rivoli, … » : le numéro seul n'apporte rien à l'affichage.
  if (parts.length > 1 && /^\d+[a-zA-Z]?$/.test(parts[0])) parts.shift();
  if (parts.length > 1 && /^france$/i.test(parts[parts.length - 1])) parts.pop();
  return parts.slice(0, 4).join(', ').trim();
}

/** Libellé court d'un point : adresse si connue, sinon coordonnées. */
export function pointLabel(point: LatLng | null, address?: string | null): string {
  if (address) return address;
  if (!point) return 'Point de départ';
  return `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`;
}

// ---------------------------------------------------------------------------
// OSRM — marche, vélo, voiture
// ---------------------------------------------------------------------------

const OSRM_PROFILES: Record<'walk' | 'bike' | 'car', string> = {
  walk: 'foot',
  bike: 'bike',
  car: 'driving',
};

interface OsrmStep {
  maneuver: { type: string; modifier?: string; location: [number, number] };
  name?: string;
  distance: number;
  duration: number;
  mode?: string;
}

const MANEUVER_FR: Record<string, string> = {
  depart: 'Départ',
  arrive: 'Vous êtes arrivé',
  turn: 'Tournez',
  'new name': 'Continuez',
  continue: 'Continuez',
  merge: 'Insérez-vous',
  'on ramp': 'Prenez la bretelle',
  'off ramp': 'Sortez',
  fork: 'À l’embranchement',
  roundabout: 'Au rond-point',
  rotary: 'Au rond-point',
  'roundabout turn': 'Au rond-point',
  'end of road': 'Au bout de la route',
  notification: 'Continuez',
  'use lane': 'Continuez',
};

const MODIFIER_FR: Record<string, string> = {
  left: 'à gauche',
  right: 'à droite',
  'slight left': 'légèrement à gauche',
  'slight right': 'légèrement à droite',
  'sharp left': 'franchement à gauche',
  'sharp right': 'franchement à droite',
  straight: 'tout droit',
  uturn: 'faites demi-tour',
};

function formatStep(step: OsrmStep): string {
  const type = step.maneuver?.type || 'continue';
  const modifier = step.maneuver?.modifier;
  const road = step.name ? ` sur ${step.name}` : '';
  if (type === 'depart') return step.name ? `Partez sur ${step.name}` : 'Partez tout droit';
  if (type === 'arrive') return 'Vous êtes arrivé à destination';
  if (type === 'roundabout' || type === 'rotary') {
    const exit = (step.maneuver as unknown as { exit?: number }).exit;
    return `Au rond-point${exit ? `, prenez la sortie ${exit}` : ''}${road}`;
  }
  const base = MANEUVER_FR[type] || 'Continuez';
  const dir = modifier ? MODIFIER_FR[modifier] : '';
  if (type === 'turn' && dir) return `Tournez ${dir}${road}`;
  if (dir) return `${base} ${dir}${road}`;
  return `${base}${road}`;
}

/**
 * Décode un tracé encodé « polyline ».
 * - OSRM (`geometries=polyline`) et OpenTripPlanner : précision 1e5.
 * - Transitous / MOTIS (v1) : précision 1e7.
 */
function decodePolyline(str: string, factor = 1e5): LatLng[] {
  let index = 0;
  let lat = 0;
  let lng = 0;
  const out: LatLng[] = [];
  while (index < str.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    out.push({ lat: lat / factor, lng: lng / factor });
  }
  return out;
}

/** Itinéraire via OSRM, avec consignes étape par étape. */
export async function routeWithOsrm(from: LatLng, to: LatLng, mode: 'walk' | 'bike' | 'car'): Promise<RoutePlan> {
  const profile = OSRM_PROFILES[mode];
  const url =
    `${OSRM_URL}/route/v1/${profile}/${from.lng},${from.lat};${to.lng},${to.lat}` +
    '?overview=full&geometries=polyline&steps=true&annotations=false';
  let data: any;
  try {
    data = await fetchJson(url);
  } catch {
    // Le serveur de démo refuse parfois le profil « foot » : repli sur le
    // moteur voiture pour au moins afficher un tracé, avec une vitesse de marche.
    if (mode !== 'walk') throw new Error('Itinéraire indisponible pour ce mode.');
    return routeWithCarFallbackWalking(from, to);
  }
  const route = data?.routes?.[0];
  if (!route) throw new Error('Aucun itinéraire trouvé entre ces deux points.');

  const geometry: LatLng[] = route.geometry ? decodePolyline(route.geometry) : [];
  const steps: RouteStep[] = [];
  for (const leg of route.legs || []) {
    for (const raw of (leg.steps || []) as OsrmStep[]) {
      if (!raw.distance && raw.maneuver?.type !== 'arrive') continue;
      steps.push({
        instruction: formatStep(raw),
        distanceM: Math.round(raw.distance || 0),
        durationS: Math.round(raw.duration || 0),
        mode,
      });
    }
  }

  return {
    mode,
    distanceM: Math.round(route.distance || 0),
    durationS: Math.round(route.duration || 0),
    geometry,
    steps,
    provider: 'OpenStreetMap · OSRM',
  };
}

async function routeWithCarFallbackWalking(from: LatLng, to: LatLng): Promise<RoutePlan> {
  const plan = await routeWithOsrm(from, to, 'car');
  // Vitesse de marche moyenne 4,8 km/h pour la durée annoncée.
  const walkSeconds = Math.round((plan.distanceM / 1000 / 4.8) * 3600);
  return {
    ...plan,
    mode: 'walk',
    durationS: walkSeconds,
    steps: plan.steps.map((s) => ({ ...s, mode: 'walk' as TravelMode })),
    provider: 'OpenStreetMap · OSRM (tracé routier)',
  };
}

// ---------------------------------------------------------------------------
// Transports en commun
// ---------------------------------------------------------------------------

/**
 * Deux fournisseurs, aucun compte requis :
 * 1. **OpenTripPlanner d'Île-de-France Mobilités** quand le trajet est francilien
 *    (horaires temps réel du réseau RATP / SNCF / Optile).
 * 2. **Transitous** (MOTIS, données ouvertes paneuropéennes) en repli, y compris
 *    hors Île-de-France. Crédité dans l'interface, conformément à ses conditions.
 */
const IDFM_OTP_URL = 'https://data.iledefrance-mobilites.fr/api/routers/default/plan';
const MOTIS_URL = 'https://api.transitous.org/api/v1/plan';

/** Emprise approximative de l'Île-de-France (départements 75, 77, 78, 91, 92, 93, 94, 95). */
export function inIleDeFrance(a: LatLng, b: LatLng): boolean {
  const inside = (p: LatLng) => p.lat >= 48.1 && p.lat <= 49.25 && p.lng >= 1.44 && p.lng <= 3.6;
  return inside(a) && inside(b);
}

/** Modes de marche rencontrés chez les fournisseurs (OTP, MOTIS). */
const WALK_MODES = new Set(['WALK', 'FOOT', 'PEDESTRIAN', 'WALKING']);

function isWalkMode(mode?: string): boolean {
  return WALK_MODES.has((mode || '').toUpperCase());
}

function formatTransitMode(mode?: string): TransitLeg['mode'] {
  if (isWalkMode(mode)) return 'walk';
  switch ((mode || '').toUpperCase()) {
    case 'BUS':
    case 'COACH':
    case 'REGIONAL_BUS':
    case 'LONG_DISTANCE_BUS':
      return 'bus';
    case 'TRAM':
      return 'tram';
    case 'SUBWAY':
    case 'METRO':
      return 'metro';
    case 'RAIL':
    case 'REGIONAL_RAIL':
    case 'HIGHSPEED_RAIL':
    case 'LONG_DISTANCE':
    case 'NIGHT_RAIL':
      return 'rail';
    case 'FERRY':
    case 'CABLE_CAR':
    case 'GONDOLA':
    case 'FUNICULAR':
      return 'transit';
    default:
      return 'transit';
  }
}

function secondsBetween(startRaw: unknown, endRaw: unknown): number {
  const start = typeof startRaw === 'string' ? Date.parse(startRaw) : Number(startRaw);
  const end = typeof endRaw === 'string' ? Date.parse(endRaw) : Number(endRaw);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 1000));
}

/** Libellé de ligne : « RER C », « Métro 1 », « Bus 38 »… */
function transitLineLabel(leg: {
  routeShortName?: string;
  routeLongName?: string;
  route?: string;
  mode?: string;
}): string {
  const short = leg.routeShortName || leg.route;
  if (short) return String(short);
  if (leg.routeLongName) return String(leg.routeLongName);
  return TRANSIT_MODE_LABEL[formatTransitMode(leg.mode)];
}

function normalizeColour(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const value = String(raw).trim();
  if (!value) return undefined;
  return value.startsWith('#') ? value : `#${value}`;
}

interface TransitLegInput {
  mode?: string;
  distance?: number;
  duration?: number;
  startTime?: string | number;
  endTime?: string | number;
  routeShortName?: string;
  routeLongName?: string;
  route?: string;
  routeColor?: string;
  headsign?: string;
  from?: { name?: string };
  to?: { name?: string };
  legGeometry?: { points?: string; precision?: number };
  geometry?: string;
}

/** Construit un itinéraire à partir de tronçons (format OTP ou MOTIS). */
function buildTransitPlan(legs: TransitLegInput[], provider: string): RoutePlan {
  const geometry: LatLng[] = [];
  const steps: RouteStep[] = [];
  const transitLegs: TransitLeg[] = [];
  let totalDistanceM = 0;

  for (const leg of legs) {
    const points = leg.legGeometry?.points || leg.geometry;
    if (points) geometry.push(...decodePolyline(points, leg.legGeometry?.precision === 7 ? 1e7 : 1e5));

    const distanceM = Math.round(leg.distance || 0);
    const durationS =
      typeof leg.duration === 'number' && Number.isFinite(leg.duration)
        ? Math.round(leg.duration)
        : secondsBetween(leg.startTime, leg.endTime);
    totalDistanceM += distanceM;

    const legMode = formatTransitMode(leg.mode);
    if (legMode === 'walk') {
      steps.push({
        instruction: `Marchez ${distanceM >= 1000 ? `${(distanceM / 1000).toFixed(1)} km` : `${distanceM} m`}${
          leg.to?.name ? ` jusqu’à ${leg.to.name}` : ''
        }`,
        distanceM,
        durationS,
        mode: 'walk',
        from: leg.from?.name,
        to: leg.to?.name,
      });
      transitLegs.push({ mode: 'walk', distanceM, durationS, from: leg.from?.name, to: leg.to?.name });
      continue;
    }

    const line = transitLineLabel(leg);
    const colour = normalizeColour(leg.routeColor);
    const headsign = leg.headsign;
    steps.push({
      instruction: `Prenez ${line}${headsign ? ` direction ${headsign}` : ''}${
        leg.from?.name ? ` à ${leg.from.name}` : ''
      }${leg.to?.name ? ` → ${leg.to.name}` : ''}`,
      distanceM,
      durationS,
      mode: 'transit',
      line,
      color: colour,
      from: leg.from?.name,
      to: leg.to?.name,
    });
    transitLegs.push({
      mode: legMode,
      line,
      color: colour,
      headsign,
      from: leg.from?.name,
      to: leg.to?.name,
      distanceM,
      durationS,
    });
  }

  return {
    mode: 'transit',
    distanceM: totalDistanceM,
    durationS: steps.reduce((sum, step) => sum + step.durationS, 0),
    geometry: dedupe(geometry),
    steps,
    transitLegs,
    provider,
  };
}

/** Normalise une réponse OpenTripPlanner (plan.itineraries[0]). */
export function parseOtpPlan(data: any, provider = 'Île-de-France Mobilités'): RoutePlan | null {
  const itinerary = data?.plan?.itineraries?.[0];
  if (!itinerary || !Array.isArray(itinerary.legs) || itinerary.legs.length === 0) return null;
  const plan = buildTransitPlan(itinerary.legs as TransitLegInput[], provider);
  return { ...plan, durationS: Math.round(itinerary.duration || plan.durationS) };
}

/** Normalise une réponse Transitous / MOTIS (itineraries[0].legs). */
export function parseMotisPlan(data: any, provider = 'Transitous · données ouvertes'): RoutePlan | null {
  const itineraries = data?.itineraries;
  if (!Array.isArray(itineraries)) return null;
  // Le premier itinéraire peut être un simple trajet à pied : on privilégie
  // celui qui contient au moins un tronçon en transport.
  const withTransit = itineraries.find((it: any) =>
    Array.isArray(it?.legs) && it.legs.some((leg: TransitLegInput) => formatTransitMode(leg.mode) !== 'walk')
  );
  const itinerary = withTransit || itineraries[0];
  if (!itinerary || !Array.isArray(itinerary.legs) || itinerary.legs.length === 0) return null;
  const plan = buildTransitPlan(itinerary.legs as TransitLegInput[], provider);
  return { ...plan, durationS: Math.round(itinerary.duration || plan.durationS) };
}

function formatLocalDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  // Format ISO local sans fuseau : OTP et MOTIS interprètent l'heure dans le
  // fuseau du réseau (Europe/Paris pour un trajet francilien).
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}:00`;
}

async function otpTransit(from: LatLng, to: LatLng, date: Date): Promise<RoutePlan> {
  const params = new URLSearchParams({
    fromPlace: `${from.lat},${from.lng}`,
    toPlace: `${to.lat},${to.lng}`,
    mode: 'WALK,TRANSIT',
    numItineraries: '3',
    date: formatLocalDateTime(date).slice(0, 10),
    time: formatLocalDateTime(date).slice(11, 16),
  });
  const data = await fetchJson(`${IDFM_OTP_URL}?${params.toString()}`, 12_000);
  const plan = parseOtpPlan(data);
  if (!plan) throw new Error('Aucun itinéraire en transports trouvé.');
  return plan;
}

async function motisTransit(from: LatLng, to: LatLng, date: Date): Promise<RoutePlan> {
  const params = new URLSearchParams({
    fromPlace: `${from.lat},${from.lng}`,
    toPlace: `${to.lat},${to.lng}`,
    time: date.toISOString(),
    numItineraries: '3',
    directModes: 'WALK',
  });
  const data = await fetchJson(`${MOTIS_URL}?${params.toString()}`, 15_000);
  const plan = parseMotisPlan(data);
  if (!plan) throw new Error('Aucun itinéraire en transports trouvé.');
  return plan;
}

/**
 * Itinéraire en transports en commun. Île-de-France Mobilités d'abord pour un
 * trajet francilien (temps réel), puis Transitous (couverture européenne).
 */
export async function routeWithTransit(from: LatLng, to: LatLng, date = new Date()): Promise<RoutePlan> {
  if (inIleDeFrance(from, to)) {
    try {
      return await otpTransit(from, to, date);
    } catch {
      /* repli silencieux sur Transitous */
    }
  }
  try {
    return await motisTransit(from, to, date);
  } catch (e) {
    throw new Error(
      (e as Error).message || 'Transports indisponibles. Essayez un autre mode de déplacement.'
    );
  }
}

function dedupe(points: LatLng[]): LatLng[] {
  const out: LatLng[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.lat - p.lat) > 1e-7 || Math.abs(last.lng - p.lng) > 1e-7) out.push(p);
  }
  return out;
}

/** Durée « 12 min », « 1 h 05 ». */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const total = Math.round(seconds / 60);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

/** Distance « 450 m », « 3,2 km ». */
export function formatRouteDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return '—';
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
}

/** Itinéraire pour le mode demandé ; bascule automatique si le tracé echoue. */
export async function planRoute(from: LatLng, to: LatLng, mode: TravelMode): Promise<RoutePlan> {
  if (mode === 'transit') return routeWithTransit(from, to);
  return routeWithOsrm(from, to, mode);
}

/** Lien de repli (uniquement sur action explicite de l'utilisateur). */
export function externalMapsUrl(to: LatLng, mode: TravelMode, from?: LatLng | null): string {
  const travelmode = mode === 'transit' ? 'transit' : mode === 'bike' ? 'bicycling' : mode === 'car' ? 'driving' : 'walking';
  const origin = from ? `&origin=${from.lat},${from.lng}` : '';
  return `https://www.google.com/maps/dir/?api=1${origin}&destination=${to.lat},${to.lng}&travelmode=${travelmode}`;
}

export const TRANSIT_MODE_LABEL: Record<TransitLeg['mode'], string> = {
  walk: 'Marche',
  bus: 'Bus',
  tram: 'Tram',
  metro: 'Métro',
  rail: 'RER / Train',
  train: 'Train',
  transit: 'Transport',
};
