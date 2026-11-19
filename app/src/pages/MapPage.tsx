import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useToast } from '../components/Toast';
import { watchEstablishments, type Establishment } from '../lib/establishments';
import { getCurrentPosition, watchPosition } from '../lib/geo';
import DirectionsPanel, { type DirectionsDestination } from '../components/DirectionsPanel';
import AddressAutocomplete from '../components/AddressAutocomplete';
import { geocodeAddress, TRAVEL_MODES, type AddressSuggestion, type TravelMode } from '../lib/directions';
import NotificationBell from '../components/NotificationBell';
import { addBaseMap } from '../lib/mapTiles';

const DEFAULT_CENTER: [number, number] = [46.6, 2.4]; // France
const DEFAULT_ZOOM = 6;
const FOCUS_ZOOM = 16;
const WATCH_INTERVAL_MS = 4000;
const RESIZE_DELAY_MS = 60;
const MIN_GPS_QUERY_LENGTH = 3;
const MAX_NEARBY_RESULTS = 5;
const LOW_ACCURACY_METERS = 100;
const MAX_ACCURACY_RADIUS = 250;

const HINT_STYLE = { fontSize: 12, color: 'var(--muted)', marginTop: 6 };

export default function MapPage() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const accuracyRef = useRef<L.Circle | null>(null);
  /** Suivi continu actif : la ref sert aux callbacks Leaflet, le state au rendu. */
  const followRef = useRef(true);
  const [following, setFollowing] = useState(true);
  const watcherRef = useRef<{ stop: () => void } | null>(null);
  const locFailedRef = useRef(false);
  const [locFailed, setLocFailedState] = useState(false);
  const gpsBusyRef = useRef(false);
  const [selected, setSelected] = useState<Establishment | null>(null);
  const [locating, setLocating] = useState(false);
  const [establishments, setEstablishments] = useState<Establishment[]>([]);
  const [partnersLoaded, setPartnersLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [directionsFor, setDirectionsFor] = useState<Establishment | null>(null);
  const [gpsDestination, setGpsDestination] = useState<DirectionsDestination | null>(null);
  const [gpsQuery, setGpsQuery] = useState('');
  const [gpsMode, setGpsMode] = useState<TravelMode>('walk');
  const [gpsBusy, setGpsBusy] = useState(false);
  const [gpsSuggestion, setGpsSuggestion] = useState<AddressSuggestion | null>(null);

  const setFollow = (value: boolean) => {
    followRef.current = value;
    setFollowing(value);
  };

  const setLocFailed = (value: boolean) => {
    locFailedRef.current = value;
    setLocFailedState(value);
  };

  /** Ouvrir une fiche met le suivi en pause : la carte ne s'échappe pas dessous. */
  const selectPartner = (e: Establishment) => {
    setFollow(false);
    setSelected(e);
  };

  /** Suggestion réellement retenue : ses coordonnées sont fiables. */
  const gpsPoint = gpsSuggestion && gpsSuggestion.label === gpsQuery.trim()
    ? { lat: gpsSuggestion.lat, lng: gpsSuggestion.lng }
    : null;
  const gpsLabel = gpsSuggestion?.label || '';
  const gpsTyping = gpsQuery.trim().length > 0;
  const gpsReady = gpsQuery.trim().length >= MIN_GPS_QUERY_LENGTH || !!gpsPoint;

  const startGps = async () => {
    if (gpsBusyRef.current) return;
    gpsBusyRef.current = true;
    setGpsBusy(true);
    try {
      // Suggestion choisie : coordonnées déjà connues. Sinon, on géocode le texte saisi.
      const hit = gpsPoint;
      if (!hit) {
        const resolved = await geocodeAddress(gpsQuery);
        if (!resolved) {
          toast('Adresse introuvable. Précisez la rue ou la ville.', 'error');
          return;
        }
        setGpsDestination({ name: resolved.label, address: resolved.label, lat: resolved.lat, lng: resolved.lng });
      } else {
        setGpsDestination({ name: gpsLabel || gpsQuery, address: gpsLabel || gpsQuery, lat: hit.lat, lng: hit.lng });
      }
      void locate(true);
    } finally {
      gpsBusyRef.current = false;
      setGpsBusy(false);
    }
  };

  // Initialisation de la carte
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: false,
      attributionControl: true,
    });
    addBaseMap(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    map.on('click', () => setSelected(null));
    // Déplacer la carte à la main met le suivi en pause ; le bouton de localisation le relance.
    map.on('dragstart', () => setFollow(false));
    mapRef.current = map;
    startWatching();
    return () => {
      watcherRef.current?.stop();
      watcherRef.current = null;
      accuracyRef.current = null;
      userMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Dessine (ou déplace) le repère utilisateur et son cercle de précision. */
  const drawUser = (lat: number, lng: number, precision: number | null, recenter: boolean) => {
    const map = mapRef.current;
    if (!map) return;
    if (!userMarkerRef.current) {
      userMarkerRef.current = L.marker([lat, lng], {
        icon: L.divIcon({
          className: 'ely-user-wrap',
          html: '<div class="ely-user-dot"><div class="ely-user-pulse"></div></div>',
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        }),
        zIndexOffset: 900,
      }).addTo(map);
    } else {
      userMarkerRef.current.setLatLng([lat, lng]);
    }
    if (precision != null && precision > 0) {
      if (!accuracyRef.current) {
        accuracyRef.current = L.circle([lat, lng], {
          radius: Math.min(precision, MAX_ACCURACY_RADIUS),
          color: '#D8CA82',
          weight: 1,
          opacity: 0.5,
          fillColor: '#D8CA82',
          fillOpacity: 0.08,
          interactive: false,
        }).addTo(map);
      } else {
        accuracyRef.current.setLatLng([lat, lng]);
        accuracyRef.current.setRadius(Math.min(precision, MAX_ACCURACY_RADIUS));
      }
    }
    if (recenter && followRef.current) {
      map.setView([lat, lng], Math.max(map.getZoom(), FOCUS_ZOOM), { animate: true });
    }
  };

  /** Active le suivi continu de la position. */
  const startWatching = () => {
    watcherRef.current?.stop();
    setLocating(true);
    let first = true;
    watcherRef.current = watchPosition(
      (coords) => {
        setUserPos({ lat: coords.lat, lng: coords.lng });
        setAccuracy(coords.accuracy ?? null);
        setLocating(false);
        setLocFailed(false);
        // Le premier point recadre la carte, puis on suit sans forcer le zoom.
        drawUser(coords.lat, coords.lng, coords.accuracy ?? null, first || followRef.current);
        first = false;
      },
      (error) => {
        setLocating(false);
        setLocFailed(true);
        toast(error.message || 'Position introuvable. Vérifiez la localisation de votre appareil.', 'error');
      },
      { intervalMs: WATCH_INTERVAL_MS },
    );
  };

  /** Recentrage demandé par l'utilisateur (bouton de localisation) : relance aussi le suivi. */
  const locate = async (silent = false) => {
    setFollow(true);
    setLocating(true);
    try {
      const pos = await getCurrentPosition({ silent });
      if (pos) {
        // Après un échec (permission accordée après coup…), on repart sur un suivi neuf.
        const restart = !watcherRef.current || locFailedRef.current;
        setUserPos({ lat: pos.lat, lng: pos.lng });
        setAccuracy(pos.accuracy ?? null);
        setLocFailed(false);
        drawUser(pos.lat, pos.lng, pos.accuracy ?? null, true);
        if (restart) startWatching();
      } else if (!userPos) {
        setLocFailed(true);
      }
    } catch {
      setLocFailed(true);
      if (!silent) toast('Position introuvable. Vérifiez la localisation de votre appareil.', 'error');
    } finally {
      setLocating(false);
    }
  };

  // Marqueurs des établissements partenaires
  useEffect(() => {
    const unsub = watchEstablishments((list) => {
      setEstablishments(list);
      setPartnersLoaded(true);
      const map = mapRef.current;
      if (!map) return;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = list.map((e) => {
        const icon = L.divIcon({
          className: 'ely-pin-wrap',
          html: `<div class="ely-pin">${
            e.logoDataUrl
              ? `<img src="${e.logoDataUrl}" alt="" />`
              : `<span>${e.name.charAt(0).toUpperCase()}</span>`
          }</div><div class="ely-pin-tip"></div>`,
          iconSize: [44, 54],
          iconAnchor: [22, 54],
        });
        const marker = L.marker([e.lat, e.lng], { icon }).addTo(map);
        marker.on('click', () => {
          selectPartner(e);
          map.panTo([e.lat, e.lng]);
        });
        return marker;
      });
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const distance = (e: Establishment) =>
    userPos ? Math.round(L.latLng(userPos.lat, userPos.lng).distanceTo(L.latLng(e.lat, e.lng))) / 1000 : null;
  const nearby = establishments
    .filter((e) => `${e.name} ${e.address} ${e.description}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (distance(a) ?? 99999) - (distance(b) ?? 99999));
  const shownNearby = nearby.slice(0, MAX_NEARBY_RESULTS);
  const hiddenNearby = nearby.length - shownNearby.length;

  // La hauteur de l'en-tête change à chaque ouverture / repli : on évite les tuiles grises.
  useEffect(() => {
    const timer = setTimeout(() => mapRef.current?.invalidateSize(), RESIZE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [gpsTyping, gpsReady, searchOpen, shownNearby.length, hiddenNearby, partnersLoaded]);

  const live = following && !!userPos && !locFailed;
  const locateLabel = locFailed
    ? 'Position indisponible — réessayer'
    : live
      ? 'Suivi de position actif — recentrer'
      : userPos
        ? 'Suivi en pause — reprendre le suivi'
        : 'Me localiser';

  return (
    <div className="map-screen" data-testid="map-screen">
      <div className="map-header" data-testid="map-header">
        <div className="map-header-top">
          <div>
            <h1 className="screen-title">Carte</h1>
          </div>
          <div className="header-actions">
            <NotificationBell />
          </div>
        </div>

        {/* GPS : action principale. Modes et bouton n'apparaissent qu'une fois la destination saisie. */}
        <div className="map-gps" data-testid="map-gps">
          <AddressAutocomplete
            value={gpsQuery}
            onChange={(value) => { setGpsQuery(value); if (gpsSuggestion && value !== gpsSuggestion.label) setGpsSuggestion(null); }}
            onSelect={(suggestion) => { setGpsSuggestion(suggestion); setGpsQuery(suggestion.label); }}
            label="Où allez-vous ?"
            placeholder="Adresse, lieu, gare…"
            ariaLabel="Adresse de destination du GPS"
            helpText="Choisissez une suggestion : le guidage part de votre position actuelle."
            near={userPos}
            testId="gps-destination"
          />
          {gpsReady && (
            <>
              <div className="chip-row" role="radiogroup" aria-label="Mode de déplacement du GPS" data-testid="gps-modes">
                {TRAVEL_MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={gpsMode === m.id}
                    className={`chip ${gpsMode === m.id ? 'chip-active' : ''}`}
                    onClick={() => setGpsMode(m.id)}
                    data-testid={`gps-mode-${m.id}`}
                  >
                    <span aria-hidden="true">{m.icon}</span> {m.short}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="btn btn-gold"
                onClick={() => void startGps()}
                disabled={gpsBusy}
                data-testid="gps-start"
              >
                {gpsBusy ? 'Préparation…' : `🧭 Démarrer le GPS · ${TRAVEL_MODES.find((m) => m.id === gpsMode)?.short.toLowerCase()}`}
              </button>
            </>
          )}
        </div>

        {/* Recherche de partenaires : secondaire, repliée par défaut. */}
        <div className="map-search">
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => setSearchOpen((open) => !open)}
            aria-expanded={searchOpen}
            data-testid="map-search-toggle"
          >
            {searchOpen ? 'Fermer la recherche' : 'Rechercher un partenaire'}
          </button>
          {searchOpen && (
            <>
              <input
                className="input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher un partenaire…"
                aria-label="Rechercher un partenaire"
                autoFocus
                data-testid="map-search-input"
              />
              <div className="nearby-list" data-testid="map-nearby-list">
                {shownNearby.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => {
                      selectPartner(e);
                      setSearchOpen(false);
                      mapRef.current?.setView([e.lat, e.lng], FOCUS_ZOOM);
                    }}
                  >
                    <b>{e.name}</b>
                    <span>{distance(e) !== null ? `${distance(e)!.toFixed(1)} km` : e.address}</span>
                  </button>
                ))}
              </div>
              {establishments.length === 0 ? (
                <div style={HINT_STYLE} role="status" data-testid="map-partners-empty">
                  {partnersLoaded ? 'Aucun partenaire pour le moment' : 'Chargement…'}
                </div>
              ) : nearby.length === 0 ? (
                <div style={HINT_STYLE} role="status" data-testid="map-search-no-result">
                  Aucun partenaire ne correspond
                </div>
              ) : hiddenNearby > 0 ? (
                <div style={HINT_STYLE} data-testid="map-search-more">
                  +{hiddenNearby} {hiddenNearby > 1 ? 'autres' : 'autre'}, précisez la recherche
                </div>
              ) : null}
            </>
          )}
        </div>

        {/* Actions rapides : masquées pendant la saisie d'une destination. */}
        {!gpsTyping && (
          <div className="map-quick-actions">
            <button className="btn btn-outline btn-sm" onClick={() => navigate('/routes')} data-testid="map-routes-button">
              🧭 Parcours
            </button>
            <button className="btn btn-outline btn-sm" onClick={() => navigate('/events')} data-testid="map-events-button">
              👥 Événements
            </button>
            <button className="btn btn-gold btn-sm" onClick={() => navigate('/activity')} data-testid="map-activity-button">
              ▶ Sortie
            </button>
          </div>
        )}
      </div>

      <div className="map-stage">
        <div ref={containerRef} className="map-container" data-testid="map-container" />

        <button
          className={`map-locate-btn ${live ? 'map-locate-live' : ''}`}
          onClick={() => locate(false)}
          disabled={locating && !userPos}
          data-testid="map-locate-button"
          aria-label={locateLabel}
          title={locateLabel}
        >
          {locating && !userPos ? <div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} /> : <LocateIcon />}
        </button>

        <div className="map-live-status" role="status" aria-live="polite" data-testid="map-live-status">
          {locFailed ? (
            <span>Position indisponible</span>
          ) : userPos ? (
            <>
              <span className="map-live-dot" aria-hidden="true" />
              <span>
                Position en direct
                {accuracy != null ? ` · ±${Math.round(accuracy)} m` : ''}
                {accuracy != null && accuracy > LOW_ACCURACY_METERS ? ' · précision faible' : ''}
                {!following ? ' · suivi en pause' : ''}
              </span>
            </>
          ) : (
            <span>Position en cours d’acquisition…</span>
          )}
        </div>

        {selected && (
          <div
            className="map-card pop-in"
            role="region"
            aria-label={`Fiche partenaire : ${selected.name}`}
            data-testid="establishment-card"
          >
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              {selected.logoDataUrl ? (
                <img src={selected.logoDataUrl} alt={selected.name} className="map-card-logo" />
              ) : (
                <div className="avatar" style={{ width: 52, height: 52, fontSize: 20 }}>
                  {selected.name.charAt(0).toUpperCase()}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="display" style={{ fontSize: 15, color: 'var(--gold)' }} data-testid="establishment-name">
                  {selected.name}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{selected.address}</div>
              </div>
              <button
                className="map-card-close"
                onClick={() => setSelected(null)}
                aria-label="Fermer la fiche"
                data-testid="establishment-card-close"
              >
                ✕
              </button>
            </div>
            <p style={{ fontSize: 13.5, marginTop: 10, color: 'var(--white)' }}>{selected.description}</p>
            <div className="partner-details">
              {selected.openingHours && <span>🕐 {selected.openingHours}</span>}
              {selected.phone && <a href={`tel:${selected.phone}`}>☎ {selected.phone}</a>}
              {selected.website && (
                <a href={selected.website} target="_blank" rel="noreferrer">
                  Site web
                </a>
              )}
              {selected.offerText && <strong>Offre : {selected.offerText}</strong>}
            </div>
            <button
              className="btn btn-gold btn-sm"
              style={{ marginTop: 10 }}
              onClick={() => setDirectionsFor(selected)}
              data-testid="establishment-directions"
            >
              Itinéraire
            </button>
          </div>
        )}
      </div>

      <DirectionsPanel
        open={!!directionsFor || !!gpsDestination}
        onClose={() => { setDirectionsFor(null); setGpsDestination(null); }}
        initialMode={gpsMode}
        destination={
          gpsDestination
            ? gpsDestination
            : directionsFor
              ? {
                  name: directionsFor.name,
                  address: directionsFor.address,
                  lat: directionsFor.lat,
                  lng: directionsFor.lng,
                }
              : null
        }
        origin={userPos}
        onLocate={() => locate(false)}
        onOriginResolved={setUserPos}
        onMapReady={(map) => {
          setTimeout(() => map.invalidateSize(), RESIZE_DELAY_MS);
        }}
      />
    </div>
  );
}

function LocateIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" strokeLinecap="round" />
      <circle cx="12" cy="12" r="7.5" />
    </svg>
  );
}
