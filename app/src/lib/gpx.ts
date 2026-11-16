/**
 * A12.2 — Import d'un fichier GPX comme sortie ElyWalk.
 *
 * Pourquoi un analyseur maison plutôt que `DOMParser` : la logique doit rester
 * testable hors navigateur (Vitest tourne en Node pour la plupart des suites) et
 * un GPX est un document très simple. On reste donc sur des expressions
 * régulières bornées, avec des limites explicites (taille du fichier, nombre de
 * points) pour qu'un fichier hostile ne puisse pas figer l'application.
 *
 * Les écarts temporels aberrants (arrêt de l'enregistreur, GPS qui décroche)
 * sont plafonnés à `MAX_POINT_GAP_SEC` : sans cela, une sortie de 3 km pouvait
 * afficher plusieurs heures de durée et une allure ridicule.
 */
import { distanceBetween, elevationGainM } from './activity';
import { caloriesForSteps } from './coins';
import type { ActivityPoint, ActivityType, HealthProfile } from './types';

/** Taille maximale lue depuis le disque (5 Mo : une trace de plusieurs jours). */
export const MAX_GPX_FILE_BYTES = 5 * 1024 * 1024;
/** Au-delà, la trace est acceptée mais échantillonnée : la carte reste fluide. */
export const MAX_GPX_POINTS = 20_000;
/** Écart maximal retenu entre deux points pour le calcul de durée. */
export const MAX_POINT_GAP_SEC = 120;
/** Longueur de foulée par défaut, comme le reste de l'application. */
const DEFAULT_STRIDE_CM = 75;

export interface GpxPoint {
  lat: number;
  lng: number;
  altitude?: number;
  recordedAt?: number;
}

export interface GpxTrack {
  name: string;
  points: GpxPoint[];
}

export interface ImportedActivity {
  name: string;
  type: ActivityType;
  points: ActivityPoint[];
  distanceM: number;
  durationSec: number;
  calories: number;
  steps: number;
  startedAt: number;
  elevationGainM: number;
}

/** Message d'erreur lisible, ou `null` si le document est exploitable. */
export function gpxImportError(xml: string): string | null {
  if (!xml || !xml.trim()) return 'Le fichier est vide.';
  if (xml.length > MAX_GPX_FILE_BYTES) return 'Fichier trop volumineux (5 Mo maximum).';
  if (!/<gpx[\s>]/i.test(xml)) return 'Ce fichier n’est pas un GPX.';
  if (!/<(trkpt|rtept)\b/i.test(xml)) return 'Aucun point de trace dans ce fichier.';
  return null;
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag);
  return m ? m[1] : null;
}

function numberTag(body: string, name: string): number | null {
  const m = new RegExp(`<${name}>\\s*([-+\\d.eE]+)\\s*</${name}>`, 'i').exec(body);
  if (!m) return null;
  const value = Number(m[1]);
  return Number.isFinite(value) ? value : null;
}

function timeTag(body: string): number | null {
  const m = /<time>\s*([^<]+?)\s*<\/time>/i.exec(body);
  if (!m) return null;
  const ms = Date.parse(m[1]);
  return Number.isFinite(ms) ? ms : null;
}

