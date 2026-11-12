import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { LocalNotifications } from '@capacitor/local-notifications';
import { PushNotifications } from '@capacitor/push-notifications';
import { App as CapApp } from '@capacitor/app';
import { collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from './firebase';

const GOAL_NOTIF_ID = 2301;
const PREFS_REMINDER = 'notif.reminder.enabled';
const PREFS_PUSH = 'notif.push.enabled';
const PREFS_SCHEDULE = 'notif.reminder.schedule.v2';
const PREFS_TOKEN = 'notif.push.token';
const PREFS_PUSH_UID = 'notif.push.uid';
const REMINDER_IDS = [2108, 2109, 2110, 2111, 2112, 2113, 2114];

/** Canaux Android créés par l'application (§ notifications qui ne s'affichent pas). */
export const CHANNEL_REMINDERS = 'elywalk-reminders';
export const CHANNEL_EVENTS = 'elywalk-events';

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

// ---------------------------------------------------------------------------
// Canaux Android
// ---------------------------------------------------------------------------
/**
 * Crée les canaux de notification Android.
 *
 * Android 8+ **ignore silencieusement** toute notification dont le `channelId`
 * n'existe pas : les rappels et les alertes d'objectif étaient programmés sur
 * `elywalk-reminders` / `elywalk-events` sans que ces canaux soient jamais
 * créés, donc rien ne s'affichait — d'où le retour « les notifications ne
 * fonctionnent pas ». La création est idempotente : Android conserve les
 * réglages utilisateur d'un canal déjà existant.
 */
export async function ensureNotificationChannels(): Promise<void> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
  const channels = [
    { id: CHANNEL_REMINDERS, name: 'Rappels de marche', description: 'Rappels quotidiens et objectif atteint', importance: 3 as const, visibility: 1 as const },
    { id: CHANNEL_EVENTS, name: 'Rencontres et compte', description: 'Rappels de sortie, demandes d’ami, retraits', importance: 4 as const, visibility: 1 as const },
  ];
  for (const channel of channels) {
    await LocalNotifications.createChannel({
      id: channel.id,
      name: channel.name,
      description: channel.description,
      importance: channel.importance,
      visibility: channel.visibility,
      vibration: true,
      lights: true,
      lightColor: '#D8CA82',
    }).catch((e) => console.warn('[notif] canal', channel.id, e));
  }
}

async function requestDisplayPermission(): Promise<boolean> {
  const local = await LocalNotifications.requestPermissions().catch(() => null);
  return local?.display === 'granted';
}

async function applyReminder(schedule: ReminderSchedule): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await LocalNotifications.cancel({ notifications: REMINDER_IDS.map(id => ({ id })) }).catch(() => undefined);
  if (!schedule.enabled || schedule.days.length === 0) return;
  if (isQuietTime(schedule.time, schedule.quietStart, schedule.quietEnd)) throw new Error('L’heure choisie se trouve dans la plage silencieuse.');
  await ensureNotificationChannels();
  if (!(await requestDisplayPermission())) throw new Error('Autorisez les notifications pour recevoir vos rappels.');
  await LocalNotifications.schedule({ notifications: schedule.days.map((day, index) => ({
    id: REMINDER_IDS[index], title: 'Vos pas vous attendent',
    body: schedule.goalAware ? 'Votre objectif du jour vous attend : marchez à votre rythme, puis validez vos pas.' : 'Pensez à valider vos pas ElyWalk avant minuit.',
    schedule: { at: nextReminder(day, schedule.time), repeats: true, every: 'week' }, channelId: CHANNEL_REMINDERS,
  })) });
}
export async function setReminderSchedule(schedule: ReminderSchedule): Promise<void> {
  if (schedule.enabled && schedule.days.length === 0) throw new Error('Choisissez au moins un jour.');
  if (schedule.enabled && isQuietTime(schedule.time, schedule.quietStart, schedule.quietEnd)) throw new Error('L’heure choisie se trouve dans la plage silencieuse.');
  // L'enregistrement précède la programmation : si la permission est refusée,
  // le réglage reste lisible et l'utilisateur peut la réaccorder ensuite.
  await Preferences.set({ key: PREFS_SCHEDULE, value: JSON.stringify(schedule) });
  await Preferences.set({ key: PREFS_REMINDER, value: String(schedule.enabled) });
  await applyReminder(schedule);
}
export async function setReminderEnabled(enabled: boolean): Promise<void> { await setReminderSchedule({ ...(await getReminderSchedule()), enabled }); }

