import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { useToast } from '../components/Toast';
import { watchEstablishments, type Establishment } from '../lib/establishments';

const DEFAULT_CENTER: [number, number] = [46.6, 2.4]; // France
const DEFAULT_ZOOM = 6;

export default function MapPage() {
  const { toast } = useToast();
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const [selected, setSelected] = useState<Establishment | null>(null);
  const [locating, setLocating] = useState(false);

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
      attribution: '© OpenStreetMap',
    }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    map.on('click', () => setSelected(null));
    mapRef.current = map;
    // Tente une localisation immédiate silencieuse.
    locate(true);
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Marqueurs des établissements partenaires
  useEffect(() => {
    const unsub = watchEstablishments((list) => {
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
      let lat: number, lng: number;
      if (Capacitor.isNativePlatform()) {
        const perm = await Geolocation.checkPermissions();
        if (perm.location !== 'granted') {
          if (silent) return;
          const req = await Geolocation.requestPermissions();
          if (req.location !== 'granted') {
            toast('Autorisez la localisation pour vous situer sur la carte.', 'error');
            return;
          }
        }
        const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 12000 });
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
      } else {
        const pos = await new Promise<GeolocationPosition>((res, rej) =>
          navigator.geolocation.getCurrentPosition(res, rej, { timeout: 12000 })
        );
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
      }
      const map = mapRef.current;
      if (!map) return;
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

  return (
    <div className="map-screen" data-testid="map-screen">
      <div className="map-header">
        <div>
          <h1 className="screen-title">Carte</h1>
          <div className="screen-sub">Découvrez les partenaires Elysium autour de vous</div>
        </div>
      </div>

      <div ref={containerRef} className="map-container" data-testid="map-container" />

      <button
        className="map-locate-btn"
        onClick={() => locate(false)}
        disabled={locating}
        data-testid="map-locate-button"
        aria-label="Me localiser"
      >
        {locating ? (
          <div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
        ) : (
          <LocateIcon />
        )}
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
          <span className="badge" style={{ marginTop: 10 }}>Partenaire Elysium</span>
        </div>
      )}
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
