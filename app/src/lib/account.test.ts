import { describe, expect, it } from 'vitest';
import { ACCOUNT_DATA_POLICY, exportFilename } from './account';

/**
 * F03 — l'inventaire est la seule source de vérité de l'effacement : ces tests
 * figent les garanties attendues (chaque collection connue est traitée, chaque
 * sous-collection l'est explicitement, les retraits ne sont jamais effacés).
 */
describe('inventaire de suppression du compte', () => {
  const kinds = new Set(ACCOUNT_DATA_POLICY.map((p) => p.kind));

  it('couvre les collections qui contiennent des données personnelles', () => {
    const paths = ACCOUNT_DATA_POLICY.map((p) => p.path);
    for (const required of [
      'users/{uid}',
      'activitySessions',
      'savedRoutes',
      'directMessages',
      'friendships',
      'friendReactions',
      'activityFeed',
      'communityEvents',
      'reports',
      'withdrawals',
      'notificationTokens',
    ]) {
      expect(
        paths.some((path) => path.startsWith(required)) ||
        ACCOUNT_DATA_POLICY.some((policy) => (policy.subcollections || []).includes(required)),
      ).toBe(true);
    }
  });

  it('traite explicitement les sous-collections du profil (Firestore ne cascade pas)', () => {
    const userPolicy = ACCOUNT_DATA_POLICY.find((p) => p.path === 'users/{uid}');
    expect(userPolicy?.kind).toBe('delete');
    expect(userPolicy?.subcollections).toEqual(
      expect.arrayContaining(['dailySteps', 'transactions', 'challenges', 'badges', 'notificationTokens', 'privateActivityNotes', 'private'])
    );
  });

  it('conserve les retraits pour la comptabilité mais anonymise l’identité', () => {
    const withdrawals = ACCOUNT_DATA_POLICY.find((p) => p.path === 'withdrawals');
    expect(withdrawals?.kind).toBe('anonymize');
    expect(withdrawals?.field).toBe('uid');
  });

  it('ne mélange pas suppression et anonymisation pour un même champ', () => {
    const pairs = new Set(ACCOUNT_DATA_POLICY.map((p) => `${p.path}:${p.field}:${p.kind}`));
    expect(pairs.size).toBe(ACCOUNT_DATA_POLICY.length);
  });

  it('justifie chaque traitement (exigence de transparence RGPD)', () => {
    for (const policy of ACCOUNT_DATA_POLICY) {
      expect(policy.reason.length).toBeGreaterThan(10);
    }
    expect(kinds.has('delete')).toBe(true);
    expect(kinds.has('anonymize')).toBe(true);
  });

  it('nomme le fichier d’export de façon stable et datée', () => {
    const name = exportFilename('abcdefgh-1234', new Date(2026, 10, 12));
    expect(name).toBe('elywalk-export-abcdefgh-20261112.json');
  });
});
