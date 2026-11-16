import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { addBaseMap } from '../lib/mapTiles';

/**
 * Aperçu cartographique d'une sortie partagée (A7).
 *
 * Le lien public ne contient **pas** le tracé GPS : seulement un centre
 * approximatif et un rayon. La carte affiche donc une zone, pas le parcours —
 * c'est le compromis retenu pour qu'un lien ouvrable sans compte ne permette
 * pas de reconstituer les déplacements. Aucune interaction : la carte est un
 * visuel, le bouton « Voir dans ElyWalk » mène à la sortie complète.
 */
export default function SharedActivityMap({
  center,
  radiusM = 600,
  height = 190,
}: {
  center: { lat: number; lng: number };
  radiusM?: number;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: true,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false,
      center: [center.lat, center.lng],
      zoom: 14,
    });
    addBaseMap(map);
    L.circle([center.lat, center.lng], {
      radius: Math.max(150, radiusM),
      color: '#D8CA82',
      weight: 2,
      fillColor: '#D8CA82',
      fillOpacity: 0.18,
    }).addTo(map);
    L.marker([center.lat, center.lng], {
      icon: L.divIcon({
        className: 'ely-user-wrap',
        html: '<div class="ely-user-dot"></div>',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      }),
      interactive: false,
    }).addTo(map);
    map.fitBounds(
      L.latLngBounds(
        [center.lat, center.lng],
        [center.lat + Math.max(0.002, radiusM / 111_000), center.lng],
      ),
      { padding: [12, 12] },
    );
    mapRef.current = map;
    const timer = window.setTimeout(() => map.invalidateSize(), 60);
    return () => {
      window.clearTimeout(timer);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center.lat, center.lng, radiusM]);

  return (
    <div
      ref={containerRef}
      className="shared-map"
      style={{ height }}
      data-testid="shared-activity-map"
      aria-label="Aperçu de la zone de la sortie"
      role="img"
    />
  );
}
