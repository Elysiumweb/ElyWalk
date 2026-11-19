import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { addBaseMap } from '../lib/mapTiles';
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
  searchActivitySessions,
  type ActivityQueryCursor,
} from '../lib/db';
import { tracking, isTrackingSupported, type TrackingSnapshot } from '../lib/tracking';
import { pedometer } from '../lib/pedometer';
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
import { showEndOfActivityAd, showInterstitial } from '../lib/ads';
import { enqueueSync, subscribeQueue, type SyncState } from '../lib/syncQueue';
import { distanceToRoute, getRoute } from '../lib/routes';
import { MAX_GPX_FILE_BYTES, buildImportedActivity, gpxImportError, parseGpx, type ImportedActivity } from '../lib/gpx';
import { importGpxSession } from '../lib/db';
import type { SavedRoute } from '../lib/types';

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
  const location = useLocation();
  const requestedRouteId = (location.state as { routeId?: string } | null)?.routeId;
  const [plannedRoute, setPlannedRoute] = useState<SavedRoute | null>(null);
  const [routeDistance, setRouteDistance] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const lineRef = useRef<L.Polyline | null>(null);
  const plannedLineRef = useRef<L.Polyline | null>(null);
  const historyLinesRef = useRef<L.Polyline[]>([]);
  const markerRef = useRef<L.CircleMarker | null>(null);

  const sessionRef = useRef<string | null>(null);
  const pointsRef = useRef<ActivityPoint[]>([]);
  const lastPointPaintRef = useRef({ at: 0 });
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
  // A12.2 — import d'une trace GPX (Strava, Garmin, OSM…).
  const gpxInputRef = useRef<HTMLInputElement | null>(null);
  const [importingGpx, setImportingGpx] = useState(false);
  const cursorRef = useRef<ActivityQueryCursor | null>(null);
  // Recherche textuelle (titre / note / parcours) : filtrage local, aucun index
  // composite requis — la recherche globale ne se limite donc pas à la page
  // chargée (F06).
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<ActivitySession[] | null>(null);
  const [searching, setSearching] = useState(false);

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

  /**
   * A12.2 — une trace GPX devient une sortie normale : distance, durée et pas
   * sont recalculés depuis les points, puis enregistrés comme n'importe quelle
   * sortie GPS (records personnels compris). La trace la plus longue du fichier
   * est retenue quand il en contient plusieurs.
   */
  async function importGpx(file: File) {
    if (!profile) return;
    if (file.size > MAX_GPX_FILE_BYTES) {
      toast('Fichier trop volumineux (5 Mo maximum).', 'error');
      return;
    }
    setImportingGpx(true);
    try {
      const xml = await file.text();
      const parseError = gpxImportError(xml);
      if (parseError) {
        toast(parseError, 'error');
        return;
      }
      const activities = parseGpx(xml)
        .map((track) =>
          buildImportedActivity(track, {
            strideCm: profile.strideLengthCm,
            health: profile.health,
            fallbackStart: Date.now(),
          }),
        )
        .filter((a): a is ImportedActivity => a !== null)
        .sort((a, b) => b.distanceM - a.distanceM);
      if (activities.length === 0) {
        toast('Aucun point exploitable dans ce fichier.', 'error');
        return;
      }
      await importGpxSession(profile.uid, activities[0]);
      toast(`Trace importée : ${formatDistance(activities[0].distanceM, unitSystem)}.`, 'success');
      setReloadToken((t) => t + 1);
    } catch {
      toast('Import impossible. Vérifiez le fichier et réessayez.', 'error');
    } finally {
      setImportingGpx(false);
      if (gpxInputRef.current) gpxInputRef.current.value = '';
    }
  }

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

  // Recherche dans toutes les sorties du compte (debounce 300 ms).
  useEffect(() => {
    if (!profile) return;
    const term = search.trim();
    if (term.length < 2) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      const q = filtersToQuery(filters);
      void searchActivitySessions(profile.uid, term, { type: q.type, from: q.from })
        .then((items) => {
          if (!cancelled) setSearchResults(items);
        })
        .catch(() => {
          if (!cancelled) setSearchResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [profile?.uid, search, filters]);

  // Carte
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { center: FALLBACK_CENTER, zoom: 6, zoomControl: false });
    addBaseMap(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Parcours préparé : affiché seulement à la demande, sans géolocalisation automatique.
  useEffect(() => {
    if (!requestedRouteId) return;
    let cancelled = false;
    getRoute(requestedRouteId).then(route => {
      if (!route || cancelled) { if (!cancelled) toast('Parcours introuvable ou privé.', 'error'); return; }
      setPlannedRoute(route);
      const map = mapRef.current;
      if (map) {
        plannedLineRef.current?.remove();
        plannedLineRef.current = L.polyline(route.points.map(p => [p.lat, p.lng] as [number, number]), { color: '#73b9e6', weight: 5, opacity: 0.85 }).addTo(map);
        map.fitBounds(plannedLineRef.current.getBounds(), { padding: [25, 25] });
      }
    }).catch(e => toast((e as Error).message, 'error'));
    return () => { cancelled = true; plannedLineRef.current?.remove(); plannedLineRef.current = null; };
  }, [requestedRouteId]);

  useEffect(() => {
    if (!running || paused || !plannedRoute || points.length === 0) { setRouteDistance(null); return; }
    setRouteDistance(Math.round(distanceToRoute(points[points.length - 1], plannedRoute.points)));
  }, [points, running, paused, plannedRoute]);

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
          sessionRef.current = `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
          await enqueueSync('activity.create', {
            uid: profile.uid, type: typeRef.current, sessionId: sessionRef.current, startedAt: startedAtRef.current,
          }, { dedupeKey: `create:${sessionRef.current}` });
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
    // F09 — le GPS émet environ un point par seconde : recréer le tableau à
    // chaque point (et re-rendre la carte Leaflet + tout l'écran pendant 45 min
    // de sortie) faisait chuter l'app. On accumule dans le tampon existant, et
    // l'état n'est rafraîchi que toutes les deux secondes pour l'affichage.
    pointsRef.current.push(point);
    const now = Date.now();
    const lastPaint = lastPointPaintRef.current;
    if (now - lastPaint.at >= 2000){
      lastPaint.at = now;
      setPoints(pointsRef.current.slice(-4000));
    }
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
    // Annonce interstitielle au lancement du GPS (placement « Interstitial »).
    // `showInterstitial` résout toujours — sans fill, sans consentement ou hors
    // application native — : le départ n'est jamais retardé ni bloqué.
    void showInterstitial();
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

      // F04 — identifiant généré sur l'appareil : la sortie peut démarrer hors
      // connexion, et un renvoi met à jour le même document (aucun doublon).
      const id = `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      sessionRef.current = id;
      const route = plannedRoute?.id ? { id: plannedRoute.id, name: plannedRoute.name } : null;
      await enqueueSync('activity.create', {
        uid: profile.uid, type, sessionId: id, startedAt: now, route,
      }, { dedupeKey: `create:${id}` });
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
      // F04 — la fin de sortie est mise en file : hors connexion, l'utilisateur
      // voit sa sortie enregistrée sur son téléphone et envoyée plus tard, au
      // lieu de perdre le parcours.
      await enqueueSync('activity.finish', {
        uid: profile.uid,
        sessionId: sessionRef.current,
        data: {
          points: finalPoints,
          distanceM: finalDistance,
          durationSec: duration,
          pausedSec: pauseSeconds,
          calories: cal,
          steps,
        },
      }, { dedupeKey: `finish:${sessionRef.current}` });
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
      // Annonce de fin de sortie (carte native Meta Audience Network, #4).
      void showEndOfActivityAd();
    } catch (e) {
      toast((e as Error).message, 'error');
      setRunning(false);
    }
  }

  const activeFilterCount = activeFiltersCount(filters);

  const list = searchResults ?? sessions;
  const showSkeleton = searching || (loadingSessions && sessions.length === 0);
  const showGpsWarning = running && gps.level !== 'good' && gps.level !== 'unknown';
  const liveStatus = !running ? '' : paused ? 'Sortie en pause.' : 'Sortie en cours.';

  return (
    <div className={`activity-screen v2-act ${running ? 'v2-act-live' : ''}`.trim()} data-testid="activity-screen">
      <style>{V2_STYLES}</style>
      <p className="v2-sr" role="status" aria-live="polite" data-testid="activity-live-announcer">{liveStatus}</p>

      <div className="activity-header">
        <div>
          <h1 className="screen-title">Sortie GPS</h1>
          <div className="screen-sub">{native ? 'Marche ou course · continue même app fermée' : 'Marche ou course · trace privée'}</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)} data-testid="activity-back-button">Retour</button>
      </div>

      <div
        className={`activity-map ${running ? 'activity-map-live' : 'activity-map-compact'}`}
        ref={containerRef}
        role="region"
        aria-label="Carte de la sortie"
        data-testid="activity-map"
      />

      <div className="activity-panel v2-panel">
        {plannedRoute && (
          <div className="planned-route-banner" data-testid="planned-route">
            <div>
              <strong>🧭 {plannedRoute.name}</strong>
              <span>{formatDistance(plannedRoute.distanceM, unitSystem)} · {plannedRoute.elevationGainM} m D+</span>
            </div>
            <button
              className="btn btn-ghost btn-sm"
              disabled={running}
              aria-label="Quitter le parcours planifié"
              data-testid="planned-route-quit-button"
              onClick={() => { setPlannedRoute(null); plannedLineRef.current?.remove(); }}
            >
              Quitter
            </button>
            {routeDistance != null && (
              <p role="status" data-testid="planned-route-distance">
                {routeDistance <= 50 ? 'Vous êtes sur le tracé.' : `À ${routeDistance} m du tracé le plus proche.`}
              </p>
            )}
          </div>
        )}

        {running && (
          <div className={`v2-live ${paused ? 'v2-live-paused' : ''}`.trim()} data-testid="activity-live-stats">
            <div className="v2-hero">
              <div>
                <strong data-testid="activity-live-duration">{fmtDuration(elapsed)}</strong>
                <span>durée active</span>
              </div>
              <div>
                <strong data-testid="activity-live-distance">{formatDistance(distance, unitSystem)}</strong>
                <span>distance</span>
              </div>
            </div>
            <div className="v2-grid4">
              <div><strong data-testid="activity-live-pace">{paceMinPerKm(distance, elapsed)}</strong><span>allure</span></div>
              <div><strong data-testid="activity-live-speed">{speedKmh(distance, elapsed).toFixed(1)}</strong><span>km/h</span></div>
              <div><strong data-testid="activity-live-steps">{Math.round(liveDeltaSteps).toLocaleString('fr-FR')}</strong><span>pas</span></div>
              <div><strong data-testid="activity-live-calories">{calories}</strong><span>kcal</span></div>
            </div>
          </div>
        )}

        <div className="activity-types" role="group" aria-label="Type de sortie">
          <button
            className={type === 'walk' ? 'selected' : ''}
            aria-pressed={type === 'walk'}
            disabled={running}
            onClick={() => setType('walk')}
            data-testid="activity-type-walk"
          >
            🚶 Marche
          </button>
          <button
            className={type === 'run' ? 'selected' : ''}
            aria-pressed={type === 'run'}
            disabled={running}
            onClick={() => setType('run')}
            data-testid="activity-type-run"
          >
            🏃 Course
          </button>
        </div>

        <div className="activity-live-meta v2-status">
          <span className={`gps-quality gps-${gps.level}`} data-testid="gps-quality" title={gps.hint}>
            <i aria-hidden="true" />{gps.label}
          </span>
          {running && <span className="activity-points" data-testid="activity-points-count">{points.length} pts GPS</span>}
          <button
            type="button"
            className={`chip ${batterySaver ? 'chip-active' : ''}`}
            aria-pressed={batterySaver}
            onClick={toggleBatterySaver}
            title="Moins de points GPS pour économiser la batterie"
            data-testid="battery-saver-toggle"
          >
            🔋 Économie
          </button>
        </div>

        {showGpsWarning && (
          <p className="v2-banner v2-banner-warn" role="status" data-testid="activity-gps-banner">
            <span aria-hidden="true">⚠️</span><span>{gps.hint}</span>
          </p>
        )}
        {paused && (
          <p className="v2-banner v2-banner-warn" role="status" data-testid="activity-pause-banner">
            <span aria-hidden="true">⏸</span>
            <span>Sortie en pause — appuyez sur « Reprendre » pour continuer. Le chrono et le GPS sont suspendus.</span>
          </p>
        )}
        {!paused && (running || elapsed > 0) && pausedSec > 0 && (
          <p className="v2-banner" data-testid="activity-paused-time-banner">
            <span aria-hidden="true">⏸</span>
            <span>Temps en pause exclu de l’allure : {fmtDuration(pausedSec)}</span>
          </p>
        )}
        {running && batterySaver && (
          <p className="v2-banner" data-testid="activity-battery-banner">
            <span aria-hidden="true">🔋</span>
            <span>Économie de batterie active : moins de points GPS enregistrés.</span>
          </p>
        )}
        {running && goal?.reached && (
          <p className="v2-banner v2-banner-ok" role="status" data-testid="activity-goal-banner">
            <span aria-hidden="true">🎉</span><span>Objectif atteint{goalKm ? ` : ${goalKm.toLocaleString('fr-FR')} km` : ''}.</span>
          </p>
        )}

        <div className="activity-goal" data-testid="activity-goal">
          <div className="activity-goal-head">
            <span>Objectif de sortie</span>
            <strong data-testid="activity-goal-value">{goalKm ? `${goalKm.toLocaleString('fr-FR')} km` : 'Libre'}</strong>
          </div>
          <div className="chip-row v2-scroll-row" role="group" aria-label="Choisir un objectif de distance">
            {GOAL_PRESETS_KM.map((km) => (
              <button
                key={km}
                type="button"
                className={`chip ${goalKm === km ? 'chip-active' : ''}`}
                aria-pressed={goalKm === km}
                onClick={() => changeGoal(goalKm === km ? null : km)}
                data-testid={`activity-goal-preset-${km}`}
              >
                {km} km
              </button>
            ))}
            <button
              type="button"
              className={`chip ${goalKm === null ? 'chip-active' : ''}`}
              aria-pressed={goalKm === null}
              onClick={() => changeGoal(null)}
              data-testid="activity-goal-none"
            >
              Aucun
            </button>
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
              data-testid="activity-goal-input"
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
                data-testid="activity-goal-progress"
              >
                <div style={{ width: `${goal.percent}%` }} />
              </div>
              <div className="goal-meta" data-testid="activity-goal-meta">
                <span>{goal.percent} %</span>
                <span>{goal.reached ? 'Objectif atteint 🎉' : `reste ${formatDistance(goal.remainingM, unitSystem)}`}</span>
              </div>
            </>
          ) : null}
        </div>

        {!running && (
          <button className="btn btn-gold v2-start" onClick={start} data-testid="activity-start-button">
            ▶ Démarrer la sortie
          </button>
        )}
        <p className="activity-privacy v2-privacy" data-testid="activity-privacy-note">
          {native
            ? 'Le GPS reste actif en arrière-plan (notification permanente) jusqu’à l’arrêt ou la pause. Le parcours n’est visible que par vous.'
            : 'Le GPS est activé uniquement pendant la sortie (onglet ouvert). Le parcours est visible seulement par vous.'}
        </p>
      </div>

      <section className="activity-history card v2-history" aria-labelledby="v2-history-title" data-testid="activity-history">
        <div className="v2-section-head">
          <h2 className="card-title" id="v2-history-title">Mes sorties</h2>
          {activeFilterCount > 0 && (
            <span className="v2-badge" data-testid="activity-filter-count">
              {activeFilterCount} filtre{activeFilterCount > 1 ? 's' : ''} actif{activeFilterCount > 1 ? 's' : ''}
            </span>
          )}
        </div>

        <div className="field v2-search">
          <input
            className="input"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Rechercher par titre, note ou parcours…"
            aria-label="Rechercher dans mes sorties"
            data-testid="activity-search-input"
          />
          <small className="field-help">
            La recherche porte sur toutes vos sorties, pas seulement sur la page affichée.
          </small>
        </div>

        <div className="v2-filter-scroll" data-testid="activity-filters">
          <div className="v2-filter-group" role="group" aria-label="Filtrer par type">
            {(['all', 'walk', 'run'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={`chip ${filters.type === value ? 'chip-active' : ''}`}
                aria-pressed={filters.type === value}
                onClick={() => updateFilters({ type: value })}
                data-testid={`activity-filter-type-${value}`}
              >
                {value === 'all' ? 'Toutes' : value === 'walk' ? '🚶 Marche' : '🏃 Course'}
              </button>
            ))}
          </div>
          <span className="v2-sep" aria-hidden="true" />
          <div className="v2-filter-group" role="group" aria-label="Filtrer par période">
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option.days}
                type="button"
                className={`chip ${filters.periodDays === option.days ? 'chip-active' : ''}`}
                aria-pressed={filters.periodDays === option.days}
                onClick={() => updateFilters({ periodDays: option.days })}
                data-testid={`activity-filter-period-${option.days}`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <span className="v2-sep" aria-hidden="true" />
          <div className="v2-filter-group" role="group" aria-label="Filtrer par distance minimale">
            {DISTANCE_OPTIONS_KM.map((km) => (
              <button
                key={km}
                type="button"
                className={`chip ${filters.minDistanceKm === km ? 'chip-active' : ''}`}
                aria-pressed={filters.minDistanceKm === km}
                onClick={() => updateFilters({ minDistanceKm: km })}
                data-testid={`activity-filter-distance-${km}`}
              >
                {km === 0 ? 'Toute distance' : `≥ ${km} km`}
              </button>
            ))}
          </div>
        </div>
        {activeFilterCount > 0 && (
          <button
            className="text-button"
            onClick={() => updateFilters(DEFAULT_ACTIVITY_FILTERS)}
            data-testid="activity-filters-reset"
          >
            Réinitialiser les filtres ({activeFilterCount})
          </button>
        )}

        {showSkeleton && (
          <div className="v2-skel-list" role="status" aria-live="polite" data-testid="activity-history-loading">
            <span className="v2-sr">{searching ? 'Recherche en cours…' : 'Chargement des sorties…'}</span>
            {[0, 1, 2, 3].map((i) => (
              <div className="v2-skel-row" key={i} aria-hidden="true">
                <span className="v2-skel v2-skel-icon" />
                <span className="v2-skel-lines">
                  <span className="v2-skel v2-skel-line" style={{ width: '62%' }} />
                  <span className="v2-skel v2-skel-line" style={{ width: '38%' }} />
                </span>
                <span className="v2-skel v2-skel-metric" />
              </div>
            ))}
          </div>
        )}

        {!loadingSessions && !searching && list.length === 0 && (
          <div className="empty-state v2-empty" data-testid="activity-history-empty">
            {searchResults ? (
              <>
                <p>Aucune sortie ne correspond à cette recherche.</p>
                <button className="btn btn-outline" onClick={() => setSearch('')} data-testid="activity-empty-clear-search">
                  Effacer la recherche
                </button>
              </>
            ) : activeFilterCount > 0 ? (
              <>
                <p>Aucune sortie ne correspond à ces filtres.</p>
                <button
                  className="btn btn-outline"
                  onClick={() => updateFilters(DEFAULT_ACTIVITY_FILTERS)}
                  data-testid="activity-empty-reset-filters"
                >
                  Réinitialiser les filtres
                </button>
              </>
            ) : (
              <p>Démarrez votre première sortie GPS.</p>
            )}
          </div>
        )}

        {list.map((s) => (
          <button
            className="list-row activity-session-row v2-row"
            key={s.id}
            onClick={() => navigate(`/activity/${s.id}`)}
            data-testid={`activity-session-row-${s.id}`}
          >
            <span className="activity-history-icon" aria-hidden="true">{s.type === 'run' ? '🏃' : '🚶'}</span>
            <span className="v2-sr">{s.type === 'run' ? 'Course' : 'Marche'}</span>
            <div className="row-main">
              <div className="row-title">{sessionTitle(s)}</div>
              <div className="row-sub">
                {new Date(s.startedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                {` · ${s.calories || 0} kcal`}
                {typeof s.steps === 'number' && s.steps > 0 ? ` · ${s.steps.toLocaleString('fr-FR')} pas` : ''}
                {s.pausedSec && s.pausedSec >= 60 ? ` · ⏸ ${Math.round(s.pausedSec / 60)} min` : ''}
                {s.note ? ' · 📝' : ''}
              </div>
            </div>
            <span className="v2-row-metrics">
              <strong>{formatDistance(s.distanceM, unitSystem)}</strong>
              <span>{Math.floor(s.durationSec / 60)} min</span>
            </span>
            <span className="row-value activity-chev" aria-hidden="true">›</span>
          </button>
        ))}

        {hasMore && !searchResults && (
          <button
            className="btn btn-outline v2-full"
            onClick={loadMoreSessions}
            disabled={loadingSessions}
            aria-busy={loadingSessions}
            data-testid="activity-load-more"
          >
            {loadingSessions ? 'Chargement…' : 'Charger plus de sorties'}
          </button>
        )}
        {searchResults && (
          <p className="muted-xs v2-result-count" role="status" data-testid="activity-search-count">
            {searchResults.length} résultat{searchResults.length > 1 ? 's' : ''} pour « {search.trim()} ».
          </p>
        )}

        <button className="text-button v2-history-link" onClick={() => navigate('/history')} data-testid="activity-daily-history-link">
          Voir l’historique quotidien
        </button>

        <div className="gpx-import v2-gpx" data-testid="gpx-import">
          <div className="card-title">Importer une trace</div>
          <p className="muted-xs">
            Une trace Strava, Garmin ou OSM devient une sortie ElyWalk : distance, durée et
            pas recalculés depuis le tracé. Elle reste privée jusqu’à ce que vous la partagiez.
          </p>
          <input
            ref={gpxInputRef}
            type="file"
            accept=".gpx,application/gpx+xml,text/xml"
            style={{ display: 'none' }}
            data-testid="gpx-import-input"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importGpx(file);
            }}
          />
          <button
            type="button"
            className="btn btn-outline v2-full"
            disabled={importingGpx}
            aria-busy={importingGpx}
            onClick={() => gpxInputRef.current?.click()}
            data-testid="gpx-import-button"
          >
            {importingGpx && <span className="v2-spin" aria-hidden="true" />}
            {importingGpx ? 'Import en cours…' : 'Importer une trace GPX'}
          </button>
          {importingGpx && (
            <p className="v2-banner" role="status" data-testid="gpx-import-status">
              <span>Lecture du fichier et calcul de la distance, de la durée et des pas…</span>
            </p>
          )}
        </div>
      </section>

      {running && (
        <div className="v2-sticky" role="group" aria-label="Commandes de la sortie" data-testid="activity-controls">
          <button
            className={`btn ${paused ? 'btn-gold' : 'btn-outline'}`}
            onClick={togglePause}
            data-testid="activity-pause-button"
          >
            {paused ? '▶ Reprendre' : '⏸ Pause'}
          </button>
          <button className="btn btn-danger" onClick={stop} data-testid="activity-stop-button">
            ■ Terminer et enregistrer
          </button>
        </div>
      )}
    </div>
  );
}

