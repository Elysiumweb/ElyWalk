import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { addBaseMap } from '../lib/mapTiles';
import SharedActivityCard from '../components/SharedActivityCard';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import Sheet from '../components/Sheet';
import ReportDialog from '../components/ReportDialog';
import ConfirmSheet from '../components/ConfirmSheet';
import {
  getActivitySession,
  deleteActivitySession,
  setActivityVisibility,
  sendDirectMessage,
  updateActivityMetadata,
  getPrivateActivityNote,
  setPrivateActivityNote,
  createActivityShareLink,
  revokeActivityShareLink,
  listActivityShareLinks,
} from '../lib/db';
import { shareUrlForPath } from '../lib/share';
import type { ShareLink } from '../lib/types';
import { shareActivity } from '../lib/share';
import { exportActivitiesCsv, exportActivityGpx } from '../lib/export';
import { saveRoute } from '../lib/routes';
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
  const busy = busyAction !== null;
  const [visibility, setVisibility] = useState<'private' | 'friends' | 'link'>('private');
  const [reportOpen, setReportOpen] = useState(false);
  // Partage par lien **révocable** : un jeton explicite remplace l'audience
  // « lien » qui n'avait aucun secret (F01).
  const [shareLink, setShareLink] = useState<ShareLink | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [revokedLinkId, setRevokedLinkId] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !profile) return;
    let cancelled = false;
    void listActivityShareLinks(profile.uid, id)
      .then((links) => {
        if (cancelled) return;
        setShareLink(links.find((link) => !link.revoked && (!link.expiresAt || link.expiresAt > Date.now())) || null);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [id, profile?.uid]);

  // Édition : titre, note, météo ressentie
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftCaption, setDraftCaption] = useState('');
  const [draftNote, setDraftNote] = useState('');
  const [draftWeather, setDraftWeather] = useState<ActivityWeather | null>(null);

  // Style de carte de l'image partagée (préférence mémorisée)
  const [mapStyle, setMapStyle] = useState<MapStyle>(() => {
    const stored = localStorage.getItem(MAP_STYLE_KEY);
    return stored === 'dark' || stored === 'satellite' || stored === 'voyager' ? stored : 'voyager';
  });

  const isOwner = !!profile && !!session && session.uid === profile.uid;

  // Note **privée** : lue dans la sous-collection du propriétaire, avec repli
  // sur l'ancien champ `note` du document partagé (migration progressive).
  const [privateNote, setPrivateNote] = useState('');

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    getActivitySession(id).then(async (s) => {
      if (cancelled) return;
      setSession(s);
      if (s) {
        setVisibility((s.visibility as 'private' | 'friends' | 'link') || 'private');
        if (profile && s.uid === profile.uid) {
          setPrivateNote(await getPrivateActivityNote(profile.uid, id, s.note).catch(() => s.note || ''));
        } else if (s.caption) {
          // Les autres lecteurs ne voient que le message partageable.
          setPrivateNote('');
        }
      }
    }).catch((e) => {
      // Une lecture échouée n'est plus confondue avec une sortie inexistante :
      // l'écran distingue « introuvable » d'« erreur, réessayer ».
      if (!cancelled) {
        setSession(null);
        setLoadError((e as Error).message || 'Sortie indisponible pour le moment.');
      }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [id, profile?.uid, reloadToken]);

  /*
    Initialisation de la carte **quand le conteneur et la sortie existent**.

    Avant : un effet `[]` lancé pendant l'écran de chargement, alors que le
    conteneur n'était pas encore monté — la carte n'était jamais créée et il
    restait un grand rectangle vide (aucune classe Leaflet, aucun enfant). Cet
    effet dépend maintenant de l'identifiant de la sortie : il est rejoué après
    l'arrivée des données, nettoyé au changement de sortie, et la taille est
    recalculée au bon moment.
  */
  useEffect(() => {
    if (!session?.id || !containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: false });
    addBaseMap(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    mapRef.current = map;
    drawnRef.current = false;
    // Le conteneur vient d'apparaître (hauteur calculée par le CSS) : on
    // réinvalide la taille pour éviter les tuiles grises.
    const sizeTimer = setTimeout(() => map.invalidateSize(), 120);
    const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => map.invalidateSize()) : null;
    if (resize && containerRef.current) resize.observe(containerRef.current);
    return () => {
      clearTimeout(sizeTimer);
      resize?.disconnect();
      map.remove();
      mapRef.current = null;
      drawnRef.current = false;
    };
  }, [session?.id]);

  // Tracé du parcours (dessiné une seule fois par carte créée).
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
  }, [session, session?.id]);

  const onShare = async () => {
    if (!profile || !session) return;
    setBusyAction('share');
    try {
      const result = await shareActivity(session, profile, profile.strideLengthCm || 75, { mapStyle });
      toast(result === 'shared' ? 'Sortie partagée !' : 'Carte enregistrée dans vos téléchargements.', 'success');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast((e as Error).message, 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const onExportGpx = async () => {
    if (!session) return;
    setBusyAction('gpx');
    try {
      const result = await exportActivityGpx(session);
      toast(result === 'shared' ? 'Fichier GPX prêt à importer (Strava, Garmin…).' : 'GPX enregistré dans vos téléchargements.', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const onSaveRoute = async () => {
    if (!profile || !session || session.points.length < 2) return;
    setBusyAction('route');
    try {
      const step = Math.max(1, Math.ceil(session.points.length / 5000));
      const points = session.points.filter((_, index) => index % step === 0 || index === session.points.length - 1).slice(0, 5000);
      await saveRoute(profile, { name: session.title?.trim() || `Parcours du ${new Date(session.startedAt).toLocaleDateString()}`, description: session.caption?.trim() || '', points, visibility: 'private' });
      toast('Parcours privé enregistré.', 'success'); navigate('/routes');
    } catch (e) { toast((e as Error).message, 'error'); }
    finally { setBusyAction(null); }
  };

  const onExportCsv = async () => {
    if (!session) return;
    setBusyAction('csv');
    try {
      const result = await exportActivitiesCsv([session]);
      toast(result === 'shared' ? 'CSV partagé.' : 'CSV enregistré dans vos téléchargements.', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const openEdit = () => {
    if (!session) return;
    setDraftTitle(session.title || '');
    setDraftCaption(session.caption || '');
    setDraftNote(privateNote);
    setDraftWeather(session.weather || null);
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!profile || !session?.id) return;
    setBusyAction('edit');
    try {
      // Titre, légende et météo sont partageables ; la note reste privée et
      // part dans la sous-collection du propriétaire (F01).
      await updateActivityMetadata(profile.uid, session.id, {
        title: draftTitle,
        caption: draftCaption,
        weather: draftWeather,
      });
      await setPrivateActivityNote(profile.uid, session.id, draftNote);
      setPrivateNote(draftNote.trim());
      setSession((s) => s ? {
        ...s,
        title: draftTitle.trim() || undefined,
        caption: draftCaption.trim() || undefined,
        weather: draftWeather || undefined,
      } : s);
      setEditing(false);
      toast('Sortie mise à jour.', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const [deleteOpen, setDeleteOpen] = useState(false);
  const onDelete = async () => {
    if (!profile || !session?.id) return;
    setBusyAction('delete');
    try {
      await deleteActivitySession(profile.uid, session.id);
      toast('Sortie et tracé GPS supprimés.', 'success');
      setDeleteOpen(false);
      navigate('/activity');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const onVisibilityChange = async (v: 'private' | 'friends' | 'link') => {
    if (!profile || !session?.id) return;
    setBusyAction('visibility');
    try {
      if (v === 'link') {
        // Un lien n'a de sens qu'avec un jeton révocable : on le crée ici.
        const link = await createActivityShareLink(profile.uid, session.id, 'summary');
        setShareLink(link);
      } else if (shareLink?.id) {
        // Repasser en privé ou en amis révoque le lien existant : il ne doit
        // pas continuer à donner accès à la sortie.
        await revokeActivityShareLink(profile.uid, session.id);
        setShareLink(null);
      }
      await setActivityVisibility(profile.uid, session.id, v);
      setVisibility(v);
      setSession((s) => s ? { ...s, visibility: v } : s);
      toast(
        v === 'private'
          ? 'Sortie privée : le lien de partage est révoqué.'
          : v === 'friends'
            ? 'Partagée avec vos amis (amitiés vérifiées).'
            : 'Lien de partage créé.',
        'success'
      );
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const copyShareLink = async () => {
    if (!shareLink) return;
    // A7 — URL publique : la page s'ouvre sans compte et affiche le résumé.
    const url = shareUrlForPath(`/s/${shareLink.sessionId}?t=${shareLink.token}`);
    try {
      await navigator.clipboard.writeText(url);
      toast('Lien copié. Il peut être révoqué à tout moment.', 'success');
    } catch {
      toast(url, 'info');
    }
  };

  const revokeLink = async () => {
    if (!profile || !shareLink?.id) return;
    setLinkBusy(true);
    try {
      if (!session?.id) return;
      await revokeActivityShareLink(profile.uid, session.id);
      setRevokedLinkId(session.id);
      setShareLink(null);
      toast('Lien révoqué : il ne fonctionne plus.', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setLinkBusy(false);
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

  if (loading) {
    return (
      <div className="screen v2-det v2-det-page" data-testid="activity-detail-screen">
        <style>{V2_STYLES}</style>
        <div className="screen-header"><div><h1 className="screen-title">Sortie</h1></div></div>
        <div role="status" aria-live="polite" aria-busy="true" data-testid="activity-detail-loading">
          <div className="v2-skel v2-skel-map" aria-hidden="true" />
          <div className="card v2-card" aria-hidden="true">
            <div className="v2-hero">
              <span className="v2-skel v2-skel-big" />
              <span className="v2-skel v2-skel-big" />
            </div>
            <div className="v2-grid4">
              {[0, 1, 2, 3].map((i) => <span className="v2-skel v2-skel-cell" key={i} />)}
            </div>
          </div>
          <div className="card v2-card" aria-hidden="true">
            <span className="v2-skel v2-skel-line" style={{ width: '45%' }} />
            <span className="v2-skel v2-skel-line" style={{ width: '80%' }} />
            <span className="v2-skel v2-skel-line" style={{ width: '60%' }} />
          </div>
          <div className="row-sub v2-loading-text">Chargement de la sortie et de la carte…</div>
        </div>
      </div>
    );
  }
  if (!session && loadError) {
    return (
      <div className="screen v2-det v2-det-page" data-testid="activity-detail-screen">
        <style>{V2_STYLES}</style>
        <div className="screen-header"><div><h1 className="screen-title">Sortie indisponible</h1></div></div>
        <div className="card v2-card" role="alert" data-testid="activity-detail-error">
          <div className="card-title">La sortie n’a pas pu être chargée</div>
          <p className="muted-text">{loadError}</p>
          <div className="v2-stack">
            <button className="btn btn-gold" onClick={() => setReloadToken((n) => n + 1)} data-testid="activity-detail-retry">
              🔄 Réessayer
            </button>
            <button className="btn btn-ghost" onClick={() => navigate('/activity')} data-testid="activity-detail-error-back">
              ← Mes sorties
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (!session) {
    return (
      <div className="screen v2-det v2-det-page" data-testid="activity-detail-screen">
        <style>{V2_STYLES}</style>
        <div className="screen-header"><div><h1 className="screen-title">Sortie introuvable</h1></div></div>
        <div className="card v2-card" data-testid="activity-detail-not-found">
          <p className="empty-state">Cette sortie n’existe plus ou ne vous appartient pas.</p>
          <div className="v2-stack">
            <button className="btn btn-ghost" onClick={() => navigate('/activity')} data-testid="activity-detail-not-found-back">
              ← Retour aux sorties
            </button>
          </div>
        </div>
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
  const pts = session.points || [];
  const gain = elevationGainM(pts);
  const weather = weatherLabel(session.weather);
  const heading = session.title?.trim() || (session.type === 'run' ? '🏃 Course' : '🚶 Marche');
  const selectedStyle = MAP_STYLES.find((s) => s.id === mapStyle);
  const hasPause = !!session.pausedSec && session.pausedSec >= 30;
  const caption = session.caption?.trim();

  return (
    <div className="screen activity-detail-screen v2-det v2-det-page" data-testid="activity-detail-screen" aria-busy={busy}>
      <style>{V2_STYLES}</style>
      <div className="screen-header">
        <div>
          <h1 className="screen-title" data-testid="activity-detail-title">{heading}</h1>
          <div className="screen-sub" data-testid="activity-detail-subtitle">
            {activityTypeLabel(session.type)} · {date} · {time}{weather ? ` · ${weather}` : ''}
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)} data-testid="activity-detail-back">Retour</button>
      </div>

      {pts.length > 0 ? (
        <div className="activity-detail-map-wrap v2-map-wrap">
          <div
            className="activity-map"
            ref={containerRef}
            role="region"
            aria-label="Carte du tracé"
            data-testid="activity-detail-map"
            style={{ height: 'min(40vh, 400px)', borderRadius: 16 }}
          />
        </div>
      ) : (
        <div className="v2-nomap" role="status" data-testid="activity-detail-map-empty">
          <strong>Aucun tracé enregistré</strong>
          <span>Cette sortie n’a pas de points GPS (GPS indisponible ou sortie manuelle). Les statistiques restent exactes.</span>
        </div>
      )}

      <section className="card v2-card" aria-label="Chiffres clés" data-testid="activity-detail-stats">
        <div className="v2-hero">
          <div>
            <strong data-testid="activity-detail-distance">{formatDistance(session.distanceM || 0, unitSystem)}</strong>
            <span>distance</span>
          </div>
          <div>
            <strong data-testid="activity-detail-duration">{fmtDuration(session.durationSec || 0)}</strong>
            <span>durée active</span>
          </div>
        </div>
        <div className="v2-grid4">
          <div><strong data-testid="activity-detail-steps">{fmtNumber(steps)}</strong><span>pas</span></div>
          <div><strong data-testid="activity-detail-calories">{session.calories || 0}</strong><span>kcal</span></div>
          <div>
            <strong data-testid="activity-detail-speed">{speedKmh(session.distanceM || 0, session.durationSec || 0).toFixed(1)}</strong>
            <span>vitesse moy. (km/h)</span>
          </div>
          <div>
            <strong data-testid="activity-detail-pace">{paceMinPerKm(session.distanceM || 0, session.durationSec || 0)}</strong>
            <span>allure</span>
          </div>
        </div>
        <div className="v2-meta-line" data-testid="activity-detail-meta">
          <span>{pts.length} points GPS enregistrés</span>
          {gain > 0 && <span>D+ {gain} m</span>}
          {hasPause && <span>⏸ {fmtDuration(session.pausedSec || 0)} de pause exclus de l’allure</span>}
        </div>
      </section>

      {!isOwner && (
        <section className="card v2-card" aria-label="Réagir à cette sortie" data-testid="activity-reactions">
          <div className="card-title">Réagir</div>
          <div className="v2-react-row">
            <button className="btn btn-outline" onClick={() => onReactOnActivity('👏')} aria-label="Envoyer un bravo" data-testid="activity-react-clap">👏 Bravo</button>
            <button className="btn btn-outline" onClick={() => onReactOnActivity('🔥')} aria-label="Envoyer une réaction feu" data-testid="activity-react-fire">🔥</button>
            <button className="btn btn-outline" onClick={() => onReactOnActivity('💛')} aria-label="Envoyer une réaction cœur" data-testid="activity-react-heart">💛</button>
          </div>
          <button
            className="text-button v2-report"
            onClick={() => setReportOpen(true)}
            aria-label="Signaler cette sortie"
            data-testid="activity-report-button"
          >
            ⚑ Signaler cette sortie
          </button>
        </section>
      )}

      {isOwner && (
        <section className="card v2-card" aria-label="Titre, légende et note" data-testid="activity-detail-notes">
          <div className="v2-section-head">
            <div className="card-title">Titre, légende et note</div>
          </div>
          <div className="v2-field">
            <span className="v2-label">Titre</span>
            <p data-testid="activity-owner-title">{session.title?.trim() || <span className="v2-placeholder">Aucun titre</span>}</p>
          </div>
          <div className="v2-field v2-field-public">
            <span className="v2-label">💬 Légende publique</span>
            <p data-testid="activity-owner-caption">{caption || <span className="v2-placeholder">Aucune légende</span>}</p>
          </div>
          <div className="v2-field v2-field-private">
            <span className="v2-label">📝 Note privée <small>· visible par vous seul</small></span>
            {privateNote
              ? <p data-testid="activity-private-note">{privateNote}</p>
              : <p><span className="v2-placeholder">Aucune note</span></p>}
          </div>
          <button className="btn btn-outline v2-full" onClick={openEdit} disabled={busy} data-testid="activity-edit-button">
            ✏️ {session.title || session.note || session.weather ? 'Modifier titre, note et météo' : 'Renommer et annoter cette sortie'}
          </button>
        </section>
      )}
      {!isOwner && session.caption && (
        <section className="card v2-card" aria-label="Légende">
          <div className="v2-field v2-field-public">
            <span className="v2-label">💬 Légende</span>
            <p data-testid="activity-caption">{session.caption}</p>
          </div>
        </section>
      )}

      <section className="card v2-card" aria-labelledby="v2-share-title" data-testid="activity-share-block">
        <h2 className="card-title" id="v2-share-title">Partage</h2>

        <span className="v2-label">Visibilité</span>
        <div className="chip-row" role="group" aria-label="Visibilité de la sortie">
          <button className={`chip ${visibility === 'private' ? 'chip-active' : ''}`} aria-pressed={visibility === 'private'} onClick={() => onVisibilityChange('private')} disabled={!isOwner || busy} data-testid="visibility-private">🔒 Moi seul</button>
          <button className={`chip ${visibility === 'friends' ? 'chip-active' : ''}`} aria-pressed={visibility === 'friends'} onClick={() => onVisibilityChange('friends')} disabled={!isOwner || busy} data-testid="visibility-friends">👥 Amis</button>
          <button className={`chip ${visibility === 'link' ? 'chip-active' : ''}`} aria-pressed={visibility === 'link'} onClick={() => onVisibilityChange('link')} disabled={!isOwner || busy} data-testid="visibility-link">🔗 Lien</button>
        </div>
        <p className="v2-help" role="status" data-testid="visibility-help">
          {busyAction === 'visibility' && <span className="v2-spin" aria-hidden="true" />}
          {visibility === 'private' && 'Seul vous voyez cette sortie.'}
          {visibility === 'friends' && 'Vérifié côté serveur : seules vos amitiés enregistrées voient cette sortie.'}
          {visibility === 'link' && 'Accessible uniquement aux personnes qui possèdent le lien, tant qu’il n’est pas révoqué.'}
        </p>
        {!isOwner && (
          <p className="v2-help v2-gold" data-testid="visibility-visitor-info">
            Sortie de {session.uid === profile?.uid ? 'vous' : 'un ami'} · visibilité : {visibility}
          </p>
        )}

        {visibility === 'link' && isOwner && (
          <div className="share-link-block v2-sub" data-testid="share-link-block">
            <span className="v2-label">Lien de partage</span>
            <small className="field-help">
              Le lien porte un jeton propre à cette sortie et n’expose qu’un résumé
              (distance, durée, date) : le tracé GPS reste privé. Le révoquer coupe
              immédiatement l’accès.
            </small>
            <div className="v2-two">
              <button type="button" className="btn btn-outline" onClick={() => void copyShareLink()} disabled={!shareLink} data-testid="copy-share-link">
                Copier le lien
              </button>
              <button type="button" className="btn btn-danger" onClick={() => void revokeLink()} disabled={!shareLink || linkBusy} aria-busy={linkBusy} data-testid="revoke-share-link">
                <BusyLabel active={linkBusy}>Révoquer</BusyLabel>
              </button>
            </div>
            {revokedLinkId && <p className="muted-xs" role="status" data-testid="share-link-revoked">Lien révoqué · les destinataires n’ont plus accès.</p>}
            <small className="field-help">
              Aperçu — ce que voit la personne qui ouvre le lien (sans compte) :
            </small>
            <SharedActivityCard
              compact
              activity={{
                title: session.title || session.routeName || 'Sortie ElyWalk',
                ownerName: profile?.displayName,
                type: session.type,
                startedAt: session.startedAt,
                durationSec: session.durationSec,
                distanceM: session.distanceM,
                calories: session.calories,
                steps: session.steps,
                caption: session.caption,
              }}
            />
          </div>
        )}

        <div className="share-style-block v2-sub" data-testid="map-style-picker">
          <span className="v2-label">Style de la carte partagée</span>
          <div className="chip-row" role="group" aria-label="Style de la carte partagée">
            {MAP_STYLES.map((style) => (
              <button
                key={style.id}
                type="button"
                className={`chip ${mapStyle === style.id ? 'chip-active' : ''}`}
                onClick={() => chooseMapStyle(style.id)}
                title={style.description}
                aria-pressed={mapStyle === style.id}
                data-testid={`map-style-${style.id}`}
              >
                {style.icon} {style.label}
              </button>
            ))}
          </div>
          <small className="share-style-hint">{selectedStyle?.description}</small>
        </div>

        <button className="btn btn-gold v2-full v2-primary" onClick={onShare} disabled={busy} aria-busy={busyAction === 'share'} data-testid="share-activity-button">
          <BusyLabel active={busyAction === 'share'}>
            {busyAction === 'share' ? 'Préparation…' : `📤 Partager cette sortie (${mapStyleLabel(mapStyle)})`}
          </BusyLabel>
        </button>
      </section>

      <section className="card v2-card" aria-label="Autres actions" data-testid="activity-other-actions">
        <div className="card-title">Autres actions</div>
        <div className="v2-actions">
          {isOwner && session.points.length >= 2 && (
            <button className="v2-action" onClick={onSaveRoute} disabled={busy} aria-busy={busyAction === 'route'} data-testid="save-activity-route">
              <span><BusyLabel active={busyAction === 'route'}>Enregistrer comme parcours privé</BusyLabel></span>
              <span aria-hidden="true">›</span>
            </button>
          )}
          <button className="v2-action" onClick={onExportGpx} disabled={busy} aria-busy={busyAction === 'gpx'} data-testid="export-gpx-button">
            <span><BusyLabel active={busyAction === 'gpx'}>🧭 Export GPX</BusyLabel></span>
            <span aria-hidden="true">›</span>
          </button>
          <button className="v2-action" onClick={onExportCsv} disabled={busy} aria-busy={busyAction === 'csv'} data-testid="export-csv-button">
            <span><BusyLabel active={busyAction === 'csv'}>📄 Export CSV</BusyLabel></span>
            <span aria-hidden="true">›</span>
          </button>
          <button className="v2-action" onClick={() => navigate('/activity')} data-testid="all-activities-button">
            <span>Voir toutes mes sorties</span>
            <span aria-hidden="true">›</span>
          </button>
        </div>
        <small className="activity-export-hint">
          Le GPX s’importe dans Strava, Garmin, Google Earth ; le CSV s’ouvre dans un tableur.
        </small>
      </section>

      {isOwner && (
        <section className="v2-danger" aria-label="Suppression de la sortie" data-testid="activity-danger-zone">
          <p>La suppression est définitive. Une confirmation vous sera demandée.</p>
          <button className="btn btn-danger v2-full" onClick={() => setDeleteOpen(true)} disabled={busy} data-testid="delete-activity-button">
            🗑 Supprimer cette sortie et son tracé GPS
          </button>
        </section>
      )}

      <Sheet open={editing} onClose={() => setEditing(false)} title="Renommer et annoter" testId="activity-edit-sheet">
        <div className="v2-det v2-det-sheet">
          <div className="field">
            <label htmlFor="activity-title">Titre</label>
            <input
              id="activity-title"
              className="input"
              maxLength={80}
              value={draftTitle}
              placeholder="ex. Balade au bord de l’Authie"
              onChange={(e) => setDraftTitle(e.target.value)}
              data-testid="activity-edit-title-input"
            />
            <small className="field-help">
              <CharCount value={draftTitle.length} max={80} testId="activity-edit-title-count" /> caractères — ce titre apparaît aussi sur l’image partagée.
            </small>
          </div>
          <div className="field">
            <label htmlFor="activity-weather">Météo ressentie</label>
            <div className="chip-row" id="activity-weather" role="group" aria-label="Météo ressentie">
              {WEATHER_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`chip ${draftWeather === option.id ? 'chip-active' : ''}`}
                  aria-pressed={draftWeather === option.id}
                  onClick={() => setDraftWeather(draftWeather === option.id ? null : option.id)}
                  data-testid={`activity-edit-weather-${option.id}`}
                >
                  {option.icon} {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="activity-caption">Légende publique</label>
            <textarea
              id="activity-caption"
              className="input"
              maxLength={500}
              value={draftCaption}
              placeholder="Un souvenir ou un message à partager avec cette sortie…"
              onChange={(e) => setDraftCaption(e.target.value)}
              data-testid="activity-edit-caption-input"
            />
            <small className="field-help">
              <CharCount value={draftCaption.length} max={500} testId="activity-edit-caption-count" /> caractères · visible par les personnes autorisées à voir la sortie.
            </small>
          </div>
          <div className="field">
            <label htmlFor="activity-note">Note privée</label>
            <textarea
              id="activity-note"
              className="input"
              maxLength={500}
              value={draftNote}
              placeholder="Sensations, météo, compagnie, souvenir…"
              onChange={(e) => setDraftNote(e.target.value)}
              data-testid="activity-edit-note-input"
            />
            <small className="field-help">
              <CharCount value={draftNote.length} max={500} testId="activity-edit-note-count" /> caractères · note <strong>privée</strong> : elle n’est jamais envoyée aux
              personnes avec qui vous partagez cette sortie.
            </small>
          </div>
          <button className="btn btn-gold" onClick={saveEdit} disabled={busy} aria-busy={busyAction === 'edit'} data-testid="activity-edit-save-button">
            <BusyLabel active={busyAction === 'edit'}>{busyAction === 'edit' ? 'Enregistrement…' : 'Enregistrer'}</BusyLabel>
          </button>
        </div>
      </Sheet>
      <ConfirmSheet
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Supprimer cette sortie ?"
        danger
        consequences={[
          'Le tracé GPS et toutes les statistiques de cette sortie sont effacés.',
          'Les encouragements reçus sur cette sortie disparaissent aussi.',
          'Cette action est définitive : aucun retour en arrière n’est possible.',
        ]}
        confirmLabel="Supprimer la sortie"
        busy={busy}
        onConfirm={onDelete}
        testId="delete-activity-sheet"
      />
      <ReportDialog open={reportOpen} onClose={() => setReportOpen(false)} targetUid={session.uid} targetType="activity" targetId={session.id!} />
    </div>
  );
}

type BusyAction = 'share' | 'gpx' | 'route' | 'csv' | 'edit' | 'delete' | 'visibility';

function BusyLabel({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <>
      {active && <span className="v2-spin" aria-hidden="true" />}
      {children}
    </>
  );
}

function CharCount({ value, max, testId }: { value: number; max: number; testId: string }) {
  const ratio = value / max;
  const level = ratio >= 1 ? 'full' : ratio >= 0.9 ? 'near' : 'ok';
  return (
    <span className={`v2-count v2-count-${level}`} aria-live={level === 'ok' ? 'off' : 'polite'} data-testid={testId}>
      {value}/{max}
    </span>
  );
}

const V2_STYLES = `
.v2-det{--v2-line:color-mix(in srgb,currentColor 14%,transparent)}
.v2-det-page{max-width:720px;width:100%;margin-inline:auto;padding-bottom:calc(24px + env(safe-area-inset-bottom,0px))}
.v2-det-sheet{display:contents}
.v2-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.v2-det :focus-visible{outline:2px solid var(--gold,#D8CA82);outline-offset:2px}
.v2-det .btn,.v2-det .chip,.v2-det .text-button{min-height:44px}
.v2-det .chip{display:inline-flex;align-items:center;justify-content:center;white-space:nowrap}
.v2-det .v2-card{margin:12px}
.v2-det h2.card-title{margin-top:0}
.v2-map-wrap{margin:0 12px;border-radius:16px;overflow:hidden}
.v2-nomap{display:flex;flex-direction:column;gap:6px;margin:0 12px;padding:16px;border:1px dashed var(--v2-line);border-radius:16px;background:var(--surface-2)}
.v2-nomap span{font-size:.9rem;line-height:1.4;color:var(--muted)}
.v2-hero{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.v2-hero strong{display:block;font-size:clamp(2rem,10vw,3.2rem);line-height:1.05;font-weight:800;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.v2-hero span,.v2-grid4 span{display:block;margin-top:4px;font-size:.78rem;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
.v2-grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:14px;padding-top:14px;border-top:1px solid var(--v2-line)}
.v2-grid4 strong{display:block;font-size:1.2rem;line-height:1.2;font-variant-numeric:tabular-nums}
.v2-meta-line{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:14px;font-size:.85rem;color:var(--muted)}
.v2-react-row{display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px}
.v2-det .v2-react-row .btn{min-height:48px;margin:0}
.v2-det .v2-report{display:block;margin-top:10px;font-size:.85rem;color:var(--muted)}
.v2-section-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.v2-field{margin-top:12px;padding:10px 12px;border-radius:12px;background:var(--surface-2)}
.v2-field p{margin:4px 0 0;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere}
.v2-field-public{border-left:3px solid var(--gold,#D8CA82)}
.v2-field-private{border:1px dashed var(--v2-line)}
.v2-label{display:block;margin-bottom:6px;font-size:.8rem;font-weight:600;letter-spacing:.03em;color:var(--muted)}
.v2-label small{font-weight:400}
.v2-field .v2-label{margin-bottom:0}
.v2-placeholder{color:var(--muted);font-style:italic}
.v2-det .v2-help{margin:8px 0 0;font-size:.85rem;line-height:1.4;color:var(--muted)}
.v2-det .v2-gold{color:var(--gold,#D8CA82)}
.v2-det .v2-sub{display:flex;flex-direction:column;gap:8px;margin-top:16px;padding-top:16px;border-top:1px solid var(--v2-line)}
.v2-det .v2-sub>*{margin-top:0;margin-bottom:0}
.v2-det .v2-sub .v2-label{margin-bottom:0}
.v2-two{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.v2-det .v2-two .btn{margin:0}
.v2-det .v2-full{width:100%;margin-top:14px}
.v2-det .v2-primary{min-height:52px}
.v2-stack{display:flex;flex-direction:column;gap:8px;margin-top:12px}
.v2-actions{display:flex;flex-direction:column}
.v2-action{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;min-height:52px;padding:8px 2px;border:0;border-bottom:1px solid var(--v2-line);background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.v2-action:last-child{border-bottom:0}
.v2-action:disabled{opacity:.5;cursor:not-allowed}
.v2-det .activity-export-hint{display:block;margin-top:8px}
.v2-danger{margin:24px 12px 12px;padding:14px;border:1px solid #e8837a;border-radius:16px}
.v2-danger p{margin:0;font-size:.85rem;line-height:1.4;color:var(--muted)}
.v2-det .v2-danger .v2-full{margin-top:10px}
.v2-count{font-variant-numeric:tabular-nums}
.v2-count-near{color:var(--gold,#D8CA82);font-weight:600}
.v2-count-full{color:#e8837a;font-weight:700}
.v2-spin{display:inline-block;width:14px;height:14px;margin-right:8px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;vertical-align:-2px;animation:v2-rotate .7s linear infinite}
.v2-skel{display:block;border-radius:12px;background:var(--v2-line);animation:v2-pulse 1.2s ease-in-out infinite}
.v2-skel-map{height:min(40vh,400px);margin:0 12px;border-radius:16px}
.v2-skel-big{height:52px}
.v2-skel-cell{height:40px}
.v2-skel-line{height:14px;margin-bottom:10px}
.v2-det .v2-loading-text{margin:0 12px;text-align:center}
@keyframes v2-pulse{50%{opacity:.45}}
@keyframes v2-rotate{to{transform:rotate(360deg)}}
@media (max-width:360px){.v2-grid4{grid-template-columns:repeat(2,1fr)}}
@media (prefers-reduced-motion:reduce){.v2-skel,.v2-spin{animation:none}}
`;
