import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useToast } from './Toast';
import { haversineM, type Coords } from '../lib/geo';
import {
  externalMapsUrl,
  formatDuration,
  formatRouteDistance,
  geocodeAddress,
  planRoute,
  pointLabel,
  reverseGeocode,
  tidyAddress,
  TRAVEL_MODES,
  TRANSIT_MODE_LABEL,
  type LatLng,
  type RoutePlan,
  type TravelMode,
} from '../lib/directions';

export interface DirectionsDestination {
  name: string;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
}

interface DirectionsPanelProps {
  open: boolean;
  onClose: () => void;
  destination: DirectionsDestination | null;
  /** Position connue de l'utilisateur, si la carte l'a déjà localisé. */
  origin: LatLng | null;
  onLocate: () => void | Promise<void>;
  onOriginResolved?: (point: Coords) => void;
  onMapReady?: (map: L.Map) => void;
}

const MODE_COLORS: Record<TravelMode, string> = {
  walk: '#8ad0a0',
  bike: '#7fc4e8',
  car: '#e8c46a',
  transit: '#c9a0e8',
};

/**
 * Feuille plein écran « Itinéraire » : adresse réelle de destination, point de
 * départ modifiable (position actuelle ou adresse saisie) et itinéraire
 * calculé **dans l'application** pour les quatre modes — à pied, à vélo, en
 * voiture et en transports en commun — avec tracé sur une carte Leaflet.
 *
 * Aucune redirection automatique vers Google Maps : le lien externe reste un
 * simple bouton de secours, affiché uniquement en cas d'échec ou sur demande.
 */
