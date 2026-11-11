import packageJson from '../../package.json';

/**
 * Version affichée dans l'application.
 *
 * Source unique : `app/package.json`. Le même fichier alimente `versionName` et
 * `versionCode` Android (`android/app/build.gradle`), donc l'écran Profil,
 * l'écran Nouveautés et la fiche Play Store ne peuvent plus diverger.
 * Aucune page ne doit écrire la version en dur.
 */
export const APP_VERSION: string =
  typeof packageJson.version === 'string' && packageJson.version.length > 0
    ? packageJson.version
    : '0.0.0-dev';

/** Libellé prêt à afficher : `ElyWalk 2.1.0`. */
export const APP_VERSION_LABEL = `ElyWalk ${APP_VERSION}`;
