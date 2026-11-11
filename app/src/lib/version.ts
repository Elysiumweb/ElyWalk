// ============================================================================
// Version de l'application — source unique.
//
// La version affichée dans l'interface (Profil, Nouveautés…) n'est plus écrite
// en dur : elle est injectée au build par Vite (`define.__APP_VERSION__`), qui
// la lit dans `package.json`. Une seule ligne est donc à incrémenter pour une
// publication :
//
//   app/package.json            → "version": "2.1.0"
//   app/android/app/build.gradle → versionCode / versionName (Play Console)
//
// ⚠️ Play Console refuse un APK/AAB dont `versionCode` a déjà été publié : il
// faut incrémenter `versionCode` (et `versionName`) à chaque envoi.
// ============================================================================

/**
 * Version applicative, ex. `1.9.0`.
 *
 * `__APP_VERSION__` est remplacé statiquement par Vite au build. Le repli
 * `'0.0.0'` ne sert qu'aux contextes où la définition manque (tests unitaires
 * lancés hors configuration Vite, outils externes).
 */
export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : '0.0.0';

/** Libellé prêt à afficher : « ElyWalk 2.1.0 ». */
export const APP_VERSION_LABEL = `ElyWalk ${APP_VERSION}`;

/**
 * Empreinte de compilation (`2.1.0+202611111230`), injectée par Vite.
 * Affichée en petit dans le profil : elle permet de vérifier en un coup d'œil
 * que l'appareil exécute bien la dernière archive et pas une WebView en cache.
 */
export const BUILD_STAMP: string =
  typeof __BUILD_STAMP__ === 'string' && __BUILD_STAMP__ ? __BUILD_STAMP__ : APP_VERSION;

/** Construction stable pour un cache-busting éventuel : `ely-1-9-0`. */
export const APP_VERSION_SLUG = `ely-${APP_VERSION.replace(/[^0-9a-zA-Z]+/g, '-')}`;
