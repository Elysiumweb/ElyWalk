// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installStartupGuard, isStartupFallbackVisible, showStartupFallback } from './startup-guard';

describe('startup-guard', () => {
  let uninstall: () => void = () => undefined;

  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
  });

  afterEach(() => {
    uninstall();
    uninstall = () => undefined;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('affiche un écran de secours quand la racine est vide', () => {
    showStartupFallback(new Error('boom'));
    expect(isStartupFallbackVisible()).toBe(true);
    const fallback = document.getElementById('elywalk-startup-fallback');
    expect(fallback?.getAttribute('role')).toBe('alert');
    expect(fallback?.textContent).toContain('ElyWalk');
    expect(fallback?.querySelector('button')?.textContent).toBe('Réessayer');
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

  it('intercepte une erreur globale au lancement', () => {
    uninstall = installStartupGuard();
    window.dispatchEvent(new ErrorEvent('error', { message: 'erreur au lancement' }));
    expect(isStartupFallbackVisible()).toBe(true);
  });

  it('ignore une promesse rejetée quand l’interface est déjà rendue', () => {
    const root = document.getElementById('root')!;
    root.innerHTML = '<div class="app-shell">OK</div>';
    uninstall = installStartupGuard();
    window.dispatchEvent(new Event('unhandledrejection'));
    expect(isStartupFallbackVisible()).toBe(false);
    expect(root.textContent).toBe('OK');
  });
});
