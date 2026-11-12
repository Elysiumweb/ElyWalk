/**
 * File d'envoi persistante et verifiable (F04).
 *
 * Aujourd'hui, une sortie vécue hors connexion existe (écran, stockage local)
 * mais n'est jamais rejouée : à la réouverture, elle a disparu. Ce module rend
 * la synchronisation explicite :
 *
 *  1. **Chaque écriture réseau passe par une tâche** décrite par des données
 *     (`type` + `payload`), sérialisée dans `Preferences` — donc survivante à un
 *     redémarrage de l'application, à une coupure réseau et à un crash.
 *  2. **Les tâches sont idempotentes** : la sortie porte un identifiant généré
 *     sur l'appareil, un renvoi met à jour le même document au lieu d'en créer
 *     un doublon.
 *  3. **L'état est visible** : `subscribeQueue` expose le nombre de tâches en
 *     attente, l'écran affiche « synchronisation en attente » et une action
 *     manuelle de relance.
 *  4. **La reprise est séquentielle et bornée** : une seule boucle à la fois,
 *     avec un plafond de tentatives et un délai croissant, pour ne pas marteler
 *     le réseau ni vider la batterie.
 */

import { Preferences } from '@capacitor/preferences';
import { Capacitor } from '@capacitor/core';

const STORAGE_KEY = 'sync.queue.v1';
const MAX_ATTEMPTS = 8;
const MAX_TASKS = 500;
/** Base du délai croissant : 5 s, 10 s, 20 s… plafonné à 5 min. */
const BACKOFF_BASE_MS = 5000;
const BACKOFF_CAP_MS = 5 * 60 * 1000;

export type SyncTaskType =
  | 'activity.create'
  | 'activity.finish'
  | 'steps.sync'
  | 'activity.metadata'
  | 'message.send'
  | 'friendship.mutate';

export interface SyncTask {
  id: string;
  type: SyncTaskType;
  /** Données nécessaires à l'exécution (sérialisables). */
  payload: Record<string, unknown>;
  createdAt: number;
  attempts: number;
  lastAttemptAt?: number;
  lastError?: string;
}

export interface SyncState {
  pending: number;
  failed: number;
  /** Dernière exécution réussie (epoch ms), pour l'écran de statut. */
  lastSyncedAt?: number;
  /** Premier message d'erreur rencontré, affichable tel quel. */
  lastError?: string;
  running: boolean;
  online: boolean;
}

type Listener = (state: SyncState) => void;

const listeners = new Set<Listener>();
let tasks: SyncTask[] = [];
let loaded = false;
let running: Promise<void> | null = null;
let lastSyncedAt: number | undefined;
let lastError: string | undefined;

/** Exécuteur enregistré par la couche données (évite un import circulaire). */
type Handler = (task: SyncTask) => Promise<void>;
const handlers = new Map<SyncTaskType, Handler>();

export function registerSyncHandler(type: SyncTaskType, handler: Handler): void {
  handlers.set(type, handler);
}

function isOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  // `onLine` n'est pas fiable à 100 %, mais il évite d'essayer en avion.
  return navigator.onLine !== false;
}

function snapshot(): SyncState {
  const pending = tasks.filter((t) => t.attempts < MAX_ATTEMPTS).length;
  return {
    pending,
    failed: tasks.length - pending,
    lastSyncedAt,
    lastError,
    running: running !== null,
    online: isOnline(),
  };
}

function emit(): void {
  const state = snapshot();
  listeners.forEach((listener) => {
    try {
      listener(state);
    } catch {
      /* un abonné fautif ne doit pas bloquer la file */
    }
  });
}

async function persist(): Promise<void> {
  try {
    await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify({ tasks, lastSyncedAt }) });
  } catch (e) {
    console.warn('[sync] persistance impossible', (e as Error).message);
  }
}

/** Charge la file depuis le stockage (une seule fois). */
export async function loadSyncQueue(): Promise<SyncTask[]> {
  if (loaded) return tasks;
  loaded = true;
  try {
    const { value } = await Preferences.get({ key: STORAGE_KEY });
    if (value) {
      const parsed = JSON.parse(value) as { tasks?: SyncTask[]; lastSyncedAt?: number };
      tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
      lastSyncedAt = parsed.lastSyncedAt;
    }
  } catch (e) {
    console.warn('[sync] file illisible, on repart à vide', (e as Error).message);
    tasks = [];
  }
  emit();
  return tasks;
}

export function subscribeQueue(listener: Listener): () => void {
  listeners.add(listener);
  listener(snapshot());
  return () => listeners.delete(listener);
}

export function currentSyncState(): SyncState {
  return snapshot();
}

