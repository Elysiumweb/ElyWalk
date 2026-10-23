import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { Geolocation } from '@capacitor/geolocation';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import {
  appendActivityPoint,
  createActivitySession,
  finishActivitySession,
  listActivitySessionsPage,
  type ActivityQueryCursor,
} from '../lib/db';
import { tracking, isTrackingSupported, type TrackingSnapshot } from '../lib/tracking';
import { pedometer } from '../lib/pedometer';
import { showInterstitial } from '../lib/ads';
import type { ActivityPoint, ActivitySession, ActivityType } from '../lib/types';
import { formatDistance } from '../lib/coins';
import {
  ACTIVE_SESSION_KEY,
  ACTIVITY_FILTERS_KEY,
  ACTIVITY_GOAL_KEY,
  BATTERY_SAVER_KEY,
  DEFAULT_ACTIVITY_FILTERS,
  DISTANCE_OPTIONS_KM,
  GOAL_PRESETS_KM,
  PERIOD_OPTIONS,
  activeFiltersCount,
  distanceBetween,
  filtersToQuery,
  fmtDuration,
  goalProgress,
  gpsQuality,
  isQualityDegraded,
  paceMinPerKm,
  readStoredFlag,
  readStoredNumber,
  sessionTitle,
  speedKmh,
  writeStoredFlag,
  writeStoredNumber,
  type ActivityFilterState,
  type GpsQualityLevel,
} from '../lib/activity';
import { notifyActivityGoal } from '../lib/notifications';

const FALLBACK_CENTER: [number, number] = [46.6, 2.4];
const PAGE_SIZE = 20;

interface StoredSession {
  id?: string;
  type?: ActivityType;
  startedAt?: number;
  stepsAtStart?: number | null;
}

function loadStoredFilters(): ActivityFilterState {
  try {
    const raw = localStorage.getItem(ACTIVITY_FILTERS_KEY);
    if (!raw) return DEFAULT_ACTIVITY_FILTERS;
    const parsed = JSON.parse(raw) as Partial<ActivityFilterState>;
    return {
      type: parsed.type === 'walk' || parsed.type === 'run' ? parsed.type : 'all',
      periodDays: PERIOD_OPTIONS.some((p) => p.days === parsed.periodDays) ? (parsed.periodDays as number) : 0,
      minDistanceKm: DISTANCE_OPTIONS_KM.includes(Number(parsed.minDistanceKm)) ? Number(parsed.minDistanceKm) : 0,
    };
  } catch {
    return DEFAULT_ACTIVITY_FILTERS;
  }
}

