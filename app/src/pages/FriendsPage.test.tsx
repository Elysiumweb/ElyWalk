// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { UserProfile } from '../lib/types';

/**
 * Régression « les amis chargent en boucle ».
 *
 * `watchFriendships` est un `onSnapshot`. Sans gestionnaire d'erreur, un refus
 * de règle (budget de 10 accès document dépassé par les vérifications de
 * blocage) n'appelait **jamais** le callback : `setLoading(false)` ne passait
 * pas et l'écran restait sur « Chargement de vos amis » indéfiniment.
 *
 * Ces tests figent le comportement attendu : sortir du chargement, afficher
 * une erreur, et relancer réellement les abonnements au clic sur « Réessayer ».
 */

const me = {
  uid: 'me', displayName: 'Moi', photoURL: null, role: 'user', createdAt: 1,
  totalSteps: 10, totalCalories: 1, streak: 1, todaySteps: 1, todayDate: '2026-11-12',
  elycoins: 0, referralCode: 'HNNGXQ', dailyStepGoal: 10000, unitSystem: 'metric',
} as unknown as UserProfile;

const friend: UserProfile = { ...me, uid: 'ami', displayName: 'Ami Fidèle', referralCode: 'AMI' };

/** Abonnements simulés : `fail` reproduit un refus de règle Firestore. */
const state = {
  fail: false,
  subscribes: 0,
};

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ profile: me }) }));
vi.mock('../components/Toast', () => ({ useToast: () => ({ toast: () => undefined }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => () => undefined }));

vi.mock('../lib/db', () => {
  const empty = () => () => undefined;
  const failing = (onError?: (e: unknown) => void) => {
    if (state.fail) {
      queueMicrotask(() => onError?.(new Error('Missing or insufficient permissions.')));
      return () => undefined;
    }
    return undefined;
  };
  return {
    findUserByCode: vi.fn(async () => null),
    sendFriendRequest: vi.fn(async () => undefined),
    respondFriendRequest: vi.fn(async () => undefined),
    searchUsersByName: vi.fn(async () => []),
    removeFriendship: vi.fn(async () => undefined),
    sendFriendReaction: vi.fn(async () => undefined),
    sendDirectMessage: vi.fn(async () => undefined),
    listRecentMessages: vi.fn(async () => []),
    watchDirectMessages: vi.fn(empty),
    watchRecentMessages: vi.fn(empty),
    watchIncomingRequests: vi.fn((_uid: string, cb: (v: unknown[]) => void, onError?: (e: unknown) => void) => {
      failing(onError);
      if (!state.fail) cb([]);
      return () => undefined;
    }),
    watchOutgoingRequests: vi.fn((_uid: string, cb: (v: unknown[]) => void, onError?: (e: unknown) => void) => {
      failing(onError);
      if (!state.fail) cb([]);
      return () => undefined;
    }),
    watchFriendReactions: vi.fn((_uid: string, cb: (v: unknown[]) => void, onError?: (e: unknown) => void) => {
      failing(onError);
      if (!state.fail) cb([]);
      return () => undefined;
    }),
    getProfiles: vi.fn(async () => [friend]),
    watchFriendships: vi.fn((_uid: string, cb: (uids: string[]) => void, onError?: (e: unknown) => void) => {
      state.subscribes += 1;
      if (state.fail) {
        // Firestore signale le refus de façon asynchrone, via le 3e argument.
        queueMicrotask(() => onError?.(new Error('Missing or insufficient permissions.')));
      } else {
        void cb([friend.uid]);
      }
      return () => undefined;
    }),
  };
});

vi.mock('../components/ActivityFeed', () => ({ default: () => <div /> }));
vi.mock('../components/QRCode', () => ({
  default: () => <div />,
  shareFriendCode: vi.fn(async () => undefined),
}));
vi.mock('../components/Sheet', () => ({ default: ({ children }: { children?: unknown }) => <div>{children as never}</div> }));
vi.mock('../components/ReportDialog', () => ({ default: () => <div /> }));

const FriendsPage = (await import('./FriendsPage')).default;

afterEach(() => {
  cleanup();
  state.fail = false;
  state.subscribes = 0;
});

describe('FriendsPage — chargement des amis', () => {
  it('affiche les amis et sort du chargement', async () => {
    render(<FriendsPage />);
    await waitFor(() => expect(screen.queryByText('Chargement de vos amis')).toBeNull());
    expect(screen.getByText('Ami Fidèle')).toBeTruthy();
  });

  it('sort du chargement et affiche une erreur quand les règles refusent la lecture', async () => {
    state.fail = true;
    render(<FriendsPage />);
    // L'assertion qui échouait avant le correctif : sans gestionnaire d'erreur,
    // le squelette restait affiché pour toujours.
    await waitFor(() => expect(screen.queryByText('Chargement de vos amis')).toBeNull());
    expect(screen.getByTestId('error-state')).toBeTruthy();
    expect(screen.getByText('Réessayer')).toBeTruthy();
  });

  it('relance réellement les abonnements au clic sur « Réessayer »', async () => {
    state.fail = true;
    render(<FriendsPage />);
    const retry = await screen.findByText('Réessayer');
    const before = state.subscribes;
    state.fail = false;
    retry.click();
    await waitFor(() => expect(state.subscribes).toBeGreaterThan(before));
    await waitFor(() => expect(screen.getByText('Ami Fidèle')).toBeTruthy());
  });
});