export async function notifyActivityGoal(goalKm: number, distanceM: number): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await ensureNotificationChannels();
    if (!(await requestDisplayPermission())) return;
    await LocalNotifications.schedule({ notifications: [{ id: GOAL_NOTIF_ID, title: 'Objectif atteint ! 🎉', body: `Bravo : ${goalKm.toLocaleString()} km visés, ${(distanceM / 1000).toFixed(2)} km parcourus. Continuez comme ça !`, schedule: { at: new Date(Date.now() + 400) }, channelId: CHANNEL_REMINDERS }] });
  } catch (e) { console.warn('[notif] goal', e); }
}

// ---------------------------------------------------------------------------
// Push FCM — un jeton par appareil, rattaché au compte courant
// ---------------------------------------------------------------------------
/**
 * Enregistre le jeton de l'appareil **courant**.
 *
 * Avant, le listener `registration` était installé une seule fois et capturait
 * le premier UID : après un changement de compte, le jeton restait rangé sous
 * l'ancien profil (et l'ancien compte recevait les notifications du nouveau).
 * De plus, désactiver les push effaçait **tous** les jetons du compte, donc les
 * autres appareils cessaient aussi d'être notifiés.
 *
 * Désormais : le jeton est conservé localement, écrit sous l'UID courant, et
 * supprimé de l'UID précédent lors d'une déconnexion ou d'un changement de
 * compte (`syncPushRegistration`).
 */
let listenersInstalled = false;
let currentUid: string | null = null;

function sanitizeToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
}

async function storeToken(uid: string, token: string): Promise<void> {
  const id = sanitizeToken(token);
  if (!id) return;
  await Preferences.set({ key: PREFS_TOKEN, value: token });
  await setDoc(doc(db, 'users', uid, 'notificationTokens', id), {
    token,
    platform: Capacitor.getPlatform(),
    updatedAt: Date.now(),
    // Identifiant de l'installation : permet de ne supprimer QUE le jeton de
    // cet appareil lors d'une désactivation locale.
    deviceId: id,
  }).catch(() => undefined);
}

async function removeToken(uid: string, token: string): Promise<void> {
  const id = sanitizeToken(token);
  if (!id) return;
  await deleteDoc(doc(db, 'users', uid, 'notificationTokens', id)).catch(() => undefined);
}

/**
 * Retire **tous** les jetons d'un compte — réservé à la suppression de compte
 * (RGPD). La désactivation des push sur un téléphone ne passe jamais par ici :
 * elle ne doit pas couper les notifications des autres appareils du compte.
 */
export async function removeAllTokens(uid: string): Promise<void> {
  const snaps = await getDocs(collection(db, 'users', uid, 'notificationTokens'));
  await Promise.all(snaps.docs.map(s => deleteDoc(s.ref).catch(() => undefined)));
}

function installPushListeners(): void {
  if (listenersInstalled) return;
  listenersInstalled = true;
  PushNotifications.addListener('registration', async ({ value }) => {
    const uid = currentUid;
    if (!uid) return;
    await storeToken(uid, value);
  }).catch(() => undefined);
  PushNotifications.addListener('registrationError', (error) => {
    console.warn('[Push] enregistrement impossible', error);
  }).catch(() => undefined);
  // Ouverture d'une notification : on transmet la destination à l'application.
  PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    const data = (action?.notification?.data || {}) as Record<string, string>;
    routeNotification(data);
  }).catch(() => undefined);
}

/**
 * Navigue vers l'écran concerné quand une notification est touchée (F11) :
 * les notifications de sortie ouvrent les Rencontres, une demande d'ami les
 * Amis, un retrait le portefeuille… Sans cela, toucher une notification
 * ouvrait simplement l'écran d'accueil.
 */
export function routeNotification(data: Record<string, string>): void {
  if (typeof window === 'undefined') return;
  const type = data.type || '';
  const target =
    type === 'friend_request' ? '/friends'
    : type === 'withdrawal' ? '/wallet'
    : type === 'event' ? '/events'
    : data.url || '/';
  window.dispatchEvent(new CustomEvent('elywalk:navigate', { detail: { path: target, data } }));
}

