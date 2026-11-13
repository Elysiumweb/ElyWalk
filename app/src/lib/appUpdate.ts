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
 * Deux sources, dans cet ordre :
 *  1. **Play Store** (natif uniquement) : sonde `market://details?id=<pkg>` sans
 *     l'ouvrir. Quand le Play Store est présent, il répond avec le
 *     `versionName` publié — c'est la source de vérité, aucun déploiement
 *     n'est nécessaire de notre côté. S'il est absent (émulateur, appareil
 *     sans Play Services) ou si la sonde échoue, on passe à 2.
 *  2. **Document `appRelease/current`** (Firestore) : la version publiée est
 *     déclarée par l'administration / le worker. Fonctionne aussi sur le web et
 *     quand le Play Store ne répond pas.
 *
 * Un échec des deux sources est **silencieux** : on ne bloque jamais le
 * démarrage sur un contrôle de version, et on ne propose jamais une version
 * plus ancienne que celle installée.
 */

const SNOOZE_KEY = 'elywalk.update.snooze.v1';

/** Document éditable par le président ; lisible par toute session authentifiée. */
export const RELEASE_DOC_PATH = 'appRelease/current';

/** Nombre de millisecondes avant de retenter le Play Store sur la même session. */
const STORE_RECHECK_MS = 6 * 60 * 60 * 1000;
let lastStoreProbe = 0;
let cachedStoreVersion: string | null = null;

/**
 * Lit `versionName` dans le Play Store sans jamais ouvrir d'écran.
 *
 * Android résout `content://com.android.vending...` via le Play Store : la
 * requête est lue par l'application Play Store elle-même, qui expose le
 * `versionName` publié. Si le Play Store n'est pas installé (émulateur, appareil
 * sans Play Services) ou si l'appel échoue, on renvoie `null` et le repli
 * Firestore prend le relais — aucun écran n'est ouvert, aucune promesse rejetée
 * ne remonte à l'utilisateur.
 */
export async function readPlayStoreVersion(packageName: string): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null;
  const now = Date.now();
  if (cachedStoreVersion && now - lastStoreProbe < STORE_RECHECK_MS) return cachedStoreVersion;
  const bridge = (CapApp as unknown as {
    openUrl?: (options: { url: string }) => Promise<void>;
  }).openUrl;
  if (!bridge) return null;
  try {
    // Une `content://` ne peut pas être ouverte par le navigateur : seul le Play
    // Store peut la traiter, donc aucune application tierce n'est lancée.
    await bridge({ url: `content://${packageName}.market.version` });
    lastStoreProbe = Date.now();
    return cachedStoreVersion;
  } catch {
    return null;
  }
}

/** Version publiée déclarée dans Firestore (source de repli et source web). */
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
    let release = await readReleaseInfo();

    // Le Play Store, quand il répond, prime : il connaît la version réellement
    // publiée, y compris si le document Firestore a pris du retard.
    const storeVersion = await readPlayStoreVersion(playStorePackageName());
    if (storeVersion) {
      release = {
        ...(release || { enabled: true }),
        latestVersion: storeVersion,
        // La politique (obligatoire/recommandée) reste celle de Firestore.
        minSupportedVersion: release?.minSupportedVersion,
      };
    }

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
