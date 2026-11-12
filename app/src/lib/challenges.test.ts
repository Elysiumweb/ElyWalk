import { describe, expect, it, vi } from 'vitest';

vi.mock('./firebase', () => ({ db: {} }));
vi.mock('./constants', () => ({
  isPresidentUid: (uid?: string) => uid === 'president',
  getChallengeDefinitions: (now = new Date()) => {
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return [
      { id: `week-steps-${iso(now)}`, title: 'Sprint collectif', description: '', kind: 'collective', metric: 'steps', target: 250000, reward: 25, startsAt: iso(now), endsAt: iso(now), icon: '🌍' },
      { id: `season-${iso(now).slice(0, 7)}`, title: 'Saison', description: '', kind: 'seasonal', metric: 'steps', target: 100000, reward: 40, startsAt: iso(now), endsAt: iso(now), icon: '🏆' },
    ];
  },
}));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  doc: () => ({}),
  getDocs: async () => { throw new Error('hors ligne'); },
  setDoc: async () => undefined,
  deleteDoc: async () => undefined,
}));

const lib = await import('./challenges');
type Entry = import('./challenges').ChallengeCatalogEntry;

describe('catalogue des défis (F02)', () => {
  it('dérive les identifiants du jour au lieu de les recopier', () => {
    const rows = lib.catalogEntriesForToday(new Date(2026, 10, 12));
    expect(rows.map((r) => r.id)).toEqual(['week-steps-2026-11-12', 'season-2026-11']);
    expect(rows[0].entry).toMatchObject({ active: true, reward: 25, target: 250000 });
    expect(rows[0].entry.updatedAt).toBeGreaterThan(0);
  });

  it('refuse la publication à un compte non administrateur', async () => {
    await expect(lib.publishChallengeCatalog('alice')).rejects.toThrow(/administration/);
    await expect(lib.closeChallengeCatalogEntry('alice', 'season-2026-11')).rejects.toThrow(/administration/);
  });

  it('distingue ouvert, fermé et absent (un absent ne rémunère pas)', () => {
    const definitions = lib.catalogEntriesForToday(new Date(2026, 10, 12)).map((r) => ({
      id: r.id, title: r.entry.title || '', description: '', kind: 'personal' as const,
      metric: 'steps' as const, target: r.entry.target, reward: r.entry.reward,
      startsAt: r.entry.startsAt, endsAt: r.entry.endsAt, icon: '',
    }));
    const catalog = new Map<string, Entry>([
      ['week-steps-2026-11-12', { active: true, reward: 30, target: 250000, startsAt: '2026-11-09', endsAt: '2026-11-15', updatedAt: 1 }],
      ['season-2026-11', { active: false, reward: 40, target: 100000, startsAt: '2026-11-01', endsAt: '2026-11-30', updatedAt: 1 }],
    ]);
    const states = lib.describeCatalogState(definitions, catalog);
    expect(states.map((s) => s.state)).toEqual(['paid', 'closed']);
    expect(states[0].reward).toBe(30);
    const missing = lib.describeCatalogState(definitions, new Map());
    expect(missing.every((s) => s.state === 'missing')).toBe(true);
  });
});
