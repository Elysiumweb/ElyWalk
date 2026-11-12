import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Régression « je ne vois pas les autres au classement ».
 *
 * Firestore limite une requête à **10 appels de document** au total (pas par
 * ligne). Une règle de liste qui vérifie le blocage en consomme 2 par résultat :
 * au-delà de 5 lignes, la requête entière est refusée. L'écran ne montrait alors
 * plus que l'utilisateur courant.
 *
 * Ces tests vérifient que `getLeaderboard` retombe proprement sur une fenêtre
 * plus petite au lieu de propager l'échec.
 */

type Doc = { data: () => Record<string, unknown> };
const people = Array.from({ length: 12 }, (_, i) => ({
  uid: `u${i}`, displayName: `Marcheur ${i}`, elycoins: 100 - i * 5, totalSteps: 1000 * (i + 1),
  todaySteps: i, todayDate: '2026-11-12', referralCode: `C${i}`,
}));

const calls: Array<{ kind: 'sorted' | 'plain'; size: number }> = [];
const behavior: { failAbove: number | null } = { failAbove: null };

vi.mock('./firebase', () => ({ db: {} }));

vi.mock('firebase/firestore', () => {
  const snap = (n: number): { docs: Doc[] } => ({ docs: people.slice(0, n).map((p) => ({ data: () => p })) });
  return {
    collection: () => ({}),
    query: (_ref: unknown, ...constraints: Array<{ __limit?: number; __order?: string }>) => ({
      limit: constraints.find((c) => c.__limit != null)?.__limit ?? Infinity,
      field: constraints.find((c) => typeof c.__order === 'string')?.__order ?? null,
    }),
    orderBy: (field: string) => ({ __order: field }),
    limit: (n: number) => ({ __limit: n }),
    getDocs: async (q: { limit: number; field: string | null }) => {
      calls.push({ kind: q.field ? 'sorted' : 'plain', size: q.limit });
      // Simule le refus de Firestore quand la règle coûte trop d'appels.
      if (behavior.failAbove != null && q.limit > behavior.failAbove) {
        throw Object.assign(new Error('Missing or insufficient permissions'), { code: 'permission-denied' });
      }
      // Émule le tri serveur : sans tri, l'ordre est celui du stockage.
      const ordered = q.field
        ? [...people].sort((a, b) => Number(b[q.field as keyof typeof b]) - Number(a[q.field as keyof typeof a]))
        : people;
      return { docs: ordered.slice(0, q.limit).map((p) => ({ data: () => p })) };
    },
  };
});

const { getLeaderboard } = await import('./db');

beforeEach(() => {
  calls.length = 0;
  behavior.failAbove = null;
});

describe('getLeaderboard — repli en cascade', () => {
  it('utilise le chemin nominal quand les règles l’autorisent', async () => {
    const rows = await getLeaderboard(10, 'coins');
    expect(rows.length).toBe(10);
    expect(rows[0].uid).toBe('u0');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ kind: 'sorted', size: 10 });
  });

  it('retombe sur une fenêtre réduite si la règle refuse plus de 5 résultats', async () => {
    behavior.failAbove = 5;
    const rows = await getLeaderboard(100, 'coins');
    // La liste reste exploitable au lieu de se réduire à l'utilisateur courant.
    expect(rows.length).toBe(5);
    expect(rows.length).toBeGreaterThan(1);
    // Les tentatives ont bien été décroissantes.
    expect(calls.map((c) => c.size)).toEqual([100, 100, 5]);
  });

  it('remonte l’erreur quand aucune tentative ne passe', async () => {
    behavior.failAbove = 0;
    await expect(getLeaderboard(100, 'coins')).rejects.toThrow(/permissions/);
  });

  it('trie sur la métrique demandée, pas sur le solde', async () => {
    // `totalSteps` croît avec l'index, `elycoins` décroît : les deux tris ne
    // peuvent pas coïncider, donc un tri resté sur le solde se verrait.
    const bySteps = await getLeaderboard(3, 'steps');
    expect(bySteps.map((u) => u.uid)).toEqual(['u11', 'u10', 'u9']);
    const byCoins = await getLeaderboard(3, 'coins');
    expect(byCoins.map((u) => u.uid)).toEqual(['u0', 'u1', 'u2']);
  });
});
