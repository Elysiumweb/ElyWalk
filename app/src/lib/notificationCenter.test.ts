import { describe, expect, it } from 'vitest';
import {
  MAX_INBOX,
  alertNotificationId,
  markAlertRead,
  markAllAlertsRead,
  normalizeAlertPreferences,
  parseInbox,
  pushAlert,
  sanitizeMinutes,
  sanitizeRadius,
  unreadAlertCount,
  type InAppAlert,
} from './notificationCenter';

/**
 * Alertes in-app et préférences (exigences produit #4 et #5).
 *
 * Sont vérifiés ici : le rayon ajustable (borné), la déduplication des alertes
 * (pas de doublon à chaque rendu), le compteur non lu, la persistance tolérante
 * et la stabilité des identifiants de notification système.
 */

const alert = (key: string, overrides: Partial<InAppAlert> = {}) => ({
  key,
  kind: 'message' as const,
  title: 'Titre',
  body: 'Corps',
  path: '/friends',
  ...overrides,
});

describe('préférences d’alerte', () => {
  it('borne le rayon des rencontres proches entre 1 et 100 km', () => {
    expect(sanitizeRadius(10)).toBe(10);
    expect(sanitizeRadius('25')).toBe(25);
    expect(sanitizeRadius(0)).toBe(1);
    expect(sanitizeRadius(-4)).toBe(1);
    expect(sanitizeRadius(500)).toBe(100);
    expect(sanitizeRadius('abc')).toBe(10);
    expect(sanitizeRadius(Number.NaN)).toBe(10);
    expect(sanitizeRadius(undefined)).toBe(10);
  });

  it('borne le délai de rappel entre 5 minutes et 24 heures', () => {
    expect(sanitizeMinutes(60)).toBe(60);
    expect(sanitizeMinutes(1)).toBe(5);
    expect(sanitizeMinutes(5000)).toBe(1440);
    expect(sanitizeMinutes('x')).toBe(60);
  });

  it('normalise une préférence partielle ou obsolète', () => {
    expect(normalizeAlertPreferences(null)).toEqual({
      messages: true,
      friendRequests: true,
      nearbyEvents: true,
      nearbyRadiusKm: 10,
      eventReminders: true,
      eventReminderMinutes: 60,
    });
    const custom = normalizeAlertPreferences({ messages: false, nearbyRadiusKm: 3, eventReminderMinutes: 15 });
    expect(custom.messages).toBe(false);
    expect(custom.nearbyRadiusKm).toBe(3);
    expect(custom.eventReminderMinutes).toBe(15);
    expect(custom.friendRequests).toBe(true);
  });
});

describe('boîte de notifications in-app', () => {
  it('ajoute en tête et ne duplique pas une clé déjà connue', () => {
    let inbox: InAppAlert[] = [];
    inbox = pushAlert(inbox, alert('message:1'));
    inbox = pushAlert(inbox, alert('message:2'));
    inbox = pushAlert(inbox, alert('message:1'));
    expect(inbox.map((item) => item.key)).toEqual(['message:2', 'message:1']);
    expect(inbox[0].read).toBe(false);
  });

  it('plafonne la boîte et oublie les plus anciennes', () => {
    let inbox: InAppAlert[] = [];
    for (let i = 0; i < MAX_INBOX + 12; i += 1) inbox = pushAlert(inbox, alert(`message:${i}`));
    expect(inbox).toHaveLength(MAX_INBOX);
    expect(inbox[0].key).toBe(`message:${MAX_INBOX + 11}`);
  });

  it('compte les non-lues et sait les marquer comme lues', () => {
    let inbox = pushAlert(pushAlert([], alert('a')), alert('b'));
    expect(unreadAlertCount(inbox)).toBe(2);
    inbox = markAlertRead(inbox, 'a');
    expect(unreadAlertCount(inbox)).toBe(1);
    inbox = markAllAlertsRead(inbox);
    expect(unreadAlertCount(inbox)).toBe(0);
    // Idempotent : une clé inconnue ne casse rien.
    expect(markAlertRead(inbox, 'inconnue')).toHaveLength(2);
  });

  it('relit une boîte persistée en tolérant les entrées invalides', () => {
    const parsed = parseInbox([
      { key: 'k1', kind: 'friend_request', title: 'Demande', body: 'Bob', path: '/friends', createdAt: 5, read: true },
      { key: '', title: 'sans clé' },
      null,
      { key: 'k2', title: 'Sans corps', path: '/events', createdAt: 'hier' },
    ]);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].read).toBe(true);
    expect(parsed[1].kind).toBe('message');
    expect(Number.isFinite(parsed[1].createdAt)).toBe(true);
    expect(parseInbox('pas un tableau')).toEqual([]);
  });

  it('garde un identifiant de notification système stable et distinct par alerte', () => {
    const a = alertNotificationId('message:abc');
    const b = alertNotificationId('message:abc');
    const c = alertNotificationId('message:abd');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    // Plage réservée, distincte des rappels quotidiens (2108-2301) et des
    // rappels de sortie (300 000+).
    for (const key of ['x', 'y', 'z', 'message:1', 'nearby:event']) {
      const id = alertNotificationId(key);
      expect(id).toBeGreaterThanOrEqual(400_000);
      expect(id).toBeLessThan(900_000);
    }
  });
});