function pointFromTag(tag: string, body: string): GpxPoint | null {
  const lat = Number(attr(tag, 'lat'));
  const lng = Number(attr(tag, 'lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const ele = numberTag(body, 'ele');
  const at = timeTag(body);
  return {
    lat,
    lng,
    ...(ele != null ? { altitude: ele } : {}),
    ...(at != null ? { recordedAt: at } : {}),
  };
}

function trackName(xml: string, from: number, to: number): string {
  const block = xml.slice(from, to);
  const trk = /<trk>([\s\S]*?)(?:<trkseg>|<\/trk>)/i.exec(block);
  const scope = trk ? trk[1] : block;
  const m = /<name>\s*([^<]{1,120})\s*<\/name>/i.exec(scope);
  return m ? m[1].trim() : '';
}

/**
 * Analyse un GPX 1.0/1.1. Les pistes (`<trk>`) sont conservées séparément ; un
 * fichier sans piste mais avec un itinéraire (`<rtept>`) est lu comme une seule
 * piste. Les points invalides sont ignorés en silence (fichiers réels abîmés).
 */
export function parseGpx(xml: string): GpxTrack[] {
  const tracks: GpxTrack[] = [];
  const trkBlocks = [...xml.matchAll(/<trk\b[^>]*>([\s\S]*?)<\/trk>/gi)];
  for (const block of trkBlocks) {
    const body = block[1];
    const start = (block.index ?? 0) + block[0].indexOf(body);
    const name = trackName(xml, start, start + body.length);
    const points: GpxPoint[] = [];
    // Deux formes réelles : `<trkpt …>…</trkpt>` et la forme vide `<trkpt … />`
    // (fréquente dans les exports OSM et Garmin simplifiés).
    for (const pt of body.matchAll(/<trkpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/trkpt>)/gi)) {
      const parsed = pointFromTag(pt[1], pt[2] || '');
      if (parsed) points.push(parsed);
    }
    if (points.length > 0) tracks.push({ name, points });
  }

  if (tracks.length === 0) {
    const points: GpxPoint[] = [];
    for (const pt of xml.matchAll(/<rtept\b([^>]*?)(?:\/>|>([\s\S]*?)<\/rtept>)/gi)) {
      const parsed = pointFromTag(pt[1], pt[2] || '');
      if (parsed) points.push(parsed);
    }
    if (points.length > 0) tracks.push({ name: '', points });
  }
  return tracks;
}

/** Réduction régulière d'une trace trop longue (garde le premier et le dernier). */
function thin<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const step = Math.ceil(items.length / max);
  const out: T[] = [];
  for (let i = 0; i < items.length; i += step) out.push(items[i]);
  if (out[out.length - 1] !== items[items.length - 1]) out.push(items[items.length - 1]);
  return out;
}

/**
 * Convertit une piste en sortie prête à enregistrer : distance cumulée, durée
 * (somme des écarts plafonnés), pas estimés depuis la foulée et calories.
 */
export function buildImportedActivity(
  track: GpxTrack,
  options: {
    type?: ActivityType;
    strideCm?: number;
    health?: HealthProfile;
    /** Date de départ à utiliser si la trace ne porte pas d'horodatage. */
    fallbackStart?: number;
  } = {},
): ImportedActivity | null {
  const raw = track.points;
  if (raw.length < 2) return null;

  const kept = thin(raw, MAX_GPX_POINTS);
  let distanceM = 0;
  for (let i = 1; i < kept.length; i++) distanceM += distanceBetween(kept[i - 1], kept[i]);

  const timed = kept.every((p) => typeof p.recordedAt === 'number');
  let durationSec = 0;
  if (timed) {
    for (let i = 1; i < kept.length; i++) {
      const delta = ((kept[i].recordedAt as number) - (kept[i - 1].recordedAt as number)) / 1000;
      if (delta > 0) durationSec += Math.min(delta, MAX_POINT_GAP_SEC);
    }
  }
  if (!timed || durationSec <= 0) {
    // 5 km/h : l'allure de marche retenue partout ailleurs dans l'application.
    durationSec = Math.round(distanceM / (5000 / 3600));
  }

  const strideCm = Math.max(30, Math.min(150, options.strideCm || DEFAULT_STRIDE_CM));
  const steps = Math.round(distanceM / (strideCm / 100));
  const type = options.type ?? 'walk';
  const calories = caloriesForSteps(steps, options.health, strideCm);

  // Horodatage de départ : première marque de temps fiable, sinon la date de
  // dépôt du fichier. `recordedAt` reste aligné sur ce départ pour que la carte
  // et l'historique racontent la même chose.
  const startedAt = timed ? (kept[0].recordedAt as number) : options.fallbackStart || Date.now();
  const base = timed ? (kept[0].recordedAt as number) : startedAt;
  const normalised: ActivityPoint[] = kept.map((p, index) => ({
    lat: p.lat,
    lng: p.lng,
    recordedAt: timed ? (p.recordedAt as number) : base + Math.round((index / Math.max(1, kept.length - 1)) * durationSec * 1000),
    ...(p.altitude != null ? { altitude: p.altitude } : {}),
    // Un fichier importé n'a pas de précision mesurée : on ne prétend pas le
    // contraire, la qualité GPS restera « inconnue » sur la fiche.
  }));

  return {
    name: track.name || 'Sortie importée',
    type,
    points: normalised,
    distanceM: Math.round(distanceM),
    durationSec: Math.round(durationSec),
    calories,
    steps,
    startedAt,
    elevationGainM: elevationGainM(normalised),
  };
}
