/**
 * Calcul **pur** du crédit de pas — sans Firestore ni Capacitor.
 *
 * Depuis la 2.2.5, valider ses pas n'est plus limité à **une fois par jour** :
 * on peut valider à 14 h, marcher encore, puis revalider à 20 h. Le crédit est
 * donc **incrémental** :
 *
 *  • `dailySteps/{date}` porte le **cumul de la journée** (pas, ElyCoins,
 *    calories) — il n'est jamais réinitialisé, ce qui permet à l'historique, au
 *    classement et à l'export de continuer à lire une seule ligne par jour ;
 *  • le profil ne reçoit que le **delta** depuis la validation précédente
 *    (`totalSteps`, `totalCalories`, `elycoins`) ;
 *  • la série (`streak`) et les gels ne bougent qu'à la **première** validation
 *    de la journée — revalider deux heures plus tard ne fait pas gagner un jour
 *    de série.
 *
 * Les règles Firestore appliquent exactement la même arithmétique (`validStepCredit`) :
 * si le client et la règle divergent, l'écriture est refusée. Ce module est donc
 * testé unitairement, ce qui n'était pas possible avec la transaction Firestore.
 */

import { caloriesForSteps, coinsForSteps } from './coins';
import type { HealthProfile } from './types';

/** Plafond quotidien de pas (même borne que les règles et l'export). */
export const MAX_DAILY_STEPS = 60_000;

/** État déjà écrit dans `users/{uid}/dailySteps/{date}`. */
export interface DayStepsSnapshot {
  steps: number;
  coins: number;
  calories: number;
}

export interface StepValidationInput {
  /** Cumul de pas du jour mesuré par le podomètre (ou saisi). */
  stepsToday: number;
  /** Document `dailySteps/{today}` existant, `null` à la première validation. */
  previous: DayStepsSnapshot | null;
  profile: {
    lastValidatedDate: string | null;
    streak: number;
    streakFreezes?: number;
  };
  health?: HealthProfile;
  strideLengthCm?: number;
  /** Date locale `AAAA-MM-JJ`. */
  today: string;
}

export interface StepValidationPlan {
  /** Cumuls de la journée, à écrire dans `dailySteps/{today}`. */
  steps: number;
  coins: number;
  calories: number;
  /** Deltas à créditer au profil. */
  addedSteps: number;
  addedCoins: number;
  addedCalories: number;
  streak: number;
  streakFreezes: number;
  freezeUsed: boolean;
  /** `true` si c'est la première validation de la journée (série avancée). */
  firstOfDay: boolean;
}

/** Nombre de jours entre deux dates `AAAA-MM-JJ` (négatif si `date` est futur). */
export function daysSince(date: string | null, today: string): number | null {
  if (!date) return null;
  const from = new Date(`${date}T00:00:00`);
  const to = new Date(`${today}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

/** Gels de série : 0 à 3, comme la règle Firestore. */
function clampFreezes(value: number | undefined): number {
  const n = Number.isFinite(value as number) ? Math.floor(value as number) : 1;
  return Math.max(0, Math.min(3, n));
}

/**
 * Calcule le crédit d'une validation de pas.
 *
 * Lève une erreur explicite (affichée telle quelle) quand il n'y a rien à
 * créditer (aucun nouveau pas, compteur incohérent). Au-delà du plafond
 * quotidien, le cumul est plafonné — la validation reste possible.
 */
export function planStepValidation(input: StepValidationInput): StepValidationPlan {
  const { stepsToday, previous, profile, health, strideLengthCm = 75, today } = input;

  if (!Number.isFinite(stepsToday)) {
    throw new Error('Nombre de pas illisible. Réessayez dans un instant.');
  }
  if (stepsToday < 0) {
    throw new Error('Nombre de pas incohérent.');
  }
  // Au-delà du plafond, on **crédite le plafond** au lieu de tout refuser :
  // perdre 200 pas de plus serait une punition silencieuse, alors que la règle
  // Firestore borne de toute façon la journée à 60 000 pas.
  const steps = Math.min(MAX_DAILY_STEPS, Math.floor(stepsToday));

  const previousSteps = Math.max(0, Math.min(MAX_DAILY_STEPS, Math.floor(previous?.steps ?? 0)));
  const previousCoins = Math.max(0, Number(previous?.coins ?? 0));
  const previousCalories = Math.max(0, Number(previous?.calories ?? 0));

  const addedSteps = steps - previousSteps;
  if (addedSteps <= 0) {
    throw new Error(
      'Aucun nouveau pas depuis votre dernière validation. Marchez encore un peu, puis revalidez : vous pouvez le faire autant de fois que vous voulez dans la journée.'
    );
  }

  // Barème identique à la règle Firestore : les ElyCoins de la journée suivent
  // les paliers du cumul, donc revalider ne « perd » jamais de récompense.
  const coins = coinsForSteps(steps);
  // Les calories ne redescendent jamais, même si le profil santé change en
  // cours de journée (poids corrigé à la baisse) : la règle exige un delta ≥ 0.
  const calories = Math.max(previousCalories, caloriesForSteps(steps, health, strideLengthCm));

  const firstOfDay = profile.lastValidatedDate !== today;
  const availableFreezes = clampFreezes(profile.streakFreezes);
  const currentStreak = Number.isFinite(profile.streak) ? Math.max(0, Math.floor(profile.streak)) : 0;

  let streak = currentStreak;
  let streakFreezes = availableFreezes;
  let freezeUsed = false;

  if (firstOfDay) {
    const gap = daysSince(profile.lastValidatedDate, today);
    freezeUsed = gap === 2 && availableFreezes > 0;
    // Série continue (hier) ou rattrapée par un gel ; sinon la série repart à 1.
    streak = gap === 1 || freezeUsed ? currentStreak + 1 : 1;
    streakFreezes = clampFreezes(availableFreezes - (freezeUsed ? 1 : 0));
  }

  return {
    steps,
    coins,
    calories,
    addedSteps,
    addedCoins: Math.max(0, coins - previousCoins),
    addedCalories: Math.max(0, calories - previousCalories),
    streak,
    streakFreezes,
    freezeUsed,
    firstOfDay,
  };
}

/**
 * Récompense encore disponible pour la journée : différence entre le barème du
 * cumul mesuré et celui du cumul déjà validé. Sert à afficher « +3 EC » sur le
 * bouton de validation sans promettre deux fois la même récompense.
 */
export function pendingCoins(stepsToday: number, validatedToday: number): number {
  const steps = Math.max(0, Math.floor(Number.isFinite(stepsToday) ? stepsToday : 0));
  const validated = Math.max(0, Math.floor(Number.isFinite(validatedToday) ? validatedToday : 0));
  if (steps <= validated) return 0;
  const earned = coinsForSteps(Math.min(steps, MAX_DAILY_STEPS));
  // Aucune validation aujourd'hui : la journée part de zéro (le barème de 0 pas
  // vaut 1 EC pour un document existant, pas pour une première validation).
  if (validated <= 0) return earned;
  return Math.max(0, earned - coinsForSteps(validated));
}
