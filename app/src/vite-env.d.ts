/// <reference types="vite/client" />

/**
 * Version applicative injectée au build par Vite (`vite.config.ts`) à partir de
 * `package.json`. Voir `src/lib/version.ts`.
 */
declare const __APP_VERSION__: string;

/** Identifiant de build horodaté (`2.1.0+202611111200`), même source. */
declare const __BUILD_STAMP__: string;
