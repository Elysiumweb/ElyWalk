import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import AppErrorBoundary from './AppErrorBoundary';

function Boom(): never {
  throw new Error('rendu impossible');
}

/**
 * Vérifie qu'un plantage de rendu affiche l'écran de secours au lieu d'une
 * page blanche (symptôme rapporté : « l'application crash au lancement »).
 */
describe('AppErrorBoundary', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    container = document.getElementById('root') as HTMLDivElement;
    root = createRoot(container);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('affiche un écran de secours quand un enfant lève pendant le rendu', () => {
    act(() => {
      root.render(
        <AppErrorBoundary>
          <Boom />
        </AppErrorBoundary>
      );
    });
    expect(document.getElementById('elywalk-startup-fallback')).not.toBeNull();
    expect(container.textContent).toContain('ElyWalk');
  });

  it('laisse passer une interface saine', () => {
    act(() => {
      root.render(
        <AppErrorBoundary>
          <div className="app-shell">Contenu</div>
        </AppErrorBoundary>
      );
    });
    expect(container.textContent).toBe('Contenu');
    expect(document.getElementById('elywalk-startup-fallback')).toBeNull();
  });
});
