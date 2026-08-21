import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { Geolocation } from '@capacitor/geolocation';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { appendActivityPoint, createActivitySession, finishActivitySession, listActivitySessions } from '../lib/db';
import { tracking, isTrackingSupported, type TrackingSnapshot } from '../lib/tracking';
import { pedometer } from '../lib/pedometer';
import type { ActivityPoint, ActivitySession, ActivityType } from '../lib/types';
import { formatDistance } from '../lib/coins';

const FALLBACK_CENTER: [number, number] = [46.6, 2.4];
const ACTIVE_SESSION_KEY = 'elywalk.activeSession';

function distanceBetween(a: ActivityPoint, b: ActivityPoint): number {
  const radius = 6371000; const lat = (b.lat - a.lat) * Math.PI / 180; const lng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(lat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(lng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
function fmtDuration(sec: number): string {
  return `${String(Math.floor(sec / 3600)).padStart(2, '0')}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}
function speedKmh(distanceM: number, sec: number): number {
  return sec > 0 ? distanceM / 1000 / (sec / 3600) : 0;
}
function paceMinPerKm(distanceM: number, sec: number): string {
  if (distanceM <= 0 || sec <= 0) return '—';
  const totalMin = sec / 60 / (distanceM / 1000);
  return `${Math.floor(totalMin)}'${String(Math.round((totalMin % 1) * 60)).padStart(2, '0')}"`;
}

interface StoredSession { id?: string; type?: ActivityType; startedAt?: number; stepsAtStart?: number | null }

export default function ActivityPage() {
  const { profile } = useAuth(); const { toast } = useToast(); const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement | null>(null); const mapRef = useRef<L.Map | null>(null); const lineRef = useRef<L.Polyline | null>(null); const historyLinesRef = useRef<L.Polyline[]>([]); const markerRef = useRef<L.CircleMarker | null>(null);
  const sessionRef = useRef<string | null>(null);
  const pointsRef = useRef<ActivityPoint[]>([]); const distanceRef = useRef(0); const startedAtRef = useRef<number | null>(null);
  const typeRef = useRef<ActivityType>('walk'); const stepsAtStartRef = useRef<number | null>(null);
  const watchRef = useRef<string | number | null>(null);
  const trackHandleRef = useRef<{ remove: () => void } | null>(null);
  const appStateHandleRef = useRef<{ remove: () => void } | null>(null);
  const stepsUnsubRef = useRef<(() => void) | null>(null);
  const lastSavedRef = useRef(0);
  const [type, setType] = useState<ActivityType>('walk');
  const [running, setRunning] = useState(false); const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0); const [distance, setDistance] = useState(0);
  const [points, setPoints] = useState<ActivityPoint[]>([]); const [liveSteps, setLiveSteps] = useState(0);
  const [sessions, setSessions] = useState<ActivitySession[]>([]);

  const native = isTrackingSupported();
  const strideCm = profile?.strideLengthCm || 75;
  const unitSystem = profile?.unitSystem || profile?.health?.unitSystem || 'metric';
  const calories = Math.round(distance / 1000 * (type === 'run' ? 75 : 50));
  const liveDeltaSteps = stepsAtStartRef.current != null ? Math.max(0, liveSteps - stepsAtStartRef.current) : Math.round(distance / (strideCm / 100));
  const timer = fmtDuration(elapsed);

  useEffect(() => { if (profile) listActivitySessions(profile.uid).then(setSessions).catch(() => undefined); }, [profile?.uid]);

  // Carte
  useEffect(() => { if (!containerRef.current || mapRef.current) return; const map = L.map(containerRef.current, { center: FALLBACK_CENTER, zoom: 6, zoomControl: false }); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map); L.control.zoom({ position: 'bottomright' }).addTo(map); mapRef.current = map; return () => { map.remove(); mapRef.current = null; }; }, []);

  // Parcours précédents en fond
  useEffect(() => { const map = mapRef.current; if (!map) return; historyLinesRef.current.forEach((line) => line.remove()); historyLinesRef.current = sessions.filter((s) => s.points.length > 1).map((s) => { const line = L.polyline(s.points.map((p) => [p.lat, p.lng] as [number, number]), { color: '#8b866f', weight: 3, opacity: .55, dashArray: '5 7' }).addTo(map); line.on('click', () => navigate(`/activity/${s.id}`)); return line; }); }, [sessions, navigate]);

  // Chronomètre
  useEffect(() => { if (!running || !startedAt) return; const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000); return () => window.clearInterval(id); }, [running, startedAt]);

  // Tracé live
  useEffect(() => { const map = mapRef.current; if (!map) return; if (lineRef.current) lineRef.current.remove(); lineRef.current = points.length > 1 ? L.polyline(points.map((p) => [p.lat, p.lng] as [number, number]), { color: '#D8CA82', weight: 5, opacity: .9 }).addTo(map) : null; if (points.length) { const p = points[points.length - 1]; if (markerRef.current) markerRef.current.remove(); markerRef.current = L.circleMarker([p.lat, p.lng], { radius: 7, color: '#111', fillColor: '#D8CA82', fillOpacity: 1, weight: 3 }).addTo(map); if (running) map.setView([p.lat, p.lng], Math.max(map.getZoom(), 16)); } }, [points, running]);

  // Reprise d'une sortie native en cours (app fermée puis rouverte)
  useEffect(() => {
    if (!profile || !native) return;
    let cancelled = false;
    (async () => {
      try {
        const isRunning = await tracking.isTracking();
        if (!isRunning) { localStorage.removeItem(ACTIVE_SESSION_KEY); return; }
        const snap = await tracking.getSnapshot();
        if (cancelled) return;
        const stored: StoredSession = JSON.parse(localStorage.getItem(ACTIVE_SESSION_KEY) || '{}');
        typeRef.current = snap.type || stored.type || 'walk'; setType(typeRef.current);
        startedAtRef.current = snap.startedAt || stored.startedAt || Date.now(); setStartedAt(startedAtRef.current);
        stepsAtStartRef.current = typeof stored.stepsAtStart === 'number' ? stored.stepsAtStart : null;
        if (stored.id) sessionRef.current = stored.id;
        else { sessionRef.current = await createActivitySession(profile.uid, typeRef.current); localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify({ id: sessionRef.current, type: typeRef.current, startedAt: startedAtRef.current, stepsAtStart: stepsAtStartRef.current })); }
        lastSavedRef.current = Date.now();
        applySnapshot(snap);
        attachListeners();
        stepsUnsubRef.current = pedometer.subscribe((s) => setLiveSteps(s)); setLiveSteps(pedometer.getTodaySteps());
        setRunning(true);
        toast('Sortie en cours reprise.', 'info');
      } catch (e) { console.warn('[activity] resume', e); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.uid]);

  // Démontage : on détache les écouteurs mais on laisse le service natif tourner.
  useEffect(() => () => { detachListeners(); if (!native) stopWatch(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  function applySnapshot(snap: TrackingSnapshot) {
    pointsRef.current = snap.points || []; distanceRef.current = snap.distanceM || 0;
    if (snap.startedAt) { startedAtRef.current = snap.startedAt; setStartedAt(snap.startedAt); }
    typeRef.current = snap.type; setType(snap.type);
    setPoints(pointsRef.current); setDistance(distanceRef.current); setElapsed(snap.durationSec || 0);
  }
  async function attachListeners() {
    if (!trackHandleRef.current) trackHandleRef.current = await tracking.addListener((s) => { applySnapshot(s); void maybePersist(); });
    if (!appStateHandleRef.current) appStateHandleRef.current = await CapApp.addListener('appStateChange', ({ isActive }) => { if (isActive) tracking.getSnapshot().then(applySnapshot).catch(() => undefined); });
  }
  function detachListeners() {
    try { trackHandleRef.current?.remove(); } catch { /* ignore */ }
    trackHandleRef.current = null;
    try { appStateHandleRef.current?.remove(); } catch { /* ignore */ }
    appStateHandleRef.current = null;
    try { stepsUnsubRef.current?.(); } catch { /* ignore */ }
    stepsUnsubRef.current = null;
  }
  async function maybePersist() {
    if (!profile || !sessionRef.current || Date.now() - lastSavedRef.current < 8000) return;
    lastSavedRef.current = Date.now();
    const dur = startedAtRef.current ? Math.floor((Date.now() - startedAtRef.current) / 1000) : elapsed;
    const cal = Math.round(distanceRef.current / 1000 * (typeRef.current === 'run' ? 75 : 50));
    await appendActivityPoint(profile.uid, sessionRef.current, pointsRef.current, distanceRef.current, dur, cal).catch(() => undefined);
  }

  async function addPoint(position: { latitude: number; longitude: number; altitude?: number | null }) {
    const point: ActivityPoint = { lat: position.latitude, lng: position.longitude, altitude: position.altitude || undefined, recordedAt: Date.now() };
    const previous = pointsRef.current[pointsRef.current.length - 1];
    if (previous) { const delta = distanceBetween(previous, point); if (delta < 100) distanceRef.current += delta; }
    pointsRef.current = [...pointsRef.current, point]; setPoints(pointsRef.current); setDistance(distanceRef.current);
    void maybePersist();
  }
  async function stopWatch() { if (watchRef.current === null) return; if (Capacitor.isNativePlatform()) await Geolocation.clearWatch({ id: String(watchRef.current) }).catch(() => undefined); else navigator.geolocation.clearWatch(Number(watchRef.current)); watchRef.current = null; }
  async function startWatch() {
    if (Capacitor.isNativePlatform()) {
      const perm = await Geolocation.requestPermissions(); if (perm.location !== 'granted') throw new Error('Autorisez la localisation pour enregistrer le parcours.');
      watchRef.current = await Geolocation.watchPosition({ enableHighAccuracy: true, timeout: 12000, maximumAge: 3000 }, (pos) => { if (pos) addPoint(pos.coords).catch(() => undefined); });
    } else {
      if (!navigator.geolocation) throw new Error('La géolocalisation n’est pas disponible dans ce navigateur.');
      watchRef.current = navigator.geolocation.watchPosition((pos) => addPoint(pos.coords).catch(() => undefined), () => toast('Position GPS indisponible.', 'error'), { enableHighAccuracy: true, maximumAge: 3000, timeout: 12000 });
    }
  }

  async function start() {
    if (!profile || running) return;
    try {
      pointsRef.current = []; distanceRef.current = 0; const now = Date.now(); startedAtRef.current = now; typeRef.current = type;
      setPoints([]); setDistance(0); setElapsed(0); setStartedAt(now); lastSavedRef.current = now;
      const id = await createActivitySession(profile.uid, type); sessionRef.current = id;
      try { await pedometer.loadPersisted(); stepsAtStartRef.current = pedometer.getTodaySteps(); } catch { stepsAtStartRef.current = null; }
      setLiveSteps(pedometer.getTodaySteps());
      if (native) { const snap = await tracking.start(type); applySnapshot(snap); await attachListeners(); }
      else { await startWatch(); }
      stepsUnsubRef.current = pedometer.subscribe((s) => setLiveSteps(s));
      localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify({ id, type, startedAt: now, stepsAtStart: stepsAtStartRef.current }));
      setRunning(true);
      toast(type === 'run' ? 'Course démarrée. Bonne sortie !' : 'Marche démarrée. Bonne sortie !', 'success');
    } catch (e) {
      await cleanupAfterError();
      toast((e as Error).message, 'error');
    }
  }

  async function cleanupAfterError() { detachListeners(); if (!native) await stopWatch(); }

  async function stop() {
    if (!profile || !sessionRef.current) return;
    try {
      let finalPoints = pointsRef.current; let finalDistance = distanceRef.current; let duration = startedAtRef.current ? Math.floor((Date.now() - startedAtRef.current) / 1000) : elapsed;
      if (native) { const snap = await tracking.stop(); finalPoints = snap.points || finalPoints; finalDistance = snap.distanceM || finalDistance; duration = snap.durationSec || duration; }
      else { await stopWatch(); }
      detachListeners();
      try { await pedometer.loadPersisted(); } catch { /* ignore */ }
      const endSteps = pedometer.getTodaySteps();
      const delta = (typeof stepsAtStartRef.current === 'number' && endSteps >= stepsAtStartRef.current) ? (endSteps - stepsAtStartRef.current) : 0;
      const steps = delta > 0 ? delta : Math.round(finalDistance / (strideCm / 100));
      const cal = Math.round(finalDistance / 1000 * (typeRef.current === 'run' ? 75 : 50));
      await finishActivitySession(profile.uid, sessionRef.current, { points: finalPoints, distanceM: finalDistance, durationSec: duration, calories: cal, steps });
      pointsRef.current = []; distanceRef.current = 0; startedAtRef.current = null; sessionRef.current = null; stepsAtStartRef.current = null;
      setPoints([]); setDistance(0); setElapsed(0); setRunning(false);
      localStorage.removeItem(ACTIVE_SESSION_KEY);
      setSessions(await listActivitySessions(profile.uid));
      toast(`Sortie enregistrée · ${formatDistance(finalDistance, unitSystem)} · ${Math.floor(duration / 60)} min`, 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
      setRunning(false);
    }
  }

  return <div className="activity-screen" data-testid="activity-screen"><div className="activity-header"><div><h1 className="screen-title">Sortie GPS</h1><div className="screen-sub">{native ? 'Marche ou course · continue même app fermée' : 'Marche ou course · trace privée'}</div></div><button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}>Retour</button></div>
    <div className="activity-map" ref={containerRef} />
    <div className="activity-panel"><div className="activity-types"><button className={type === 'walk' ? 'selected' : ''} disabled={running} onClick={() => setType('walk')}>🚶 Marche</button><button className={type === 'run' ? 'selected' : ''} disabled={running} onClick={() => setType('run')}>🏃 Course</button></div>
      <div className="activity-stats"><div><strong>{timer}</strong><span>durée</span></div><div><strong>{formatDistance(distance, unitSystem)}</strong><span>distance</span></div><div><strong>{calories}</strong><span>kcal</span></div><div><strong>{Math.round(liveDeltaSteps).toLocaleString('fr-FR')}</strong><span>pas</span></div><div><strong>{speedKmh(distance, elapsed).toFixed(1)}</strong><span>km/h</span></div><div><strong>{paceMinPerKm(distance, elapsed)}</strong><span>allure</span></div></div>
      {running ? <button className="btn btn-danger" onClick={stop}>■ Terminer et enregistrer</button> : <button className="btn btn-gold" onClick={start}>▶ Démarrer la sortie</button>}
      <p className="activity-privacy">{native ? 'Le GPS reste actif en arrière-plan (notification permanente) jusqu’à l’arrêt. Le parcours n’est visible que par vous.' : 'Le GPS est activé uniquement pendant la sortie (onglet ouvert). Le parcours est visible seulement par vous.'}</p></div>
    {sessions.length > 0 && <div className="activity-history card"><div className="card-title">Mes sorties</div>{sessions.map((s) => <button className="list-row activity-session-row" key={s.id} onClick={() => navigate(`/activity/${s.id}`)}><span className="activity-history-icon">{s.type === 'run' ? '🏃' : '🚶'}</span><div className="row-main"><div className="row-title">{new Date(s.startedAt).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}</div><div className="row-sub">{formatDistance(s.distanceM, unitSystem)} · {Math.floor(s.durationSec / 60)} min · {s.calories || 0} kcal{typeof s.steps === 'number' && s.steps > 0 ? ` · ${s.steps.toLocaleString('fr-FR')} pas` : ''}</div></div><span className="row-value activity-chev">›</span></button>)}
      <button className="text-button" style={{ marginTop: 6 }} onClick={() => navigate('/history')}>Voir l’historique quotidien</button>
    </div>}
  </div>;
}
