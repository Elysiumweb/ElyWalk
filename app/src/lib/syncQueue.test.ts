import { beforeEach, describe, expect, it, vi } from 'vitest';

// Le stockage Capacitor est remplacé par une carte en mémoire : la file doit
// rester testable sans appareil.
const store = new Map<string, string>();
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: store.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => { store.set(key, value); },
    remove: async ({ key }: { key: string }) => { store.delete(key); },
  },
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' } }));

const queue = await import('./syncQueue');

beforeEach(async () => {
  store.clear();
  // Réinitialise l'état interne du module entre les tests.
  await queue.clearSyncQueue();
  queue.registerSyncHandler('activity.create', async () => undefined);
  queue.registerSyncHandler('activity.finish', async () => undefined);
  queue.registerSyncHandler('steps.sync', async () => undefined);
  queue.registerSyncHandler('activity.metadata', async () => undefined);
  queue.registerSyncHandler('message.send', async () => undefined);
  queue.registerSyncHandler('friendship.mutate', async () => undefined);
});

describe('file de synchronisation (F04)', () => {
  it('persiste les tâches et les rejoue dans l’ordre de création', async () => {
    // En ligne, `enqueueSync` lance déjà l'envoi : deux insertions concurrentes
    // peuvent donc partir dans un ordre quelconque. On simule un appareil hors
    // connexion pour observer l'ordre de reprise.
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true, writable: true });
    const order: string[] = [];
    queue.registerSyncHandler('activity.create', async () => { order.push('create'); });
    queue.registerSyncHandler('activity.finish', async () => { order.push('finish'); });
    await queue.enqueueSync('activity.create', { sessionId: 'a' });
    await queue.enqueueSync('activity.finish', { sessionId: 'a' });
    expect(await queue.pendingSyncCount()).toBe(2);
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
    await queue.flushSyncQueue();
    expect(order).toEqual(['create', 'finish']);
    expect(await queue.pendingSyncCount()).toBe(0);
  });

  it('remplace une tâche identique au lieu d’en empiler une seconde', async () => {
    await queue.enqueueSync('activity.finish', { sessionId: 'a', v: 1 }, { dedupeKey: 'finish:a' });
    await queue.enqueueSync('activity.finish', { sessionId: 'a', v: 2 }, { dedupeKey: 'finish:a' });
    expect(await queue.pendingSyncCount()).toBe(1);
  });

  it('conserve la tâche en échec plutôt que de perdre la sortie', async () => {
    queue.registerSyncHandler('activity.create', async () => { throw new Error('Échec réseau'); });
    await queue.enqueueSync('activity.create', { sessionId: 'b' });
    await queue.flushSyncQueue();
    const state = queue.currentSyncState();
    expect(state.pending + state.failed).toBe(1);
    expect(state.lastError).toContain('réseau');
  });

  it('abandonne une erreur de permission immédiatement (réessayer ne sert à rien)', async () => {
    queue.registerSyncHandler('activity.create', async () => { throw new Error('Missing or insufficient permissions'); });
    await queue.enqueueSync('activity.create', { sessionId: 'c' });
    await queue.flushSyncQueue();
    expect(queue.currentSyncState().failed).toBe(1);
    // Une relance manuelle rend une nouvelle chance (l'utilisateur a peut-être
    // résolu le problème entre-temps) : la tâche repart donc en attente.
    // Le gestionnaire continue d'échouer : la tâche repart en attente puis est
    // re-marquée en échec, mais elle n'a pas été silencieusement supprimée.
    await queue.retryFailedSync();
    expect(queue.currentSyncState().pending + queue.currentSyncState().failed).toBe(1);
  });

  it('applique un délai croissant borné entre deux tentatives', () => {
    expect(queue.backoffDelay(1)).toBe(5000);
    expect(queue.backoffDelay(2)).toBe(10000);
    expect(queue.backoffDelay(3)).toBe(20000);
    expect(queue.backoffDelay(50)).toBe(5 * 60 * 1000);
  });

  it('vide la file à la déconnexion (aucune fuite entre comptes)', async () => {
    await queue.enqueueSync('steps.sync', { uid: 'alice' });
    await queue.clearSyncQueue();
    expect(await queue.pendingSyncCount()).toBe(0);
  });
});
