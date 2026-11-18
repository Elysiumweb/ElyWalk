import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { useEffect, useState } from 'react';

// ============================================================================
// Consentement publicitaire (RGPD) — remplace le module Google UMP / Funding
// Choices utilisé tant que la régie était AdMob.
//
// Trois états :
//   - `unknown`  : aucun choix exprimé → AUCUNE annonce n'est demandée.
//   - `granted`  : annonces personnalisées autorisées.
//   - `refused`  : annonces non personnalisées uniquement (Limited Data Use).
//
// ⚠️ Ce garde-fou applicatif garantit qu'aucune requête publicitaire n'est
// émise sans choix explicite. Pour l'EEE/UK, la réglementation exige aussi une
// CMP enregistrée IAB TCF v2 (ou le consentement natif Meta) qui transmet la
// chaîne de consentement au SDK : voir DEPLOYMENT.md § « Consentement ».
// ============================================================================

export type AdConsent = 'unknown' | 'granted' | 'refused';

const STORAGE_KEY = 'ads.consent.v1';
const STORAGE_EVENT = 'elywalk:ad-consent-changed';
const PRIVACY_EVENT = 'elywalk:ad-privacy-options';

let cached: AdConsent | null = null;
const listeners = new Set<(consent: AdConsent) => void>();

function normalize(value: string | null | undefined): AdConsent {
  return value === 'granted' || value === 'refused' ? value : 'unknown';
}

/** Consentement courant (mémoire puis `Preferences`). */
export async function getAdConsent(): Promise<AdConsent> {
  if (cached) return cached;
  try {
    const { value } = await Preferences.get({ key: STORAGE_KEY });
    cached = normalize(value);
  } catch {
    cached = 'unknown';
  }
  return cached;
}

/** Enregistre un nouveau choix et prévient l'application (et le SDK natif). */
export async function setAdConsent(consent: 'granted' | 'refused'): Promise<void> {
  cached = consent;
  try {
    await Preferences.set({ key: STORAGE_KEY, value: consent });
  } catch (e) {
    console.warn('[Ads] consent storage error', e);
  }
  listeners.forEach((listener) => listener(consent));
  try {
    window.dispatchEvent(new CustomEvent(STORAGE_EVENT, { detail: consent }));
  } catch {
    /* environnement non web (tests) */
  }
}

/** Abonnement bas niveau (utilisé par `ads.ts`). */
export function subscribeAdConsent(listener: (consent: AdConsent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Hook React : consentement courant + mises à jour.
 * `ready` passe à `true` une fois le stockage lu : tant qu'il est `false`, on ne
 * sait pas encore si l'utilisateur a déjà choisi (évite un flash de l'écran de
 * consentement au démarrage).
 */
export function useAdConsent(): { consent: AdConsent; ready: boolean } {
  const [state, setState] = useState<{ consent: AdConsent; ready: boolean }>({
    consent: 'unknown',
    ready: false,
  });

  useEffect(() => {
    let alive = true;
    getAdConsent().then((value) => {
      if (alive) setState((prev) => ({ consent: prev.ready ? prev.consent : value, ready: true }));
    });
    const unsubscribe = subscribeAdConsent((value) => setState({ consent: value, ready: true }));
    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent<AdConsent>).detail;
      if (detail === 'granted' || detail === 'refused') setState({ consent: detail, ready: true });
    };
    window.addEventListener(STORAGE_EVENT, onEvent);
    return () => {
      alive = false;
      unsubscribe();
      window.removeEventListener(STORAGE_EVENT, onEvent);
    };
  }, []);

  return state;
}

/** `true` si l'écran de choix doit être proposé spontanément (app native). */
export function needsConsentPrompt(consent: AdConsent): boolean {
  return Capacitor.isNativePlatform() && consent === 'unknown';
}

/** Ouvre l'écran « Confidentialité des annonces » depuis le profil. */
export function openAdPrivacyOptions(): void {
  window.dispatchEvent(new Event(PRIVACY_EVENT));
}

/** Abonnement à la demande d'ouverture (monté par `AdConsentSheet`). */
export function onAdPrivacyOptionsRequested(listener: () => void): () => void {
  window.addEventListener(PRIVACY_EVENT, listener);
  return () => window.removeEventListener(PRIVACY_EVENT, listener);
}
