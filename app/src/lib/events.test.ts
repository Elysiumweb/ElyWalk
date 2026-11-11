import { describe, expect, it } from 'vitest';
import {
  formatEventDate,
  isPastEvent,
  localDateInput,
  parseLocalDateTime,
} from './events';

describe('localDateInput — date locale, jamais UTC', () => {
  it('renvoie le jour local même tard le soir', () => {
    // 23 h 30 à Paris : `toISOString()` basculerait déjà sur J+1.
    expect(localDateInput(new Date(2026, 10, 14, 23, 30))).toBe('2026-11-14');
  });

  it('complète les mois et jours sur deux chiffres', () => {
    expect(localDateInput(new Date(2026, 0, 5, 9, 0))).toBe('2026-01-05');
  });
});

describe('parseLocalDateTime — date + heure locales', () => {
  it('construit la date locale exacte', () => {
    const value = parseLocalDateTime('2026-11-14', '10:30');
    expect(value).not.toBeNull();
    expect(value!.getFullYear()).toBe(2026);
    expect(value!.getMonth()).toBe(10);
    expect(value!.getDate()).toBe(14);
    expect(value!.getHours()).toBe(10);
    expect(value!.getMinutes()).toBe(30);
  });

  it('accepte une date sans heure (minuit local)', () => {
    const value = parseLocalDateTime('2026-11-14');
    expect(value!.getHours()).toBe(0);
  });

  it('rejette une date impossible', () => {
    expect(parseLocalDateTime('2026-02-31', '10:00')).toBeNull();
  });

  it('rejette une heure invalide', () => {
    expect(parseLocalDateTime('2026-11-14', '25:00')).toBeNull();
    expect(parseLocalDateTime('2026-11-14', '10:75')).toBeNull();
  });

  it('rejette un format de date non ISO', () => {
    expect(parseLocalDateTime('14/11/2026', '10:00')).toBeNull();
  });
});

describe('isPastEvent — pas de rencontre dans le passé', () => {
  const now = new Date(2026, 10, 14, 12, 0);

  it('considère comme passée une rencontre d’hier', () => {
    expect(isPastEvent('2026-11-13', '18:00', now)).toBe(true);
  });

  it('considère comme passée une rencontre du matin même', () => {
    expect(isPastEvent('2026-11-14', '09:00', now)).toBe(true);
  });

  it('accepte une rencontre du soir même', () => {
    expect(isPastEvent('2026-11-14', '18:00', now)).toBe(false);
  });

  it('accepte une rencontre future', () => {
    expect(isPastEvent('2026-12-01', '09:00', now)).toBe(false);
  });

  it('ne bloque pas une saisie invalide (gérée par le formulaire)', () => {
    expect(isPastEvent('n’importe quoi', '10:00', now)).toBe(false);
  });
});

describe('formatEventDate — locale de l’appareil', () => {
  it('formate la date en toutes lettres en français', () => {
    const label = formatEventDate('2026-11-14', '10:00', 'fr-FR');
    expect(label).toContain('14');
    expect(label).toContain('novembre');
    expect(label).toContain('2026');
    expect(label).toContain('10:00');
  });

  it('suit la locale demandée (anglais britannique)', () => {
    const label = formatEventDate('2026-11-14', '10:00', 'en-GB');
    expect(label.toLowerCase()).toContain('november');
  });

  it('retombe sur la valeur brute si la date est invalide', () => {
    expect(formatEventDate('2026-02-31', '10:00')).toBe('2026-02-31 · 10:00');
  });

  it('gère une rencontre sans heure', () => {
    const label = formatEventDate('2026-11-14', null, 'fr-FR');
    expect(label).toContain('novembre');
    expect(label).not.toContain(':');
  });
});
