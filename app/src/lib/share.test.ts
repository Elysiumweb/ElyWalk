import { describe, expect, it } from 'vitest';
import {
  CANONICAL_SHARE_ORIGIN,
  isUnshareableOrigin,
  shareUrlForPath,
  shareUrlForReferral,
} from './share';

/**
 * Régression : l'APK 2.2.1 partageait `https://localhost/?ref=CODE`, car le lien
 * était construit depuis `location.origin` — dans la WebView Capacitor, cette
 * origine vaut `https://localhost` ou `capacitor://localhost`. Le destinataire
 * ouvrait alors une page inexistante.
 *
 * Ces tests figent le domaine public et interdisent qu'une origine locale
 * réapparaisse dans un lien partagé.
 */
describe('liens partageables', () => {
  it('utilise le domaine public pour un parrainage', () => {
    expect(CANONICAL_SHARE_ORIGIN).toBe('https://elywalk-2f7ba.web.app');
    expect(shareUrlForReferral('HNNGXQ')).toBe('https://elywalk-2f7ba.web.app/?ref=HNNGXQ');
  });

  it('nettoie et encode le code de parrainage', () => {
    expect(shareUrlForReferral(' hnngxq ')).toBe('https://elywalk-2f7ba.web.app/?ref=HNNGXQ');
    expect(shareUrlForReferral('A B')).toBe('https://elywalk-2f7ba.web.app/?ref=A%20B');
    expect(shareUrlForReferral('')).toBe(CANONICAL_SHARE_ORIGIN);
  });

  it('ne partage jamais une origine locale, même fournie en entrée', () => {
    expect(shareUrlForPath('https://localhost/?ref=HNNGXQ')).toBe(
      'https://elywalk-2f7ba.web.app/?ref=HNNGXQ'
    );
    expect(shareUrlForPath('capacitor://localhost/amis')).toBe('https://elywalk-2f7ba.web.app/amis');
    expect(shareUrlForPath('https://127.0.0.1:5173/profil')).toBe('https://elywalk-2f7ba.web.app/profil');
    expect(shareUrlForPath('https://192.168.1.20:5173/profil')).toBe('https://elywalk-2f7ba.web.app/profil');
  });

  it('ajoute la barre oblique manquante', () => {
    expect(shareUrlForPath('amis')).toBe('https://elywalk-2f7ba.web.app/amis');
  });

  it('détecte les origines non partageables', () => {
    expect(isUnshareableOrigin('https://elywalk-2f7ba.web.app')).toBe(false);
    for (const origin of [
      '',
      'https://localhost',
      'https://localhost:5173/',
      'capacitor://localhost',
      'file:///android_asset/public/index.html',
      'http://127.0.0.1:5173',
      'http://10.0.0.2:5173',
      'http://172.20.0.4:5173',
      'http://192.168.0.12:5173',
    ]) {
      expect(isUnshareableOrigin(origin), origin).toBe(true);
    }
  });

  it('reste sur le domaine public quand la WebView est montée sur localhost', () => {
    // La WebView fournit location.origin = https://localhost. `shareUrlForReferral`
    // ne lit pas `location` : le lien reste correct dans ce contexte.
    const localOrigin = 'https://localhost';
    expect(isUnshareableOrigin(localOrigin)).toBe(true);
    expect(shareUrlForReferral('HNNGXQ').startsWith(localOrigin)).toBe(false);
  });
});