/** Identifiant de tâche stable, lisible dans les journaux. */
function newTaskId(type: SyncTaskType): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${type}-${Date.now().toString(36)}-${random}`;
}

/**
 * Ajoute une tâche. Si une tâche identique (même `dedupeKey`) est déjà en
 * attente, elle est remplacée : appuyer dix fois sur « terminer » hors ligne ne
 * crée pas dix envois.
 */
export async function enqueueSync(
  type: SyncTaskType,
  payload: Record<string, unknown>,
  options: { dedupeKey?: string } = {}
): Promise<SyncTask> {
  await loadSyncQueue();
  const existing = options.dedupeKey
    ? tasks.find((t) => t.payload.dedupeKey === options.dedupeKey && t.type === type)
    : undefined;
  if (existing) {
    existing.payload = { ...payload, dedupeKey: options.dedupeKey };
    existing.attempts = 0;
    existing.lastError = undefined;
    await persist();
    emit();
    return existing;
  }
  const task: SyncTask = {
    id: newTaskId(type),
    type,
    payload: options.dedupeKey ? { ...payload, dedupeKey: options.dedupeKey } : payload,
    createdAt: Date.now(),
    attempts: 0,
  };
  tasks = [...tasks, task].slice(-MAX_TASKS);
  await persist();
  emit();
  // Tentative immédiate : en ligne, la sortie part sans attendre l'écran suivant.
  if (isOnline()) void flushSyncQueue();
  return task;
}

/** Retire une tâche (exécutée ou abandonnée). */
async function removeTask(id: string): Promise<void> {
  tasks = tasks.filter((t) => t.id !== id);
  await persist();
}

/** Délai avant nouvelle tentative (exporté pour les tests). */
export function backoffDelay(attempts: number): number {
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1));
}

function shouldRetry(task: SyncTask, now = Date.now()): boolean {
  if (task.attempts >= MAX_ATTEMPTS) return false;
  if (!task.lastAttemptAt) return true;
  return now - task.lastAttemptAt >= backoffDelay(task.attempts);
}

/**
 * Rejoue la file, séquentiellement. Ne lève jamais : l'appelant est un effet de
 * bord (retour de connexion, ouverture de l'app, bouton « Réessayer »).
 */
export async function flushSyncQueue(): Promise<void> {
  if (running) return running;
  await loadSyncQueue();
  if (!isOnline()) {
    emit();
    return;
  }
  running = (async () => {
    emit();
    for (const task of [...tasks].sort((a, b) => a.createdAt - b.createdAt)) {
      if (!shouldRetry(task)) continue;
      const handler = handlers.get(task.type);
      if (!handler) {
        // Aucun exécuteur : la version de l'app a changé entre l'enregistrement
        // et la reprise. On garde la tâche visible en échec plutôt que de
        // jeter silencieusement la sortie de l'utilisateur.
        task.lastError = 'Synchronisation indisponible dans cette version.';
        continue;
      }
      task.attempts += 1;
      task.lastAttemptAt = Date.now();
      try {
        await handler(task);
        await removeTask(task.id);
        lastSyncedAt = Date.now();
        lastError = undefined;
      } catch (e) {
        task.lastError = (e as Error).message || 'Échec réseau';
        lastError = task.lastError;
        await persist();
        // Erreur de règles ou de validation : réessayer n'y changera rien.
        if (/permission|insufficient|invalid|not-found/i.test(task.lastError)) {
          task.attempts = MAX_ATTEMPTS;
        }
      }
    }
    await persist();
  })();
  try {
    await running;
  } finally {
    running = null;
    emit();
  }
}

/** Relance manuelle (bouton « Réessayer » de l'écran de statut). */
export async function retryFailedSync(): Promise<void> {
  tasks.forEach((task) => {
    if (task.attempts >= MAX_ATTEMPTS) {
      task.attempts = 0;
      task.lastAttemptAt = undefined;
    }
  });
  await persist();
  emit();
  await flushSyncQueue();
}

/** Vide la file (déconnexion : les tâches appartiennent au compte précédent). */
export async function clearSyncQueue(): Promise<void> {
  tasks = [];
  lastError = undefined;
  lastSyncedAt = undefined;
  await persist();
  emit();
}

/** Nombre de tâches en attente, sans abonnement. */
export async function pendingSyncCount(): Promise<number> {
  await loadSyncQueue();
  return tasks.filter((t) => t.attempts < MAX_ATTEMPTS).length;
}

/**
 * Branche les événements réseau. Retourne la fonction de nettoyage.
 * Sur natif, Capacitor expose aussi `@capacitor/network` ; on s'appuie d'abord
 * sur les événements navigateur (présents dans la WebView) pour ne pas ajouter
 * de dépendance.
 */
export function watchConnectivity(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onOnline = () => {
    emit();
    void flushSyncQueue();
  };
  const onOffline = () => emit();
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  // Sur natif, la reprise après mise en arrière-plan se fait à la reprise de
  // l'app (`App` listener) : on expose aussi une fonction dédiée.
  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
}

/** `true` sur un appareil où `Preferences` est persistant (toujours le cas). */
export function syncStorageAvailable(): boolean {
  return typeof Preferences !== 'undefined' || Capacitor.isNativePlatform();
}
