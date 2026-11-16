import type { ActivityPoint, ActivitySession, DailySteps } from './types';
import { dateStr } from './coins';

/**
 * Records personnels (A12.1).
 *
 * Constat : aucun calcul de record n'existait (`personalBest` : 0 occurrence).
 * L'écran Progression n'affichait donc que des totaux, jamais la meilleure
 * performance — ce qui prive le marcheur régulier du repère le plus motivant.
 *
 * Quatre records sont suivis :
 *  - meilleur **1 km** et meilleur **5 km** (temps sur la fenêtre glissante la
 *    plus rapide d'une sortie) ;
 *  - **plus longue sortie** (distance) ;
 *  - **meilleure semaine** (pas validés, du lundi au dimanche).
 *
 * Les calculs sont purs : la position et le temps viennent du tracé GPS et des
 * pas déjà validés, aucune donnée n'est envoyée à un service tiers.
 */

export interface PersonalRecords {
  /** Meilleur temps (s) sur 1 km, `null` si aucune sortie assez longue. */
  best1kmSec: number | null;
  /** Meilleur temps (s) sur 5 km, `null` si aucune sortie assez longue. */
  best5kmSec: number | null;
  /** Plus longue sortie (m). */
  longestDistanceM: number;
  /** Meilleure semaine en pas validés. */
  bestWeekSteps: number;
  /** Lundi de cette meilleure semaine (`YYYY-MM-DD`). */
  bestWeekStart: string | null;
  updatedAt: number;
}

export const EMPTY_RECORDS: PersonalRecords = {
  best1kmSec: null,
  best5kmSec: null,
  longestDistanceM: 0,
  bestWeekSteps: 0,
  bestWeekStart: null,
  updatedAt: 0,
};

/** Distance cumulée (m) le long d'un tracé, avec haversine. */
function cumulative(points: ActivityPoint[]): { distances: number[]; total: number } {
  const distances = [0];
  let total = 0;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    total += 2 * 6_371_000 * Math.asin(Math.sqrt(h));
    distances.push(total);
  }
  return { distances, total };
}

/**
 * Fenêtre glissante la plus rapide pour couvrir `meters`.
 *
 * Deux curseurs avancent sur les points : dès que l'écart de distance atteint
 * l'objectif, on mesure le temps écoulé. Les points sans horodatage exploitable
 * (`recordedAt` ≤ 0) sont ignorés — sinon un GPX importé sans heure donnerait
 * un record impossible.
 */
export function bestWindowSec(
  points: ActivityPoint[],
  meters: number,
  session?: Pick<ActivitySession, 'startedAt' | 'durationSec'>,
): number | null {
  if (!Number.isFinite(meters) || meters <= 0) return null;
  const usable = (points || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (usable.length < 2) return null;
  const { distances, total } = cumulative(usable);
  if (total < meters) return null;

  // Horodatages : `recordedAt` des points ; à défaut, interpolation linéaire
  // sur la durée totale (un GPX sans heures reste comparable à lui-même).
  const stamps = usable.map((point, index) => {
    if (Number.isFinite(point.recordedAt) && point.recordedAt > 1_000_000) return point.recordedAt;
    if (session && total > 0) {
      return (session.startedAt || 0) + (distances[index] / total) * (session.durationSec || 0) * 1000;
    }
    return Number.NaN;
  });
  if (stamps.every((value) => !Number.isFinite(value))) return null;

  let best: number | null = null;
  let start = 0;
  for (let end = 1; end < usable.length; end += 1) {
    while (start < end && distances[end] - distances[start + 1] >= meters) start += 1;
    if (distances[end] - distances[start] < meters) continue;
    const elapsed = (stamps[end] - stamps[start]) / 1000;
    if (!Number.isFinite(elapsed) || elapsed <= 0) continue;
    if (best == null || elapsed < best) best = elapsed;
  }
  return best == null ? null : Math.round(best);
}

/** Records d'une sortie (1 km et 5 km). */
export function sessionSplits(session: ActivitySession): { best1kmSec: number | null; best5kmSec: number | null } {
  return {
    best1kmSec: bestWindowSec(session.points || [], 1000, session),
    best5kmSec: bestWindowSec(session.points || [], 5000, session),
  };
}

/** Lundi de la semaine d'une date `YYYY-MM-DD`. */
export function mondayOf(date: string): string {
  const value = new Date(`${date}T00:00:00`);
  const offset = (value.getDay() + 6) % 7;
  value.setDate(value.getDate() - offset);
  return dateStr(value);
}

/** Meilleure semaine (pas validés) sur l'historique fourni. */
export function bestWeekFromDays(days: DailySteps[]): { steps: number; weekStart: string | null } {
  const byWeek = new Map<string, number>();
  for (const day of days) {
    if (!day?.date) continue;
    const week = mondayOf(day.date);
    byWeek.set(week, (byWeek.get(week) || 0) + Math.max(0, Math.floor(day.steps || 0)));
  }
  let bestSteps = 0;
  let bestWeek: string | null = null;
  for (const [week, steps] of byWeek) {
    if (steps > bestSteps) {
      bestSteps = steps;
      bestWeek = week;
    }
  }
  return { steps: bestSteps, weekStart: bestWeek };
}

/** Fusionne les records existants avec ceux d'une nouvelle sortie. */
export function mergeRecords(
  current: Partial<PersonalRecords> | null | undefined,
  update: {
    best1kmSec?: number | null;
    best5kmSec?: number | null;
    distanceM?: number;
    bestWeek?: { steps: number; weekStart: string | null };
  },
): PersonalRecords {
  const base: PersonalRecords = { ...EMPTY_RECORDS, ...(current || {}) };
  const faster = (previous: number | null, next: number | null | undefined) => {
    if (next == null || !Number.isFinite(next) || next <= 0) return previous;
    if (previous == null || !Number.isFinite(previous) || previous <= 0) return next;
    return Math.min(previous, next);
  };
  const week = update.bestWeek;
  const betterWeek = week && week.steps > (base.bestWeekSteps || 0)
    ? { steps: week.steps, weekStart: week.weekStart }
    : { steps: base.bestWeekSteps || 0, weekStart: base.bestWeekStart };
  return {
    best1kmSec: faster(base.best1kmSec, update.best1kmSec),
    best5kmSec: faster(base.best5kmSec, update.best5kmSec),
    longestDistanceM: Math.max(base.longestDistanceM || 0, Math.round(update.distanceM || 0)),
    bestWeekSteps: betterWeek.steps,
    bestWeekStart: betterWeek.weekStart,
    updatedAt: Date.now(),
  };
}

/** « 5 min 42 / km » ou « 4:12 » pour un temps sur une distance. */
export function formatPace(seconds: number | null, meters: number): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0 || meters <= 0) return '—';
  const perKm = seconds / (meters / 1000);
  const minutes = Math.floor(perKm / 60);
  const rest = Math.round(perKm % 60);
  return `${minutes}′${String(rest).padStart(2, '0')}″ /km`;
}

/** « 12 min 30 ». */
export function formatRecordTime(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '—';
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes} min ${String(rest).padStart(2, '0')} s`;
}
