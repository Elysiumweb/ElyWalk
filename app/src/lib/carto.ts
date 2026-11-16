/**
 * Clé et URL du fond de carte CARTO — module **sans Leaflet**.
 *
 * Séparé de `mapTiles.ts` pour être importable depuis le rendu canvas des
 * cartes partagées (`share.ts`) et depuis les tests sans charger Leaflet.
 *
 * Constat utilisateur : les sorties GPS et la carte n'affichaient plus rien
 * (tuiles refusées) car CARTO exige désormais une clé d'API. La clé est
 * déclarée **une seule fois ici** et réutilisée partout.
 *
 * ⚠️ Une clé de fond de carte est publique par nature (elle accompagne chaque
 * tuile envoyée au navigateur). Elle doit être **restreinte par domaine et par
 * application** dans le tableau de bord CARTO.
 */
export const CARTO_API_KEY = 'cb1_59h8_1_791c57a18e7fc67c0b0fd712';

/** Attribution obligatoire (CARTO + OpenStreetMap). */
export const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · &copy; <a href="https://carto.com/attributions">CARTO</a>';

export type BaseMapStyle = 'voyager' | 'voyager_dark' | 'light_all';

/** Style par défaut : Voyager, lisible en extérieur comme sur la charte. */
export const DEFAULT_BASE_MAP: BaseMapStyle = 'voyager';

/** URL de tuile CARTO (raster PNG) avec la clé d'API. */
export function cartoTileUrl(style: BaseMapStyle = DEFAULT_BASE_MAP): string {
  return `https://basemaps.cartocdn.com/rastertiles/${style}/{z}/{x}/{y}.png?key=${CARTO_API_KEY}`;
}

/** URL de tuile OpenStreetMap, utilisée en repli. */
export const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

export const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/**
 * Ajoute la clé à une URL de tuile CARTO déjà construite (rendu canvas).
 * Exporté pour être testé : oublier `?key=` rendait les images de partage
 * vides, sans aucun message d'erreur.
 */
export function withCartoKey(url: string, key = CARTO_API_KEY): string {
  if (!/basemaps\.cartocdn\.com/.test(url)) return url;
  if (/[?&]key=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}key=${key}`;
}

/** Lien public carré vers un aperçu de carte statique (sans clé tierce). */
export function staticMapPreviewUrl(center: { lat: number; lng: number }, zoom = 14): string {
  // OpenStreetMap ne fournit pas d'API statique officielle : on renvoie l'URL
  // d'intégration utilisée par la page publique (carte Leaflet légère).
  return `https://www.openstreetmap.org/export/embed.html?bbox=${center.lng - 0.01}%2C${center.lat - 0.008}%2C${center.lng + 0.01}%2C${center.lat + 0.008}&layer=mapnik&marker=${center.lat}%2C${center.lng}#map=${zoom}`;
}
