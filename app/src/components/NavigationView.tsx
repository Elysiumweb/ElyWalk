import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useToast } from './Toast';
import { getCurrentPosition, haversineM, watchPosition, type Coords } from '../lib/geo';
import {
  formatDuration,
  formatRouteDistance,
  planRoute,
  type LatLng,
  type RoutePlan,
  type RouteStep,
  type TravelMode,
} from '../lib/directions';

interface NavigationViewProps {
  open: boolean;
  onClose: () => void;
  /** Nom de la destination (« Marche du parc », établissement…). */
  destinationName: string;
  destination: LatLng | null;
  mode: TravelMode;
  /** Itinéraire déjà calculé par la feuille « Itinéraire ». */
  initialPlan?: RoutePlan | null;
  /** Départ connu (position courante ou adresse choisie). */
  start: LatLng | null;
}

const MODE_COLORS: Record<TravelMode, string> = {
  walk: '#8ad0a0',
  bike: '#7fc4e8',
  car: '#e8c46a',
  transit: '#c9a0e8',
};

const MODE_LABEL: Record<TravelMode, string> = {
  walk: 'à pied',
  bike: 'à vélo',
  car: 'en voiture',
  transit: 'en transports',
};

/**
 * **Guidage GPS dans l'application** (bug « Rencontres → Itinéraire »).
 *
 * Avant : la feuille d'itinéraire empilait la liste des consignes sous une
 * carte statique — ce n'est pas un GPS. Désormais, « Démarrer » ouvre cet écran
 * plein écran :
 *
 * - la carte suit la position (niveau de zoom de conduite, recentrage continu) ;
 * - le tracé est dessiné, l'étape en cours est mise en avant ;
 * - un bandeau affiche la **distance et la durée restantes**, la prochaine
 *   manœuvre (flèche + texte) et le nom de la destination ;
 * - la progression est calculée par rapport au tracé (projection du point sur
 *   le segment le plus proche), pas par rapport au point de départ, donc un
 *   détour ou une sortie de route ne fausse pas le reste à parcourir ;
 * - l'écran reste allumé si l'API le permet (`wakeLock`), et un bouton
 *   « Recentrer » réactive le suivi après un déplacement manuel de la carte.
 *
 * Aucune redirection vers Google Maps : tout se passe dans ElyWalk.
 */
