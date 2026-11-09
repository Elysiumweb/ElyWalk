import type {
  ActivityPoint,
  ActivitySession,
  ActivityType,
  ActivityWeather,
  DailySteps,
} from './types';

/**
 * Helpers purs autour des sorties GPS : calculs d'allure, qualité du signal,
 * objectifs, export GPX/CSV et synthèses hebdomadaires.
 *
 * Ce module ne dépend ni de Capacitor ni de Firestore : il est testable et
 * peut être utilisé aussi bien par l'écran de sortie que par l'historique.
 */

// ============ Clés de préférences locales ============

export const ACTIVE_SESSION_KEY = 'elywalk.activeSession';
export const ACTIVITY_GOAL_KEY = 'elywalk.activityGoalKm';
export const BATTERY_SAVER_KEY = 'elywalk.activityBatterySaver';
export const MAP_STYLE_KEY = 'elywalk.shareMapStyle';
export const ACTIVITY_FILTERS_KEY = 'elywalk.activityFilters';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Lit un nombre stocké localement (null si absent ou invalide). */
export function readStoredNumber(key: string): number | null {
  const raw = storage()?.getItem(key);
  if (raw == null || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function writeStoredNumber(key: string, value: number | null): void {
  const s = storage();
  if (!s) return;
  if (value == null) s.removeItem(key);
  else s.setItem(key, String(value));
}

export function readStoredFlag(key: string): boolean {
  return storage()?.getItem(key) === '1';
}

export function writeStoredFlag(key: string, enabled: boolean): void {
  storage()?.setItem(key, enabled ? '1' : '0');
}

// ============ Géométrie / formatage ============

/** Distance orthodromique en mètres entre deux coordonnées. */
export function distanceBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const radius = 6371000;
  const lat = ((b.lat - a.lat) * Math.PI) / 180;
  const lng = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(lat / 2) ** 2
    + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(lng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export function fmtDuration(sec: number): string {
  const safe = Math.max(0, Math.floor(sec || 0));
  return `${String(Math.floor(safe / 3600)).padStart(2, '0')}:${String(Math.floor(safe / 60) % 60).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

/** Vitesse moyenne en km/h. */
export function speedKmh(distanceM: number, sec: number): number {
  return sec > 0 ? distanceM / 1000 / (sec / 3600) : 0;
}

/** Allure en min/km, formatée « 6'12" ». */
export function paceMinPerKm(distanceM: number, sec: number): string {
  if (distanceM <= 0 || sec <= 0) return '—';
  const totalMin = sec / 60 / (distanceM / 1000);
  if (!Number.isFinite(totalMin) || totalMin > 999) return '—';
  return `${Math.floor(totalMin)}'${String(Math.round((totalMin % 1) * 60)).padStart(2, '0')}"`;
}

/** Dénivelé positif cumulé (m) à partir des altitudes GPS. */
export function elevationGainM(points: ActivityPoint[]): number {
  let gain = 0;
  let previous: number | null = null;
  for (const p of points) {
    if (typeof p.altitude !== 'number' || !Number.isFinite(p.altitude)) continue;
    if (previous != null && p.altitude > previous) gain += p.altitude - previous;
    previous = p.altitude;
  }
  return Math.round(gain);
}

export function activityTypeLabel(type: ActivityType): string {
  return type === 'run' ? 'Course' : 'Marche';
}

/** Titre affiché : titre personnalisé sinon « Marche · lun. 21 oct. ». */
export function sessionTitle(session: Pick<ActivitySession, 'type' | 'startedAt' | 'title'>): string {
  const custom = session.title?.trim();
  if (custom) return custom;
  const date = new Date(session.startedAt).toLocaleDateString('fr-FR', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
  return `${activityTypeLabel(session.type)} · ${date}`;
}

// ============ Qualité du signal GPS ============

export type GpsQualityLevel = 'unknown' | 'good' | 'fair' | 'poor';

export interface GpsQuality {
  level: GpsQualityLevel;
  label: string;
  hint: string;
  accuracyM: number | null;
}

/**
 * Classe la précision GPS instantanée. Seuils pensés pour la marche :
 * en dessous de 12 m la trace est fiable, au-delà de 30 m elle peut
 * « danser » et gonfler la distance.
 */
export function gpsQuality(accuracyM?: number | null): GpsQuality {
  if (accuracyM == null || !Number.isFinite(accuracyM) || accuracyM <= 0) {
    return { level: 'unknown', label: 'GPS en attente', hint: 'Recherche du signal…', accuracyM: null };
  }
  const rounded = Math.round(accuracyM);
  if (accuracyM <= 12) {
    return { level: 'good', label: `Signal excellent · ±${rounded} m`, hint: 'Trajectoire fiable.', accuracyM };
  }
  if (accuracyM <= 30) {
    return { level: 'fair', label: `Signal moyen · ±${rounded} m`, hint: 'La distance peut être approximative.', accuracyM };
  }
  return {
    level: 'poor',
    label: `Signal faible · ±${rounded} m`,
    hint: 'Éloignez-vous des bâtiments ou attendez un ciel dégagé.',
    accuracyM,
  };
}

/** Vrai quand le signal se dégrade par rapport au niveau précédent. */
export function isQualityDegraded(previous: GpsQualityLevel, next: GpsQualityLevel): boolean {
  const rank: Record<GpsQualityLevel, number> = { unknown: 0, good: 1, fair: 2, poor: 3 };
  return rank[next] > rank[previous] && next !== 'unknown';
}

// ============ Objectif de sortie ============

export interface GoalProgress {
  goalM: number;
  doneM: number;
  percent: number;
  remainingM: number;
  reached: boolean;
}

export function goalProgress(distanceM: number, goalKm: number | null | undefined): GoalProgress | null {
  if (!goalKm || !Number.isFinite(goalKm) || goalKm <= 0) return null;
  const goalM = goalKm * 1000;
  const doneM = Math.max(0, distanceM || 0);
  return {
    goalM,
    doneM,
    percent: Math.min(100, Math.round((doneM / goalM) * 100)),
    remainingM: Math.max(0, goalM - doneM),
    reached: doneM >= goalM,
  };
}

export const GOAL_PRESETS_KM = [1, 3, 5, 10];

// ============ Styles de carte pour le partage ============

export type MapStyle = 'voyager' | 'dark' | 'satellite';

export interface MapStyleOption {
  id: MapStyle;
  label: string;
  icon: string;
  description: string;
}

export const MAP_STYLES: MapStyleOption[] = [
  { id: 'voyager', label: 'Voyager', icon: '🗺️', description: 'Rues colorées, lisible partout' },
  { id: 'dark', label: 'Sombre', icon: '🌙', description: 'Fond nocturne assorti à ElyWalk' },
  { id: 'satellite', label: 'Satellite', icon: '🛰️', description: 'Vue aérienne du parcours' },
];

export function mapStyleLabel(style: MapStyle | undefined): string {
  return MAP_STYLES.find((s) => s.id === style)?.label || 'Voyager';
}

// ============ Météo ressentie ============

export const WEATHER_OPTIONS: Array<{ id: ActivityWeather; icon: string; label: string }> = [
  { id: 'sunny', icon: '☀️', label: 'Ensoleillé' },
  { id: 'cloudy', icon: '⛅', label: 'Nuageux' },
  { id: 'rain', icon: '🌧️', label: 'Pluvieux' },
  { id: 'cold', icon: '❄️', label: 'Froid' },
  { id: 'wind', icon: '💨', label: 'Venté' },
  { id: 'night', icon: '🌙', label: 'Nuit' },
];

export function weatherLabel(weather?: ActivityWeather | null): string | null {
  if (!weather) return null;
  const option = WEATHER_OPTIONS.find((w) => w.id === weather);
  return option ? `${option.icon} ${option.label}` : null;
}

// ============ Synthèses par période ============

export interface PeriodSummary {
  steps: number;
  distanceM: number;
  calories: number;
  activeDays: number;
  days: number;
  coins: number;
}

function summaryOf(days: DailySteps[], strideCm: number): PeriodSummary {
  const steps = days.reduce((sum, d) => sum + Math.max(0, d.steps || 0), 0);
  const calories = days.reduce((sum, d) => sum + Math.max(0, d.calories || 0), 0);
  const coins = days.reduce((sum, d) => sum + Math.max(0, d.coins || 0), 0);
  return {
    steps,
    distanceM: (steps * strideCm) / 100,
    calories,
    activeDays: days.filter((d) => (d.steps || 0) > 0).length,
    days: days.length,
    coins,
  };
}

/** Somme les journées dont la date est dans [startDate, endDate) (YYYY-MM-DD). */
export function summarizeRange(days: DailySteps[], startDate: string, endDate: string, strideCm = 75): PeriodSummary {
  return summaryOf(days.filter((d) => d.date >= startDate && d.date < endDate), strideCm);
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Lundi 00:00 de la semaine contenant `ref`. */
export function startOfWeek(ref: Date = new Date()): Date {
  const d = startOfDay(ref);
  const offset = (d.getDay() + 6) % 7; // lundi = 0
  d.setDate(d.getDate() - offset);
  return d;
}

export interface DateRange { start: string; end: string }

function rangeOf(start: Date, end: Date): DateRange {
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { start: fmt(start), end: fmt(end) };
}

/** Semaine en cours (lundi → dimanche inclus), bornes exclusives. */
export function currentWeekRange(ref: Date = new Date()): DateRange {
  const start = startOfWeek(ref);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return rangeOf(start, end);
}

/** Semaine précédente complète. */
export function previousWeekRange(ref: Date = new Date()): DateRange {
  const end = startOfWeek(ref);
  const start = new Date(end);
  start.setDate(start.getDate() - 7);
  return rangeOf(start, end);
}

/** Mois en cours, bornes exclusives. */
export function currentMonthRange(ref: Date = new Date()): DateRange {
  return rangeOf(new Date(ref.getFullYear(), ref.getMonth(), 1), new Date(ref.getFullYear(), ref.getMonth() + 1, 1));
}

/** Mois précédent complet. */
export function previousMonthRange(ref: Date = new Date()): DateRange {
  return rangeOf(new Date(ref.getFullYear(), ref.getMonth() - 1, 1), new Date(ref.getFullYear(), ref.getMonth(), 1));
}

/** Variation en % ; null quand la période précédente est vide. */
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export function formatChange(change: number | null): string {
  if (change == null) return 'Pas de comparaison';
  if (change === 0) return '= stable';
  return `${change > 0 ? '↑ +' : '↓ '}${change} %`;
}

// ============ Export GPX ============

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function isoOrEmpty(ms?: number): string {
  return ms && Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

/**
 * Construit un fichier GPX 1.1 importable dans Strava, Garmin, Google Earth…
 * Les points sans coordonnées valides sont ignorés.
 */
export function buildGpx(session: ActivitySession): string {
  const name = escapeXml(session.title?.trim() || `${activityTypeLabel(session.type)} ElyWalk`);
  const descParts = [
    session.note?.trim(),
    `Durée ${fmtDuration(session.durationSec || 0)}`,
    `${((session.distanceM || 0) / 1000).toFixed(2)} km`,
  ].filter(Boolean);
  const desc = escapeXml(descParts.join(' · '));
  const type = session.type === 'run' ? 'running' : 'walking';
  const points = (session.points || []).filter(
    (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180,
  );
  const trackPoints = points.map((p) => {
    const ele = typeof p.altitude === 'number' && Number.isFinite(p.altitude) ? `\n        <ele>${p.altitude.toFixed(1)}</ele>` : '';
    const time = isoOrEmpty(p.recordedAt);
    const timeTag = time ? `\n        <time>${time}</time>` : '';
    return `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}">${ele}${timeTag}\n      </trkpt>`;
  }).join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="ElyWalk" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">',
    '  <metadata>',
    `    <name>${name}</name>`,
    `    <desc>${desc}</desc>`,
    `    <time>${isoOrEmpty(session.startedAt)}</time>`,
    '  </metadata>',
    '  <trk>',
    `    <name>${name}</name>`,
    `    <type>${type}</type>`,
    '    <trkseg>',
    trackPoints,
    '    </trkseg>',
    '  </trk>',
    '</gpx>',
    '',
  ].filter((line) => line !== '').join('\n');
}

// ============ Export CSV ============

function csvCell(value: string | number | null | undefined): string {
  if (value == null) return '';
  const str = String(value);
  return /[",\n\r;]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

const ACTIVITY_CSV_HEADER = [
  'date', 'debut', 'duree_s', 'pause_s', 'distance_m', 'distance_km',
  'denivele_m', 'calories', 'pas', 'type', 'titre', 'meteo', 'note',
];

/** CSV d'une ou plusieurs sorties (une ligne par sortie). */
export function buildActivitiesCsv(sessions: ActivitySession[], weatherName?: (w?: ActivityWeather) => string | null): string {
  const rows = sessions.map((s) => {
    const started = new Date(s.startedAt);
    return [
      started.toLocaleDateString('fr-CA'),
      started.toLocaleTimeString('fr-FR'),
      Math.round(s.durationSec || 0),
      Math.round(s.pausedSec || 0),
      Math.round(s.distanceM || 0),
      ((s.distanceM || 0) / 1000).toFixed(3),
      elevationGainM(s.points || []),
      Math.round(s.calories || 0),
      typeof s.steps === 'number' ? Math.round(s.steps) : '',
      s.type,
      s.title || '',
      weatherName ? (weatherName(s.weather) || '') : (s.weather || ''),
      s.note || '',
    ].map(csvCell).join(',');
  });
  // BOM UTF-8 pour qu'Excel affiche correctement les accents.
  return `\uFEFF${[ACTIVITY_CSV_HEADER.join(','), ...rows].join('\r\n')}\r\n`;
}

/** CSV des pas quotidiens (complète l'export RGPD JSON). */
export function buildDailyStepsCsv(days: DailySteps[], strideCm = 75): string {
  const header = ['date', 'pas', 'distance_km', 'calories', 'elycoins'];
  const rows = days.map((d) => [
    d.date,
    Math.round(d.steps || 0),
    (((d.steps || 0) * strideCm) / 100000).toFixed(3),
    Math.round(d.calories || 0),
    Math.round((d.coins || 0) * 10) / 10,
  ].map(csvCell).join(','));
  return `\uFEFF${[header.join(','), ...rows].join('\r\n')}\r\n`;
}

/** Nom de fichier sûr (sans accents ni caractères réservés). */
export function safeFilename(input: string, fallback = 'elywalk'): string {
  const slug = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || fallback;
}

// ============ Filtres de sorties ============

export interface ActivityFilterState {
  type: ActivityType | 'all';
  /** 7, 30, 365 ou 0 (= tout). */
  periodDays: number;
  minDistanceKm: number;
}

export const DEFAULT_ACTIVITY_FILTERS: ActivityFilterState = { type: 'all', periodDays: 0, minDistanceKm: 0 };

export const PERIOD_OPTIONS: Array<{ days: number; label: string }> = [
  { days: 0, label: 'Tout' },
  { days: 7, label: '7 jours' },
  { days: 30, label: '30 jours' },
  { days: 365, label: '1 an' },
];

export const DISTANCE_OPTIONS_KM = [0, 1, 3, 5, 10];

/** Nombre de filtres actifs (affiché sur le bouton de réinitialisation). */
export function activeFiltersCount(filters: ActivityFilterState): number {
  return (filters.type !== 'all' ? 1 : 0)
    + (filters.periodDays !== 0 ? 1 : 0)
    + (filters.minDistanceKm !== 0 ? 1 : 0);
}

/** Convertit l'état d'UI en bornes de requête Firestore (epoch ms). */
export function filtersToQuery(filters: ActivityFilterState, now = Date.now()): {
  type?: ActivityType;
  from?: number;
  minDistanceM?: number;
} {
  return {
    type: filters.type === 'all' ? undefined : filters.type,
    from: filters.periodDays > 0 ? now - filters.periodDays * 86400000 : undefined,
    minDistanceM: filters.minDistanceKm > 0 ? filters.minDistanceKm * 1000 : undefined,
  };
}
