import { useEffect, useState } from 'react';
import { Preferences } from '@capacitor/preferences';

// ============================================================================
// Apparence — réglage d'affichage (audit § 2.7).
//
// Trois choix, persistés localement et appliqués via `data-theme` sur <html> :
//   • `system`   : suit le réglage clair/sombre du téléphone ;
//   • `dark`     : charte ElyWalk noir/or imposée ;
//   • `contrast` : charte sombre avec contrastes renforcés (textes discrets
//                  éclaircis, bordures plus franches, états désactivés lisibles).
//
// Les couleurs restent définies dans `appearance.css` : ce module ne fait que
// résoudre le thème effectif et le publier dans le DOM.
// ============================================================================

export type Appearance = 'system' | 'dark' | 'contrast';
/** Thème réellement appliqué au document. */
export type ResolvedTheme = 'dark' | 'light' | 'contrast';

const STORAGE_KEY = 'elywalk.appearance.v1';
const EVENT = 'elywalk:appearance-changed';

export const APPEARANCE_OPTIONS: { value: Appearance; label: string; hint: string }[] = [
  { value: 'system', label: 'Système', hint: 'Suit le réglage clair/sombre du téléphone.' },
  { value: 'dark', label: 'Sombre', hint: 'Charte ElyWalk noir et or, quel que soit le réglage du téléphone.' },
  { value: 'contrast', label: 'Contraste renforcé', hint: 'Textes et bordures plus contrastés, états désactivés lisibles.' },
];

function normalize(value: string | null | undefined): Appearance {
  return value === 'system' || value === 'contrast' || value === 'dark' ? value : 'dark';
}

/** Lit le choix enregistré (valeur par défaut : charte sombre). */
export function readAppearance(): Appearance {
  try {
    return normalize(localStorage.getItem(STORAGE_KEY));
  } catch {
    return 'dark';
  }
}

function prefersLight(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches;
  } catch {
    return false;
  }
}

/** Thème effectif pour un choix donné (pure, testable). */
export function resolveTheme(appearance: Appearance, light = prefersLight()): ResolvedTheme {
  if (appearance === 'contrast') return 'contrast';
  if (appearance === 'dark') return 'dark';
  return light ? 'light' : 'dark';
}

/** Applique le thème au document (idempotent). */
export function applyAppearance(appearance: Appearance): ResolvedTheme {
  const theme = resolveTheme(appearance);
  try {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.appearance = appearance;
    // `color-scheme` aligne les contrôles natifs (champs date/heure, scrollbars).
    root.style.colorScheme = theme === 'light' ? 'light' : 'dark';
  } catch {
    /* environnement sans DOM (tests) */
  }
  return theme;
}

/** Enregistre le choix, l'applique et prévient les autres vues. */
export async function setAppearance(appearance: Appearance): Promise<void> {
  const value = normalize(appearance);
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* stockage indisponible */
  }
  applyAppearance(value);
  try {
    await Preferences.set({ key: STORAGE_KEY, value });
  } catch (e) {
    console.warn('[Appearance] preferences', e);
  }
  try {
    window.dispatchEvent(new CustomEvent<Appearance>(EVENT, { detail: value }));
  } catch {
    /* environnement non web */
  }
}

/**
 * Hook : choix courant + application immédiate. Le mode `system` réagit aux
 * changements de réglage du téléphone sans rechargement.
 */
export function useAppearance(): { appearance: Appearance; setAppearance: (next: Appearance) => Promise<void> } {
  const [appearance, update] = useState<Appearance>(() => readAppearance());

  useEffect(() => {
    applyAppearance(appearance);
    // Récupère un éventuel choix stocké côté natif (Preferences).
    Preferences.get({ key: STORAGE_KEY })
      .then(({ value }) => {
        if (value && normalize(value) !== appearance) update(normalize(value));
      })
      .catch(() => undefined);
  }, [appearance]);

  useEffect(() => {
    const onStorage = () => update(readAppearance());
    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent<Appearance>).detail;
      if (detail) update(normalize(detail));
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(EVENT, onEvent);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(EVENT, onEvent);
    };
  }, []);

  useEffect(() => {
    if (appearance !== 'system' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => applyAppearance('system');
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, [appearance]);

  return { appearance, setAppearance };
}
