import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Preferences } from '@capacitor/preferences';
import { dateStr } from './coins';

/**
 * Rappel de fin de journée (A12.6) — « marche du soir ».
 *
 * Constat : la série se perdait silencieusement. Si l'utilisateur ne validait
 * pas ses pas avant minuit, il ne l'apprenait qu'en voyant sa série repartir à
 * 1 le lendemain (seul le gel la rattrapait).
 *
 * Le rappel est **local** : programmé à 21 h 30 sur l'appareil, il ne dépend
 * d'aucun push, et il est reprogrammé à chaque ouverture de l'application avec
 * un message à jour (« il te reste 1 240 pas à valider »). Il est annulé dès
 * que la journée est validée ou que l'utilisateur le désactive.
 */
const KEY = 'elywalk.eveningReminder.v1';
/** Identifiant stable : reprogrammer remplace la notification existante. */
export const EVENING_REMINDER_ID = 2_401;
const REMINDER_HOUR = 21;
const REMINDER_MINUTE = 30;

export interface EveningReminderOptions {
  /** Journée déjà validée : aucun rappel n'est utile. */
  alreadyValidated: boolean;
  /** Pas du jour relevés par le podomètre. */
  steps: number;
  /** Objectif quotidien. */
  goal: number;
  /** Préférence utilisateur (Réglages → Notifications). */
  enabled: boolean;
  /** Date de référence (testabilité). */
  now?: Date;
}

/** Heure du rappel pour une date donnée (aujourd'hui si `now` fourni). */
export function eveningReminderAt(now: Date = new Date()): Date {
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), REMINDER_HOUR, REMINDER_MINUTE, 0, 0);
  return at;
}

/** Faut-il programmer un rappel ? (logique pure, testée) */
export function shouldScheduleEveningReminder(options: EveningReminderOptions): boolean {
  if (!options.enabled) return false;
  if (options.alreadyValidated) return false;
  const now = options.now || new Date();
  if (eveningReminderAt(now).getTime() <= now.getTime()) return false;
  return true;
}

/** Corps de la notification, adapté au reste à valider. */
export function eveningReminderBody(options: Pick<EveningReminderOptions, 'steps' | 'goal'>): string {
  const goal = Math.max(1, Math.round(options.goal));
  const remaining = Math.max(0, goal - Math.max(0, Math.round(options.steps)));
  if (remaining > 0) {
    return `Il te reste ${remaining.toLocaleString('fr-FR')} pas pour atteindre ton objectif. Valide ta journée avant minuit pour garder ta série.`;
  }
  return 'Tes pas ne sont pas encore validés. Valide ta journée avant minuit pour garder ta série.';
}

/** Marque locale (utile au diagnostic et pour éviter les doublons). */
async function rememberScheduled(value: { at: number; day: string } | null): Promise<void> {
  try {
    if (!value) {
      await Preferences.remove({ key: KEY });
      return;
    }
    await Preferences.set({ key: KEY, value: JSON.stringify(value) });
  } catch {
    /* stockage indisponible */
  }
}

export async function scheduledEveningReminder(): Promise<{ at: number; day: string } | null> {
  try {
    const stored = await Preferences.get({ key: KEY });
    if (!stored.value) return null;
    return JSON.parse(stored.value) as { at: number; day: string };
  } catch {
    return null;
  }
}

/**
 * (Re)programme ou annule le rappel du soir. Ne lève jamais d'exception : un
 * refus de permission ne doit pas interrompre l'écran d'accueil.
 */
export async function syncEveningReminder(options: EveningReminderOptions): Promise<'scheduled' | 'cancelled' | 'unsupported'> {
  const now = options.now || new Date();
  if (!Capacitor.isNativePlatform()) {
    await rememberScheduled(null);
    return 'unsupported';
  }
  await LocalNotifications.cancel({ notifications: [{ id: EVENING_REMINDER_ID }] }).catch(() => undefined);
  if (!shouldScheduleEveningReminder(options)) {
    await rememberScheduled(null);
    return 'cancelled';
  }
  const at = eveningReminderAt(now);
  try {
    const permission = await LocalNotifications.checkPermissions().catch(() => null);
    const granted = permission?.display === 'granted'
      || (await LocalNotifications.requestPermissions().catch(() => null))?.display === 'granted';
    if (!granted) return 'cancelled';
    await LocalNotifications.schedule({
      notifications: [
        {
          id: EVENING_REMINDER_ID,
          title: 'Ta série est en jeu 🌙',
          body: eveningReminderBody(options),
          schedule: { at },
          channelId: 'elywalk-reminders',
          extra: { type: 'evening', url: '/', day: dateStr(now) },
        },
      ],
    });
    await rememberScheduled({ at: at.getTime(), day: dateStr(now) });
    return 'scheduled';
  } catch {
    return 'cancelled';
  }
}
