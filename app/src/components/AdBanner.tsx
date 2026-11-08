import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { showBanner } from '../lib/ads';

/**
 * Bannière publicitaire Meta ancrée en bas de l'écran.
 *
 * <p>Le rendu est fait côté **natif** (le SDK Meta dessine sa propre vue
 * au-dessus de la WebView) : ce composant ne sert qu'à déclencher l'affichage
 * une fois la session ouverte, et à réserver la place correspondante pour que
 * le contenu ne passe pas sous l'annonce.</p>
 *
 * <p>La hauteur réservée est publiée dans la variable CSS
 * `--ad-banner-height` par `lib/ads.ts`.</p>
 */
export default function AdBanner() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    // La bannière est partagée par tous les écrans : elle n'est jamais retirée
    // à la navigation, seulement par `hideBanner()` (refus de consentement) ou
    // à la destruction de l'activité.
    void showBanner();
  }, []);

  // Rien à dessiner : la bannière est une vue native.
  return null;
}
