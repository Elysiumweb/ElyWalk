// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { UserProfile } from '../lib/types';

/**
 * La migration `blockedUsers` / `blockedBy` (F12) doit être lançable depuis
 * l'espace admin de l'application — pas depuis la console Firebase, où l'oubli
 * laisse des blocages anciens invisibles dans les listes.
 */

const president = { uid: 'BZ333LlhuJMoD4rXIquGE0zzjX43', displayName: 'Président', role: 'president' } as unknown as UserProfile;

const state = { role: 'president', updated: 0, fail: false };

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ profile: state.role === 'president' ? president : { ...president, uid: 'autre', role: 'user' } }),
}));
vi.mock('../components/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => () => undefined, useLocation: () => ({ key: 'default' }) }));
vi.mock('../lib/db', () => ({
  // Panneau « Mise à jour » : le document de version est lu et écrit via db.ts.
  setPublishedRelease: vi.fn(async () => undefined),
  listAllPartnerRequests: vi.fn(async () => []),
  updatePartnerRequestStatus: vi.fn(async () => undefined),
  listAllWithdrawals: vi.fn(async () => []),
  updateWithdrawalStatus: vi.fn(async () => undefined),
}));
vi.mock('../lib/establishments', () => ({
  createEstablishment: vi.fn(),
  deleteEstablishment: vi.fn(),
  updateEstablishment: vi.fn(),
  listEstablishments: vi.fn(async () => []),
  geocodeAddress: vi.fn(),
  resizeLogoToDataUrl: vi.fn(),
}));
vi.mock('../lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  getDocs: vi.fn(async () => ({ docs: [] })),
  doc: vi.fn(() => ({})),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => ({}) })),
}));
vi.mock('../lib/challenges', () => ({
  closeChallengeCatalogEntry: vi.fn(),
  describeCatalogState: () => [],
  publishChallengeCatalog: vi.fn(async () => ({ written: [], skipped: [] })),
  setChallengeCatalogEntry: vi.fn(),
}));
vi.mock('../lib/safety', () => ({
  watchReports: vi.fn(() => () => undefined),
  reviewReport: vi.fn(async () => undefined),
  backfillBlockedUsers: vi.fn(async () => {
    if (state.fail) throw new Error('Migration réservée au Président et au Co-Président.');
    state.updated += 1;
    return { updated: 3, skipped: 2 };
  }),
}));

const AdminPage = (await import('./AdminPage')).default;

afterEach(() => {
  cleanup();
  state.role = 'president';
  state.updated = 0;
  state.fail = false;
});

describe('AdminPage — migration des blocages', () => {
  it('lance la migration depuis l’onglet Maintenance', async () => {
    render(<AdminPage />);
    (await screen.findByTestId('admin-tab-maintenance')).click();
    const button = await screen.findByTestId('run-blocked-backfill');
    button.click();
    await waitFor(() => expect(state.updated).toBe(1));
  });

  it('remonte l’erreur au lieu d’échouer en silence', async () => {
    state.fail = true;
    render(<AdminPage />);
    (await screen.findByTestId('admin-tab-maintenance')).click();
    (await screen.findByTestId('run-blocked-backfill')).click();
    await waitFor(() => expect(state.updated).toBe(0));
    expect(screen.getByTestId('run-blocked-backfill')).toBeTruthy();
  });

  it('reste inaccessible hors président', async () => {
    state.role = 'autre';
    render(<AdminPage />);
    expect(screen.queryByTestId('admin-tab-maintenance')).toBeNull();
    expect(screen.getByText('Accès réservé')).toBeTruthy();
  });
});
