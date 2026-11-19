import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import {
  decideUpdate,
  PLAY_STORE_PACKAGE,
  normalizeRelease,
  parseSnooze,
  playStoreMarketUrl,
  playStoreUrl,
  SNOOZE_MS,
  type ReleaseInfo,
  type SnoozeState,
  type UpdateDecision,
} from './appRelease';
import { APP_VERSION } from './version';

/**
 * Détection d'une mise à jour publiée sur le Play Store.
 *
 * La source de vérité est `appRelease/current` (Firestore). Le Worker
 * synchronise ce document avec la version de production publiée dans Play
 * Console toutes les six heures ; les administrateurs peuvent aussi gérer les
 * notes et la politique de mise à jour depuis l'application. Les métadonnées
 * sont publiques pour que l'avis fonctionne également avant connexion.
 *
 * Une erreur réseau est **silencieuse** : elle ne bloque jamais le démarrage et
 * ne propose jamais une version plus ancienne que celle installée.
 */

const SNOOZE_KEY = 'elywalk.update.snooze.v1';

/** Métadonnées publiques de version, éditables uniquement par l'administration. */
export const RELEASE_DOC_PATH = 'appRelease/current';

/** Version publiée dans le document synchronisé par le Worker et Play Console. */
export async function readReleaseInfo(): Promise<ReleaseInfo | null> {
  try {
    const snapshot = await getDoc(doc(db, RELEASE_DOC_PATH));
    if (!snapshot.exists()) return null;
    return normalizeRelease(snapshot.data());
  } catch {
    // Hors ligne, règle refusée, document absent : le contrôle est simplement
    // inactif. Aucune alerte : ce n'est pas une erreur de l'utilisateur.
    return null;
  }
}

/**
 * Version installée.
 *
 * `APP_VERSION` vient du build (`package.json`), donc de la même valeur que
 * `versionName`/`versionCode` Android : c'est fiable même en web. Sur natif, on
 * demande au plugin la valeur réelle — utile si l'APK et le bundle web
 * divergent (mise à jour partielle).
 */
export async function readInstalledVersion(): Promise<string> {
  if (!Capacitor.isNativePlatform()) return APP_VERSION;
  try {
    const info = await CapApp.getInfo();
    return info.version || APP_VERSION;
  } catch {
    return APP_VERSION;
  }
}

async function readSnooze(): Promise<SnoozeState | null> {
  try {
    const { value } = await Preferences.get({ key: SNOOZE_KEY });
    return parseSnooze(value);
  } catch {
    return null;
  }
}

/** Reporte la mise à jour d'une version donnée (bouton « Plus tard »). */
export async function snoozeUpdate(version: string, durationMs: number = SNOOZE_MS): Promise<void> {
  const state: SnoozeState = { version, until: Date.now() + durationMs };
  try {
    await Preferences.set({ key: SNOOZE_KEY, value: JSON.stringify(state) });
  } catch {
    /* stockage indisponible : l'écran se refermera simplement pour cette fois */
  }
}

/** Efface le report (utile après une mise à jour réussie ou pour tester). */
export async function clearSnooze(): Promise<void> {
  try {
    await Preferences.remove({ key: SNOOZE_KEY });
  } catch {
    /* rien à faire */
  }
}

/**
 * Point d'entrée : renvoie la décision d'affichage de l'écran de mise à jour.
 * Ne lève jamais : toute erreur signifie « pas de mise à jour à proposer ».
 */
export async function checkForUpdate(options: { now?: number } = {}): Promise<UpdateDecision> {
  const none: UpdateDecision = { available: false, severity: 'recommended', dismissed: false };
  try {
    const installed = await readInstalledVersion();
    const release = await readReleaseInfo();
    const decision = decideUpdate(installed, release, await readSnooze(), options.now ?? Date.now());
    return decision;
  } catch {
    return none;
  }
}

/** Identifiant Play Store, surchargeable par variable d'environnement Vite. */
function playStorePackageName(): string {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  return env?.VITE_PLAY_PACKAGE || PLAY_STORE_PACKAGE;
}

/**
 * Ouvre la fiche Play Store. `market://` d'abord (application Play Store),
 * puis repli navigateur : sur un appareil sans Play Store, l'utilisateur garde
 * un moyen d'atteindre la page de téléchargement.
 */
export async function openPlayStore(): Promise<void> {
  const packageName = playStorePackageName();
  const market = playStoreMarketUrl(packageName);
  const web = playStoreUrl(packageName);
  try {
    const bridge = (CapApp as unknown as {
      openUrl?: (options: { url: string }) => Promise<void>;
    }).openUrl;
    if (bridge && Capacitor.isNativePlatform()) {
      await bridge({ url: market });
      return;
    }
  } catch {
    /* Play Store absent : on retombe sur le navigateur */
  }
  if (typeof window !== 'undefined') window.open(web, '_blank', 'noopener,noreferrer');
}
