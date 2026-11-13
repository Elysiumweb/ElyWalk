import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { LocalNotifications } from '@capacitor/local-notifications';
import { CHANNEL_EVENTS, ensureNotificationChannels } from './notifications';

/**
 * Centre de notifications in-app et préférences d'alerte.
 *
 * Deux manques étaient signalés :
 *  - « on ne voit pas qu'on a reçu un message » (aucun retour in-app) ;
 *  - aucun réglage pour les alertes de rencontre dans un rayon donné, ni pour
 *    le rappel d'une rencontre à laquelle on est inscrit.
 *
 * Ce module rassemble :
 *  1. les **préférences** (messages, demandes d'ami, rencontres proches avec
 *     rayon ajustable, rappels d'inscription), persistées sur l'appareil ;
 *  2. une **file d'alertes** in-app (cloche + panneau), persistée pour ne pas
 *     rejouer deux fois la même alerte au redémarrage ;
 *  3. la **pose de notifications locales** pour les alertes qui n'ont pas de
 *     push serveur (message reçu app ouverte, rencontre proche, rappel
 *     d'inscription avant le départ).
 */

// ---------------------------------------------------------------------------
// Préférences
// ---------------------------------------------------------------------------

export interface AlertPreferences {
  /** Nouveau message d'un ami. */
  messages: boolean;
  /** Demande d'ami reçue. */
  friendRequests: boolean;
  /** Rencontre proposée dans un rayon donné. */
  nearbyEvents: boolean;
  /** Rayon des rencontres proches, en kilomètres (1 à 100). */
  nearbyRadiusKm: number;
  /** Rappel avant une rencontre à laquelle je suis inscrit. */
  eventReminders: boolean;
  /** Délai du rappel avant le départ, en minutes. */
  eventReminderMinutes: number;
}

export const DEFAULT_ALERT_PREFERENCES: AlertPreferences = {
  messages: true,
  friendRequests: true,
  nearbyEvents: true,
  nearbyRadiusKm: 10,
  eventReminders: true,
  eventReminderMinutes: 60,
};

const PREFS_KEY = 'alerts.preferences.v1';

export function sanitizeRadius(value: unknown, fallback = DEFAULT_ALERT_PREFERENCES.nearbyRadiusKm): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(1, Math.round(n)));
}

export function sanitizeMinutes(value: unknown, fallback = DEFAULT_ALERT_PREFERENCES.eventReminderMinutes): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(24 * 60, Math.max(5, Math.round(n)));
}

/** Normalise une préférence lue sur l'appareil (valeur partielle ou obsolète). */
export function normalizeAlertPreferences(raw: unknown): AlertPreferences {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<AlertPreferences>;
  return {
    messages: value.messages !== false,
    friendRequests: value.friendRequests !== false,
    nearbyEvents: value.nearbyEvents !== false,
    nearbyRadiusKm: sanitizeRadius(value.nearbyRadiusKm),
    eventReminders: value.eventReminders !== false,
    eventReminderMinutes: sanitizeMinutes(value.eventReminderMinutes),
  };
}

export async function getAlertPreferences(): Promise<AlertPreferences> {
  try {
    const stored = await Preferences.get({ key: PREFS_KEY });
    if (!stored.value) return { ...DEFAULT_ALERT_PREFERENCES };
    return normalizeAlertPreferences(JSON.parse(stored.value));
  } catch {
    return { ...DEFAULT_ALERT_PREFERENCES };
  }
}

export async function setAlertPreferences(next: AlertPreferences): Promise<AlertPreferences> {
  const clean = normalizeAlertPreferences(next);
  await Preferences.set({ key: PREFS_KEY, value: JSON.stringify(clean) });
  return clean;
}

// ---------------------------------------------------------------------------
// File d'alertes in-app
// ---------------------------------------------------------------------------

export type InAppAlertKind = 'message' | 'friend_request' | 'event_nearby' | 'event_reminder';

export interface InAppAlert {
  /** Clé stable : empêche de créer deux alertes identiques. */
  key: string;
  kind: InAppAlertKind;
  title: string;
  body: string;
  /** Chemin de navigation au clic. */
  path: string;
  createdAt: number;
  read: boolean;
}

