import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * F12 — le blocage est répliqué dans les documents lus, dans **un seul lot**
 * atomique. Deux écritures séparées laisseraient un état où le blocage existe
 * sans être visible des listes : la personne bloquée réapparaîtrait.
 *
 * Ces tests vérifient le contrat observé (ce qui part dans le lot), pas
 * l'implémentation Firestore.
 */

const snap = (data: Record<string, unknown> | null) => ({
  exists: () => data !== null,
  data: () => data,
  id: 'doc',
  ref: { id: 'doc' },
});

const state = {
  users: {} as Record<string, Record<string, unknown> | null>,
  friendships: [] as { id: string; data: Record<string, unknown> }[],
  batch: [] as { kind: string; path: string; data?: Record<string, unknown> }[],
};

vi.mock('./firebase', () => ({ db: {} }));

vi.mock('firebase/firestore', () => ({
  // `doc(db, 'users', uid)` est aussi utilisé : on reconstruit le chemin pour
  // que les assertions portent sur des chemins lisibles.
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  collection: (_db: unknown, name: string) => ({ name }),
  query: (_ref: unknown, ...rest: unknown[]) => ({ rest }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  getDoc: vi.fn(async (ref: { path: string }) => {
    // `users/{uid}` : le profil est la seule collection lue en lecture directe.
    const [first, second] = ref.path.split('/');
    return first === 'users' ? snap(state.users[second] ?? null) : snap(null);
  }),
  // L'API attend des `QueryDocumentSnapshot` : `data()` et `ref` doivent être
  // des fonctions, pas les propriétés brutes du fixture.
  getDocs: vi.fn(async () => ({
    docs: state.friendships.map((d) => ({ id: d.id, data: () => d.data, ref: { path: `friendships/${d.id}` } })),
  })),
  onSnapshot: vi.fn(() => () => undefined),
  writeBatch: vi.fn(() => {
    const ops: typeof state.batch = [];
    state.batch.push(...[]);
    const api = {
      set: (ref: { path: string }, data: Record<string, unknown>) => { ops.push({ kind: 'set', path: ref.path, data }); },
      update: (ref: { path: string }, data: Record<string, unknown>) => { ops.push({ kind: 'update', path: ref.path, data }); },
      delete: (ref: { path: string }) => { ops.push({ kind: 'delete', path: ref.path }); },
      commit: async () => { state.batch.push(...ops); },
    };
    return api;
  }),
  addDoc: vi.fn(),
  setDoc: vi.fn(),
  deleteDoc: vi.fn(),
  updateDoc: vi.fn(),
  arrayUnion: vi.fn(),
  orderBy: vi.fn(),
}));

const { blockAccount, unblockAccount } = await import('./safety');

const owner = { uid: 'alice', displayName: 'Alice', blockedUsers: ['carol'] } as never;
const target = { uid: 'bob', displayName: 'Bob' } as never;

beforeEach(() => {
  state.batch = [];
  state.users = {
    alice: { uid: 'alice', blockedUsers: ['carol'], blockedBy: [] },
    bob: { uid: 'bob', blockedBy: ['dave'] },
  };
  state.friendships = [
    { id: 'f1', data: { members: ['alice', 'bob'], hiddenFor: [] } },
    { id: 'f2', data: { members: ['alice', 'carol'], hiddenFor: [] } },
  ];
});

describe('blockAccount', () => {
  it('écrit le blocage, les deux listes et le masquage dans un seul lot', async () => {
    await blockAccount(owner, target);

    const paths = state.batch.map((op) => `${op.kind}:${op.path}`).sort();
    expect(paths).toEqual([
      'set:blockedAccounts/alice_bob',
      'update:friendships/f1',
      'update:users/alice',
      'update:users/bob',
    ]);

    const alice = state.batch.find((op) => op.path === 'users/alice')!;
    expect(alice.data?.blockedUsers).toEqual(['carol', 'bob']);
    // `blockedBy` est écrit chez la cible : c'est ce qui permet à une règle de
    // liste de filtrer sans lire un document tiers (1 appel par ligne).
    const bob = state.batch.find((op) => op.path === 'users/bob')!;
    expect(bob.data?.blockedBy).toEqual(['dave', 'alice']);
    // L'amitié est masquée pour l'auteur du blocage, sans être supprimée.
    const friendship = state.batch.find((op) => op.path === 'friendships/f1')!;
    expect(friendship.data?.hiddenFor).toEqual(['alice']);
  });

  it('ne produit pas de doublon quand la personne est déjà bloquée', async () => {
    state.users.alice = { uid: 'alice', blockedUsers: ['carol', 'bob'], blockedBy: [] };
    state.users.bob = { uid: 'bob', blockedBy: ['alice'] };
    await blockAccount(owner, target);
    expect(state.batch.find((op) => op.path === 'users/alice')!.data?.blockedUsers).toEqual(['carol', 'bob']);
    expect(state.batch.find((op) => op.path === 'users/bob')!.data?.blockedBy).toEqual(['alice']);
  });

  it('refuse de se bloquer soi-même', async () => {
    await expect(blockAccount(owner, owner)).rejects.toThrow('vous bloquer vous-même');
    expect(state.batch).toHaveLength(0);
  });
});

describe('unblockAccount', () => {
  it('retire les quatre traces dans un seul lot', async () => {
    state.users.alice = { uid: 'alice', blockedUsers: ['bob'], blockedBy: [] };
    state.users.bob = { uid: 'bob', blockedBy: ['alice'] };
    state.friendships = [{ id: 'f1', data: { members: ['alice', 'bob'], hiddenFor: ['alice'] } }];

    await unblockAccount('alice', 'bob');

    const paths = state.batch.map((op) => `${op.kind}:${op.path}`).sort();
    expect(paths).toEqual([
      'delete:blockedAccounts/alice_bob',
      'update:friendships/f1',
      'update:users/alice',
      'update:users/bob',
    ]);
    expect(state.batch.find((op) => op.path === 'users/alice')!.data?.blockedUsers).toEqual([]);
    expect(state.batch.find((op) => op.path === 'users/bob')!.data?.blockedBy).toEqual([]);
    expect(state.batch.find((op) => op.path === 'friendships/f1')!.data?.hiddenFor).toEqual([]);
  });
});
