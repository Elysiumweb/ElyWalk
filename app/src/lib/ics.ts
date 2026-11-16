import type { CommunityEvent } from './types';

/**
 * Export calendrier (A10) — fichier `.ics` généré **localement**.
 *
 * Aucun serveur, aucune clé : le fichier est produit à partir de la rencontre
 * et proposé au partage / téléchargement. Il s'ouvre dans Google Agenda, Apple
 * Calendrier, Outlook ou Samsung Agenda.
 *
 * Points de vigilance traités :
 *  - lignes pliées à 75 octets (RFC 5545) — sans cela, certains clients
 *    tronquent la description ou refusent le fichier ;
 *  - échappement des virgules, points-virgules, barres obliques inverses et
 *    retours à la ligne ;
 *  - `DTSTART`/`DTEND` en **UTC** (`Z`) calculés depuis la date/heure locale de
 *    la rencontre, pour éviter le décalage d'une heure ;
 *  - `UID` stable (`elywalk-event-<id>@elywalk`) : réimporter le même fichier
 *    met à jour l'événement au lieu de le dupliquer.
 */

const CRLF = '\r\n';

/** Échappement RFC 5545 d'une valeur texte. */
export function escapeIcsText(value: string): string {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

/** Replie une ligne à 75 octets (RFC 5545 §3.1). */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  let out = '';
  let current = '';
  let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    // 74 pour laisser la place au caractère de continuation lui-même.
    if (bytes + size > 74) {
      out += `${current}${CRLF} `;
      current = '';
      bytes = 1;
    }
    current += char;
    bytes += size;
  }
  return out + current;
}

/** `20261116T093000Z` — format DATE-TIME UTC d'iCalendar. */
export function toIcsDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(
    date.getUTCHours(),
  )}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

export interface IcsOptions {
  /** Durée par défaut si la rencontre n'en déclare pas (minutes). */
  durationMinutes?: number;
  /** Lien public de la rencontre, ajouté en description. */
  url?: string | null;
  /** Horodatage de génération (testabilité). */
  now?: Date;
}

/**
 * Date de départ d'une rencontre, en heure locale de l'appareil.
 * (Calcul local plutôt qu'import de `eventReminders`, qui charge les plugins
 * natifs de notification : ce module doit rester utilisable en test et dans le
 * navigateur sans Capacitor.)
 */
export function eventStartDate(event: Pick<CommunityEvent, 'date' | 'time'>): Date {
  return new Date(`${event.date}T${event.time || '09:00'}:00`);
}

/** Contenu du fichier `.ics` d'une rencontre. */
export function buildEventIcs(event: CommunityEvent, options: IcsOptions = {}): string {
  const start = eventStartDate(event);
  const duration = Math.max(15, options.durationMinutes ?? 120);
  const end = new Date(start.getTime() + duration * 60000);
  const now = options.now || new Date();
  const id = event.id || `draft-${start.getTime()}`;

  const location = [event.location || event.establishmentName || '', event.lat != null && event.lng != null
    ? `https://www.openstreetmap.org/?mlat=${event.lat}&mlon=${event.lng}#map=17/${event.lat}/${event.lng}`
    : '']
    .filter(Boolean)
    .join(' — ');

  const descriptionParts = [
    event.description?.trim(),
    `Organisé par ${event.creatorName} via ElyWalk.`,
    event.participants?.length ? `${event.participants.length} participant(s) déjà inscrit(s).` : '',
    options.url || '',
  ].filter((value): value is string => Boolean(value && value.length));

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ElyWalk//Rencontres//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:elywalk-event-${id}@elywalk`,
    `DTSTAMP:${toIcsDate(now)}`,
    `DTSTART:${toIcsDate(start)}`,
    `DTEND:${toIcsDate(end)}`,
    `SUMMARY:${escapeIcsText(event.title || 'Rencontre ElyWalk')}`,
    `DESCRIPTION:${escapeIcsText(descriptionParts.join('\n'))}`,
    location ? `LOCATION:${escapeIcsText(location)}` : '',
    event.lat != null && event.lng != null
      ? `GEO:${event.lat};${event.lng}`
      : '',
    // Rappel 1 h avant le départ, comme le rappel local de l'application.
    'BEGIN:VALARM',
    'TRIGGER:-PT60M',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeIcsText(event.title || 'Rencontre ElyWalk')}`,
    'END:VALARM',
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter((line) => line.length > 0);

  return lines.map(foldIcsLine).join(CRLF) + CRLF;
}

/** Nom de fichier sûr pour l'export. */
export function icsFilename(event: CommunityEvent): string {
  const base = (event.title || 'rencontre-elywalk')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return `${base || 'rencontre-elywalk'}.ics`;
}

/**
 * Télécharge (web) ou partage (mobile) le fichier `.ics`.
 *
 * Le partage natif n'accepte pas un texte brut : on crée un Blob puis, sur le
 * web, un lien de téléchargement. Sur mobile, la feuille de partage du système
 * reçoit le fichier via `navigator.share` quand les fichiers sont supportés.
 */
export async function downloadIcs(filename: string, content: string): Promise<'shared' | 'downloaded'> {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const file = new File([blob], filename, { type: 'text/calendar' });
  if (typeof navigator !== 'undefined' && navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    } catch (e) {
      if (/cancel|abort/i.test((e as Error)?.message || '')) return 'shared';
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return 'downloaded';
}
