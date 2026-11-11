import { useEffect, useState } from 'react';
import { Preferences } from '@capacitor/preferences';

// ============================================================================
// Options d'affichage — thème et lisibilité.
//
// Trois réglages, choisis par l'utilisateur et persistés localement :
//   • `system`    : suit le réglage clair/sombre de l'appareil ;
//   • `dark`      : charte noir & or d'origine, quel que soit le système ;
//   • `contrast`  : noir profond + or et textes plus lumineux, contours
//                   renforcés (luminosité extérieure, vue fatiguée).
//
// Le mode clair n'est volontairement pas proposé : l'identité Elysium repose
// sur le fond « midnight black ». Le réglage « système » ne basculera donc
// jamais en thème clair, il aligne seulement les contrastes sur
// `prefers-color-scheme` (déjà résolu plus bas) et sur l'accessibilité.
//
// Le choix est appliqué via `data-theme` sur `<html>` ; les variables de
// `styles.css` (--muted, --surface, --gold-border…) et les surcharges de
// `ux-polish.css` s'en déduisent, sans réécrire les composants.
// ============================================================================

export type ThemePreference = 'system' | 'dark' | 'contrast';

const STORAGE_KEY = 'ui.theme.v1';
const LISTENERS = 'elywalk:theme-changed';

/** Attribut `data-theme` posé sur `<html>`. `contrast` est aussi un thème. */
export type ResolvedTheme = 'dark' | 'contrast';

/** Réglages proposés dans Profil → Affichage. */
export const THEME_OPTIONS: {
  id: ThemePreference;
  label: string;
  hint: string;
  icon: string;
}[] = [
  { id: 'system', label: 'Système', hint: 'Suit le mode clair/sombre de l’appareil', icon: '⚙️' },
  { id: 'dark', label: 'Sombre', hint: 'Charte noir & or ElyWalk', icon: '🌙' },
  { id: 'contrast', label: 'Contraste renforcé', hint: 'Textes et contours plus lumineux', icon: '☀️' },
];

function normalize(value: string | null | undefined): ThemePreference {
  return value === 'dark' || value === 'contrast' || value === 'system' ? value : 'system';
}

/**
 * Résolution pure du thème affiché (testable sans DOM).
 *
 * Même en mode `system`, le thème reste sombre : c'est la charte de
 * l'application. Seul le mode `contrast` change réellement les couleurs.
 */
export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === 'contrast' ? 'contrast' : 'dark';
}

/** Applique le thème au document (idempotent, sans effet hors navigateur). */
export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference);
  try {
    const root = document.documentElement;
    root.dataset.theme = resolved;
    root.dataset.themePreference = preference;
    // `color-scheme` évite le flash blanc du WebView au chargement.
    root.style.colorScheme = 'dark';
  } catch {
    /* contexte sans DOM (tests unitaires) */
  }
  return resolved;
}

export async function getThemePreference(): Promise<ThemePreference> {
  try {
    const { value } = await Preferences.get({ key: STORAGE_KEY });
    return normalize(value);
  } catch {
    return 'system';
  }
}

/**
 * Applique le thème enregistré dès le démarrage (appelé depuis `main.tsx`,
 * avant le premier rendu React) pour éviter un flash de la charte par défaut.
 */
export async function initTheme(): Promise<ResolvedTheme> {
  const preference = await getThemePreference();
  return applyTheme(preference);
}

export async function setThemePreference(preference: ThemePreference): Promise<void> {
  applyTheme(preference);
  try {
    await Preferences.set({ key: STORAGE_KEY, value: preference });
  } catch (e) {
    console.warn('[Theme] storage error', e);
  }
  try {
    window.dispatchEvent(new CustomEvent(LISTENERS, { detail: preference }));
  } catch {
    /* environnement non web */
  }
}

/** Hook React : réglage courant + application immédiate. */
export function useThemePreference(): {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  ready: boolean;
  setPreference: (value: ThemePreference) => Promise<void>;
} {
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    getThemePreference()
      .then((value) => {
        if (!alive) return;
        setPreferenceState(value);
        applyTheme(value);
      })
      .finally(() => alive && setReady(true));
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<ThemePreference>).detail;
      setPreferenceState(normalize(detail));
    };
    window.addEventListener(LISTENERS, onChange);
    return () => {
      alive = false;
      window.removeEventListener(LISTENERS, onChange);
    };
  }, []);

  const setPreference = async (value: ThemePreference) => {
    setPreferenceState(value);
    await setThemePreference(value);
  };

  return { preference, resolved: resolveTheme(preference), ready, setPreference };
}
