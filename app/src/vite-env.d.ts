/// <reference types="vite/client" />

/**
 * Version de l'application injectée au build par Vite (`define`), lue depuis
 * `app/package.json` : une seule source de vérité pour l'UI web et pour
 * `versionName` / `versionCode` Android (voir android/app/build.gradle).
 */
declare const __APP_VERSION__: string;
