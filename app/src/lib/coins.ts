import { STEP_TIERS, COINS_PER_EURO } from './constants';

/** ElyCoins gagnés pour un nombre de pas quotidien donné. */
export function coinsForSteps(steps: number): number {
  const s = Math.max(0, Math.floor(steps));
  const tier = STEP_TIERS.find((t) => s >= t.min && s <= t.max);
  return tier ? tier.coins : 1;
}

/** Estimation des calories brûlées (~0,04 kcal / pas). */
export function caloriesForSteps(steps: number): number {
  return Math.round(steps * 0.04);
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
