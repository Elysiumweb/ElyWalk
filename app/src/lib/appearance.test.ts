import { describe, expect, it } from 'vitest';
import { resolveTheme } from './appearance';

describe('resolveTheme — thème effectif (audit § 2.7)', () => {
  it('impose la charte sombre quand l’utilisateur choisit « Sombre »', () => {
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('suit le réglage du téléphone en mode « Système »', () => {
    expect(resolveTheme('system', true)).toBe('light');
    expect(resolveTheme('system', false)).toBe('dark');
  });

  it('applique le contraste renforcé quel que soit le réglage système', () => {
    expect(resolveTheme('contrast', true)).toBe('contrast');
    expect(resolveTheme('contrast', false)).toBe('contrast');
  });
});
