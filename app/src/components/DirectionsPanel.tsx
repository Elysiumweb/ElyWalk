import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useToast } from './Toast';
import AddressAutocomplete from './AddressAutocomplete';
import NavigationView from './NavigationView';
import { haversineM, type Coords } from '../lib/geo';
import { showInterstitial } from '../lib/ads';
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
  type AddressSuggestion,
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
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
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
  // Détail des consignes : masqué par défaut. Le guidage se fait sur la carte
  // (NavigationView) ; la liste n'est qu'une aide consultable.
  const [showSteps, setShowSteps] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

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

  /**
   * Ouverture « Itinéraire » : on localise l'utilisateur immédiatement.
   *
   * Avant, la feuille s'ouvrait sans point de départ (« Position non
   * détectée ») : l'utilisateur devait appuyer sur « Ma position » puis
   * attendre un second calcul. Depuis les Rencontres comme depuis la carte
   * partenaire, le trajet est désormais demandé dès l'ouverture, sur la carte
   * ElyWalk.
   */
  const autoLocatedRef = useRef(false);
  useEffect(() => {
    if (!open) { autoLocatedRef.current = false; return; }
    if (autoLocatedRef.current) return;
    if (startPoint || origin) { autoLocatedRef.current = true; return; }
    autoLocatedRef.current = true;
    void Promise.resolve(onLocate()).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
    // La feuille s'ouvre dans un conteneur qui vient d'apparaître : sans cette
    // seconde invalidation, Leaflet garde la taille 0 px mesurée à l'ouverture
    // et n'affiche qu'un rectangle gris.
    // `ResizeObserver` n'existe pas sur toutes les WebViews anciennes : la
    // hauteur est alors recalculée à la fin du calcul d'itinéraire.
    const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => map.invalidateSize()) : null;
    if (resize && mapElRef.current) resize.observe(mapElRef.current);
    return () => {
      resize?.disconnect();
      map.remove();
      mapRef.current = null;
      layersRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /**
   * Comportement modal : Escape / retour Android ferment la feuille, le focus
   * reste à l'intérieur et revient au déclencheur à la fermeture.
   *
   * `role="dialog" aria-modal="true"` ne suffisait pas : sans piège de focus,
   * la tabulation partait derrière la surcouche, dans la barre d'onglets — ce
   * qui rendait « Itinéraire » inutilisable au clavier.
   */
  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const overlay = overlayRef.current;
    const focusables = () =>
      Array.from(
        overlay?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) || []
      );
    requestAnimationFrame(() => {
      if (!overlay) return;
      const active = document.activeElement as HTMLElement | null;
      if (!active || !overlay.contains(active)) overlay.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const prev = previousFocusRef.current;
      if (prev && prev.isConnected) prev.focus();
    };
  }, [open]);

  // Calcul de l'itinéraire à chaque changement de mode / point de départ.
  // `attempt` permet de relancer le calcul après une erreur, sans changer de
  // mode ni de point de départ (« Réessayer »).
  const [attempt, setAttempt] = useState(0);

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
  }, [open, mode, attempt, startPoint?.lat, startPoint?.lng, destPoint?.lat, destPoint?.lng]);

  /**
   * Alternative explicite quand le mode demandé ne peut pas être calculé.
   *
   * On ne substitue jamais un tracé automobile à un mode actif : on propose un
   * autre **mode réel** (à pied par défaut, transports pour un trajet urbain)
   * que l'utilisateur choisit lui-même.
   */
  const alternativeMode: TravelMode | null = (() => {
    if (!error) return null;
    if (mode === 'walk') return 'transit';
    if (mode === 'bike') return 'walk';
    if (mode === 'transit') return 'walk';
    return 'walk';
  })();

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

  /** Adresse choisie dans la liste de suggestions (coordonnées déjà résolues). */
  const applySuggestion = (suggestion: AddressSuggestion) => {
    setStartPoint({ lat: suggestion.lat, lng: suggestion.lng });
    setStartLabel(suggestion.label);
    setEditingStart(true);
    onOriginResolved?.({ lat: suggestion.lat, lng: suggestion.lng });
    setAddressQuery(suggestion.label);
  };

  return (
    <div
      className="directions-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Itinéraire vers ${destination?.name || 'la destination'}`}
      data-testid="directions-panel"
      ref={overlayRef}
      tabIndex={-1}
    >
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
          <AddressAutocomplete
            value={addressQuery}
            onChange={setAddressQuery}
            onSelect={applySuggestion}
            label="Adresse de départ"
            placeholder="Ex. 12 rue de Rivoli, Paris"
            ariaLabel="Adresse de départ"
            helpText="Les adresses sont proposées au fil de la frappe : touchez-en une pour partir de là."
            near={startPoint}
            testId="directions-start"
          />
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
            <div className="directions-error" role="alert" data-testid="directions-error">
              <span>⚠️ {error}</span>
              {straightLineM != null && (
                <span className="muted-text">
                  À vol d’oiseau : {formatRouteDistance(straightLineM)}
                </span>
              )}
              {/*
                Aucun tracé automobile n'est plus présenté comme piéton : quand
                le mode demandé n'a pas pu être calculé, on le dit et on propose
                une alternative explicite (autre mode, nouvel essai, ou
                ouverture dans une application externe sur action volontaire).
              */}
              <div className="directions-alt">
                <span className="muted-xs">
                  Le mode « {TRAVEL_MODES.find((m) => m.id === mode)?.short} » n’a pas pu être
                  calculé. Voici ce que vous pouvez faire :
                </span>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => setAttempt((n) => n + 1)}
                  data-testid="directions-retry"
                >
                  🔄 Réessayer
                </button>
                {alternativeMode && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setMode(alternativeMode)}
                    data-testid="directions-alternative-mode"
                  >
                    {TRAVEL_MODES.find((m) => m.id === alternativeMode)?.icon}{' '}
                    Essayer {TRAVEL_MODES.find((m) => m.id === alternativeMode)?.label.toLowerCase()}
                  </button>
                )}
                {destPoint && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => window.open(externalMapsUrl(destPoint, mode, startPoint), '_blank', 'noopener')}
                    data-testid="directions-external-fallback"
                  >
                    Ouvrir l’itinéraire dans une autre application
                  </button>
                )}
              </div>
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

        {/*
          Le détail des consignes n'est plus affiché en permanence : il
          remplaçait le guidage par une simple liste. La carte et le bouton
          « Démarrer » lancent un vrai guidage (NavigationView) ; la liste reste
          disponible à la demande, pour préparer le trajet.
        */}
        {plan && plan.steps.length > 0 && !loading && (
          <div className="directions-steps-block">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setShowSteps((v) => !v)}
              aria-expanded={showSteps}
              data-testid="directions-toggle-steps"
            >
              {showSteps ? 'Masquer le détail des consignes' : `Voir le détail (${plan.steps.length} étapes)`}
            </button>
            {showSteps && (
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
          </div>
        )}

        {destPoint && (
          <button
            type="button"
            className="btn btn-gold directions-start-nav"
            onClick={() => {
              // Interstitiel au lancement du GPS (même placement que la sortie
              // GPS). Il résout toujours : le guidage s'ouvre immédiatement.
              void showInterstitial();
              setNavOpen(true);
            }}
            data-testid="directions-start-navigation"
          >
            🧭 Démarrer le guidage
          </button>
        )}

        {plan && destPoint && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => window.open(externalMapsUrl(destPoint, mode, startPoint), '_blank', 'noopener')}
            data-testid="directions-external"
          >
            Ouvrir dans une autre application de cartes
          </button>
        )}
        <p className="muted-xs directions-credits">
          Calcul d’itinéraire : OpenStreetMap · Valhalla (marche, vélo, voiture) et
          Île-de-France Mobilités ou <a href="https://transitous.org" target="_blank" rel="noreferrer">Transitous</a>{' '}
          (transports en commun). Adresses : Photon · OpenStreetMap.
        </p>
      </div>

      <NavigationView
        open={navOpen}
        onClose={() => setNavOpen(false)}
        destinationName={destination?.name || 'Destination'}
        destination={destPoint}
        mode={mode}
        initialPlan={plan}
        start={startPoint}
      />
    </div>
  );
}