export default function ActivityPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const lineRef = useRef<L.Polyline | null>(null);
  const historyLinesRef = useRef<L.Polyline[]>([]);
  const markerRef = useRef<L.CircleMarker | null>(null);

  const sessionRef = useRef<string | null>(null);
  const pointsRef = useRef<ActivityPoint[]>([]);
  const distanceRef = useRef(0);
  const startedAtRef = useRef<number | null>(null);
  const typeRef = useRef<ActivityType>('walk');
  const stepsAtStartRef = useRef<number | null>(null);
  const watchRef = useRef<string | number | null>(null);
  const trackHandleRef = useRef<{ remove: () => void } | null>(null);
  const appStateHandleRef = useRef<{ remove: () => void } | null>(null);
  const stepsUnsubRef = useRef<(() => void) | null>(null);
  const lastSavedRef = useRef(0);

  // Durée active : base du dernier instant connu + temps écoulé depuis.
  const durationBaseRef = useRef({ sec: 0, at: Date.now() });
  const pausedTotalRef = useRef(0); // web : ms de pauses terminées
  const pausedAtRef = useRef<number | null>(null); // web : début de la pause en cours
  const pausedSecRef = useRef(0);
  const lastQualityRef = useRef<GpsQualityLevel>('unknown');
  const lastGpsAlertRef = useRef(0);
  const goalNotifiedRef = useRef(false);

  const [type, setType] = useState<ActivityType>('walk');
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [pausedSec, setPausedSec] = useState(0);
  const [distance, setDistance] = useState(0);
  const [points, setPoints] = useState<ActivityPoint[]>([]);
  const [liveSteps, setLiveSteps] = useState(0);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [batterySaver, setBatterySaver] = useState(() => readStoredFlag(BATTERY_SAVER_KEY));
  const [goalKm, setGoalKm] = useState<number | null>(() => readStoredNumber(ACTIVITY_GOAL_KEY));
  // Champ libre séparé de l'objectif pour autoriser la saisie « 0.5 » sans
  // que la valeur soit immédiatement normalisée à zéro.
  const [goalInput, setGoalInput] = useState(() => {
    const stored = readStoredNumber(ACTIVITY_GOAL_KEY);
    return stored ? String(stored) : '';
  });

  const [filters, setFilters] = useState<ActivityFilterState>(loadStoredFilters);
  const [sessions, setSessions] = useState<ActivitySession[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const cursorRef = useRef<ActivityQueryCursor | null>(null);

  const native = isTrackingSupported();
  const strideCm = profile?.strideLengthCm || 75;
  const unitSystem = profile?.unitSystem || profile?.health?.unitSystem || 'metric';
  const calories = Math.round((distance / 1000) * (type === 'run' ? 75 : 50));
  const liveDeltaSteps = stepsAtStartRef.current != null
    ? Math.max(0, liveSteps - stepsAtStartRef.current)
    : Math.round(distance / (strideCm / 100));
  const goal = goalProgress(distance, goalKm);
  const gps = paused
    ? { level: 'unknown' as GpsQualityLevel, label: 'GPS suspendu (pause)', hint: 'Le GPS reprendra à la reprise de la sortie.' }
    : running
      ? gpsQuality(accuracy)
      : { level: 'unknown' as GpsQualityLevel, label: 'GPS en veille', hint: 'Le signal sera évalué au démarrage.' };

  function updateFilters(patch: Partial<ActivityFilterState>) {
    setFilters((prev) => {
      const next = { ...prev, ...patch };
      try { localStorage.setItem(ACTIVITY_FILTERS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  function changeGoal(value: number | null) {
    const safe = value != null && Number.isFinite(value) && value > 0 ? Math.min(100, Math.round(value * 10) / 10) : null;
    setGoalKm(safe);
    setGoalInput(safe != null ? String(safe) : '');
    writeStoredNumber(ACTIVITY_GOAL_KEY, safe);
    // Nouvel objectif encore à portée : on réautorise la notification.
    if (safe != null && safe * 1000 > distanceRef.current) goalNotifiedRef.current = false;
  }

  function onGoalInput(raw: string) {
    setGoalInput(raw);
    const value = raw === '' ? null : Number(raw.replace(',', '.'));
    const safe = value != null && Number.isFinite(value) && value > 0 ? Math.min(100, Math.round(value * 10) / 10) : null;
    setGoalKm(safe);
    writeStoredNumber(ACTIVITY_GOAL_KEY, safe);
    if (safe != null && safe * 1000 > distanceRef.current) goalNotifiedRef.current = false;
  }

  // Chargement de la première page quand les filtres changent.
  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    cursorRef.current = null;
    setSessions([]);
    setHasMore(false);
    void (async () => {
      setLoadingSessions(true);
      try {
        const q = filtersToQuery(filters);
        const page = await listActivitySessionsPage(profile.uid, {
          type: q.type,
          from: q.from,
          minDistanceM: q.minDistanceM,
          pageSize: PAGE_SIZE,
        });
        if (cancelled) return;
        cursorRef.current = page.cursor;
        setHasMore(page.hasMore);
        setSessions(page.items);
      } catch (e) {
        if (!cancelled) toast(`Sorties indisponibles : ${(e as Error).message}`, 'error');
      } finally {
        if (!cancelled) setLoadingSessions(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.uid, filters, reloadToken]);

  async function loadMoreSessions() {
    if (!profile || loadingSessions || !cursorRef.current) return;
    setLoadingSessions(true);
    try {
      const q = filtersToQuery(filters);
      const page = await listActivitySessionsPage(profile.uid, {
        type: q.type,
        from: q.from,
        minDistanceM: q.minDistanceM,
        pageSize: PAGE_SIZE,
        cursor: cursorRef.current,
      });
      cursorRef.current = page.cursor;
      setHasMore(page.hasMore);
      setSessions((prev) => {
        const seen = new Set(prev.map((s) => s.id));
        return [...prev, ...page.items.filter((s) => !seen.has(s.id))];
      });
    } catch (e) {
      toast(`Chargement impossible : ${(e as Error).message}`, 'error');
    } finally {
      setLoadingSessions(false);
    }
  }

  // Carte
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { center: FALLBACK_CENTER, zoom: 6, zoomControl: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Parcours chargés en fond
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    historyLinesRef.current.forEach((line) => line.remove());
    historyLinesRef.current = sessions.filter((s) => (s.points || []).length > 1).map((s) => {
      const line = L.polyline(s.points.map((p) => [p.lat, p.lng] as [number, number]), {
        color: '#8b866f', weight: 3, opacity: 0.55, dashArray: '5 7',
      }).addTo(map);
      line.on('click', () => navigate(`/activity/${s.id}`));
      return line;
    });
  }, [sessions, navigate]);

  // Chronomètre : avance tant que la sortie n'est pas en pause.
  useEffect(() => {
    if (!running || paused) return;
    const id = window.setInterval(() => setElapsed(activeElapsedSec()), 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, paused, native]);

  // Tracé live
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (lineRef.current) lineRef.current.remove();
    lineRef.current = points.length > 1
      ? L.polyline(points.map((p) => [p.lat, p.lng] as [number, number]), { color: '#D8CA82', weight: 5, opacity: 0.9 }).addTo(map)
      : null;
    if (points.length) {
      const p = points[points.length - 1];
      if (markerRef.current) markerRef.current.remove();
      markerRef.current = L.circleMarker([p.lat, p.lng], {
        radius: 7, color: '#111', fillColor: paused ? '#e8837a' : '#D8CA82', fillOpacity: 1, weight: 3,
      }).addTo(map);
      if (running) map.setView([p.lat, p.lng], Math.max(map.getZoom(), 16));
    }
  }, [points, running, paused]);

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
        typeRef.current = snap.type || stored.type || 'walk';
        setType(typeRef.current);
        startedAtRef.current = snap.startedAt || stored.startedAt || Date.now();
        stepsAtStartRef.current = typeof stored.stepsAtStart === 'number' ? stored.stepsAtStart : null;
        if (stored.id) sessionRef.current = stored.id;
        else {
          sessionRef.current = await createActivitySession(profile.uid, typeRef.current);
          localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify({
            id: sessionRef.current, type: typeRef.current, startedAt: startedAtRef.current, stepsAtStart: stepsAtStartRef.current,
          }));
        }
        lastSavedRef.current = Date.now();
        const storedBatterySaver = snap.batterySaver ?? readStoredFlag(BATTERY_SAVER_KEY);
        setBatterySaver(storedBatterySaver);
        applySnapshot(snap);
        // Objectif déjà atteint avant la fermeture : ne pas renotifier.
        const persistedGoal = readStoredNumber(ACTIVITY_GOAL_KEY);
        if (goalProgress(snap.distanceM || 0, persistedGoal)?.reached) goalNotifiedRef.current = true;
        await attachListeners();
        stepsUnsubRef.current = pedometer.subscribe((s) => setLiveSteps(s));
        setLiveSteps(pedometer.getTodaySteps());
        setRunning(true);
        toast(snap.paused ? 'Sortie en pause retrouvée.' : 'Sortie en cours reprise.', 'info');
      } catch (e) { console.warn('[activity] resume', e); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.uid]);

  // Démontage : on détache les écouteurs mais on laisse le service natif tourner.
  useEffect(() => () => { detachListeners(); if (!native) stopWatch(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  /** Durée active en secondes, pauses exclues (native : base du dernier snapshot). */
  function activeElapsedSec(): number {
    if (native) {
      const base = durationBaseRef.current;
      const runningSec = paused ? 0 : (Date.now() - base.at) / 1000;
      return Math.max(0, Math.floor(base.sec + runningSec));
    }
    const started = startedAtRef.current;
    if (!started) return 0;
    const now = Date.now();
    const pausedMs = pausedTotalRef.current + (paused && pausedAtRef.current ? now - pausedAtRef.current : 0);
    return Math.max(0, Math.floor((now - started - pausedMs) / 1000));
  }

  function currentPausedSec(): number {
    if (native) return pausedSecRef.current;
    const now = Date.now();
    const ongoing = paused && pausedAtRef.current ? now - pausedAtRef.current : 0;
    return Math.floor((pausedTotalRef.current + ongoing) / 1000);
  }

  function noteAccuracy(value: number | null | undefined, allowAlert: boolean) {
    const next = gpsQuality(value);
    setAccuracy(value ?? null);
    const previous = lastQualityRef.current;
    if (
      allowAlert && isQualityDegraded(previous, next.level)
      && Date.now() - lastGpsAlertRef.current > 60000
    ) {
      lastGpsAlertRef.current = Date.now();
      toast(`${next.label} — ${next.hint}`, 'info');
    }
    lastQualityRef.current = next.level;
  }

  function applySnapshot(snap: TrackingSnapshot) {
    pointsRef.current = snap.points || [];
    distanceRef.current = snap.distanceM || 0;
    if (snap.startedAt) startedAtRef.current = snap.startedAt;
    typeRef.current = snap.type;
    setType(snap.type);
    pausedSecRef.current = snap.pausedSec || 0;
    setPausedSec(snap.pausedSec || 0);
    durationBaseRef.current = { sec: snap.durationSec || 0, at: Date.now() };
    setPoints(pointsRef.current);
    setDistance(distanceRef.current);
    setElapsed(snap.durationSec || 0);
    setPaused(!!snap.paused);
    setBatterySaver(!!snap.batterySaver);
    noteAccuracy(snap.accuracyM, true);
  }

  async function attachListeners() {
    if (!trackHandleRef.current) {
      trackHandleRef.current = await tracking.addListener((s) => { applySnapshot(s); void maybePersist(); });
    }
    if (!appStateHandleRef.current) {
      appStateHandleRef.current = await CapApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) tracking.getSnapshot().then(applySnapshot).catch(() => undefined);
      });
    }
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
    const dur = activeElapsedSec();
    const cal = Math.round((distanceRef.current / 1000) * (typeRef.current === 'run' ? 75 : 50));
    await appendActivityPoint(
      profile.uid,
      sessionRef.current,
      pointsRef.current,
      distanceRef.current,
      dur,
      cal,
      currentPausedSec(),
    ).catch(() => undefined);
  }

  async function addPoint(position: { latitude: number; longitude: number; altitude?: number | null; accuracy?: number | null }) {
    const point: ActivityPoint = {
      lat: position.latitude,
      lng: position.longitude,
      altitude: position.altitude || undefined,
      accuracy: position.accuracy ?? undefined,
      recordedAt: Date.now(),
    };
    const previous = pointsRef.current[pointsRef.current.length - 1];
    if (previous) {
      const delta = distanceBetween(previous, point);
      // Les points très imprécis ne gonflent pas la distance.
      const preciseEnough = point.accuracy == null || point.accuracy <= 100;
      if (delta < 100 && preciseEnough) distanceRef.current += delta;
    }
    pointsRef.current = [...pointsRef.current, point];
    setPoints(pointsRef.current);
    setDistance(distanceRef.current);
    noteAccuracy(point.accuracy, true);
    void maybePersist();
  }

  async function stopWatch() {
    if (watchRef.current === null) return;
    if (Capacitor.isNativePlatform()) await Geolocation.clearWatch({ id: String(watchRef.current) }).catch(() => undefined);
    else navigator.geolocation.clearWatch(Number(watchRef.current));
    watchRef.current = null;
  }

  async function startWatch() {
    if (Capacitor.isNativePlatform()) {
      const perm = await Geolocation.requestPermissions();
      if (perm.location !== 'granted') throw new Error('Autorisez la localisation pour enregistrer le parcours.');
      watchRef.current = await Geolocation.watchPosition(
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 3000 },
        (pos) => { if (pos) addPoint(pos.coords).catch(() => undefined); },
      );
    } else {
      if (!navigator.geolocation) throw new Error('La géolocalisation n’est pas disponible dans ce navigateur.');
      // Mode économie : moins de points, précision moindre.
      watchRef.current = navigator.geolocation.watchPosition(
        (pos) => addPoint(pos.coords).catch(() => undefined),
        () => toast('Position GPS indisponible.', 'error'),
        batterySaver
          ? { enableHighAccuracy: false, maximumAge: 15000, timeout: 30000 }
          : { enableHighAccuracy: true, maximumAge: 3000, timeout: 12000 },
      );
    }
  }

  async function start() {
    if (!profile || running) return;
    try {
      pointsRef.current = [];
      distanceRef.current = 0;
      const now = Date.now();
      startedAtRef.current = now;
      typeRef.current = type;
      durationBaseRef.current = { sec: 0, at: now };
      pausedTotalRef.current = 0;
      pausedAtRef.current = null;
      pausedSecRef.current = 0;
      goalNotifiedRef.current = false;
      lastQualityRef.current = 'unknown';
      setPaused(false);
      setPausedSec(0);
      setAccuracy(null);
      setPoints([]);
      setDistance(0);
      setElapsed(0);
      lastSavedRef.current = now;

      const id = await createActivitySession(profile.uid, type);
      sessionRef.current = id;
      try {
        await pedometer.loadPersisted();
        stepsAtStartRef.current = pedometer.getTodaySteps();
      } catch { stepsAtStartRef.current = null; }
      setLiveSteps(pedometer.getTodaySteps());

      if (native) {
        const snap = await tracking.start(type, batterySaver);
        applySnapshot(snap);
        // Objectif déjà atteint avant la fermeture : ne pas renotifier.
        const persistedGoal = readStoredNumber(ACTIVITY_GOAL_KEY);
        if (goalProgress(snap.distanceM || 0, persistedGoal)?.reached) goalNotifiedRef.current = true;
        await attachListeners();
      } else {
        await startWatch();
      }
      stepsUnsubRef.current = pedometer.subscribe((s) => setLiveSteps(s));
      localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify({
        id, type, startedAt: now, stepsAtStart: stepsAtStartRef.current,
      }));
      setRunning(true);
      toast(type === 'run' ? 'Course démarrée. Bonne sortie !' : 'Marche démarrée. Bonne sortie !', 'success');
    } catch (e) {
      await cleanupAfterError();
      toast((e as Error).message, 'error');
    }
  }

  async function cleanupAfterError() {
    detachListeners();
    if (!native) await stopWatch();
  }

  /** Pause / reprise : le temps de pause est exclu du chrono et de l'allure. */
  async function togglePause() {
    if (!running) return;
    try {
      if (!paused) {
        const sec = activeElapsedSec();
        durationBaseRef.current = { sec, at: Date.now() };
        setElapsed(sec);
        if (native) {
          const snap = await tracking.pause();
          applySnapshot(snap);
        } else {
          pausedAtRef.current = Date.now();
          await stopWatch();
          setPaused(true);
        }
        toast('Sortie en pause — GPS suspendu.', 'info');
      } else {
        if (native) {
          const snap = await tracking.resume();
          applySnapshot(snap);
        } else {
          if (pausedAtRef.current) pausedTotalRef.current += Date.now() - pausedAtRef.current;
          pausedAtRef.current = null;
          const sec = activeElapsedSec();
          durationBaseRef.current = { sec, at: Date.now() };
          setElapsed(sec);
          setPaused(false);
          await startWatch();
        }
        toast('Sortie reprise. Bonne route !', 'success');
      }
    } catch (e) {
      toast(`Pause impossible : ${(e as Error).message}`, 'error');
    }
  }

  /** Économie de batterie : demande moins de points GPS pendant la sortie. */
  async function toggleBatterySaver() {
    const next = !batterySaver;
    setBatterySaver(next);
    writeStoredFlag(BATTERY_SAVER_KEY, next);
    if (native && running) {
      try { applySnapshot(await tracking.setBatterySaver(next)); } catch { /* ignore */ }
    } else if (running && !paused) {
      await stopWatch();
      await startWatch();
    }
    toast(
      next ? 'Mode économie : moins de points GPS, batterie préservée.' : 'Précision GPS maximale rétablie.',
      'info',
    );
  }

  // Notification (toast + notification locale) à l'atteinte de l'objectif.
  useEffect(() => {
    if (!running || !goal?.reached || goalNotifiedRef.current || !goalKm) return;
    goalNotifiedRef.current = true;
    toast(`Objectif atteint : ${goalKm} km ! 🎉`, 'success');
    void notifyActivityGoal(goalKm, distance);
  }, [running, goal?.reached, goalKm, distance, toast]);

  async function stop() {
    if (!profile || !sessionRef.current) return;
    try {
      let finalPoints = pointsRef.current;
      let finalDistance = distanceRef.current;
      let duration = activeElapsedSec();
      let pauseSeconds = currentPausedSec();
      if (native) {
        const snap = await tracking.stop();
        finalPoints = snap.points || finalPoints;
        finalDistance = snap.distanceM || finalDistance;
        duration = snap.durationSec || duration;
        pauseSeconds = snap.pausedSec || pauseSeconds;
      } else {
        await stopWatch();
        pauseSeconds = currentPausedSec();
      }
      detachListeners();
      try { await pedometer.loadPersisted(); } catch { /* ignore */ }
      const endSteps = pedometer.getTodaySteps();
      const delta = (typeof stepsAtStartRef.current === 'number' && endSteps >= stepsAtStartRef.current)
        ? endSteps - stepsAtStartRef.current
        : 0;
      const steps = delta > 0 ? delta : Math.round(finalDistance / (strideCm / 100));
      const cal = Math.round((finalDistance / 1000) * (typeRef.current === 'run' ? 75 : 50));
      await finishActivitySession(profile.uid, sessionRef.current, {
        points: finalPoints,
        distanceM: finalDistance,
        durationSec: duration,
        pausedSec: pauseSeconds,
        calories: cal,
        steps,
      });
      pointsRef.current = [];
      distanceRef.current = 0;
      startedAtRef.current = null;
      sessionRef.current = null;
      stepsAtStartRef.current = null;
      pausedTotalRef.current = 0;
      pausedAtRef.current = null;
      pausedSecRef.current = 0;
      setPoints([]);
      setDistance(0);
      setElapsed(0);
      setPausedSec(0);
      setPaused(false);
      setRunning(false);
      setAccuracy(null);
      localStorage.removeItem(ACTIVE_SESSION_KEY);
      setReloadToken((n) => n + 1);
      const pauseLabel = pauseSeconds >= 60 ? ` · ${Math.round(pauseSeconds / 60)} min de pause` : '';
      toast(
        `Sortie enregistrée · ${formatDistance(finalDistance, unitSystem)} · ${Math.floor(duration / 60)} min${pauseLabel}`,
        'success',
      );
      // Annonce interstitielle sur la transition « fin de sortie ».
      // Affichée APRÈS l'enregistrement (la séance ne dépend jamais de la pub),
      // et soumise au cooldown interne de ads.ts.
      void showInterstitial().catch(() => undefined);
    } catch (e) {
      toast((e as Error).message, 'error');
      setRunning(false);
    }
  }

  const activeFilterCount = activeFiltersCount(filters);

  return (
    <div className="activity-screen" data-testid="activity-screen">
      <div className="activity-header">
        <div>
          <h1 className="screen-title">Sortie GPS</h1>
          <div className="screen-sub">{native ? 'Marche ou course · continue même app fermée' : 'Marche ou course · trace privée'}</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}>Retour</button>
      </div>
      <div className="activity-map" ref={containerRef} />
      <div className="activity-panel">
        <div className="activity-types">
          <button className={type === 'walk' ? 'selected' : ''} disabled={running} onClick={() => setType('walk')}>🚶 Marche</button>
          <button className={type === 'run' ? 'selected' : ''} disabled={running} onClick={() => setType('run')}>🏃 Course</button>
        </div>
        <div className="activity-stats">
          <div><strong>{fmtDuration(elapsed)}</strong><span>durée active</span></div>
          <div><strong>{formatDistance(distance, unitSystem)}</strong><span>distance</span></div>
          <div><strong>{calories}</strong><span>kcal</span></div>
          <div><strong>{Math.round(liveDeltaSteps).toLocaleString('fr-FR')}</strong><span>pas</span></div>
          <div><strong>{speedKmh(distance, elapsed).toFixed(1)}</strong><span>km/h</span></div>
          <div><strong>{paceMinPerKm(distance, elapsed)}</strong><span>allure</span></div>
        </div>

        <div className="activity-live-meta">
          <span className={`gps-quality gps-${gps.level}`} data-testid="gps-quality" title={gps.hint}>
            <i aria-hidden="true" />{gps.label}
          </span>
          {running && <span className="activity-points">{points.length} pts GPS</span>}
          <button
            type="button"
            className={`chip ${batterySaver ? 'chip-active' : ''}`}
            aria-pressed={batterySaver}
            onClick={toggleBatterySaver}
            title="Moins de points GPS pour économiser la batterie"
          >
            🔋 Économie
          </button>
        </div>
        {running && gps.level !== 'good' && gps.level !== 'unknown' && (
          <p className="activity-gps-hint" role="status">⚠️ {gps.hint}</p>
        )}
        {paused && (
          <p className="activity-pause-note" role="status">
            ⏸ Sortie en pause — appuyez sur « Reprendre » pour continuer. Le chrono et le GPS sont suspendus.
          </p>
        )}
        {!paused && (running || elapsed > 0) && pausedSec > 0 && (
          <p className="activity-pause-note">⏸ Temps en pause exclu de l’allure : {fmtDuration(pausedSec)}</p>
        )}

        <div className="activity-goal" data-testid="activity-goal">
          <div className="activity-goal-head">
            <span>Objectif de sortie</span>
            <strong>{goalKm ? `${goalKm.toLocaleString('fr-FR')} km` : 'Libre'}</strong>
          </div>
          <div className="chip-row">
            {GOAL_PRESETS_KM.map((km) => (
              <button
                key={km}
                type="button"
                className={`chip ${goalKm === km ? 'chip-active' : ''}`}
                onClick={() => changeGoal(goalKm === km ? null : km)}
              >
                {km} km
              </button>
            ))}
            <button type="button" className={`chip ${goalKm === null ? 'chip-active' : ''}`} onClick={() => changeGoal(null)}>Aucun</button>
            <input
              className="input goal-input"
              type="number"
              inputMode="decimal"
              min="0.5"
              max="100"
              step="0.5"
              placeholder="Autre"
              aria-label="Objectif personnalisé en kilomètres"
              value={goalInput}
              onChange={(e) => onGoalInput(e.target.value)}
            />
          </div>
          {goal ? (
            <>
              <div
                className={`goal-progress ${goal.reached ? 'goal-reached' : ''}`}
                role="progressbar"
                aria-valuenow={goal.percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Progression vers l’objectif"
              >
                <div style={{ width: `${goal.percent}%` }} />
              </div>
              <div className="goal-meta">
                <span>{goal.percent} %</span>
                <span>{goal.reached ? 'Objectif atteint 🎉' : `reste ${formatDistance(goal.remainingM, unitSystem)}`}</span>
              </div>
            </>
          ) : null}
        </div>

        {running ? (
          <div className="activity-actions">
            <button className={`btn ${paused ? 'btn-gold' : 'btn-outline'}`} onClick={togglePause}>
              {paused ? '▶ Reprendre' : '⏸ Pause'}
            </button>
            <button className="btn btn-danger" onClick={stop}>■ Terminer et enregistrer</button>
          </div>
        ) : (
          <button className="btn btn-gold" onClick={start}>▶ Démarrer la sortie</button>
        )}
        <p className="activity-privacy">
          {native
            ? 'Le GPS reste actif en arrière-plan (notification permanente) jusqu’à l’arrêt ou la pause. Le parcours n’est visible que par vous.'
            : 'Le GPS est activé uniquement pendant la sortie (onglet ouvert). Le parcours est visible seulement par vous.'}
        </p>
      </div>

      <div className="activity-history card">
        <div className="card-title">Mes sorties</div>
          <div className="activity-filters">
            <div className="filter-row" role="group" aria-label="Filtrer par type">
              {(['all', 'walk', 'run'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`chip ${filters.type === value ? 'chip-active' : ''}`}
                  onClick={() => updateFilters({ type: value })}
                >
                  {value === 'all' ? 'Toutes' : value === 'walk' ? '🚶 Marche' : '🏃 Course'}
                </button>
              ))}
            </div>
            <div className="filter-row" role="group" aria-label="Filtrer par période">
              {PERIOD_OPTIONS.map((option) => (
                <button
                  key={option.days}
                  type="button"
                  className={`chip ${filters.periodDays === option.days ? 'chip-active' : ''}`}
                  onClick={() => updateFilters({ periodDays: option.days })}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="filter-row" role="group" aria-label="Filtrer par distance minimale">
              {DISTANCE_OPTIONS_KM.map((km) => (
                <button
                  key={km}
                  type="button"
                  className={`chip ${filters.minDistanceKm === km ? 'chip-active' : ''}`}
                  onClick={() => updateFilters({ minDistanceKm: km })}
                >
                  {km === 0 ? 'Toute distance' : `≥ ${km} km`}
                </button>
              ))}
            </div>
            {activeFilterCount > 0 && (
              <button className="text-button" onClick={() => updateFilters(DEFAULT_ACTIVITY_FILTERS)}>
                Réinitialiser les filtres ({activeFilterCount})
              </button>
            )}
          </div>

          {loadingSessions && sessions.length === 0 && <div className="spinner" style={{ margin: '18px auto' }} />}
          {!loadingSessions && sessions.length === 0 && (
            <div className="empty-state">
              {activeFilterCount > 0 ? 'Aucune sortie ne correspond à ces filtres.' : 'Démarrez votre première sortie GPS.'}
            </div>
          )}
          {sessions.map((s) => (
            <button className="list-row activity-session-row" key={s.id} onClick={() => navigate(`/activity/${s.id}`)}>
              <span className="activity-history-icon">{s.type === 'run' ? '🏃' : '🚶'}</span>
              <div className="row-main">
                <div className="row-title">{sessionTitle(s)}</div>
                <div className="row-sub">
                  {formatDistance(s.distanceM, unitSystem)} · {Math.floor(s.durationSec / 60)} min · {s.calories || 0} kcal
                  {typeof s.steps === 'number' && s.steps > 0 ? ` · ${s.steps.toLocaleString('fr-FR')} pas` : ''}
                  {s.pausedSec && s.pausedSec >= 60 ? ` · ⏸ ${Math.round(s.pausedSec / 60)} min` : ''}
                  {s.note ? ' · 📝' : ''}
                </div>
              </div>
              <span className="row-value activity-chev">›</span>
            </button>
          ))}
          {hasMore && (
            <button className="btn btn-outline" style={{ marginTop: 8 }} onClick={loadMoreSessions} disabled={loadingSessions}>
              {loadingSessions ? 'Chargement…' : 'Charger plus de sorties'}
            </button>
          )}
          <button className="text-button" style={{ marginTop: 6 }} onClick={() => navigate('/history')}>
            Voir l’historique quotidien
          </button>
      </div>
    </div>
  );
}
