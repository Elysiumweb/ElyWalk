import { describe, expect, it } from 'vitest';
import { caloriesForSteps, coinsForSteps, dateStr } from './coins';
describe('économie des pas', () => {
  it('applique les bornes du barème', () => { expect(coinsForSteps(0)).toBe(1); expect(coinsForSteps(2499)).toBe(1); expect(coinsForSteps(2500)).toBe(2); expect(coinsForSteps(10000)).toBe(10); expect(coinsForSteps(50000)).toBe(50); });
  it('neutralise les valeurs négatives', () => expect(coinsForSteps(-100)).toBe(1));
  it('calcule les calories', () => expect(caloriesForSteps(10000)).toBe(400));
  it('formate une date locale stable', () => expect(dateStr(new Date(2026, 7, 18))).toBe('2026-08-18'));
});