const V2_STYLES = `
.v2-act{--v2-line:color-mix(in srgb,currentColor 14%,transparent);max-width:720px;width:100%;margin-inline:auto}
.v2-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.v2-act :focus-visible{outline:2px solid var(--gold,#D8CA82);outline-offset:2px}
.v2-act .btn,.v2-act .chip,.v2-act .text-button,.v2-act .activity-types button,.v2-act .goal-input{min-height:44px}
.v2-act .chip{display:inline-flex;align-items:center;justify-content:center;white-space:nowrap}
.v2-act .v2-panel{display:flex;flex-direction:column;gap:14px}
.v2-act .v2-panel>*{margin-top:0;margin-bottom:0}
.v2-live{padding:4px 2px;transition:opacity .2s ease}
.v2-live-paused{opacity:.6}
.v2-hero{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.v2-hero strong{display:block;font-size:clamp(2.1rem,10.5vw,3.4rem);line-height:1.05;font-weight:800;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.v2-hero span,.v2-grid4 span{display:block;margin-top:4px;font-size:.78rem;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
.v2-grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:14px;padding-top:14px;border-top:1px solid var(--v2-line)}
.v2-grid4 strong{display:block;font-size:1.25rem;line-height:1.2;font-variant-numeric:tabular-nums}
.v2-act .v2-status{display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;font-size:.9rem}
.v2-act .v2-status .chip{margin-left:auto}
.v2-banner{display:flex;align-items:flex-start;gap:10px;margin:0;padding:12px 14px;border:1px solid var(--v2-line);border-radius:12px;background:var(--surface-2);font-size:.92rem;line-height:1.4}
.v2-banner-warn{border-color:#e8837a}
.v2-banner-ok{border-color:var(--gold,#D8CA82)}
.v2-act .v2-scroll-row{flex-wrap:nowrap;overflow-x:auto;padding-bottom:4px;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.v2-act .v2-scroll-row::-webkit-scrollbar{display:none}
.v2-act .v2-scroll-row>*{flex:none}
.v2-act .v2-start{width:100%;min-height:56px;font-size:1.05rem}
.v2-act .v2-privacy{font-size:.8rem;line-height:1.45;color:var(--muted)}
.v2-act .v2-history{margin-top:20px}
.v2-section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
.v2-section-head .card-title{margin:0}
.v2-badge{flex:none;padding:4px 10px;border:1px solid var(--gold,#D8CA82);border-radius:999px;font-size:.78rem;color:var(--gold,#D8CA82)}
.v2-act .v2-search{margin-bottom:10px}
.v2-filter-scroll{display:flex;align-items:center;gap:8px;margin-inline:-2px;padding:4px 2px 8px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.v2-filter-scroll::-webkit-scrollbar{display:none}
.v2-filter-group{display:flex;flex:none;gap:8px}
.v2-filter-scroll .chip{flex:none}
.v2-sep{flex:none;width:1px;height:24px;background:var(--v2-line)}
.v2-skel{display:block;border-radius:10px;background:var(--v2-line);animation:v2-pulse 1.2s ease-in-out infinite}
.v2-skel-list{margin-top:8px}
.v2-skel-row{display:flex;align-items:center;gap:12px;min-height:64px}
.v2-skel-icon{flex:none;width:36px;height:36px;border-radius:50%}
.v2-skel-lines{display:flex;flex:1;flex-direction:column;gap:8px}
.v2-skel-line{height:12px}
.v2-skel-metric{flex:none;width:56px;height:28px}
.v2-act .v2-empty{display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center}
.v2-act .v2-empty p{margin:0}
.v2-act .v2-row{display:flex;align-items:center;gap:12px;width:100%;min-height:64px;text-align:left}
.v2-act .v2-row .row-main{flex:1;min-width:0}
.v2-act .v2-row .row-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.v2-row-metrics{display:flex;flex:none;flex-direction:column;align-items:flex-end;font-variant-numeric:tabular-nums}
.v2-row-metrics strong{font-size:1rem}
.v2-row-metrics span{font-size:.8rem;color:var(--muted)}
.v2-act .v2-full{width:100%;margin-top:10px}
.v2-act .v2-result-count{margin:10px 0 0}
.v2-act .v2-history-link{display:block;margin-top:8px}
.v2-act .v2-gpx{display:flex;flex-direction:column;gap:8px;margin-top:20px;padding-top:16px;border-top:1px solid var(--v2-line)}
.v2-act .v2-gpx>*{margin-top:0;margin-bottom:0}
.v2-spin{display:inline-block;width:14px;height:14px;margin-right:8px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;vertical-align:-2px;animation:v2-rotate .7s linear infinite}
.v2-sticky{position:sticky;bottom:var(--v2-bottom-offset,0px);z-index:1100;display:grid;grid-template-columns:1fr 1.4fr;gap:10px;margin-top:16px;padding:10px 12px calc(10px + env(safe-area-inset-bottom,0px));padding-left:calc(12px + env(safe-area-inset-left,0px));padding-right:calc(12px + env(safe-area-inset-right,0px));border-top:1px solid var(--v2-line);background:var(--surface-2)}
.v2-act .v2-sticky .btn{width:100%;min-height:56px;margin:0;font-size:1rem}
@keyframes v2-pulse{50%{opacity:.45}}
@keyframes v2-rotate{to{transform:rotate(360deg)}}
@media (max-width:360px){.v2-grid4{grid-template-columns:repeat(2,1fr)}.v2-sticky{grid-template-columns:1fr 1fr}}
@media (prefers-reduced-motion:reduce){.v2-skel,.v2-spin{animation:none}.v2-live{transition:none}}
`;
