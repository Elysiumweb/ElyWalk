import { describe, expect, it } from 'vitest';
import { isAppOpenAllowed } from './ads';

/** Minuit UTC + quelques heures : évite tout effet de fuseau. */
const at = (iso: string, hour = 10) => new Date(`${iso}T${String(hour).padStart(2, '0')}:00:00.000Z`).getTime();

describe('isAppOpenAllowed — garde-fous de l’interstitiel d’ouverture', () => {
  it('autorise la première annonce de la journée', () => {
    expect(isAppOpenAllowed({ date: '2026-11-08', count: 2, lastShownAt: at('2026-11-08', 22) }, at('2026-11-09'))).toBe(true);
  });

  it('autorise tant que le plafond journalier (2) n’est pas atteint', () => {
    const now = at('2026-11-09', 12);
    expect(isAppOpenAllowed({ date: '2026-11-09', count: 1, lastShownAt: now - 11 * 60 * 1000 }, now)).toBe(true);
  });

  it('bloque au-delà du plafond journalier', () => {
    const now = at('2026-11-09', 12);
    expect(isAppOpenAllowed({ date: '2026-11-09', count: 2, lastShownAt: now - 60 * 60 * 1000 }, now)).toBe(false);
  });

  it('impose un cooldown de 10 minutes entre deux annonces', () => {
    const now = at('2026-11-09', 12);
    expect(isAppOpenAllowed({ date: '2026-11-09', count: 1, lastShownAt: now - 5 * 60 * 1000 }, now)).toBe(false);
  });

  it('réautorise le lendemain même après le plafond', () => {
    const now = at('2026-11-10', 8);
    expect(isAppOpenAllowed({ date: '2026-11-09', count: 99, lastShownAt: at('2026-11-09', 23) }, now)).toBe(true);
  });
});
