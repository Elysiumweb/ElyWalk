import { Capacitor } from '@capacitor/core';
import { ATTESTATION_WORKER_URL } from './constants';

/**
 * Attestation d'intégrité de l'appareil (F05).
 *
 * Obtient un jeton Play Integrity via le plugin natif
 * `@capacitor-community/play-integrity` puis le fait vérifier par le Worker
 * Cloudflare de confiance (voir /worker). Sans jeton vérifié côté serveur,
 * aucun crédit ne peut être attesté comme réel.
 *
 * Installation du plugin (une fois) :
 *   npm install @capacitor-community/play-integrity && npx cap sync
 * Prérequis Google : lier un projet Cloud dans la Play Console et activer
 * l'API Play Integrity (voir /worker/README.md).
 */

export interface IntegrityResult {
  ok: boolean;
  reason?: string;
}

/** Demande un jeton et le fait vérifier par le backend de confiance. */
export async function attestDeviceIntegrity(uid: string): Promise<IntegrityResult> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    return { ok: false, reason: 'Play Integrity indisponible sur cette plateforme' };
  }
  if (!ATTESTATION_WORKER_URL) {
    return { ok: false, reason: 'Worker d’attestation non configuré (ATTESTATION_WORKER_URL)' };
  }

  // Import dynamique : le module reste compilable même si le plugin n'est pas
  // encore installé (dégradation gracieuse, l'économie reste bornée par Firestore).
  const PLUGIN_SPEC = '@capacitor-community/play-integrity';
  let PlayIntegrity: { requestIntegrityToken: (o: unknown) => Promise<{ token: string }> };
  try {
    const mod = await import(/* @vite-ignore */ PLUGIN_SPEC);
    PlayIntegrity = mod.PlayIntegrity;
  } catch {
    return { ok: false, reason: 'Plugin play-integrity non installé' };
  }

  try {
    // Nonce unique par requête (évite le rejeu).
    const nonce = crypto.randomUUID().replace(/-/g, '');
    const { token } = await PlayIntegrity.requestIntegrityToken({
      nonce,
      googleCloudProjectNumber: 0, // 0 = valeur par défaut de l'application
    });
    const res = await fetch(`${ATTESTATION_WORKER_URL}/verify-integrity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, uid }),
    });
    return (await res.json()) as IntegrityResult;
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}