const ALERTS_KEY = 'alerts.inbox.v1';
/** Borne de la boîte : au-delà, les plus anciennes sont oubliées. */
export const MAX_INBOX = 50;

/** Ajoute une alerte en tête de file (dédoublonnée par `key`). */
export function pushAlert(inbox: InAppAlert[], alert: Omit<InAppAlert, 'createdAt' | 'read'> & { createdAt?: number }): InAppAlert[] {
  if (inbox.some((item) => item.key === alert.key)) return inbox;
  const entry: InAppAlert = {
    ...alert,
    createdAt: alert.createdAt ?? Date.now(),
    read: false,
  };
  return [entry, ...inbox].slice(0, MAX_INBOX);
}

export function markAlertRead(inbox: InAppAlert[], key: string): InAppAlert[] {
  return inbox.map((item) => (item.key === key ? { ...item, read: true } : item));
}

export function markAllAlertsRead(inbox: InAppAlert[]): InAppAlert[] {
  return inbox.map((item) => (item.read ? item : { ...item, read: true }));
}

export function unreadAlertCount(inbox: InAppAlert[]): number {
  return inbox.reduce((count, item) => (item.read ? count : count + 1), 0);
}

/** Nettoie une boîte lue depuis le stockage (tolère les anciennes formes). */
export function parseInbox(raw: unknown): InAppAlert[] {
  if (!Array.isArray(raw)) return [];
  const out: InAppAlert[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const value = item as Partial<InAppAlert>;
    if (!value.key || !value.title) continue;
    out.push({
      key: String(value.key),
      kind: (value.kind as InAppAlertKind) || 'message',
      title: String(value.title),
      body: String(value.body || ''),
      path: String(value.path || '/'),
      createdAt: Number(value.createdAt) || Date.now(),
      read: value.read === true,
    });
  }
  return out.slice(0, MAX_INBOX);
}

export async function loadInbox(): Promise<InAppAlert[]> {
  try {
    const stored = await Preferences.get({ key: ALERTS_KEY });
    if (!stored.value) return [];
    return parseInbox(JSON.parse(stored.value));
  } catch {
    return [];
  }
}

export async function saveInbox(inbox: InAppAlert[]): Promise<void> {
  try {
    await Preferences.set({ key: ALERTS_KEY, value: JSON.stringify(inbox.slice(0, MAX_INBOX)) });
  } catch {
    /* stockage indisponible : la boîte reste utilisable en mémoire */
  }
}

// ---------------------------------------------------------------------------
// Notifications locales (message, rencontre proche, rappel d'inscription)
// ---------------------------------------------------------------------------

/**
 * Identifiants stables : Android remplace une notification de même id, donc une
 * alerte répétée ne s'empile pas. Plage distincte des rappels quotidiens
 * (2108-2114), de l'objectif (2301) et des rappels de sortie (300 000+).
 */
export function alertNotificationId(key: string): number {
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return 400_000 + (Math.abs(hash) % 500_000);
}

/**
 * Affiche une notification système pour une alerte sans équivalent push.
 * Ne fait jamais échouer l'appelant : sans permission ou hors natif, la file
 * in-app reste seule source de vérité.
 */
export async function notifyLocally(alert: {
  key: string;
  title: string;
  body: string;
  path: string;
  at?: Date;
}): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await ensureNotificationChannels();
    const permission = await LocalNotifications.checkPermissions().catch(() => null);
    if (permission?.display !== 'granted') {
      const request = await LocalNotifications.requestPermissions().catch(() => null);
      if (request?.display !== 'granted') return;
    }
    await LocalNotifications.schedule({
      notifications: [
        {
          id: alertNotificationId(alert.key),
          title: alert.title,
          body: alert.body,
          schedule: { at: alert.at || new Date(Date.now() + 400) },
          channelId: CHANNEL_EVENTS,
          extra: { url: alert.path, key: alert.key },
        },
      ],
    });
  } catch (e) {
    console.warn('[notif] alerte locale', e);
  }
}

/** Annule une notification locale programmée (rappel d'inscription annulé…). */
export async function cancelLocalAlert(key: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await LocalNotifications.cancel({ notifications: [{ id: alertNotificationId(key) }] }).catch(() => undefined);
}
