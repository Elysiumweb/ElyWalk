/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Config Firebase (facultatif — valeurs par défaut dans src/lib/firebase.ts) */
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_ANDROID_APP_ID?: string;
  readonly VITE_FIREBASE_WEB_APP_ID?: string;
  /** App Check */
  readonly VITE_APP_CHECK_RECAPTCHA_SITE_KEY?: string;
  readonly VITE_APP_CHECK_DEBUG_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