export default function DirectionsPanel({
  open,
  onClose,
  destination,
  origin,
  onLocate,
  onOriginResolved,
  onMapReady,
}: DirectionsPanelProps) {
  const { toast } = useToast();
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);

  const [mode, setMode] = useState<TravelMode>('walk');
  const [plan, setPlan] = useState<RoutePlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [startPoint, setStartPoint] = useState<LatLng | null>(origin);
  const [startLabel, setStartLabel] = useState<string | null>(null);
  const [destAddress, setDestAddress] = useState<string | null>(null);
  const [destPoint, setDestPoint] = useState<LatLng | null>(null);
  const [addressQuery, setAddressQuery] = useState('');
  const [editingStart, setEditingStart] = useState(false);

  // Point d'arrivée : coordonnées de l'établissement si connues, sinon
  // géocodage de son adresse postale.
  useEffect(() => {
    if (!open || !destination) return;
    let cancelled = false;
    setDestAddress(destination.address || null);
    setDestPoint(
      destination.lat != null && destination.lng != null
        ? { lat: destination.lat, lng: destination.lng }
        : null
    );
    if (destination.lat == null || destination.lng == null) {
      if (destination.address) {
        void geocodeAddress(destination.address)
          .then((hit) => {
            if (cancelled || !hit) return;
            setDestPoint({ lat: hit.lat, lng: hit.lng });
            setDestAddress(tidyAddress(hit.label));
          })
          .catch(() => undefined);
      }
    }
    return () => {
      cancelled = true;
    };
  }, [open, destination?.name, destination?.address, destination?.lat, destination?.lng]);

  // Reprise de la position de la carte dès qu'elle est disponible.
  useEffect(() => {
    if (origin && !editingStart) {
      setStartPoint(origin);
      setStartLabel(null);
    }
  }, [origin?.lat, origin?.lng, editingStart]);

  // Adresse réelle du point de départ (affichée sous le nom).
  useEffect(() => {
    if (!open || !startPoint) return;
    let cancelled = false;
    void reverseGeocode(startPoint)
      .then((label) => {
        if (!cancelled && label) setStartLabel(label);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, startPoint?.lat, startPoint?.lng]);

  // Adresse réelle de destination quand seule la position est connue.
  useEffect(() => {
    if (!open || !destPoint || destAddress) return;
    let cancelled = false;
    void reverseGeocode(destPoint)
      .then((label) => {
        if (!cancelled && label) setDestAddress(label);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, destPoint?.lat, destPoint?.lng, destAddress]);

  // Initialisation unique de la carte de l'itinéraire.
  useEffect(() => {
    if (!open || !mapElRef.current || mapRef.current) return;
    const map = L.map(mapElRef.current, {
      zoomControl: false,
      attributionControl: true,
      center: [46.6, 2.4],
      zoom: 6,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    layersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    onMapReady?.(map);
    setTimeout(() => map.invalidateSize(), 80);
    return () => {
      map.remove();
      mapRef.current = null;
      layersRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Calcul de l'itinéraire à chaque changement de mode / point de départ.
  useEffect(() => {
    if (!open || !destPoint) return;
    if (!startPoint) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void planRoute(startPoint, destPoint, mode)
      .then((next) => {
        if (cancelled) return;
        setPlan(next);
      })
      .catch((e) => {
        if (cancelled) return;
        setPlan(null);
        setError((e as Error).message || 'Itinéraire indisponible.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, mode, startPoint?.lat, startPoint?.lng, destPoint?.lat, destPoint?.lng]);

  // Tracé + repères sur la carte.
  useEffect(() => {
    const map = mapRef.current;
    const layers = layersRef.current;
    if (!map || !layers) return;
    layers.clearLayers();
    if (destPoint) {
      L.marker([destPoint.lat, destPoint.lng], {
        icon: L.divIcon({
          className: 'ely-pin-wrap',
          html: '<div class="ely-pin"><span>⚑</span></div><div class="ely-pin-tip"></div>',
          iconSize: [44, 54],
          iconAnchor: [22, 54],
        }),
      })
        .addTo(layers)
        .bindTooltip(destination?.name || 'Destination');
    }
    if (startPoint) {
      L.marker([startPoint.lat, startPoint.lng], {
        icon: L.divIcon({
          className: 'ely-user-wrap',
          html: '<div class="ely-user-dot"></div>',
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        }),
      })
        .addTo(layers)
        .bindTooltip('Départ');
    }

    const geometry = plan?.geometry?.length ? plan.geometry : [];
    if (geometry.length > 1) {
      const line = L.polyline(
        geometry.map((p) => [p.lat, p.lng] as [number, number]),
        { color: MODE_COLORS[mode], weight: 5, opacity: 0.92, lineJoin: 'round' }
      ).addTo(layers);
      map.fitBounds(line.getBounds(), { padding: [26, 26] });
    } else if (startPoint && destPoint) {
      L.polyline(
        [
          [startPoint.lat, startPoint.lng],
          [destPoint.lat, destPoint.lng],
        ],
        { color: MODE_COLORS[mode], weight: 4, dashArray: '6 8', opacity: 0.8 }
      ).addTo(layers);
      map.fitBounds(
        L.latLngBounds([
          [startPoint.lat, startPoint.lng],
          [destPoint.lat, destPoint.lng],
        ]),
        { padding: [26, 26] }
      );
    } else if (destPoint) {
      map.setView([destPoint.lat, destPoint.lng], 16);
    }
    setTimeout(() => map.invalidateSize(), 30);
  }, [plan, destPoint?.lat, destPoint?.lng, startPoint?.lat, startPoint?.lng, mode, destination?.name]);

  if (!open) return null;

  const straightLineM = startPoint && destPoint ? haversineM(startPoint, destPoint) : null;

  const useCurrentPosition = async () => {
    setEditingStart(false);
    toast('Recherche de votre position…', 'info');
    await onLocate();
  };

  const applyAddressQuery = async () => {
    if (addressQuery.trim().length < 3) {
      toast('Saisissez une adresse de départ complète.', 'error');
      return;
    }
    setLoading(true);
    try {
      const hit = await geocodeAddress(addressQuery);
      if (!hit) {
        toast('Adresse introuvable. Précisez la ville.', 'error');
        return;
      }
      setStartPoint({ lat: hit.lat, lng: hit.lng });
      setStartLabel(tidyAddress(hit.label));
      setEditingStart(true);
      onOriginResolved?.({ lat: hit.lat, lng: hit.lng });
      setAddressQuery('');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="directions-overlay" role="dialog" aria-modal="true" aria-label="Itinéraire" data-testid="directions-panel">
      <div className="directions-head">
        <div style={{ minWidth: 0 }}>
          <div className="directions-title">Itinéraire vers</div>
          <div className="directions-dest" data-testid="directions-destination">
            {destination?.name || 'Destination'}
          </div>
          <div className="directions-address" data-testid="directions-address">
            📍 {destAddress || (destPoint ? pointLabel(destPoint) : 'Adresse en cours de chargement…')}
          </div>
        </div>
        <button className="map-card-close" onClick={onClose} aria-label="Fermer l’itinéraire" data-testid="directions-close">
          ✕
        </button>
      </div>

      <div className="directions-modes" role="tablist" aria-label="Mode de déplacement">
        {TRAVEL_MODES.map((m) => (
          <button
            key={m.id}
            role="tab"
            aria-selected={mode === m.id}
            className={`directions-mode ${mode === m.id ? 'directions-mode-active' : ''}`}
            onClick={() => setMode(m.id)}
            data-testid={`directions-mode-${m.id}`}
          >
            <span aria-hidden="true">{m.icon}</span>
            <span>{m.short}</span>
          </button>
        ))}
      </div>

      <div className="directions-map" ref={mapElRef} data-testid="directions-map" />

      <div className="directions-body">
        <div className="directions-start">
          <div className="row-main">
            <div className="row-title" style={{ fontSize: 13 }}>
              Départ
            </div>
            <div className="row-sub" data-testid="directions-start">
              {startPoint ? startLabel || pointLabel(startPoint) : 'Position non détectée'}
            </div>
          </div>
          <div className="directions-start-actions">
            <button className="btn btn-outline btn-sm" onClick={() => void useCurrentPosition()} data-testid="directions-useme">
              Ma position
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setEditingStart((v) => !v)}
              data-testid="directions-edit-start"
            >
              Adresse
            </button>
          </div>
        </div>

        {(editingStart || !startPoint) && (
          <div className="directions-address-form">
            <input
              className="input"
              value={addressQuery}
              onChange={(e) => setAddressQuery(e.target.value)}
              placeholder="Adresse de départ (ex. 12 rue de Rivoli, Paris)"
              aria-label="Adresse de départ"
              data-testid="directions-start-input"
            />
            <button className="btn btn-gold btn-sm" onClick={() => void applyAddressQuery()} disabled={loading}>
              Utiliser
            </button>
          </div>
        )}

        <div className="directions-summary" data-testid="directions-summary">
          {!startPoint && (
            <span className="muted-text">Activez la localisation ou saisissez une adresse de départ.</span>
          )}
          {startPoint && loading && (
            <div className="directions-loading">
              <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
              Calcul de l’itinéraire…
            </div>
          )}
          {startPoint && !loading && error && (
            <div className="directions-error">
              <span>⚠️ {error}</span>
              {straightLineM != null && (
                <span className="muted-text">
                  À vol d’oiseau : {formatRouteDistance(straightLineM)}
                </span>
              )}
            </div>
          )}
          {startPoint && !loading && !error && plan && (
            <div className="directions-figures">
              <strong data-testid="directions-duration">{formatDuration(plan.durationS)}</strong>
              <span>{formatRouteDistance(plan.distanceM)}</span>
              <span className="muted-xs">{plan.provider}</span>
            </div>
          )}
        </div>

        {plan?.transitLegs && plan.transitLegs.length > 0 && !loading && (
          <div className="transit-legs" data-testid="transit-legs">
            {plan.transitLegs.map((leg, index) => (
              <div className="transit-leg" key={`${leg.mode}-${index}`}>
                <span
                  className="transit-chip"
                  style={leg.color ? { background: leg.color, color: '#111' } : undefined}
                >
                  {TRANSIT_MODE_LABEL[leg.mode]}
                  {leg.line ? ` ${leg.line}` : ''}
                </span>
                <div className="row-main">
                  <div className="row-title" style={{ fontSize: 13 }}>
                    {leg.from || 'Départ'} → {leg.to || 'Arrivée'}
                  </div>
                  <div className="row-sub">
                    {formatDuration(leg.durationS)} · {formatRouteDistance(leg.distanceM)}
                    {leg.headsign ? ` · direction ${leg.headsign}` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {plan?.steps && plan.steps.length > 0 && !loading && (
          <ol className="directions-steps" data-testid="directions-steps">
            {plan.steps.map((step, index) => (
              <li key={`${index}-${step.instruction}`}>
                <span className="directions-step-index" aria-hidden="true">
                  {index + 1}
                </span>
                <div className="row-main">
                  <div className="row-title" style={{ fontSize: 13 }}>
                    {step.instruction}
                  </div>
                  {step.distanceM > 0 && (
                    <div className="row-sub">
                      {formatRouteDistance(step.distanceM)}
                      {step.durationS > 0 ? ` · ${formatDuration(step.durationS)}` : ''}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}

        {destPoint && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => window.open(externalMapsUrl(destPoint, mode, startPoint), '_blank', 'noopener')}
            data-testid="directions-external"
          >
            Ouvrir dans Google Maps
          </button>
        )}
        <p className="muted-xs directions-credits">
          Calcul d’itinéraire : OpenStreetMap · OSRM (marche, vélo, voiture) et
          Île-de-France Mobilités ou <a href="https://transitous.org" target="_blank" rel="noreferrer">Transitous</a>{' '}
          (transports en commun).
        </p>
      </div>
    </div>
  );
}
