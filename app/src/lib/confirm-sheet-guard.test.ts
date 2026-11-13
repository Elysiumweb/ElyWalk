import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Garde-fou D06 — aucune boîte de dialogue native.
 *
 * `confirm()` / `prompt()` (et leurs variantes `window.`) ne disent pas ce qui
 * va se passer, ne sont pas traduisibles, bloquent la WebView Android et
 * perdent la saisie en cas d'échec. Chaque action destructrice ou coûteuse doit
 * passer par `ConfirmSheet`, qui énonce les conséquences et conserve la saisie.
 *
 * Ce test parcourt réellement les sources : il échoue dès qu'un appel natif est
 * réintroduit, y compris dans un fichier ajouté plus tard.
 */

const SRC = 'src';

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

/** Retire commentaires et chaînes pour ne tester que le code exécutable. */
function stripCommentsAndStrings(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

const NATIVE_DIALOG = /(?<![.\w$])(?:window\.)?(confirm|prompt|alert)\s*\(/g;

describe('D06 — confirmations structurées', () => {
  const files = walk(SRC);

  it('aucun fichier source n’appelle confirm() / prompt() / alert()', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const code = stripCommentsAndStrings(readFileSync(file, 'utf8'));
      for (const match of code.matchAll(NATIVE_DIALOG)) {
        offenders.push(`${file}: ${match[1]}()`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('ConfirmSheet énonce les conséquences et gère un champ texte requis', () => {
    const sheet = readFileSync('src/components/ConfirmSheet.tsx', 'utf8');
    expect(sheet).toContain('confirm-consequences');
    expect(sheet).toContain('aria-invalid');
    expect(sheet).toContain("role=\"alert\"");
    // Valeur initiale : la note de modération pré-remplie n'est pas effacée.
    expect(sheet).toContain('initialText');
    // Une action dangereuse est visuellement séparée.
    expect(sheet).toContain('confirm-danger');
  });

  it('les écrans avec action destructive utilisent ConfirmSheet', () => {
    const expectations: Array<[string, string]> = [
      ['src/pages/SettingsPage.tsx', 'delete-account-sheet'],
      ['src/pages/ActivityDetailPage.tsx', 'delete-activity-sheet'],
      ['src/pages/RoutesPage.tsx', 'delete-route-sheet'],
      ['src/pages/ChallengesPage.tsx', 'delete-challenge-sheet'],
      ['src/pages/PartnersPage.tsx', 'redeem-offer-sheet'],
      ['src/pages/PublicProfilePage.tsx', 'block-sheet'],
      ['src/pages/AdminPage.tsx', 'moderation-sheet'],
      ['src/pages/ProfilePage.tsx', 'logout-sheet'],
    ];
    for (const [file, testId] of expectations) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).toContain('ConfirmSheet');
      expect(source, file).toContain(`testId="${testId}"`);
    }
  });
});
