import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { LocalNotifications } from '@capacitor/local-notifications';
import { PushNotifications } from '@capacitor/push-notifications';
import { collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from './firebase';

const GOAL_NOTIF_ID = 2301;
const PREFS_REMINDER = 'notif.reminder.enabled';
const PREFS_PUSH = 'notif.push.enabled';
const PREFS_SCHEDULE = 'notif.reminder.schedule.v2';
const REMINDER_IDS = [2108, 2109, 2110, 2111, 2112, 2113, 2114];

export interface ReminderSchedule {
  enabled: boolean;
  /** Jours JS : 0 = dimanche, 1 = lundi… */
  days: number[];
  time: string;
  quietStart: string;
  quietEnd: string;
  /** Adapte le texte à l'objectif, sans augmenter la fréquence. */
  goalAware: boolean;
}
export interface NotificationSettings {
  reminder: boolean;
  push: boolean;
  schedule: ReminderSchedule;
}
const DEFAULT_SCHEDULE: ReminderSchedule = { enabled: true, days: [0, 1, 2, 3, 4, 5, 6], time: '20:00', quietStart: '22:00', quietEnd: '08:00', goalAware: true };
let pushListenerInstalled = false;

export async function getReminderSchedule(): Promise<ReminderSchedule> {
  const [stored, legacy] = await Promise.all([Preferences.get({ key: PREFS_SCHEDULE }), Preferences.get({ key: PREFS_REMINDER })]);
  if (!stored.value) return { ...DEFAULT_SCHEDULE, enabled: legacy.value !== 'false' };
  try {
    const value = JSON.parse(stored.value) as Partial<ReminderSchedule>;
    const days = Array.isArray(value.days) ? [...new Set(value.days.filter(d => Number.isInteger(d) && d >= 0 && d <= 6))] : DEFAULT_SCHEDULE.days;
    const validTime = (v: unknown, fallback: string) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : fallback;
    return { enabled: value.enabled !== false, days, time: validTime(value.time, '20:00'), quietStart: validTime(value.quietStart, '22:00'), quietEnd: validTime(value.quietEnd, '08:00'), goalAware: value.goalAware !== false };
  } catch { return { ...DEFAULT_SCHEDULE }; }
}

export async function getNotificationSettings(): Promise<NotificationSettings> {
  const [schedule, push] = await Promise.all([getReminderSchedule(), Preferences.get({ key: PREFS_PUSH })]);
  return { reminder: schedule.enabled, push: push.value !== 'false', schedule };
}
function minutes(time: string) { const [h, m] = time.split(':').map(Number); return h * 60 + m; }
export function isQuietTime(time: string, quietStart: string, quietEnd: string): boolean {
  const value = minutes(time), start = minutes(quietStart), end = minutes(quietEnd);
  if (start === end) return false; // égalité = plage désactivée
  return start < end ? value >= start && value < end : value >= start || value < end;
}
export function nextReminder(day: number, time: string, from = new Date()): Date {
  const [hours, mins] = time.split(':').map(Number);
  const at = new Date(from); at.setHours(hours, mins, 0, 0);
  let delta = (day - at.getDay() + 7) % 7;
  if (delta === 0 && at <= from) delta = 7;
  at.setDate(at.getDate() + delta); return at;
}
async function applyReminder(schedule: ReminderSchedule): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await LocalNotifications.cancel({ notifications: REMINDER_IDS.map(id => ({ id })) }).catch(() => undefined);
  if (!schedule.enabled || schedule.days.length === 0) return;
  if (isQuietTime(schedule.time, schedule.quietStart, schedule.quietEnd)) throw new Error('L’heure choisie se trouve dans la plage silencieuse.');
  const local = await LocalNotifications.requestPermissions(); if (local.display !== 'granted') return;
  await LocalNotifications.schedule({ notifications: schedule.days.map((day, index) => ({
    id: REMINDER_IDS[index], title: 'Vos pas vous attendent',
    body: schedule.goalAware ? 'Votre objectif du jour vous attend : marchez à votre rythme, puis validez vos pas.' : 'Pensez à valider vos pas ElyWalk avant minuit.',
    schedule: { at: nextReminder(day, schedule.time), repeats: true, every: 'week' }, channelId: 'elywalk-reminders',
  })) });
}
export async function setReminderSchedule(schedule: ReminderSchedule): Promise<void> {
  if (schedule.enabled && schedule.days.length === 0) throw new Error('Choisissez au moins un jour.');
  if (schedule.enabled && isQuietTime(schedule.time, schedule.quietStart, schedule.quietEnd)) throw new Error('L’heure choisie se trouve dans la plage silencieuse.');
  await Preferences.set({ key: PREFS_SCHEDULE, value: JSON.stringify(schedule) });
  await Preferences.set({ key: PREFS_REMINDER, value: String(schedule.enabled) });
  await applyReminder(schedule);
}
export async function setReminderEnabled(enabled: boolean): Promise<void> { await setReminderSchedule({ ...(await getReminderSchedule()), enabled }); }

export async function notifyActivityGoal(goalKm: number, distanceM: number): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const local = await LocalNotifications.requestPermissions(); if (local.display !== 'granted') return;
    await LocalNotifications.schedule({ notifications: [{ id: GOAL_NOTIF_ID, title: 'Objectif atteint ! 🎉', body: `Bravo : ${goalKm.toLocaleString()} km visés, ${(distanceM / 1000).toFixed(2)} km parcourus. Continuez comme ça !`, schedule: { at: new Date(Date.now() + 400) }, channelId: 'elywalk-reminders' }] });
  } catch (e) { console.warn('[notif] goal', e); }
}
async function clearTokens(uid: string): Promise<void> { const snaps = await getDocs(collection(db, 'users', uid, 'notificationTokens')); await Promise.all(snaps.docs.map(s => deleteDoc(s.ref).catch(() => undefined))); }
export async function setPushEnabled(uid: string, enabled: boolean): Promise<void> {
  await Preferences.set({ key: PREFS_PUSH, value: String(enabled) }); if (!Capacitor.isNativePlatform()) return;
  if (!enabled) { try { await PushNotifications.unregister(); } catch (e) { console.warn('[Push] unregister error', e); } await clearTokens(uid); return; }
  const push = await PushNotifications.requestPermissions(); if (push.receive !== 'granted') return;
  await installPushListener(uid); await PushNotifications.register();
}
async function installPushListener(uid: string): Promise<void> {
  if (pushListenerInstalled) return; pushListenerInstalled = true;
  await PushNotifications.addListener('registration', async ({ value }) => { const id = value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120); await setDoc(doc(db, 'users', uid, 'notificationTokens', id), { token: value, platform: Capacitor.getPlatform(), updatedAt: Date.now() }).catch(() => undefined); });
}
export async function setupNotifications(uid: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const settings = await getNotificationSettings(); await applyReminder(settings.schedule).catch(console.warn);
  if (settings.push) { await installPushListener(uid); const push = await PushNotifications.requestPermissions(); if (push.receive === 'granted') await PushNotifications.register(); }
}
