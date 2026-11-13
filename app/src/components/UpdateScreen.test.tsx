// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Écran de mise à jour : il s'affiche au lancement, avant tout le reste.
 *
 * Deux comportements comptent et sont testés ici :
 *  - une mise à jour **recommandée** peut être reportée, et le report est
 *    enregistré pour la version proposée (elle ne revient pas avant 24 h) ;
 *  - une mise à jour **obligatoire** ne peut pas être esquivée : ni « Plus
 *    tard », ni Échap, ni clic sur le fond.
 */

const snoozeUpdate = vi.fn(async () => undefined);
const openPlayStore = vi.fn(async () => undefined);

vi.mock('../lib/appUpdate', () => ({
  snoozeUpdate: (...args: unknown[]) => snoozeUpdate(...(args as [])),
  openPlayStore: () => openPlayStore(),
}));

vi.mock('../context/LocaleContext', () => ({
  useI18n: () => ({
    locale: 'fr',
    setLocale: async () => undefined,
    t: (key: string) =>
      ({
        'update.recommended.title': 'Une nouvelle version est disponible',
        'update.required.title': 'Mise à jour nécessaire',
        'update.recommended.body': 'Une version plus récente est disponible.',
        'update.required.body': 'Cette version n’est plus prise en charge.',
        'update.required.note': 'Votre profil est conservé.',
        'update.installed': 'Installée',
        'update.available': 'Disponible',
        'update.whatsnew': 'Nouveautés',
        'update.action': 'Mettre à jour',
        'update.opening': 'Ouverture du Play Store…',
        'update.later': 'Plus tard',
        'update.hint': 'La mise à jour se télécharge depuis le Play Store.',
      })[key] ?? key,
    formatDate: () => '',
    formatNumber: (value: number) => String(value),
  }),
}));

const { default: UpdateScreen } = await import('./UpdateScreen');

beforeEach(() => {
  snoozeUpdate.mockClear();
  openPlayStore.mockClear();
});
afterEach(() => cleanup());

const recommended = {
  available: true,
  severity: 'recommended' as const,
  latestVersion: '2.3.0',
  notes: 'Itinéraires corrigés',
  dismissed: false,
};
const required = { ...recommended, severity: 'required' as const };

describe('UpdateScreen', () => {
  it('affiche les deux versions et les nouveautés', () => {
    render(<UpdateScreen decision={recommended} onDismiss={() => undefined} />);
    expect(screen.getByTestId('update-screen')).toBeTruthy();
    expect(screen.getByTestId('update-latest').textContent).toContain('2.3.0');
    expect(screen.getByTestId('update-installed').textContent).toMatch(/ElyWalk \d/);
    expect(screen.getByTestId('update-notes').textContent).toContain('Itinéraires corrigés');
  });

  it('« Mettre à jour » ouvre la fiche Play Store', async () => {
    const user = userEvent.setup();
    render(<UpdateScreen decision={recommended} onDismiss={() => undefined} />);
    await user.click(screen.getByTestId('update-open-store'));
    await waitFor(() => expect(openPlayStore).toHaveBeenCalledTimes(1));
  });

  it('« Plus tard » reporte cette version et referme l’écran', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<UpdateScreen decision={recommended} onDismiss={onDismiss} />);
    await user.click(screen.getByTestId('update-later'));
    await waitFor(() => expect(snoozeUpdate).toHaveBeenCalledWith('2.3.0'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('une mise à jour obligatoire ne peut pas être fermée', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<UpdateScreen decision={required} onDismiss={onDismiss} />);

    expect(screen.queryByTestId('update-later')).toBeNull();
    expect(screen.getByTestId('update-screen').getAttribute('data-severity')).toBe('required');

    // Échap et clic sur le fond ne ferment rien.
    await user.keyboard('{Escape}');
    await user.click(screen.getByTestId('update-screen'));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('reste une boîte de dialogue accessible', () => {
    render(<UpdateScreen decision={recommended} onDismiss={() => undefined} />);
    const dialog = screen.getByTestId('update-screen');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('update-screen-title');
  });
});
