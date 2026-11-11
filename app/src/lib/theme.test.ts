import { describe, expect, it } from 'vitest';
import { resolveTheme, THEME_OPTIONS } from './theme';

describe('resolveTheme — applique le réglage d’affichage', () => {
  it('garde la charte sombre en mode système', () => {
    expect(resolveTheme('system')).toBe('dark');
  });

  it('conserve le thème sombre explicite', () => {
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('bascule en contraste renforcé', () => {
    expect(resolveTheme('contrast')).toBe('contrast');
  });
});

describe('THEME_OPTIONS — réglages exposés dans le profil', () => {
  it('propose exactement Système / Sombre / Contraste renforcé', () => {
    expect(THEME_OPTIONS.map((option) => option.id)).toEqual(['system', 'dark', 'contrast']);
  });

  it('chaque réglage possède un libellé et une aide lisibles', () => {
    for (const option of THEME_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(1);
      expect(option.hint.length).toBeGreaterThan(5);
    }
  });
});
