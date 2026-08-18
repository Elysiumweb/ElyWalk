import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { PushNotifications } from '@capacitor/push-notifications';
import { doc, setDoc } from 'firebase/firestore';
import { db } from './firebase';

export async function setupNotifications(uid: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const local = await LocalNotifications.requestPermissions();
  if (local.display === 'granted') {
    await LocalNotifications.cancel({ notifications: [{ id: 2108 }] }).catch(() => undefined);
    const at = new Date(); at.setHours(20, 0, 0, 0); if (at <= new Date()) at.setDate(at.getDate() + 1);
    await LocalNotifications.schedule({ notifications: [{ id: 2108, title: 'Vos pas vous attendent', body: 'Pensez à valider vos pas ElyWalk avant minuit.', schedule: { at, repeats: true, every: 'day' }, channelId: 'elywalk-reminders' }] });
  }
  const push = await PushNotifications.requestPermissions();
  if (push.receive === 'granted') {
    await PushNotifications.register();
    await PushNotifications.addListener('registration', async ({ value }) => {
      const id = value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
      await setDoc(doc(db, 'users', uid, 'notificationTokens', id), { token: value, platform: Capacitor.getPlatform(), updatedAt: Date.now() });
    });
  }
}