export async function setPushEnabled(uid: string, enabled: boolean): Promise<void> {
  await Preferences.set({ key: PREFS_PUSH, value: String(enabled) });
  if (!Capacitor.isNativePlatform()) return;
  if (!enabled) {
    try { await PushNotifications.unregister(); } catch (e) { console.warn('[Push] unregister error', e); }
    // Seul le jeton de CET appareil est retiré : les autres téléphones du même
    // compte continuent de recevoir leurs notifications.
    const stored = await Preferences.get({ key: PREFS_TOKEN });
    if (stored.value) await removeToken(uid, stored.value);
    await Preferences.remove({ key: PREFS_TOKEN });
    return;
  }
  const push = await PushNotifications.requestPermissions();
  if (push.receive !== 'granted') throw new Error('Autorisez les notifications pour recevoir les alertes.');
  currentUid = uid;
  await Preferences.set({ key: PREFS_PUSH_UID, value: uid });
  installPushListeners();
  await PushNotifications.register();
}

/**
 * Point d'entrée unique appelé à la connexion **et** à la déconnexion.
 *
 * - connexion : installe les listeners avec le bon UID et réenregistre le
 *   jeton (Android ne le régénère pas toujours) ;
 * - déconnexion (`uid = null`) : supprime le jeton de l'appareil du compte
 *   précédent pour qu'il ne continue pas à recevoir des notifications.
 */
export async function syncPushRegistration(uid: string | null): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    currentUid = uid;
    return;
  }
  const previous = currentUid || (await Preferences.get({ key: PREFS_PUSH_UID })).value;
  if (!uid) {
    const stored = await Preferences.get({ key: PREFS_TOKEN });
    if (previous && stored.value) await removeToken(previous, stored.value);
    await Preferences.remove({ key: PREFS_TOKEN });
    await Preferences.remove({ key: PREFS_PUSH_UID });
    currentUid = null;
    return;
  }
  if (previous && previous !== uid) {
    // Changement de compte sur le même appareil : le jeton ne doit plus être
    // rangé sous l'ancien profil.
    const stored = await Preferences.get({ key: PREFS_TOKEN });
    if (stored.value) await removeToken(previous, stored.value);
  }
  currentUid = uid;
  await Preferences.set({ key: PREFS_PUSH_UID, value: uid });
  const settings = await getNotificationSettings();
  if (!settings.push) return;
  installPushListeners();
  const push = await PushNotifications.requestPermissions().catch(() => null);
  if (push?.receive === 'granted') {
    await PushNotifications.register();
    const stored = await Preferences.get({ key: PREFS_TOKEN });
    if (stored.value) await storeToken(uid, stored.value);
  }
}

/** Écoute l'ouverture d'un lien de notification quand l'app était fermée. */
export function listenNotificationNavigation(onNavigate: (path: string) => void): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ path: string }>).detail;
    if (detail?.path) onNavigate(detail.path);
  };
  window.addEventListener('elywalk:navigate', handler as EventListener);
  const sub = CapApp.addListener('appUrlOpen', (event) => {
    if (event.url?.includes('/events')) onNavigate('/events');
    else if (event.url?.includes('/friends')) onNavigate('/friends');
  });
  return () => {
    window.removeEventListener('elywalk:navigate', handler as EventListener);
    void sub.then((handle) => handle.remove());
  };
}

export async function setupNotifications(uid: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    currentUid = uid;
    return;
  }
  await ensureNotificationChannels();
  const settings = await getNotificationSettings();
  await applyReminder(settings.schedule).catch(console.warn);
  if (settings.push) await syncPushRegistration(uid);
  else currentUid = uid;
}

/**
 * État réel des notifications, pour l'écran de diagnostic (F06).
 * Sans cela, « les notifications ne marchent pas » ne peut pas être distingué
 * entre permission refusée, jeton non enregistré et canal absent.
 */
export async function notificationDiagnostics(): Promise<{
  permission: string;
  token: string | null;
  channels: string[];
  scheduledReminders: number;
}> {
  if (!Capacitor.isNativePlatform()) {
    return { permission: 'indisponible (web)', token: null, channels: [], scheduledReminders: 0 };
  }
  let permission = 'inconnue';
  try {
    const status = await LocalNotifications.checkPermissions();
    permission = status.display;
  } catch {
    permission = 'indisponible';
  }
  let token: string | null = null;
  try {
    const stored = await Preferences.get({ key: PREFS_TOKEN });
    token = stored.value || null;
  } catch { token = null; }
  let scheduledReminders = 0;
  try {
    const pending = await LocalNotifications.getPending();
    scheduledReminders = pending.notifications?.length || 0;
  } catch { scheduledReminders = 0; }
  return { permission, token, channels: ['elywalk-reminders', 'elywalk-events'], scheduledReminders };
}
