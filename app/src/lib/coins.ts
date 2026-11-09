import { STEP_TIERS, COINS_PER_EURO } from './constants';
import type { HealthProfile } from './types';

/** ElyCoins gagnés pour un nombre de pas quotidien donné. */
export function coinsForSteps(steps: number): number {
  const s = Math.max(0, Math.floor(steps));
  const tier = STEP_TIERS.find((t) => s >= t.min && s <= t.max);
  return tier ? tier.coins : 1;
}

/**
 * Estimation des calories. Sans données santé, on conserve l'estimation
 * historique de 0,04 kcal/pas. Avec un poids et une taille, la distance et
 * le coût énergétique deviennent personnalisés (et restent une estimation).
 */
export function caloriesForSteps(steps: number, health?: HealthProfile, strideLengthCm = 75): number {
  const safeSteps = Math.max(0, Math.floor(steps));
  if (!health?.weightKg || !health.heightCm) return Math.round(safeSteps * 0.04);
  const stride = Math.max(30, Math.min(150, strideLengthCm));
  const distanceKm = safeSteps * stride / 100000;
  // Marche à allure modérée : ~0,67 kcal/kg/km.
  return Math.round(distanceKm * health.weightKg * 0.67);
}

export function nextStepTier(steps: number): { remaining: number; target: number; coins: number } | null {
  const safe = Math.max(0, Math.floor(steps));
  const next = STEP_TIERS.find((tier) => safe < tier.min);
  return next ? { remaining: next.min - safe, target: next.min, coins: next.coins } : null;
}

export function formatDistance(meters: number, unit: 'metric' | 'imperial' = 'metric'): string {
  const value = unit === 'imperial' ? meters / 1609.344 : meters / 1000;
  return `${value.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ${unit === 'imperial' ? 'mi' : 'km'}`;
}

export function formatHeight(cm: number, unit: 'metric' | 'imperial' = 'metric'): string {
  if (unit === 'metric') return `${Math.round(cm)} cm`;
  const inches = Math.round(cm / 2.54);
  return `${Math.floor(inches / 12)}’${inches % 12}”`;
}

/** Conversion ElyCoins -> euros. */
export function coinsToEuros(coins: number): number {
  return coins / COINS_PER_EURO;
}

/** Format d'affichage des ElyCoins (max 1 décimale). */
export function fmtCoins(coins: number): string {
  const rounded = Math.round(coins * 10) / 10;
  return Number.isInteger(rounded)
    ? rounded.toLocaleString('fr-FR')
    : rounded.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function fmtEuros(coins: number): string {
  return coinsToEuros(coins).toLocaleString('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + ' €';
}

export function fmtNumber(n: number): string {
  return Math.floor(n).toLocaleString('fr-FR');
}

/** Date locale au format YYYY-MM-DD. */
export function dateStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function yesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return dateStr(d);
}
