import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { LocalNotifications } from '@capacitor/local-notifications';
import { PushNotifications } from '@capacitor/push-notifications';
import { collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from './firebase';

const REMINDER_ID = 2108; // notification locale de rappel à 20 h
const PREFS_REMINDER = 'notif.reminder.enabled';
const PREFS_PUSH = 'notif.push.enabled';

export interface NotificationSettings {
  reminder: boolean;
  push: boolean;
}

let pushListenerInstalled = false;

/** Lit les préférences de notification (rappels locaux + push FCM). */
export async function getNotificationSettings(): Promise<NotificationSettings> {
  const [reminder, push] = await Promise.all([
    Preferences.get({ key: PREFS_REMINDER }),
    Preferences.get({ key: PREFS_PUSH }),
  ]);
  return {
    // Par défaut actif (comportement historique), mais désactivable.
    reminder: reminder.value !== 'false',
    push: push.value !== 'false',
  };
}

/** Programme (ou non) le rappel quotidien de validation à 20 h. */
async function applyReminder(enabled: boolean): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  if (!enabled) {
    await LocalNotifications.cancel({ notifications: [{ id: REMINDER_ID }] }).catch(() => undefined);
    return;
  }
  const local = await LocalNotifications.requestPermissions();
  if (local.display !== 'granted') return;
  await LocalNotifications.cancel({ notifications: [{ id: REMINDER_ID }] }).catch(() => undefined);
  const at = new Date();
  at.setHours(20, 0, 0, 0);
  if (at <= new Date()) at.setDate(at.getDate() + 1);
  await LocalNotifications.schedule({
    notifications: [
      {
        id: REMINDER_ID,
        title: 'Vos pas vous attendent',
        body: 'Pensez à valider vos pas ElyWalk avant minuit.',
        schedule: { at, repeats: true, every: 'day' },
        channelId: 'elywalk-reminders',
      },
    ],
  });
}

/** Active/désactive le rappel quotidien à 20 h. */
export async function setReminderEnabled(enabled: boolean): Promise<void> {
  await Preferences.set({ key: PREFS_REMINDER, value: String(enabled) });
  await applyReminder(enabled);
}

/** Supprime tous les jetons FCM de l'utilisateur (désinscription des push). */
async function clearTokens(uid: string): Promise<void> {
  const snaps = await getDocs(collection(db, 'users', uid, 'notificationTokens'));
  await Promise.all(snaps.docs.map((s) => deleteDoc(s.ref).catch(() => undefined)));
}

/** Active/désactive les push FCM (enregistrement + jetons Firestore). */
export async function setPushEnabled(uid: string, enabled: boolean): Promise<void> {
  await Preferences.set({ key: PREFS_PUSH, value: String(enabled) });
  if (!Capacitor.isNativePlatform()) return;
  if (!enabled) {
    try {
      await PushNotifications.unregister();
    } catch (e) {
      console.warn('[Push] unregister error', e);
    }
    await clearTokens(uid);
    return;
  }
  const push = await PushNotifications.requestPermissions();
  if (push.receive !== 'granted') return;
  await installPushListener(uid);
  await PushNotifications.register();
}

/** Enregistre le listener `registration` une seule fois par session. */
async function installPushListener(uid: string): Promise<void> {
  if (pushListenerInstalled) return;
  pushListenerInstalled = true;
  await PushNotifications.addListener('registration', async ({ value }) => {
    const id = value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
    await setDoc(doc(db, 'users', uid, 'notificationTokens', id), {
      token: value,
      platform: Capacitor.getPlatform(),
      updatedAt: Date.now(),
    }).catch(() => undefined);
  });
}

/**
 * Applique les préférences enregistrées à l'ouverture de session.
 * Ne demande plus aucune permission de façon inconditionnelle.
 */
export async function setupNotifications(uid: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const settings = await getNotificationSettings();
  await applyReminder(settings.reminder);
  if (settings.push) {
    await installPushListener(uid);
    const push = await PushNotifications.requestPermissions();
    if (push.receive === 'granted') await PushNotifications.register();
  }
}
