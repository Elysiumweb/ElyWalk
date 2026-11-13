import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Garde-fous de mise en page et d'accessibilité (D02, D04, D05).
 *
 * Ces vérifications portent sur les feuilles de style réelles : elles
 * empêchent la réapparition exacte des régressions constatées —
 *  • feuille « Itinéraire » sans règle CSS (panneau `static`, carte 0 px) ;
 *  • carte qui prend toute la hauteur avant le départ (bouton hors écran) ;
 *  • viewport bloquant le zoom ;
 *  • fermetures et libellés sous les seuils tactiles et typographiques.
 */

const read = (path: string) => readFileSync(path, 'utf8');
const styles = read('src/styles.css');
const ux = read('src/ux-polish.css');
const profile = read('src/profile-polish.css');
const index = read('index.html');

/** Bloc de déclaration d'un sélecteur, dans n'importe quelle feuille. */
function rule(selector: string): string | null {
  for (const sheet of [styles, ux, profile]) {
    const start = sheet.indexOf(`${selector} {`);
    if (start === -1) continue;
    const end = sheet.indexOf('}', start);
    return sheet.slice(start, end);
  }
  return null;
}

describe('D02 — feuille Itinéraire', () => {
  it('la surcouche est positionnée et au-dessus de la barre d’onglets', () => {
    const block = rule('.directions-overlay');
    expect(block).toBeTruthy();
    expect(block).toMatch(/position:\s*fixed/);
    expect(block).toMatch(/inset:\s*0/);
    const zIndex = Number(block?.match(/z-index:\s*(\d+)/)?.[1] || 0);
    const tabbar = rule('.tabbar');
    const tabbarZ = Number(tabbar?.match(/z-index:\s*(\d+)/)?.[1] || 0);
    const bannerZ = Number(rule('.map-locate-btn')?.match(/z-index:\s*(\d+)/)?.[1] || 0);
    expect(zIndex).toBeGreaterThan(tabbarZ);
    expect(zIndex).toBeGreaterThan(bannerZ);
  });

  it('la carte de l’itinéraire a une hauteur non nulle', () => {
    const block = rule('.directions-map');
    expect(block).toBeTruthy();
    // Une hauteur minimale explicite : c'est la valeur qui valait 0 px.
    expect(block).toMatch(/min-height:\s*[1-9]\d*px/);
    expect(block).toMatch(/flex:\s*1 1 auto/);
  });

  it('toutes les classes du panneau ont une règle CSS', () => {
    const source = read('src/components/DirectionsPanel.tsx');
    const classes = new Set<string>();
    for (const match of source.matchAll(/className=(?:"([^"]+)"|\{`?([^`"}]+))/g)) {
      const value = (match[1] || match[2] || '').replace(/\$\{[^}]*\}/g, ' ');
      value.split(/\s+/).filter(Boolean).forEach((name) => {
        if (name.startsWith('directions-') || name === 'transit-legs' || name === 'transit-leg' || name === 'transit-chip') classes.add(name);
      });
    }
    const missing = [...classes].filter((name) => !rule(`.${name}`) && !profile.includes(`.${name}`) && !profile.includes(`.${name} `) && !profile.includes(`.${name}:`) && !profile.includes(`.${name},`));
    expect(missing, `classes sans règle CSS : ${missing.join(', ')}`).toEqual([]);
  });
});

describe('D04 — sortie GPS sur petit écran', () => {
  it('la carte est compacte avant le départ et pleine pendant la sortie', () => {
    expect(styles).toMatch(/\.activity-map-compact\s*\{[^}]*height:\s*clamp\(/);
    expect(styles).toMatch(/\.activity-map-live\s*\{[^}]*height:\s*min\(/);
  });

  it('les compteurs à zéro n’occupent pas la première vue', () => {
    expect(styles).toMatch(/\.activity-stats-idle\s*\{[^}]*grid-template-columns:\s*repeat\(2/);
    expect(styles).toMatch(/\.activity-stats-idle \.activity-stat-extra\s*\{\s*display:\s*none/);
  });
});

describe('D05 — zoom, cibles tactiles, lisibilité', () => {
  it('le viewport autorise le zoom (aucun maximum-scale, aucun user-scalable=no)', () => {
    const viewport = index.match(/name="viewport"\s+content="([^"]+)"/)?.[1] || '';
    expect(viewport).toContain('width=device-width');
    expect(viewport).toContain('viewport-fit=cover');
    expect(viewport).not.toMatch(/maximum-scale/i);
    expect(viewport).not.toMatch(/user-scalable\s*=\s*no/i);
  });

  it('les fermetures et actions isolées font au moins 44 px', () => {
    for (const selector of ['.sheet-close', '.map-card-close', '.notification-bell', '.icon-danger']) {
      const block = rule(selector);
      expect(block, selector).toBeTruthy();
      const height = block?.match(/(?:min-)?height:\s*(\d+)px/)?.[1];
      const width = block?.match(/(?:min-)?width:\s*(\d+)px/)?.[1];
      if (height) expect(Number(height), selector).toBeGreaterThanOrEqual(44);
      if (width) expect(Number(width), selector).toBeGreaterThanOrEqual(44);
    }
  });

  it('le texte secondaire ne descend plus sous 12 px', () => {
    const block = ux.slice(ux.indexOf('/* ---- Tailles de texte plancher'));
    expect(block).toMatch(/font-size:\s*max\(12px/);
    expect(block).toMatch(/font-size:\s*max\(13px/);
  });

  it('les champs gardent 16 px de texte pour éviter le zoom iOS', () => {
    expect(ux).toMatch(/\.input\s*\{[^}]*font-size:\s*max\(16px/);
  });

  it('les libellés de formulaire sont associés par htmlFor', () => {
    const auth = read('src/pages/AuthPage.tsx');
    // D07 : les réglages ont quitté le profil pour /settings ; ce sont donc les
    // composants de réglages qui doivent porter les associations libellé/champ.
    const language = read('src/components/settings/LanguageSection.tsx');
    const notifications = read('src/components/settings/NotificationsSection.tsx');
    const settings = read('src/pages/SettingsPage.tsx');
    for (const id of ['auth-name', 'auth-email', 'auth-password', 'auth-referral']) {
      expect(auth, id).toContain(`htmlFor="${id}"`);
      expect(auth, id).toContain(`id="${id}"`);
    }
    expect(language).toContain('htmlFor="language-select"');
    expect(notifications).toContain('htmlFor="reminder-time"');
    expect(notifications).toContain('htmlFor="quiet-start"');
    expect(notifications).toContain('htmlFor="quiet-end"');
    expect(settings).toContain('htmlFor="new-email"');
  });
});
