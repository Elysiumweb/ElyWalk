import { Capacitor } from '@capacitor/core';
import { FirebaseAppCheck } from '@capacitor-firebase/app-check';
import {
  initializeAppCheck,
  CustomProvider,
  ReCaptchaV3Provider,
  type AppCheck,
} from 'firebase/app-check';
import { firebaseApp } from './firebase';

/**
 * Initialisation d'App Check.
 *
 * Pourquoi c'était cassé : l'application lit Firestore avec le **SDK JS**
 * (dans la WebView Capacitor). Quand on active l'application forcée d'App
 * Check dans la console, chaque requête Firestore doit porter un jeton
 * App Check. Or le SDK JS n'en produisait aucun (aucun provider initialisé),
 * et le provider natif Play Integrity — même installé — n'alimente pas
 * automatiquement le SDK JS. Résultat : toutes les requêtes Firestore
 * étaient rejetées ("Missing or insufficient permissions" /
 * "AppCheck token is invalid") et les utilisateurs perdaient l'accès aux
 * données.
 *
 * Solution officielle (doc du plugin @capacitor-firebase/app-check) :
 *  1. initialiser App Check sur la couche native (Play Integrity / App Attest),
 *  2. créer un `CustomProvider` côté JS qui va chercher le jeton natif,
 *  3. initialiser App Check sur la couche JS avec ce provider.
 *
 * Sur le web, on utilise reCAPTCHA v3 (clé publique dans
 * `VITE_APP_CHECK_RECAPTCHA_SITE_KEY`).
 *
 * ⚠️ App Check doit être initialisé AVANT le premier appel Firestore
 * (cf. `main.tsx`).
 */

const env = import.meta.env as Record<string, string | undefined>;

let appCheckInstance: AppCheck | null = null;
let initPromise: Promise<AppCheck | null> | null = null;

/** Jeton de debug (émulateur / build de dev) : voir docs. */
function applyDebugToken(): void {
  const debugToken = env.VITE_APP_CHECK_DEBUG_TOKEN;
  if (!debugToken) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN =
    debugToken === 'true' ? true : debugToken;
}

async function doInitialize(): Promise<AppCheck | null> {
  applyDebugToken();

  const isNative = Capacitor.isNativePlatform();
  const siteKey = env.VITE_APP_CHECK_RECAPTCHA_SITE_KEY;

  if (!isNative && !siteKey) {
    // Pas de clé reCAPTCHA fournie : on n'initialise pas App Check sur le web
    // plutôt que de casser l'accès aux données.
    console.warn(
      '[AppCheck] VITE_APP_CHECK_RECAPTCHA_SITE_KEY absent : App Check désactivé sur le web.'
    );
    return null;
  }

  if (isNative) {
    // 1. Couche native (Play Integrity sur Android, App Attest/DeviceCheck sur iOS)
    await FirebaseAppCheck.initialize();
    await FirebaseAppCheck.setTokenAutoRefreshEnabled({ enabled: true });
    // 2. + 3. Couche JS alimentée par le jeton natif
    const provider = new CustomProvider({
      getToken: async () => {
        const { token, expireTimeMillis } = await FirebaseAppCheck.getToken();
        return {
          token,
          // Par défaut, les jetons App Check natifs sont valables 1 h.
          expireTimeMillis: expireTimeMillis ?? Date.now() + 60 * 60 * 1000,
        };
      },
    });
    appCheckInstance = initializeAppCheck(firebaseApp, {
      provider,
      isTokenAutoRefreshEnabled: true,
    });
  } else {
    appCheckInstance = initializeAppCheck(firebaseApp, {
      provider: new ReCaptchaV3Provider(siteKey as string),
      isTokenAutoRefreshEnabled: true,
    });
  }

  return appCheckInstance;
}

/**
 * Initialise App Check (idempotent).
 * N'échoue jamais : en cas d'erreur, on log et on laisse l'app démarrer
 * (App Check en mode non appliqué continuera de fonctionner).
 */
export function initAppCheck(): Promise<AppCheck | null> {
  if (!initPromise) {
    initPromise = doInitialize().catch((e) => {
      console.error('[AppCheck] Initialisation impossible :', e);
      return null;
    });
  }
  return initPromise;
}

export function getAppCheckInstance(): AppCheck | null {
  return appCheckInstance;
}
