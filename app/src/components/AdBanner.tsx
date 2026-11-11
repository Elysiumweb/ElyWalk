import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { hideBottomAd, showBottomAd, type BottomAdKind } from '../lib/ads';
import { useAdConsent } from '../lib/adConsent';

/**
 * Pages de type liste : l'appel « native banner » y était plus lisible qu'une
 * bannière 320×50 classique.
 */
const NATIVE_BANNER_ROUTES = ['/history'];

/**
 * Emplacement publicitaire bas d'écran, présent sur toutes les pages.
 *
 * ⚠️ Depuis la 2.1.0 (Chartboost Mediation + Meta), les placements
 * `CHARTBOOST_PLACEMENT_BANNER` sont des **interstitiels** : Meta ne remplit que
 * l'interstitiel et le récompensé. Le plugin résout donc `{ height: 0 }` et
 * **aucun espace n'est réservé** (`--ad-banner-h` reste à `0px`) — la barre
 * d'onglets et les feuilles remontent exactement comme avant.
 *
 * L'appel est conservé tel quel pour que rétablir un vrai format BANNIER ne
 * demande qu'un changement de placement côté dashboard : la hauteur renvoyée
 * par le plugin est déjà répercutée dans `--ad-banner-h` (`lib/ads.ts`).
 */
export default function AdBanner() {
  const { pathname } = useLocation();
  const { consent, ready } = useAdConsent();

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !ready) return;
    // Tant qu'aucun choix n'est exprimé, aucune annonce n'est demandée.
    if (consent === 'unknown') {
      void hideBottomAd();
      return;
    }
    const kind: BottomAdKind = NATIVE_BANNER_ROUTES.includes(pathname) ? 'nativeBanner' : 'banner';
    void showBottomAd(kind);
  }, [pathname, consent, ready]);

  return null;
}
