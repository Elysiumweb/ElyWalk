// ============================================================================
// Dates des rencontres communautaires — toujours en heure locale.
//
// Les rencontres sont saisies en **date locale** (`AAAA-MM-JJ`) + heure
// (`HH:MM`), jamais en horodatage UTC : `toISOString()` décale d'un jour selon
// le fuseau (un événement du 1er à 00 h 30 à Paris s'y afficherait le 31).
//
// L'affichage passe par `Intl.DateTimeFormat` dans la locale de l'appareil :
// « samedi 14 novembre 2026 à 10:00 » plutôt que « 2026-11-14 10:00 ».
// ============================================================================

import { dateStr } from './coins';

/** Locale de l'appareil, avec repli français si elle n'est pas exposée. */
export function deviceLocale(): string {
  try {
    return (typeof navigator !== 'undefined' && navigator.language) || 'fr-FR';
  } catch {
    return 'fr-FR';
  }
}

/** Date locale au format `AAAA-MM-JJ` (jamais `toISOString`, qui est UTC). */
export function localDateInput(d: Date = new Date()): string {
  return dateStr(d);
}

/**
 * Construit une date locale depuis `AAAA-MM-JJ` + `HH:MM`.
 * `null` si la saisie est incomplète ou impossible (31 février…).
 */
export function parseLocalDateTime(date: string, time?: string | null): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split('-').map(Number);
  let hours = 0;
  let minutes = 0;
  if (time) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
    if (!match) return null;
    hours = Number(match[1]);
    minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;
  }
  const value = new Date(year, month - 1, day, hours, minutes, 0, 0);
  // Rejette les dates impossibles (31 février → 3 mars).
  if (value.getFullYear() !== year || value.getMonth() !== month - 1 || value.getDate() !== day) {
    return null;
  }
  return value;
}

/** Vrai si la rencontre est déjà passée (heure incluse). */
export function isPastEvent(date: string, time?: string | null, now: Date = new Date()): boolean {
  const value = parseLocalDateTime(date, time);
  if (!value) return false;
  return value.getTime() < now.getTime();
}

/** « samedi 14 novembre 2026 à 10:00 » dans la locale de l'appareil. */
export function formatEventDate(date: string, time?: string | null, locale = deviceLocale()): string {
  const value = parseLocalDateTime(date, time);
  if (!value) return time ? `${date} · ${time}` : date;
  try {
    const dateLabel = new Intl.DateTimeFormat(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(value);
    if (!time) return dateLabel;
    const timeLabel = new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(value);
    return `${dateLabel} à ${timeLabel}`;
  } catch {
    return time ? `${date} · ${time}` : date;
  }
}

/** Fuseau de l'appareil, ex. « Europe/Paris » (affiché si nécessaire). */
export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}
