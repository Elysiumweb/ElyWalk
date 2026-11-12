// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach } from 'vitest';
import type { UserProfile } from '../lib/types';

/**
 * Régression « je ne vois pas les autres au classement ».
 *
 * Le classement est alimenté par `getLeaderboard`, qui lit `users`. Un profil
 * peut être **refusé par les règles** (blocage, profil privé, document
 * supprimé) : dans ce cas `getDocs` échoue pour toute la requête, pas seulement
 * pour la ligne fautive. L'écran affichait alors « Classement indisponible » ou
 * un classement réduit à l'utilisateur courant.
 *
 * Ces tests figent le comportement attendu : les autres marcheurs restent
 * visibles, et un profil illisible n'efface pas le classement.
 */

const me = {
  uid: 'me', displayName: 'Moi', photoURL: null, role: 'user', createdAt: 1,
  totalSteps: 1000, totalCalories: 10, streak: 1, todaySteps: 10, todayDate: '2026-11-12',
  elycoins: 5, referralCode: 'ME', dailyStepGoal: 10000, unitSystem: 'metric', onboardingDone: true,
} as unknown as UserProfile;

const other: UserProfile = {
  ...me, uid: 'other', displayName: 'Autre', referralCode: 'OTHER', elycoins: 42, totalSteps: 5000,
};

const third: UserProfile = { ...me, uid: 'third', displayName: 'Troisième', referralCode: 'THIRD', elycoins: 7 };

const state: {
  leaderboard: UserProfile[];
  leaderboardError?: Error;
  profiles: Record<string, UserProfile | null>;
} = { leaderboard: [other, third], profiles: {} };

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ profile: me }),
}));

vi.mock('../lib/db', () => ({
  getLeaderboard: vi.fn(async () => {
    if (state.leaderboardError) throw state.leaderboardError;
    return state.leaderboard;
  }),
  listDailySteps: vi.fn(async () => []),
  watchFriendships: vi.fn(() => () => undefined),
  getProfiles: vi.fn(async (uids: string[]) => uids.map((u) => state.profiles[u]).filter(Boolean) as UserProfile[]),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => () => undefined }));

const LeaderboardPage = (await import('../pages/LeaderboardPage')).default;

afterEach(() => {
  cleanup();
  state.leaderboard = [other, third];
  state.leaderboardError = undefined;
});

describe('Classement — visibilité des autres marcheurs', () => {
  it('affiche les autres profils et moi-même une seule fois', async () => {
    render(<LeaderboardPage />);
    const rows = await screen.findAllByTestId('leaderboard-row');
    const names = rows.map((row) => row.textContent || '');
    expect(names.some((text) => text.includes('Autre'))).toBe(true);
    expect(names.some((text) => text.includes('Troisième'))).toBe(true);
    expect(names.filter((text) => text.includes('Moi')).length).toBe(1);
  });

  it('garde le classement visible si la requête principale échoue, au lieu de tout vider', async () => {
    // Scénario réel : un profil de la collection est refusé par les règles,
    // Firestore rejette alors la requête entière.
    state.leaderboardError = Object.assign(new Error('Missing or insufficient permissions'), { code: 'permission-denied' });
    render(<LeaderboardPage />);
    // L'écran doit rester explicite (et non afficher « Aucun marcheur »).
    expect(await screen.findByTestId('error-state')).toBeTruthy();
    expect(screen.queryByTestId('leaderboard-empty-state')).toBeNull();
  });
});
