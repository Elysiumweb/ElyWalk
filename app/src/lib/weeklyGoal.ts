import type { DailySteps } from './types';
import { dateStr } from './coins';

/**
 * Objectif **hebdomadaire** et récapitulatif du dimanche (A9).
 *
 * Avant : seul `dailyStepGoal` existait. Aucun résumé n'était poussé — un
 * marcheur pouvait terminer la semaine à 42 300 pas sur 50 000 sans jamais
 * l'apprendre, et la notification du dimanche soir n'existait pas.
 *
 * Ce module ne dépend d'aucun réseau : la progression est calculée à partir des
 * pas déjà validés (`users/{uid}/dailySteps`), le worker se contente de la
 * même règle pour pousser le message à ceux qui l'ont activé.
 */

/** Objectif hebdomadaire par défaut : 50 000 pas (≈ 7 000 pas/jour). */
export const DEFAULT_WEEKLY_STEP_GOAL = 50_000;

/** Bornes acceptées par l'interface et par les règles Firestore. */
export const MIN_WEEKLY_STEP_GOAL = 7_000;
export const MAX_WEEKLY_STEP_GOAL = 210_000;

/** Longueur de pas par défaut (cm) si le profil n'en déclare pas. */
const DEFAULT_STRIDE_CM = 75;

/** Vitesse de marche retenue pour convertir les pas restants en minutes. */
const WALKING_SPEED_KMH = 4.8;

/** Lundi 00:00 (heure locale) de la semaine contenant `ref`. */
export function startOfWeek(ref: Date = new Date()): Date {
  const date = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  // getDay() : 0 = dimanche. La semaine ElyWalk commence le lundi.
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  return date;
}

/** Les sept dates `YYYY-MM-DD` de la semaine de `ref` (lundi → dimanche). */
export function weekDates(ref: Date = new Date()): string[] {
  const start = startOfWeek(ref);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    return dateStr(day);
  });
}

export interface WeeklyProgress {
  /** Objectif retenu (borné). */
  target: number;
  /** Pas validés depuis lundi. */
  total: number;
  /** Pas restants (0 si l'objectif est atteint). */
  remaining: number;
  /** Progression 0 → 1 (bornée, utilisable pour un anneau). */
  ratio: number;
  percent: number;
  /** Jours restants **avant** dimanche inclus (0 le dimanche). */
  daysLeftIncludingToday: number;
  /** Estimation du temps de marche restant, en minutes. */
  minutesRemaining: number;
  achieved: boolean;
  /** Pas quotidiens restants pour tenir le rythme. */
  perDayRemaining: number;
  weekStart: string;
  weekEnd: string;
}

/** Normalise un objectif saisi (ou absent) dans les bornes autorisées. */
export function sanitizeWeeklyGoal(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_WEEKLY_STEP_GOAL;
  return Math.min(MAX_WEEKLY_STEP_GOAL, Math.max(MIN_WEEKLY_STEP_GOAL, Math.round(numeric)));
}

/**
 * Progression hebdomadaire.
 *
 * Seuls les jours de la semaine en cours sont pris en compte : un historique
 * de plusieurs mois ne doit pas gonfler le total. Les jours manquants de
 * `dailySteps` comptent pour zéro.
 */
export function weeklyProgress(
  days: DailySteps[],
  target: number = DEFAULT_WEEKLY_STEP_GOAL,
  options: { ref?: Date; strideCm?: number } = {},
): WeeklyProgress {
  const ref = options.ref || new Date();
  const strideCm = Math.max(30, Math.min(150, options.strideCm || DEFAULT_STRIDE_CM));
  const dates = weekDates(ref);
  const byDate = new Map(days.map((day) => [day.date, Math.max(0, Math.floor(day.steps || 0))]));
  const total = dates.reduce((sum, date) => sum + (byDate.get(date) || 0), 0);
  const safeTarget = sanitizeWeeklyGoal(target);
  const remaining = Math.max(0, safeTarget - total);
  const todayIndex = dates.indexOf(dateStr(ref));
  const daysLeftIncludingToday = todayIndex >= 0 ? 7 - todayIndex : 1;
  // 1 pas ≈ (longueur de pas) cm ; temps = distance / vitesse.
  const remainingKm = (remaining * strideCm) / 100_000;
  const minutesRemaining = Math.ceil((remainingKm / WALKING_SPEED_KMH) * 60);
  return {
    target: safeTarget,
    total,
    remaining,
    ratio: safeTarget > 0 ? Math.min(1, total / safeTarget) : 0,
    percent: safeTarget > 0 ? Math.min(100, Math.round((total / safeTarget) * 100)) : 0,
    daysLeftIncludingToday,
    minutesRemaining,
    achieved: total >= safeTarget,
    perDayRemaining: Math.ceil(remaining / Math.max(1, daysLeftIncludingToday)),
    weekStart: dates[0],
    weekEnd: dates[6],
  };
}

/** « 1 h 10 », « 25 min ». */
export function formatWalkMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0 min';
  const rounded = Math.max(5, Math.round(minutes / 5) * 5);
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest ? `${hours} h ${String(rest).padStart(2, '0')}` : `${hours} h`;
}

function groupThousands(value: number): string {
  return Math.round(value).toLocaleString('fr-FR');
}

/**
 * Message du récapitulatif du dimanche, identique côté application et côté
 * worker : « 42 300 / 50 000 pas — il te reste 7 700 pas, soit 1 h 10 de
 * marche ».
 */
export function weeklyRecapMessage(progress: WeeklyProgress): { title: string; body: string } {
  const total = groupThousands(progress.total);
  const target = groupThousands(progress.target);
  if (progress.achieved) {
    return {
      title: 'Objectif de la semaine atteint 🎉',
      body: `${total} / ${target} pas — objectif atteint. Bravo, et bonne semaine !`,
    };
  }
  return {
    title: 'Ta semaine en un coup d’œil',
    body: `${total} / ${target} pas — il te reste ${groupThousands(progress.remaining)} pas, soit ${formatWalkMinutes(progress.minutesRemaining)} de marche.`,
  };
}

/** Libellé court affiché dans l'anneau d'accueil : « 42 300 / 50 000 ». */
export function weeklyGoalLabel(progress: WeeklyProgress): string {
  return `${groupThousands(progress.total)} / ${groupThousands(progress.target)} pas`;
}
