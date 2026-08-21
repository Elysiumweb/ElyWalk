import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { appendActivityPoint, createActivitySession, finishActivitySession, listActivitySessions } from '../lib/db';
import type { ActivityPoint, ActivitySession, ActivityType } from '../lib/types';
import { formatDistance } from '../lib/coins';

const FALLBACK_CENTER: [number, number] = [46.6, 2.4];
function distanceBetween(a: ActivityPoint, b: ActivityPoint): number {
  const radius = 6371000; const lat = (b.lat - a.lat) * Math.PI / 180; const lng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(lat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(lng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export default function ActivityPage() {
  const { profile } = useAuth(); const { toast } = useToast(); const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement | null>(null); const mapRef = useRef<L.Map | null>(null); const lineRef = useRef<L.Polyline | null>(null); const historyLinesRef = useRef<L.Polyline[]>([]); const markerRef = useRef<L.CircleMarker | null>(null);
  const watchRef = useRef<string | number | null>(null); const sessionRef = useRef<string | null>(null); const pointsRef = useRef<ActivityPoint[]>([]); const distanceRef = useRef(0); const lastSavedRef = useRef(0);
  const [type, setType] = useState<ActivityType>('walk'); const [running, setRunning] = useState(false); const [startedAt, setStartedAt] = useState<number | null>(null); const [elapsed, setElapsed] = useState(0); const [distance, setDistance] = useState(0); const [points, setPoints] = useState<ActivityPoint[]>([]); const [sessions, setSessions] = useState<ActivitySession[]>([]);

  useEffect(() => { if (profile) listActivitySessions(profile.uid).then(setSessions).catch(() => undefined); }, [profile?.uid]);
  useEffect(() => { if (!containerRef.current || mapRef.current) return; const map = L.map(containerRef.current, { center: FALLBACK_CENTER, zoom: 6, zoomControl: false }); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map); L.control.zoom({ position: 'bottomright' }).addTo(map); mapRef.current = map; return () => { map.remove(); mapRef.current = null; }; }, []);
  useEffect(() => { const map = mapRef.current; if (!map) return; historyLinesRef.current.forEach((line) => line.remove()); historyLinesRef.current = sessions.filter((s) => s.points.length > 1).map((s) => { const line = L.polyline(s.points.map((p) => [p.lat, p.lng] as [number, number]), { color: '#8b866f', weight: 3, opacity: .55, dashArray: '5 7' }).addTo(map); line.on('click', () => map.fitBounds(line.getBounds(), { padding: [24, 24] })); return line; }); }, [sessions]);
  useEffect(() => { if (!running || !startedAt) return; const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000); return () => window.clearInterval(id); }, [running, startedAt]);
  useEffect(() => { const map = mapRef.current; if (!map) return; if (lineRef.current) lineRef.current.remove(); lineRef.current = points.length > 1 ? L.polyline(points.map((p) => [p.lat, p.lng] as [number, number]), { color: '#D8CA82', weight: 5, opacity: .9 }) .addTo(map) : null; if (points.length) { const p = points[points.length - 1]; if (markerRef.current) markerRef.current.remove(); markerRef.current = L.circleMarker([p.lat, p.lng], { radius: 7, color: '#111', fillColor: '#D8CA82', fillOpacity: 1, weight: 3 }).addTo(map); if (running) map.setView([p.lat, p.lng], Math.max(map.getZoom(), 16)); } }, [points, running]);
  useEffect(() => () => { stopWatch(); }, []);

  const addPoint = async (position: { latitude: number; longitude: number; altitude?: number | null }) => {
    const point: ActivityPoint = { lat: position.latitude, lng: position.longitude, altitude: position.altitude || undefined, recordedAt: Date.now() };
    const previous = pointsRef.current[pointsRef.current.length - 1]; if (previous) { const delta = distanceBetween(previous, point); if (delta < 100) distanceRef.current += delta; }
    pointsRef.current = [...pointsRef.current, point]; setPoints(pointsRef.current); setDistance(distanceRef.current);
    if (sessionRef.current && Date.now() - lastSavedRef.current > 8000) { lastSavedRef.current = Date.now(); await appendActivityPoint(profile!.uid, sessionRef.current, pointsRef.current, distanceRef.current, Math.floor((Date.now() - (startedAt || Date.now())) / 1000), Math.round(distanceRef.current / 1000 * 50)); }
  };

  const stopWatch = async () => { if (watchRef.current === null) return; if (Capacitor.isNativePlatform()) await Geolocation.clearWatch({ id: String(watchRef.current) }).catch(() => undefined); else navigator.geolocation.clearWatch(Number(watchRef.current)); watchRef.current = null; };
  const startWatch = async () => {
    if (Capacitor.isNativePlatform()) {
      const perm = await Geolocation.requestPermissions(); if (perm.location !== 'granted') throw new Error('Autorisez la localisation pour enregistrer le parcours.');
      watchRef.current = await Geolocation.watchPosition({ enableHighAccuracy: true, timeout: 12000, maximumAge: 3000 }, (pos, err) => { if (pos) addPoint(pos.coords).catch(() => undefined); else if (err) toast('Signal GPS indisponible momentanément.', 'info'); });
    } else {
      if (!navigator.geolocation) throw new Error('La géolocalisation n’est pas disponible dans ce navigateur.');
      watchRef.current = navigator.geolocation.watchPosition((pos) => addPoint(pos.coords).catch(() => undefined), () => toast('Position GPS indisponible.', 'error'), { enableHighAccuracy: true, maximumAge: 3000, timeout: 12000 });
    }
  };
  const start = async () => { if (!profile || running) return; try { const now = Date.now(); const id = await createActivitySession(profile.uid, type); sessionRef.current = id; pointsRef.current = []; distanceRef.current = 0; setPoints([]); setDistance(0); setStartedAt(now); setElapsed(0); await startWatch(); setRunning(true); toast(type === 'run' ? 'Course démarrée. Bonne sortie !' : 'Marche démarrée. Bonne sortie !', 'success'); } catch (e) { await stopWatch(); toast((e as Error).message, 'error'); } };
  const stop = async () => { if (!profile || !sessionRef.current) return; await stopWatch(); const duration = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : elapsed; const data = { points: pointsRef.current, distanceM: distanceRef.current, durationSec: duration, calories: Math.round(distanceRef.current / 1000 * (type === 'run' ? 75 : 50)) }; await finishActivitySession(profile.uid, sessionRef.current, data); setRunning(false); setStartedAt(null); setSessions(await listActivitySessions(profile.uid)); toast(`Sortie enregistrée · ${formatDistance(distanceRef.current)} · ${Math.floor(duration / 60)} min`, 'success'); sessionRef.current = null; };
  const timer = `${String(Math.floor(elapsed / 3600)).padStart(2, '0')}:${String(Math.floor(elapsed / 60) % 60).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;

  return <div className="activity-screen" data-testid="activity-screen"><div className="activity-header"><div><h1 className="screen-title">Sortie GPS</h1><div className="screen-sub">Marche ou course · trace privée</div></div><button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}>Retour</button></div>
    <div className="activity-map" ref={containerRef} />
    <div className="activity-panel"><div className="activity-types"><button className={type === 'walk' ? 'selected' : ''} disabled={running} onClick={() => setType('walk')}>🚶 Marche</button><button className={type === 'run' ? 'selected' : ''} disabled={running} onClick={() => setType('run')}>🏃 Course</button></div><div className="activity-stats"><div><strong>{timer}</strong><span>durée</span></div><div><strong>{formatDistance(distance, profile?.unitSystem || 'metric')}</strong><span>distance</span></div><div><strong>{Math.round(distance / 1000 * (type === 'run' ? 75 : 50))}</strong><span>kcal</span></div></div>{running ? <button className="btn btn-danger" onClick={stop}>■ Terminer et enregistrer</button> : <button className="btn btn-gold" onClick={start}>▶ Démarrer la sortie</button>}<p className="activity-privacy">Le GPS est activé uniquement pendant la sortie. Le parcours est visible seulement par vous.</p></div>
    {sessions.length > 0 && <div className="activity-history card"><div className="card-title">Mes parcours récents</div>{sessions.map((s) => <div className="list-row" key={s.id}><span className="activity-history-icon">{s.type === 'run' ? '🏃' : '🚶'}</span><div className="row-main"><div className="row-title">{new Date(s.startedAt).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}</div><div className="row-sub">{Math.floor(s.durationSec / 60)} min · {s.points.length} points GPS</div></div><div className="row-value">{formatDistance(s.distanceM, profile?.unitSystem || 'metric')}</div></div>)}</div>}
  </div>;
}
