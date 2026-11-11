/**
 * Version affichée dans l'application.
 *
 * Elle est injectée au build par Vite depuis `app/package.json` (voir
 * `vite.config.ts`), elle-même source unique du `versionName` Android. Aucune
 * page ne doit écrire la version en dur : `app/package.json` fait foi.
 */
export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' && __APP_VERSION__.length > 0 ? __APP_VERSION__ : '0.0.0-dev';

/** Libellé prêt à afficher : `ElyWalk 2.1.0`. */
export const APP_VERSION_LABEL = `ElyWalk ${APP_VERSION}`;
