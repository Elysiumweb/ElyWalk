import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Contrôle de contraste des thèmes (D01).
 *
 * Le texte du bouton or était blanc/crème sur un dégradé or : ≈ 1,63:1 au
 * milieu du dégradé, très en dessous des 4,5:1 exigés pour du texte courant.
 * Ce test lit les **vraies valeurs** des feuilles de style (aucune copie de
 * constantes) et vérifie :
 *  - le texte des boutons or sur les trois arrêts du dégradé, dans chaque thème ;
 *  - les textes discrets (`--muted`) et d'état (danger/succès) sur les surfaces ;
 *  - que le thème clair ne conserve aucun dégradé sombre codé en dur.
 */

const read = (path: string) => readFileSync(path, 'utf8');

/** Convertit `#rrggbb` en luminance relative (WCAG 2.1). */
function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Extrait les variables de premier niveau d'un sélecteur donné. */
function tokens(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  expect(start, `sélecteur introuvable : ${selector}`).toBeGreaterThan(-1);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  const out: Record<string, string> = {};
  for (const line of body.split('\n')) {
    const match = line.match(/^\s*(--[\w-]+)\s*:\s*([^;]+);/);
    if (match) out[match[1]] = match[2].trim();
  }
  return out;
}

const styles = read('src/styles.css');
const appearance = read('src/appearance.css');
const uxPolish = read('src/ux-polish.css');

const base = tokens(styles, ':root {');
const light = tokens(appearance, ":root[data-theme='light']");
const contrastTheme = tokens(appearance, ":root[data-theme='contrast']");

const CURRENT_TEXT_MIN = 4.5;
const LARGE_TEXT_MIN = 3;

