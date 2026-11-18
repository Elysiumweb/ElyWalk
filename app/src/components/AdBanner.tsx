import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { hideBottomAd, showBottomAd, type BottomAdKind } from '../lib/ads';
import { useAdConsent } from '../lib/adConsent';

/**
 * Pages de type liste : le bandeau natif compact y est plus lisible qu'une
 * bannière 320×50 classique. Le format natif LevelPlay étant piloté par un
 * placement (Meta ne « bidde » pas en natif), `showBottomAd` retombe
 * automatiquement sur la bannière s'il n'y a pas de remplissage.
 */
const NATIVE_BANNER_ROUTES = ['/history'];

/**
 * Bannière publicitaire ancrée en bas de l'écran, présente sur TOUTES les
 * pages de l'application (exigence produit : « une bannière sur chaque page »).
 *
 * Le rendu est natif (Unity LevelPlay, avec Meta Audience Network en bidding) :
 * ce composant ne peint rien, il pilote le plugin `LevelPlayAds` et réserve la
 * hauteur correspondante via la variable CSS `--ad-banner-h` (voir styles.css).
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
