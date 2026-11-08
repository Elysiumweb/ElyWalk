import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installStartupGuard, isStartupFallbackVisible, showStartupFallback } from './startup-guard';

/**
 * Ces tests protègent le filet de sécurité du démarrage : si l'interface ne
 * peut pas être construite, l'utilisateur doit voir un écran explicite plutôt
 * qu'une page blanche (qui donne l'impression que l'application a planté).
 */
describe('startup-guard', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('affiche un écran de secours quand la racine est vide', () => {
    showStartupFallback(new Error('boom'));
    expect(isStartupFallbackVisible()).toBe(true);
    const fallback = document.getElementById('elywalk-startup-fallback');
    expect(fallback?.getAttribute('role')).toBe('alert');
    expect(fallback?.textContent).toContain('ElyWalk');
    // Un bouton permet de relancer l'application.
    expect(fallback?.querySelector('button')?.textContent).toBeTruthy();
  });

  it('ne remplace jamais une interface déjà affichée', () => {
    const root = document.getElementById('root')!;
    root.innerHTML = '<div class="app-shell">ElyWalk</div>';
    showStartupFallback();
    expect(isStartupFallbackVisible()).toBe(false);
    expect(root.textContent).toBe('ElyWalk');
  });

  it('n’affiche l’écran de secours qu’une seule fois', () => {
    showStartupFallback();
    showStartupFallback();
    expect(document.querySelectorAll('#elywalk-startup-fallback')).toHaveLength(1);
  });

  it('intercepte les erreurs globales sans casser la page', () => {
    installStartupGuard();
    window.dispatchEvent(new ErrorEvent('error', { message: 'erreur au lancement' }));
    expect(isStartupFallbackVisible()).toBe(true);
  });

  it('ignore une promesse rejetée quand l’interface est déjà rendue', () => {
    const root = document.getElementById('root')!;
    root.innerHTML = '<div class="app-shell">OK</div>';
    installStartupGuard();
    window.dispatchEvent(new Event('unhandledrejection'));
    expect(isStartupFallbackVisible()).toBe(false);
  });
});
