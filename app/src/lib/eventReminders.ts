import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Preferences } from '@capacitor/preferences';
import type { CommunityEvent } from './types';

const prefix = 'event.reminder.';
export function eventDate(event: Pick<CommunityEvent, 'date' | 'time'>): Date {
  // Sans suffixe UTC : le navigateur applique le fuseau local de l'utilisateur.
  return new Date(`${event.date}T${event.time || '09:00'}:00`);
}
function idFor(eventId: string): number {
  let hash = 2166136261;
  for (const char of eventId) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return 300000 + (Math.abs(hash) % 1000000);
}
export async function getEventReminder(eventId: string): Promise<{ enabled: boolean; minutes: number }> {
  const result = await Preferences.get({ key: `${prefix}${eventId}` });
  if (!result.value) return { enabled: false, minutes: 60 };
  try { return { enabled: true, ...JSON.parse(result.value) }; } catch { return { enabled: false, minutes: 60 }; }
}
export async function setEventReminder(event: CommunityEvent, enabled: boolean, minutes: number): Promise<void> {
  if (!event.id) return;
  const id = idFor(event.id);
  await LocalNotifications.cancel({ notifications: [{ id }] }).catch(() => undefined);
  if (!enabled) { await Preferences.remove({ key: `${prefix}${event.id}` }); return; }
  const at = new Date(eventDate(event).getTime() - minutes * 60000);
  if (at <= new Date()) throw new Error('Ce rappel serait déjà passé. Choisissez un délai plus court.');
  await Preferences.set({ key: `${prefix}${event.id}`, value: JSON.stringify({ minutes }) });
  if (!Capacitor.isNativePlatform()) return;
  const permission = await LocalNotifications.requestPermissions();
  if (permission.display !== 'granted') throw new Error('Autorisez les notifications pour recevoir ce rappel.');
  await LocalNotifications.schedule({ notifications: [{
    id, title: `Départ bientôt : ${event.title}`,
    body: `${eventDate(event).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · ${event.location || event.establishmentName || 'Lieu dans ElyWalk'}`,
    schedule: { at }, channelId: 'elywalk-events', extra: { eventId: event.id },
  }] });
}
export async function rescheduleEventReminders(events: CommunityEvent[]): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  for (const event of events) {
    if (!event.id) continue;
    const setting = await getEventReminder(event.id);
    if (setting.enabled) await setEventReminder(event, event.status !== 'cancelled' && eventDate(event) > new Date(), setting.minutes).catch(() => undefined);
  }
}