describe('bouton or — contraste du libellé', () => {
  it('atteint 4,5:1 sur chaque arrêt du dégradé, thème sombre', () => {
    for (const stop of ['--gold-grad-a', '--gold-grad-b', '--gold-grad-c']) {
      const ratio = contrast(base['--on-gold'], base[stop]);
      expect(ratio, `${stop} → ${base[stop]}`).toBeGreaterThanOrEqual(CURRENT_TEXT_MIN);
    }
  });

  it('atteint 4,5:1 sur chaque arrêt du dégradé, thème clair', () => {
    for (const stop of ['--gold-grad-a', '--gold-grad-b', '--gold-grad-c']) {
      const ratio = contrast(light['--on-gold'], light[stop]);
      expect(ratio, `${stop} → ${light[stop]}`).toBeGreaterThanOrEqual(CURRENT_TEXT_MIN);
    }
  });

  it('le thème clair ne réintroduit pas de libellé crème sur or', () => {
    // L'ancienne règle `[data-theme='light'] .btn-gold { color: #fffdf6; }`
    // donnait ≈ 1,6:1 : elle doit rester supprimée.
    expect(appearance).not.toMatch(/\[data-theme='light'\]\s*\.btn-gold\s*\{[^}]*color:\s*#fff/i);
    expect(contrast('#fffdf6', base['--gold-grad-b'])).toBeLessThan(CURRENT_TEXT_MIN);
  });
});

describe('textes sur les surfaces', () => {
  it('texte courant lisible sur cartes et feuilles (thème sombre)', () => {
    expect(contrast(base['--white'], base['--surface'])).toBeGreaterThanOrEqual(CURRENT_TEXT_MIN);
    expect(contrast(base['--white'], base['--surface-2'])).toBeGreaterThanOrEqual(CURRENT_TEXT_MIN);
    expect(contrast(base['--white'], base['--surface-card-top'])).toBeGreaterThanOrEqual(CURRENT_TEXT_MIN);
    expect(contrast(base['--white'], base['--surface-card-bottom'])).toBeGreaterThanOrEqual(CURRENT_TEXT_MIN);
  });

  it('texte courant lisible sur cartes et feuilles (thème clair)', () => {
    expect(contrast(light['--white'], light['--surface'])).toBeGreaterThanOrEqual(CURRENT_TEXT_MIN);
    expect(contrast(light['--white'], light['--surface-2'])).toBeGreaterThanOrEqual(CURRENT_TEXT_MIN);
    expect(contrast(light['--white'], light['--surface-card-top'])).toBeGreaterThanOrEqual(CURRENT_TEXT_MIN);
    expect(contrast(light['--white'], light['--surface-card-bottom'])).toBeGreaterThanOrEqual(CURRENT_TEXT_MIN);
  });

  it('texte secondaire (`--muted`) au moins à 4,5:1 dans chaque thème', () => {
    expect(contrast(base['--muted'], base['--surface'])).toBeGreaterThanOrEqual(CURRENT_TEXT_MIN);
    expect(contrast(light['--muted'], light['--surface'])).toBeGreaterThanOrEqual(CURRENT_TEXT_MIN);
    expect(contrast(light['--muted'], light['--surface-2'])).toBeGreaterThanOrEqual(CURRENT_TEXT_MIN);
    // `ux-polish.css` redéfinit `--muted` pour le thème sombre.
    const uxMuted = tokens(uxPolish, ':root {')['--muted'];
    expect(contrast(uxMuted, base['--surface-2'])).toBeGreaterThanOrEqual(CURRENT_TEXT_MIN);
  });

  it('or et couleurs d’état restent lisibles sur les surfaces claires', () => {
    expect(contrast(light['--gold'], light['--surface'])).toBeGreaterThanOrEqual(CURRENT_TEXT_MIN);
    expect(contrast(light['--gold'], light['--surface-2'])).toBeGreaterThanOrEqual(CURRENT_TEXT_MIN);
    expect(contrast(light['--danger'], light['--surface'])).toBeGreaterThanOrEqual(CURRENT_TEXT_MIN);
    expect(contrast(light['--success'], light['--surface'])).toBeGreaterThanOrEqual(CURRENT_TEXT_MIN);
  });

  it('le thème contraste renforcé éclaircit le texte secondaire', () => {
    const muted = contrastTheme['--muted'];
    expect(muted).toBeDefined();
    expect(contrast(muted, base['--surface'])).toBeGreaterThan(contrast(base['--muted'], base['--surface']));
    expect(contrast(muted, base['--surface'])).toBeGreaterThanOrEqual(CURRENT_TEXT_MIN);
  });

  it('les grandes accroches gardent au moins 3:1 (cible grand texte)', () => {
    expect(contrast(base['--gold'], base['--surface'])).toBeGreaterThanOrEqual(LARGE_TEXT_MIN);
    expect(contrast(light['--gold'], light['--surface'])).toBeGreaterThanOrEqual(LARGE_TEXT_MIN);
    expect(contrast(light['--gold'], light['--surface-2'])).toBeGreaterThanOrEqual(LARGE_TEXT_MIN);
  });
});

describe('surfaces sémantiques', () => {
  it('chaque thème définit les surfaces de carte, de feuille et d’ombre', () => {
    const required = ['--surface-card-top', '--surface-card-bottom', '--surface-hero-top', '--surface-hero-bottom', '--shadow-card', '--scrim'];
    for (const key of required) {
      expect(base[key], `sombre ${key}`).toBeDefined();
      expect(light[key], `clair ${key}`).toBeDefined();
    }
  });

  it('les cartes et feuilles ne codent plus de dégradé sombre en dur', () => {
    // Les surfaces des cartes proviennent des jetons : aucune valeur #1c1c1f…
    // ne doit subsister dans la règle `.card, .gold-hero, .sheet`.
    const cardStart = styles.indexOf('.card, .gold-hero, .sheet {');
    expect(cardStart).toBeGreaterThan(-1);
    const cardRule = styles.slice(cardStart, styles.indexOf('.gold-hero {', cardStart));
    expect(cardRule).not.toMatch(/#1[0-9a-f]{5}/i);
    expect(cardRule).toContain('var(--surface-card-top)');
  });
});
