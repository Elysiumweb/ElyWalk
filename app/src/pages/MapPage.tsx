import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useToast } from '../components/Toast';
import { watchEstablishments, type Establishment } from '../lib/establishments';
import { getCurrentPosition } from '../lib/geo';
import DirectionsPanel from '../components/DirectionsPanel';

const DEFAULT_CENTER: [number, number] = [46.6, 2.4]; // France
const DEFAULT_ZOOM = 6;

export default function MapPage() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const [selected, setSelected] = useState<Establishment | null>(null);
  const [locating, setLocating] = useState(false);
  const [establishments, setEstablishments] = useState<Establishment[]>([]);
  const [search, setSearch] = useState('');
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null);
  const [directionsFor, setDirectionsFor] = useState<Establishment | null>(null);

  // Initialisation de la carte
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: false,
      attributionControl: true,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    map.on('click', () => setSelected(null));
    mapRef.current = map;
    // Tente une localisation immédiate silencieuse.
    void locate(true);
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Marqueurs des établissements partenaires
  useEffect(() => {
    const unsub = watchEstablishments((list) => {
      setEstablishments(list);
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
          setSelected(e);
          map.panTo([e.lat, e.lng]);
        });
        return marker;
      });
    });
    return unsub;
  }, []);

  const locate = async (silent = false) => {
    setLocating(true);
    try {
      const pos = await getCurrentPosition({ silent });
      if (!pos) return;
      const { lat, lng } = pos;
      const map = mapRef.current;
      if (!map) return;
      setUserPos({ lat, lng });
      map.setView([lat, lng], 17);
      if (userMarkerRef.current) userMarkerRef.current.remove();
      userMarkerRef.current = L.marker([lat, lng], {
        icon: L.divIcon({
          className: 'ely-user-wrap',
          html: '<div class="ely-user-dot"><div class="ely-user-pulse"></div></div>',
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        }),
      }).addTo(map);
    } catch {
      if (!silent) toast('Position introuvable. Vérifiez la localisation de votre appareil.', 'error');
    } finally {
      setLocating(false);
    }
  };

  const distance = (e: Establishment) =>
    userPos ? Math.round(L.latLng(userPos.lat, userPos.lng).distanceTo(L.latLng(e.lat, e.lng))) / 1000 : null;
  const nearby = establishments
    .filter((e) => `${e.name} ${e.address} ${e.description}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (distance(a) ?? 99999) - (distance(b) ?? 99999));

  return (
    <div className="map-screen" data-testid="map-screen">
      {/*
        En-tête en flux (et non en surimpression) : la recherche et les trois
        accès « Parcours / Événements / Sortie » ne se chevauchent plus, et ils
        restent au-dessus de la carte quelle que soit la hauteur d'écran.
      */}
      <div className="map-header" data-testid="map-header">
        <div className="map-header-top">
          <div>
            <h1 className="screen-title">Carte</h1>
            <div className="screen-sub">Partenaires autour de vous · vos sorties GPS dans Sortie</div>
          </div>
        </div>
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
        <div className="map-search">
          <input
            className="input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un partenaire…"
            aria-label="Rechercher un partenaire"
            data-testid="map-search-input"
          />
          <div className="nearby-list">
            {nearby.slice(0, 5).map((e) => (
              <button
                key={e.id}
                onClick={() => {
                  setSelected(e);
                  mapRef.current?.setView([e.lat, e.lng], 16);
                }}
              >
                <b>{e.name}</b>
                <span>{distance(e) !== null ? `${distance(e)!.toFixed(1)} km` : e.address}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="map-stage">
        <div ref={containerRef} className="map-container" data-testid="map-container" />

        <button
          className="map-locate-btn"
          onClick={() => locate(false)}
          disabled={locating}
          data-testid="map-locate-button"
          aria-label="Me localiser"
        >
          {locating ? <div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} /> : <LocateIcon />}
        </button>

        {selected && (
          <div className="map-card pop-in" data-testid="establishment-card">
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
              <button className="map-card-close" onClick={() => setSelected(null)} data-testid="establishment-card-close">
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

      {/*
        Itinéraire calculé dans l'application (aucune redirection vers Maps) :
        adresse réelle + itinéraire à pied, vélo, voiture ou transports.
      */}
      <DirectionsPanel
        open={!!directionsFor}
        onClose={() => setDirectionsFor(null)}
        destination={
          directionsFor
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
          // La carte de l'itinéraire remplace visuellement celle de la page ;
          // on invalide sa taille à l'ouverture pour éviter les tuiles grises.
          setTimeout(() => map.invalidateSize(), 60);
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