export default function NavigationView({
  open,
  onClose,
  destinationName,
  destination,
  mode,
  initialPlan,
  start,
}: NavigationViewProps) {
  const { toast } = useToast();
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const followRef = useRef(true);
  const lastPositionRef = useRef<LatLng | null>(null);

  const [plan, setPlan] = useState<RoutePlan | null>(initialPlan || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState<LatLng | null>(start || null);
  const [following, setFollowing] = useState(true);

  // Le plan fourni par la feuille « Itinéraire » évite un second calcul réseau.
  useEffect(() => {
    if (!open) return;
    if (initialPlan) {
      setPlan(initialPlan);
      setError(null);
      return;
    }
    if (!start || !destination) return;
    let cancelled = false;
    setLoading(true);
    void planRoute(start, destination, mode)
      .then((next) => {
        if (!cancelled) {
          setPlan(next);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message || 'Itinéraire indisponible.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, initialPlan, start?.lat, start?.lng, destination?.lat, destination?.lng, mode]);

  // Carte plein écran du guidage.
  useEffect(() => {
    if (!open || !mapElRef.current || mapRef.current) return;
    const map = L.map(mapElRef.current, {
      zoomControl: false,
      attributionControl: true,
      center: [destination?.lat ?? 46.6, destination?.lng ?? 2.4],
      zoom: 16,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    // Un déplacement manuel suspend le suivi : l'utilisateur garde la main.
    map.on('dragstart', () => {
      followRef.current = false;
      setFollowing(false);
    });
    setTimeout(() => map.invalidateSize(), 80);
    return () => {
      map.remove();
      mapRef.current = null;
      routeLayerRef.current = null;
      userMarkerRef.current = null;
    };
  }, [open]);

  // Tracé + repère de destination.
  useEffect(() => {
    const map = mapRef.current;
    const layer = routeLayerRef.current;
    if (!map || !layer || !open) return;
    layer.clearLayers();
    if (plan?.geometry?.length) {
      L.polyline(
        plan.geometry.map((p) => [p.lat, p.lng] as [number, number]),
        { color: '#0b0b0c', weight: 9, opacity: 0.55, lineJoin: 'round' }
      ).addTo(layer);
      L.polyline(
        plan.geometry.map((p) => [p.lat, p.lng] as [number, number]),
        { color: MODE_COLORS[mode], weight: 5, opacity: 0.95, lineJoin: 'round' }
      ).addTo(layer);
    }
    if (destination) {
      L.marker([destination.lat, destination.lng], {
        icon: L.divIcon({
          className: 'ely-pin-wrap',
          html: '<div class="ely-pin"><span>⚑</span></div><div class="ely-pin-tip"></div>',
          iconSize: [44, 54],
          iconAnchor: [22, 54],
        }),
      })
        .addTo(layer)
        .bindTooltip(destinationName);
    }
    if (plan?.geometry?.length && !position) {
      map.fitBounds(L.latLngBounds(plan.geometry.map((p) => [p.lat, p.lng] as [number, number])), {
        padding: [40, 60],
      });
    }
    setTimeout(() => map.invalidateSize(), 40);
  }, [open, plan, destination?.lat, destination?.lng, destinationName, mode]);

  // Suivi de la position : le point bleu reste au centre tant que l'utilisateur
  // n'a pas déplacé la carte.
  const drawUser = (point: LatLng) => {
    const map = mapRef.current;
    if (!map) return;
    if (userMarkerRef.current) userMarkerRef.current.remove();
    userMarkerRef.current = L.marker([point.lat, point.lng], {
      icon: L.divIcon({
        className: 'ely-user-wrap',
        html: '<div class="ely-user-dot"><div class="ely-user-pulse"></div></div>',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      }),
      zIndexOffset: 800,
    }).addTo(map);
    if (followRef.current) map.setView([point.lat, point.lng], Math.max(map.getZoom(), 16), { animate: true });
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const apply = (pos: Coords) => {
      const next = { lat: pos.lat, lng: pos.lng };
      lastPositionRef.current = next;
      setPosition(next);
      drawUser(next);
    };

    // 1) Position immédiate, puis suivi continu.
    //
    // Le suivi passait uniquement par `navigator.geolocation`, qui n'existe pas
    // dans la WebView Capacitor : le guidage restait figé sur la position de
    // l'ouverture. `watchPosition` (lib/geo) utilise le suivi natif sur mobile
    // et le navigateur ailleurs, et se nettoie au démontage.
    void getCurrentPosition({ silent: true })
      .then((pos) => {
        if (pos && !cancelled) apply(pos);
      })
      .catch(() => undefined);

    const watcher = watchPosition(
      (coords) => {
        if (!cancelled) apply(coords);
      },
      (error) => {
        // Le dernier point connu reste affiché : un trou de signal d'une
        // seconde ne doit pas faire disparaître le repère.
        console.warn('[guidage] position', error.message);
      },
      { intervalMs: 3000 },
    );

    return () => {
      cancelled = true;
      watcher.stop();
    };
  }, [open]);

  // Écran allumé pendant le guidage (best effort : l'API n'existe pas partout).
  useEffect(() => {
    if (!open) return;
    let sentinel: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<any> } };
    void nav.wakeLock
      ?.request('screen')
      .then((lock: any) => {
        sentinel = lock;
      })
      .catch(() => undefined);
    return () => {
      void sentinel?.release().catch(() => undefined);
    };
  }, [open]);

  const recenter = () => {
    followRef.current = true;
    setFollowing(true);
    const map = mapRef.current;
    const point = lastPositionRef.current || position;
    if (map && point) map.setView([point.lat, point.lng], 17, { animate: true });
    else if (map && plan?.geometry?.length) {
      map.fitBounds(L.latLngBounds(plan.geometry.map((p) => [p.lat, p.lng] as [number, number])), {
        padding: [40, 60],
      });
    }
    void getCurrentPosition({ silent: true })
      .then((pos) => {
        if (pos) {
          const next = { lat: pos.lat, lng: pos.lng };
          setPosition(next);
          drawUser(next);
        }
      })
      .catch(() => undefined);
  };

  /** Avancement le long du tracé (projection sur le segment le plus proche). */
  const progress = useMemo(() => {
    const geometry = plan?.geometry || [];
    if (!position || geometry.length < 2) return null;
    let best = { distance: Number.POSITIVE_INFINITY, index: 0 };
    for (let i = 0; i < geometry.length; i += 1) {
      const d = haversineM(position, geometry[i]);
      if (d < best.distance) best = { distance: d, index: i };
    }
    // Distance restante : points suivants + distance au point courant.
    let remaining = best.distance;
    for (let i = best.index; i < geometry.length - 1; i += 1) {
      remaining += haversineM(geometry[i], geometry[i + 1]);
    }
    const total = plan?.distanceM || 0;
    const ratio = total > 0 ? Math.min(1, Math.max(0, 1 - remaining / total)) : 0;
    const etaS = plan ? Math.round(plan.durationS * (1 - ratio)) : 0;
    // Prochaine manœuvre : première consigne située devant nous sur le tracé.
    let nextStep: RouteStep | null = null;
    const steps = plan?.steps || [];
    for (const step of steps) {
      if (!step.at) continue;
      const distanceToStep = haversineM(position, step.at);
      if (distanceToStep > 25) {
        nextStep = step;
        break;
      }
    }
    if (!nextStep && steps.length) nextStep = steps[steps.length - 1];
    return {
      remaining: Math.max(0, Math.round(remaining)),
      etaS,
      ratio,
      nextStep,
      distanceToNext: nextStep?.at ? Math.round(haversineM(position, nextStep.at)) : null,
    };
  }, [plan, position?.lat, position?.lng]);

  if (!open) return null;

  const arrived = progress ? progress.remaining < 30 : false;
  const nextInstruction = arrived
    ? 'Vous êtes arrivé à destination'
    : progress?.nextStep?.instruction || plan?.steps?.[0]?.instruction || `Suivez le tracé ${MODE_LABEL[mode]}`;

  return (
    <div className="nav-overlay" role="dialog" aria-modal="true" aria-label="Guidage GPS" data-testid="navigation-view">
      <div className="nav-map" ref={mapElRef} data-testid="navigation-map" />

      <div className="nav-top">
        <button className="nav-close" onClick={onClose} aria-label="Quitter le guidage" data-testid="navigation-close">
          ✕
        </button>
        <div className="nav-destination">
          <span className="nav-destination-label">Destination</span>
          <strong>{destinationName}</strong>
        </div>
      </div>

      <div className="nav-instruction" data-testid="navigation-instruction">
        {loading && (
          <div className="nav-loading">
            <span className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
            Calcul de l’itinéraire…
          </div>
        )}
        {!loading && error && (
          <div className="nav-error">
            <span>⚠️ {error}</span>
            <small>Réessayez, ou choisissez un autre mode de déplacement.</small>
          </div>
        )}
        {!loading && !error && (
          <>
            <div className="nav-instruction-main">
              <span className="nav-arrow" aria-hidden="true">
                {arrived ? '🏁' : arrowFor(progress?.nextStep)}
              </span>
              <span className="nav-instruction-text" data-testid="navigation-next-step">
                {nextInstruction}
              </span>
            </div>
            <div className="nav-instruction-meta">
              {progress?.distanceToNext != null && !arrived && (
                <strong>dans {formatRouteDistance(progress.distanceToNext)}</strong>
              )}
              {plan && (
                <span>
                  {formatRouteDistance(progress?.remaining ?? plan.distanceM)} ·{' '}
                  {formatDuration(progress?.etaS ?? plan.durationS)} restants
                </span>
              )}
            </div>
          </>
        )}
      </div>

      <div className="nav-bottom">
        {plan && (
          <div className="nav-progress" aria-hidden="true">
            <div className="nav-progress-bar" style={{ width: `${Math.round((progress?.ratio || 0) * 100)}%` }} />
          </div>
        )}
        <div className="nav-actions">
          <button
            type="button"
            className={`nav-recenter ${following ? 'nav-recenter-active' : ''}`}
            onClick={recenter}
            data-testid="navigation-recenter"
          >
            <span aria-hidden="true">◎</span> Recentrer
          </button>
          <button type="button" className="btn btn-danger btn-sm" onClick={onClose} data-testid="navigation-stop">
            Terminer
          </button>
        </div>
        {!plan && !loading && (
          <button
            type="button"
            className="btn btn-gold btn-sm"
            onClick={() => {
              if (!position || !destination) {
                toast('Position ou destination inconnue.', 'error');
                return;
              }
              setLoading(true);
              void planRoute(position, destination, mode)
                .then((next) => {
                  setPlan(next);
                  setError(null);
                })
                .catch((e) => setError((e as Error).message))
                .finally(() => setLoading(false));
            }}
          >
            Recalculer l’itinéraire
          </button>
        )}
      </div>
    </div>
  );
}

/** Flèche directionnelle déduite du type de manœuvre. */
function arrowFor(step?: RouteStep | null): string {
  if (!step) return '⬆️';
  const kind = (step.kind || '').toLowerCase();
  const modifier = (step.modifier || '').toLowerCase();
  if (kind === 'arrive') return '🏁';
  if (kind === 'roundabout' || kind === 'rotary') return '🔄';
  if (modifier.includes('sharp left') || modifier === 'left') return '⬅️';
  if (modifier.includes('sharp right') || modifier === 'right') return '➡️';
  if (modifier.includes('slight left')) return '↖️';
  if (modifier.includes('slight right')) return '↗️';
  if (modifier === 'uturn') return '↩️';
  return '⬆️';
}
