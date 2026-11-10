import { describe, expect, it } from 'vitest';
import { isQuietTime, nextReminder } from './notifications';

describe('rappels personnalisés', () => {
  it('gère une plage silencieuse dans la même journée', () => {
    expect(isQuietTime('12:00', '11:00', '13:00')).toBe(true);
    expect(isQuietTime('14:00', '11:00', '13:00')).toBe(false);
  });
  it('gère une plage silencieuse à cheval sur minuit', () => {
    expect(isQuietTime('23:30', '22:00', '08:00')).toBe(true);
    expect(isQuietTime('07:59', '22:00', '08:00')).toBe(true);
    expect(isQuietTime('20:00', '22:00', '08:00')).toBe(false);
  });
  it('désactive la plage si les deux bornes sont égales', () => {
    expect(isQuietTime('20:00', '20:00', '20:00')).toBe(false);
  });
  it('planifie le prochain jour choisi dans le fuseau local', () => {
    const from = new Date(2026, 10, 10, 21, 0); // mardi
    const next = nextReminder(2, '20:00', from);
    expect(next.getDate()).toBe(17);
    expect(next.getHours()).toBe(20);
  });
});
