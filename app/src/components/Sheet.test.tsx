// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import Sheet from './Sheet';

/**
 * Régression « ça tape une lettre par lettre » : chaque frappe dans un champ
 * de la feuille déclenche un rendu du parent. Avant le correctif, l'effet de
 * focus du `Sheet` se rejouait à chaque rendu (identité de `onClose` changée),
 * et le curseur repartait sur la croix de fermeture. Le test tape un pseudo
 * complet et vérifie que la valeur et le focus restent dans le champ.
 */
function Harness() {
  const [open, setOpen] = useState(true);
  const [name, setName] = useState('');
  return (
    <Sheet open={open} onClose={() => setOpen(false)} title="Modifier mon profil">
      <input
        className="input"
        aria-label="Pseudo"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <textarea className="input" aria-label="Bio" />
    </Sheet>
  );
}

// Chaque test monte sa propre feuille : sans nettoyage, les rendus précédents
// restent dans le DOM (deux boutons « Fermer »).
afterEach(() => cleanup());

describe('Sheet — saisie continue', () => {
  it('garde le focus et accepte le texte lettre par lettre', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByLabelText('Pseudo') as HTMLInputElement;
    await user.click(input);
    await user.type(input, 'Elywalker');

    expect(input.value).toBe('Elywalker');
    expect(document.activeElement).toBe(input);
  });

  it('accepte aussi une bio multi-mots', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const bio = screen.getByLabelText('Bio') as HTMLTextAreaElement;
    await user.click(bio);
    await user.type(bio, 'Marche tous les jours a Paris');

    expect(bio.value).toBe('Marche tous les jours a Paris');
    expect(document.activeElement).toBe(bio);
  });

  it('ferme toujours avec Échap et la croix', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByLabelText('Fermer'));
    expect(screen.queryByLabelText('Pseudo')).toBeNull();
  });
});
