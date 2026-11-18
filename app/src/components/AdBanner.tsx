import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { hideBottomAd, showBottomAd, type BottomAdKind } from '../lib/ads';
import { useAdConsent } from '../lib/adConsent';

/**
 * Pages de type liste : le bandeau natif compact y est plus lisible qu'une
 * bannière 320×50 classique. Si aucun réseau ne remplit le placement natif
 * LevelPlay, `showBottomAd` retombe automatiquement sur la bannière.
 */
const NATIVE_BANNER_ROUTES = ['/history'];

/**
 * Bannière publicitaire ancrée en bas de l'écran, présente sur TOUTES les
 * pages de l'application (exigence produit : « une bannière sur chaque page »).
 *
 * Le rendu est assuré côté Android par LevelPlay : ce composant ne peint rien,
 * il pilote le plugin `LevelPlayAds` et réserve la hauteur via la variable CSS
 * `--ad-banner-h` (voir styles.css).
 */
export default function AdBanner() {
  const { pathname } = useLocation();
  const { consent, ready } = useAdConsent();

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !ready) return;
    if (consent === 'unknown') {
      void hideBottomAd();
      return;
    }
    const kind: BottomAdKind = NATIVE_BANNER_ROUTES.includes(pathname) ? 'nativeBanner' : 'banner';
    void showBottomAd(kind);
  }, [pathname, consent, ready]);

  return null;
}
