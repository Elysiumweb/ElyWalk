import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { useI18n } from '../context/LocaleContext';
import Sheet from '../components/Sheet';
import { listRoutes, parseGpx, saveRoute, duplicateRoute, deleteRoute, routeToGpx, updateRouteVisibility } from '../lib/routes';
import { formatDistance } from '../lib/coins';
import type { SavedRoute } from '../lib/types';

export default function RoutesPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const { t } = useI18n();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [routes, setRoutes] = useState<SavedRoute[]>([]);
  const [search, setSearch] = useState('');
  const [imported, setImported] = useState<{ name: string; points: import('../lib/types').ActivityPoint[] } | null>(null);
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [busy, setBusy] = useState(false);

  const reload = () => profile && listRoutes(profile.uid).then(setRoutes).catch(e => toast((e as Error).message, 'error'));
  useEffect(() => { void reload(); }, [profile?.uid]);

  const onFile = async (file?: File) => {
    if (!file) return;
    try {
      const parsed = parseGpx(await file.text());
      setImported(parsed); setName(parsed.name);
    } catch (e) { toast((e as Error).message, 'error'); }
    finally { if (fileRef.current) fileRef.current.value = ''; }
  };
  const save = async () => {
    if (!profile || !imported || !name.trim()) return;
    setBusy(true);
    try { await saveRoute(profile, { ...imported, name, visibility }); setImported(null); await reload(); toast('Parcours enregistré.', 'success'); }
    catch (e) { toast((e as Error).message, 'error'); }
    finally { setBusy(false); }
  };
  const download = (route: SavedRoute) => {
    const url = URL.createObjectURL(new Blob([routeToGpx(route)], { type: 'application/gpx+xml' }));
    const a = document.createElement('a'); a.href = url; a.download = `${route.name.replace(/[^a-z0-9_-]+/gi, '-')}.gpx`; a.click(); URL.revokeObjectURL(url);
  };
  const filtered = routes.filter(r => `${r.name} ${r.description} ${r.ownerName}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));

  return <div className="screen" data-testid="routes-screen">
    <div className="screen-header"><div><h1 className="screen-title">{t('routes.title')}</h1><div className="screen-sub">{t('routes.subtitle')}</div></div><button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}>Retour</button></div>
    <div className="card"><div className="card-title">Ajouter un itinéraire</div><p className="card-help">Importez un GPX depuis votre appareil. Le fichier est analysé localement ; aucune position n’est collectée avant de démarrer le suivi.</p><button className="btn btn-gold" onClick={() => fileRef.current?.click()} data-testid="import-gpx">{t('routes.import')}</button><input ref={fileRef} hidden type="file" accept=".gpx,application/gpx+xml" onChange={e => void onFile(e.target.files?.[0])} /></div>
    <div className="field"><input className="input" value={search} onChange={e => setSearch(e.target.value)} placeholder={t('routes.search')} aria-label="Rechercher un parcours" /></div>
    {filtered.length === 0 ? <div className="card empty-state"><div className="display">Aucun parcours</div>Importez une trace GPX pour commencer.</div> : filtered.map(route => <article className="card route-card" key={route.id} data-testid="route-card">
      <RoutePreview route={route} />
      <div className="route-card-head"><div><h2>{route.name}</h2><p>Par {route.ownerName} · {route.visibility === 'public' ? 'Public' : 'Privé'}</p></div><span className="badge">{formatDistance(route.distanceM, 'metric')}</span></div>
      <div className="route-stats"><span>↗ {route.elevationGainM} m D+</span><span>↘ {route.elevationLossM} m D−</span><span>{route.points.length} points</span></div>
      {route.description && <p className="card-help">{route.description}</p>}
      <div className="route-actions"><button className="btn btn-gold btn-sm" onClick={() => navigate('/activity', { state: { routeId: route.id } })}>{t('routes.follow')}</button><button className="btn btn-outline btn-sm" onClick={() => download(route)}>GPX</button>{route.uid !== profile?.uid && profile && <button className="btn btn-outline btn-sm" onClick={() => duplicateRoute(route, profile).then(reload)}>Sauvegarder</button>}{route.uid === profile?.uid && <><button className="btn btn-ghost btn-sm" onClick={() => updateRouteVisibility(profile.uid, route.id!, route.visibility === 'public' ? 'private' : 'public').then(reload)}>{route.visibility === 'public' ? 'Rendre privé' : 'Publier'}</button><button className="btn btn-danger btn-sm" onClick={() => confirm('Supprimer ce parcours ?') && deleteRoute(profile.uid, route.id!).then(reload)}>Supprimer</button></>}</div>
    </article>)}
    <p className="card-help">Cartes © contributeurs OpenStreetMap. Le suivi nécessite votre position uniquement pendant la sortie.</p>
    <Sheet open={!!imported} onClose={() => setImported(null)} title="Enregistrer le parcours"><div className="field"><label>Nom</label><input className="input" value={name} onChange={e => setName(e.target.value)} maxLength={80} /></div><div className="field"><label>Visibilité</label><select className="input" value={visibility} onChange={e => setVisibility(e.target.value as 'private' | 'public')}><option value="private">Privé — moi uniquement</option><option value="public">Public — toute la communauté</option></select></div><button className="btn btn-gold" disabled={busy || !name.trim()} onClick={save}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button></Sheet>
  </div>;
}

function RoutePreview({ route }: { route: SavedRoute }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || route.points.length < 2) return;
    const map = L.map(ref.current, { zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false, boxZoom: false, keyboard: false, attributionControl: false });
    L.control.attribution({ prefix: false }).addAttribution('&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>').addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    const line = L.polyline(route.points.map(p => [p.lat, p.lng] as [number, number]), { color: '#D8CA82', weight: 4 }).addTo(map);
    map.fitBounds(line.getBounds(), { padding: [15, 15] });
    return () => { map.remove(); };
  }, [route.id]);
  return <div className="route-preview" ref={ref} aria-label={`Aperçu cartographique de ${route.name}`} />;
}
