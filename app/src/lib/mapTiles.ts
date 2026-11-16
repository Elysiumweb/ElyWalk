import L from 'leaflet';
import {
  CARTO_ATTRIBUTION,
  DEFAULT_BASE_MAP,
  OSM_ATTRIBUTION,
  OSM_TILE_URL,
  cartoTileUrl,
  type BaseMapStyle,
} from './carto';

export {
  CARTO_API_KEY,
  CARTO_ATTRIBUTION,
  DEFAULT_BASE_MAP,
  OSM_TILE_URL,
  cartoTileUrl,
  withCartoKey,
  type BaseMapStyle,
} from './carto';

/**
 * Fonds de carte Leaflet de l'application — CARTO **avec clé d'API**.
 *
 * Constat utilisateur : les sorties GPS affichaient un fond gris, les tuiles
 * CARTO étant refusées faute de clé. La clé vit dans `lib/carto.ts` et ce
 * module l'applique à toutes les cartes Leaflet (Carte, Itinéraire, Guidage,
 * Sortie GPS, Parcours, détail de sortie). Un repli OpenStreetMap est branché :
 * si CARTO refuse les tuiles (clé révoquée, quota), la carte bascule sur OSM au
 * lieu de rester vide.
 */
export function addBaseMap(
  map: L.Map,
  options: { style?: BaseMapStyle; maxZoom?: number; minZoom?: number } = {},
): L.TileLayer {
  const style = options.style || DEFAULT_BASE_MAP;
  const maxZoom = options.maxZoom ?? 20;
  const layer = L.tileLayer(cartoTileUrl(style), {
    maxZoom,
    minZoom: options.minZoom,
    attribution: CARTO_ATTRIBUTION,
    crossOrigin: true,
  }).addTo(map);

  let errors = 0;
  let swapped = false;
  const swap = () => {
    if (swapped) return;
    swapped = true;
    layer.remove();
    L.tileLayer(OSM_TILE_URL, { maxZoom, attribution: OSM_ATTRIBUTION, crossOrigin: true }).addTo(map);
  };
  layer.on('tileerror', () => {
    errors += 1;
    // Une tuile manquante isolée (bord de carte) ne déclenche pas le repli.
    if (errors >= 3) swap();
  });
  // Aucune tuile chargée après 8 s : le service ne répond pas, on bascule.
  if (typeof window !== 'undefined') {
    window.setTimeout(() => {
      if (swapped) return;
      if (typeof map.hasLayer === 'function' && !map.hasLayer(layer)) return;
      const container = layer.getContainer?.();
      const loaded = container ? container.querySelectorAll('img.leaflet-tile-loaded').length : 0;
      if (loaded === 0) swap();
    }, 8000);
  }
  return layer;
}
