import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import Sheet from '../components/Sheet';
import {
  getActivitySession,
  deleteActivitySession,
  setActivityVisibility,
  sendDirectMessage,
  updateActivityMetadata,
} from '../lib/db';
import { shareActivity } from '../lib/share';
import { exportActivitiesCsv, exportActivityGpx } from '../lib/export';
import type { ActivitySession, ActivityWeather } from '../lib/types';
import { fmtNumber, formatDistance } from '../lib/coins';
import {
  MAP_STYLES,
  MAP_STYLE_KEY,
  WEATHER_OPTIONS,
  activityTypeLabel,
  elevationGainM,
  fmtDuration,
  mapStyleLabel,
  paceMinPerKm,
  speedKmh,
  weatherLabel,
  type MapStyle,
} from '../lib/activity';

export default function ActivityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const drawnRef = useRef(false);
  const [session, setSession] = useState<ActivitySession | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [visibility, setVisibility] = useState<'private' | 'friends' | 'link'>('private');

  // Édition : titre, note, météo ressentie
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftNote, setDraftNote] = useState('');
  const [draftWeather, setDraftWeather] = useState<ActivityWeather | null>(null);

  // Style de carte de l'image partagée (préférence mémorisée)
  const [mapStyle, setMapStyle] = useState<MapStyle>(() => {
    const stored = localStorage.getItem(MAP_STYLE_KEY);
    return stored === 'dark' || stored === 'satellite' || stored === 'voyager' ? stored : 'voyager';
  });

  const isOwner = !!profile && !!session && session.uid === profile.uid;

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getActivitySession(id).then((s) => {
      setSession(s);
      if (s) setVisibility((s.visibility as 'private' | 'friends' | 'link') || 'private');
    }).catch(() => setSession(null)).finally(() => setLoading(false));
  }, [id]);

  // Init carte
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; drawnRef.current = false; };
  }, []);

  // Tracé du parcours
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !session || drawnRef.current) return;
    const pts = session.points || [];
    if (pts.length > 0) {
      if (pts.length > 1) {
        L.polyline(pts.map((p) => [p.lat, p.lng] as [number, number]), { color: '#D8CA82', weight: 5, opacity: 0.9 }).addTo(map);
      }
      L.circleMarker([pts[0].lat, pts[0].lng], { radius: 8, color: '#111', fillColor: '#5bd46f', fillOpacity: 1, weight: 3 }).addTo(map);
      if (pts.length > 1) {
        L.circleMarker([pts[pts.length - 1].lat, pts[pts.length - 1].lng], { radius: 8, color: '#111', fillColor: '#D8CA82', fillOpacity: 1, weight: 3 }).addTo(map);
      }
      map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng] as [number, number])).pad(0.2), { maxZoom: 17 });
    } else {
      map.setView([46.6, 2.4], 5);
    }
    setTimeout(() => map.invalidateSize(), 120);
    drawnRef.current = true;
  }, [session]);

  const onShare = async () => {
    if (!profile || !session) return;
    setBusy(true);
    try {
      const result = await shareActivity(session, profile, profile.strideLengthCm || 75, { mapStyle });
      toast(result === 'shared' ? 'Sortie partagée !' : 'Carte enregistrée dans vos téléchargements.', 'success');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const onExportGpx = async () => {
    if (!session) return;
    setBusy(true);
    try {
      const result = await exportActivityGpx(session);
      toast(result === 'shared' ? 'Fichier GPX prêt à importer (Strava, Garmin…).' : 'GPX enregistré dans vos téléchargements.', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const onExportCsv = async () => {
    if (!session) return;
    setBusy(true);
    try {
      const result = await exportActivitiesCsv([session]);
      toast(result === 'shared' ? 'CSV partagé.' : 'CSV enregistré dans vos téléchargements.', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const openEdit = () => {
    if (!session) return;
    setDraftTitle(session.title || '');
    setDraftNote(session.note || '');
    setDraftWeather(session.weather || null);
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!profile || !session?.id) return;
    setBusy(true);
    try {
      await updateActivityMetadata(profile.uid, session.id, {
        title: draftTitle,
        note: draftNote,
        weather: draftWeather,
      });
      setSession((s) => s ? {
        ...s,
        title: draftTitle.trim() || undefined,
        note: draftNote.trim() || undefined,
        weather: draftWeather || undefined,
      } : s);
      setEditing(false);
      toast('Sortie mise à jour.', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!profile || !session?.id) return;
    if (!confirm('Supprimer cette sortie et son tracé GPS ? Cette action est définitive.')) return;
    setBusy(true);
    try {
      await deleteActivitySession(profile.uid, session.id);
      toast('Sortie et tracé GPS supprimés.', 'success');
      navigate('/activity');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const onVisibilityChange = async (v: 'private' | 'friends' | 'link') => {
    if (!profile || !session?.id) return;
    setBusy(true);
    try {
      await setActivityVisibility(profile.uid, session.id, v);
      setVisibility(v);
      setSession((s) => s ? { ...s, visibility: v } : s);
      toast(v === 'private' ? 'Sortie privée' : v === 'friends' ? 'Partagée avec vos amis !' : 'Lien activable (amis)', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const onReactOnActivity = async (emoji: string) => {
    if (!profile || !session) return;
    const targetUid = session.uid;
    if (targetUid === profile.uid) {
      toast('Vous ne pouvez pas réagir à votre propre sortie', 'info');
      return;
    }
    const text = `Réaction ${emoji} sur sortie du ${new Date(session.startedAt).toLocaleDateString('fr-FR')}`;
    try {
      await sendDirectMessage(profile, targetUid, `${emoji} ${text}`, session.id);
      toast('Réaction envoyée !', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const chooseMapStyle = (style: MapStyle) => {
    setMapStyle(style);
    try { localStorage.setItem(MAP_STYLE_KEY, style); } catch { /* ignore */ }
  };

  if (loading) return <div className="screen"><div className="spinner" style={{ margin: '40px auto' }} /></div>;
  if (!session) {
    return (
      <div className="screen" data-testid="activity-detail-screen">
        <div className="screen-header"><div><h1 className="screen-title">Sortie introuvable</h1></div></div>
        <p className="empty-state">Cette sortie n’existe plus ou ne vous appartient pas.</p>
        <button className="btn btn-ghost" onClick={() => navigate('/activity')}>← Retour aux sorties</button>
      </div>
    );
  }

  const strideCm = profile?.strideLengthCm || 75;
  const steps = (typeof session.steps === 'number' && session.steps > 0)
    ? session.steps
    : Math.round((session.distanceM || 0) / (strideCm / 100));
  const unitSystem = profile?.unitSystem || profile?.health?.unitSystem || 'metric';
  const date = new Date(session.startedAt).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const time = new Date(session.startedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const gain = elevationGainM(session.points || []);
  const weather = weatherLabel(session.weather);
  const heading = session.title?.trim() || (session.type === 'run' ? '🏃 Course' : '🚶 Marche');
  const selectedStyle = MAP_STYLES.find((s) => s.id === mapStyle);

  return (
    <div className="screen activity-detail-screen" data-testid="activity-detail-screen">
      <div className="screen-header">
        <div>
          <h1 className="screen-title">{heading}</h1>
          <div className="screen-sub">
            {activityTypeLabel(session.type)} · {date} · {time}{weather ? ` · ${weather}` : ''}
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}>Retour</button>
      </div>
      <div className="activity-map" ref={containerRef} data-testid="activity-detail-map" style={{ height: 'min(46vh, 440px)', borderRadius: 16, margin: '0 12px' }} />
      <div className="card" style={{ margin: '12px' }}>
        <div className="activity-stats">
          <div><strong>{formatDistance(session.distanceM || 0, unitSystem)}</strong><span>distance</span></div>
          <div><strong>{fmtDuration(session.durationSec || 0)}</strong><span>durée active</span></div>
          <div><strong>{fmtNumber(steps)}</strong><span>pas</span></div>
          <div><strong>{session.calories || 0}</strong><span>kcal</span></div>
          <div><strong>{speedKmh(session.distanceM || 0, session.durationSec || 0).toFixed(1)}</strong><span>vitesse moy. (km/h)</span></div>
          <div><strong>{paceMinPerKm(session.distanceM || 0, session.durationSec || 0)}</strong><span>allure</span></div>
        </div>
        <div className="row-sub" style={{ marginTop: 6 }}>
          {(session.points || []).length} points GPS enregistrés{gain > 0 ? ` · D+ ${gain} m` : ''}
        </div>
        {session.pausedSec && session.pausedSec >= 30 ? (
          <div className="row-sub" style={{ marginTop: 4 }}>
            ⏸ {fmtDuration(session.pausedSec)} de pause exclus de l’allure
          </div>
        ) : null}

        {isOwner && (
          <button className="btn btn-outline btn-sm" style={{ marginTop: 10 }} onClick={openEdit} disabled={busy}>
            ✏️ {session.title || session.note || session.weather ? 'Modifier titre, note et météo' : 'Renommer et annoter cette sortie'}
          </button>
        )}
        {session.note && <p className="activity-note">📝 {session.note}</p>}

        <div className="card" style={{ marginTop: 12, background: 'var(--surface-2)' }}>
          <div className="card-title">Visibilité</div>
          <div className="chip-row">
            <button className={`chip ${visibility === 'private' ? 'chip-active' : ''}`} onClick={() => onVisibilityChange('private')} disabled={!isOwner}>🔒 Moi seul</button>
            <button className={`chip ${visibility === 'friends' ? 'chip-active' : ''}`} onClick={() => onVisibilityChange('friends')} disabled={!isOwner}>👥 Amis</button>
            <button className={`chip ${visibility === 'link' ? 'chip-active' : ''}`} onClick={() => onVisibilityChange('link')} disabled={!isOwner}>🔗 Lien</button>
          </div>
          <small style={{ color: 'var(--muted)', fontSize: 11 }}>
            {visibility === 'private' && 'Seul vous voyez cette sortie.'}
            {visibility === 'friends' && 'Vos amis peuvent voir cette sortie dans l’app.'}
            {visibility === 'link' && 'Visible via lien — amis uniquement pour l’instant.'}
          </small>
          {!isOwner && <small style={{ color: 'var(--gold)', display: 'block', marginTop: 6 }}>Sortie de {session.uid === profile?.uid ? 'vous' : 'un ami'} · visibilité : {visibility}</small>}
        </div>

        {!isOwner && (
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn btn-outline btn-sm" style={{ flex: 1 }} onClick={() => onReactOnActivity('👏')}>👏 Bravo</button>
            <button className="btn btn-outline btn-sm" style={{ flex: 1 }} onClick={() => onReactOnActivity('🔥')}>🔥</button>
            <button className="btn btn-outline btn-sm" style={{ flex: 1 }} onClick={() => onReactOnActivity('💛')}>💛</button>
          </div>
        )}

        <div className="share-style-block" data-testid="map-style-picker">
          <div className="card-title">Style de la carte partagée</div>
          <div className="chip-row">
            {MAP_STYLES.map((style) => (
              <button
                key={style.id}
                type="button"
                className={`chip ${mapStyle === style.id ? 'chip-active' : ''}`}
                onClick={() => chooseMapStyle(style.id)}
                title={style.description}
                aria-pressed={mapStyle === style.id}
              >
                {style.icon} {style.label}
              </button>
            ))}
          </div>
          <small className="share-style-hint">{selectedStyle?.description}</small>
        </div>

        <button className="btn btn-gold" style={{ marginTop: 12, width: '100%' }} onClick={onShare} disabled={busy}>
          {busy ? 'Préparation…' : `📤 Partager cette sortie (${mapStyleLabel(mapStyle)})`}
        </button>

        <div className="activity-export-row">
          <button className="btn btn-outline" onClick={onExportGpx} disabled={busy}>🧭 Export GPX</button>
          <button className="btn btn-outline" onClick={onExportCsv} disabled={busy}>📄 Export CSV</button>
        </div>
        <small className="activity-export-hint">
          Le GPX s’importe dans Strava, Garmin, Google Earth ; le CSV s’ouvre dans un tableur.
        </small>

        <button className="btn btn-outline" style={{ marginTop: 8, width: '100%' }} onClick={() => navigate('/activity')}>Voir toutes mes sorties</button>
        {isOwner && <button className="btn btn-danger" style={{ marginTop: 8, width: '100%' }} onClick={onDelete} disabled={busy}>🗑 Supprimer cette sortie et son tracé GPS</button>}
      </div>

      <Sheet open={editing} onClose={() => setEditing(false)} title="Renommer et annoter" testId="activity-edit-sheet">
        <div className="field">
          <label htmlFor="activity-title">Titre</label>
          <input
            id="activity-title"
            className="input"
            maxLength={80}
            value={draftTitle}
            placeholder="ex. Balade au bord de l’Authie"
            onChange={(e) => setDraftTitle(e.target.value)}
          />
          <small className="field-help">80 caractères max — ce titre apparaît aussi sur l’image partagée.</small>
        </div>
        <div className="field">
          <label htmlFor="activity-weather">Météo ressentie</label>
          <div className="chip-row" id="activity-weather">
            {WEATHER_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`chip ${draftWeather === option.id ? 'chip-active' : ''}`}
                onClick={() => setDraftWeather(draftWeather === option.id ? null : option.id)}
              >
                {option.icon} {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="activity-note">Note</label>
          <textarea
            id="activity-note"
            className="input"
            maxLength={500}
            value={draftNote}
            placeholder="Sensations, météo, compagnie, souvenir…"
            onChange={(e) => setDraftNote(e.target.value)}
          />
          <small className="field-help">{draftNote.length}/500 caractères · note privée.</small>
        </div>
        <button className="btn btn-gold" onClick={saveEdit} disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
      </Sheet>
    </div>
  );
}
