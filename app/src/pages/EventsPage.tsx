import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { useI18n } from '../context/LocaleContext';
import Sheet from '../components/Sheet';
import Avatar from '../components/Avatar';
import DirectionsPanel from '../components/DirectionsPanel';
import { getCurrentPosition } from '../lib/geo';
import { createCommunityEvent, watchCommunityEvents, joinCommunityEvent, leaveCommunityEvent, updateCommunityEvent, getProfiles } from '../lib/db';
import { listEstablishments, type Establishment } from '../lib/establishments';
import { eventDate, getEventReminder, rescheduleEventReminders, setEventReminder } from '../lib/eventReminders';
import type { CommunityEvent, UserProfile } from '../lib/types';

/**
 * Date du jour au format `YYYY-MM-DD` **en heure locale**.
 * `toISOString()` renvoie la date UTC : à Paris, une création d'événement après
 * minuit (ou le matin en heure d'été avancée) pouvait proposer la veille
 * (audit § 2.6).
 */
function todayLocalInput(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Fuseau de l'appareil, affiché à côté de l'heure pour lever toute ambiguïté. */
const LOCAL_TIME_ZONE = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
})();

export default function EventsPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const { formatDate } = useI18n();
  const nav = useNavigate();
  const [events, setEvents] = useState<CommunityEvent[]>([]);
  const [establishments, setEstablishments] = useState<Establishment[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CommunityEvent | null>(null);
  const [title, setTitle] = useState(''); const [desc, setDesc] = useState('');
  const [date, setDate] = useState(todayLocalInput()); const [time, setTime] = useState('10:00');
  const [estId, setEstId] = useState(''); const [address, setAddress] = useState(''); const [capacity, setCapacity] = useState('');
  const [busy, setBusy] = useState(false);
  const [participants, setParticipants] = useState<UserProfile[]>([]);
  const [participantEvent, setParticipantEvent] = useState<CommunityEvent | null>(null);
  const [reminderEvent, setReminderEvent] = useState<CommunityEvent | null>(null);
  const [reminderEnabled, setReminderEnabled] = useState(false); const [reminderMinutes, setReminderMinutes] = useState(60);
  // Itinéraire calculé dans l'application (adresse + 4 modes), sans redirection Maps.
  const [directionsEvent, setDirectionsEvent] = useState<CommunityEvent | null>(null);
  const [directionsOrigin, setDirectionsOrigin] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => watchCommunityEvents(items => { setEvents(items); void rescheduleEventReminders(items); }), []);
  useEffect(() => { listEstablishments().then(setEstablishments).catch(() => undefined); }, []);

  const reset = () => { setTitle(''); setDesc(''); setAddress(''); setCapacity(''); setEstId(''); setEditing(null); setDate(todayLocalInput()); };
  const openEdit = (ev: CommunityEvent) => { setEditing(ev); setTitle(ev.title); setDesc(ev.description); setAddress(ev.location || ''); setCapacity(ev.maxParticipants?.toString() || ''); setDate(ev.date); setTime(ev.time || '10:00'); setOpen(true); };
  const submit = async () => {
    if (!profile) return;
    if (!title.trim() || !date || !time) { toast('Titre, date et heure sont requis.', 'error'); return; }
    // Date et heure sont saisies en heure locale (aucun passage par UTC) :
    // une sortie ne peut pas être créée dans le passé (audit § 2.6).
    const startsAt = new Date(`${date}T${time}`);
    if (Number.isNaN(startsAt.getTime())) { toast('Date ou heure invalide.', 'error'); return; }
    const dateChanged = !editing || editing.date !== date || (editing.time || '') !== time;
    if (dateChanged && startsAt.getTime() < Date.now() - 60 * 1000) {
      toast('Choisissez une date et une heure à venir.', 'error');
      return;
    }
    const max = capacity ? Number(capacity) : null;
    if (max != null && (!Number.isInteger(max) || max < 2 || max > 500)) { toast('La capacité doit être comprise entre 2 et 500.', 'error'); return; }
    setBusy(true);
    try {
      const est = establishments.find(e => e.id === estId);
      if (editing) await updateCommunityEvent(profile.uid, editing.id!, { title: title.trim(), description: desc.trim(), location: address.trim() || est?.address, date, time, message: 'La date, l’heure ou le lieu de la sortie a été modifié.' });
      else await createCommunityEvent(profile, { title: title.trim(), description: desc.trim() || 'Sortie communautaire ElyWalk', establishmentId: est?.id, establishmentName: est?.name, location: address.trim() || est?.address, lat: est?.lat, lng: est?.lng, date, time, maxParticipants: max });
      toast(editing ? 'Événement modifié, participants prévenus.' : 'Événement créé !', 'success'); setOpen(false); reset();
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };
  const toggleJoin = async (ev: CommunityEvent) => {
    if (!profile) return;
    const joined = ev.participants.includes(profile.uid) || (ev.waitlist || []).includes(profile.uid);
    try { if (joined) { await leaveCommunityEvent(profile.uid, ev.id!); toast('Désinscrit', 'success'); } else { const result = await joinCommunityEvent(profile.uid, ev.id!); toast(result === 'joined' ? 'Inscrit !' : 'Ajouté à la liste d’attente.', 'success'); } }
    catch (e) { toast((e as Error).message, 'error'); }
  };
  const cancel = async (ev: CommunityEvent) => { if (!profile || !confirm('Annuler cette sortie et prévenir tous les inscrits ?')) return; try { await updateCommunityEvent(profile.uid, ev.id!, { status: 'cancelled', message: 'L’organisateur a annulé cette sortie.' }); toast('Sortie annulée, participants prévenus.', 'success'); } catch (e) { toast((e as Error).message, 'error'); } };
  const showParticipants = async (ev: CommunityEvent) => { setParticipantEvent(ev); setParticipants(await getProfiles([...ev.participants, ...(ev.waitlist || [])])); };
  const openReminder = async (ev: CommunityEvent) => { const setting = await getEventReminder(ev.id!); setReminderEnabled(setting.enabled); setReminderMinutes(setting.minutes); setReminderEvent(ev); };
  const saveReminder = async () => { if (!reminderEvent) return; try { await setEventReminder(reminderEvent, reminderEnabled, reminderMinutes); toast(reminderEnabled ? 'Rappel programmé.' : 'Rappel désactivé.', 'success'); setReminderEvent(null); } catch (e) { toast((e as Error).message, 'error'); } };
  const openDirections = (ev: CommunityEvent) => setDirectionsEvent(ev);
  /** Localisation demandée depuis la feuille d'itinéraire (Silent en cas de refus). */
  const locateForDirections = async () => {
    try {
      const pos = await getCurrentPosition({ silent: false });
      if (pos) setDirectionsOrigin({ lat: pos.lat, lng: pos.lng });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return <div className="screen" data-testid="events-screen">
    <div className="screen-header"><div><h1 className="screen-title">Rencontres</h1><div className="screen-sub">Marcher ensemble · établissements partenaires</div></div><button className="btn btn-ghost btn-sm" onClick={() => nav(-1)}>Retour</button></div>
    <div className="card"><div className="card-title">Sorties communautaires Elysium</div><p className="card-help">Organisez ou rejoignez une marche. Les rappels sont facultatifs et les inscrits sont prévenus des changements.</p><button className="btn btn-gold" onClick={() => { reset(); setOpen(true); }}>+ Proposer une sortie</button></div>
    {events.length === 0 ? <div className="card empty-state"><div className="display">Aucun événement</div>Soyez le premier à proposer une marche ensemble !</div> : events.map(ev => {
      const mine = profile?.uid === ev.creatorUid; const joined = !!profile && ev.participants.includes(profile.uid); const waiting = !!profile && (ev.waitlist || []).includes(profile.uid); const full = !!ev.maxParticipants && ev.participants.length >= ev.maxParticipants;
      return <div key={ev.id} className={`card ${ev.status === 'cancelled' ? 'event-cancelled' : ''}`} data-testid="event-card">
        <div className="row-between"><div><div className="title-sm">{ev.title}</div><div className="row-sub">📅 {formatDate(eventDate(ev), { dateStyle: 'full', timeStyle: 'short' })}</div><div className="row-sub">📍 {ev.location || ev.establishmentName || 'Lieu à préciser'}</div></div><button className="badge" onClick={() => void showParticipants(ev)}>{ev.participants.length}{ev.maxParticipants ? ` / ${ev.maxParticipants}` : ''} inscrits</button></div>
        {ev.status === 'cancelled' && <span className="badge badge-danger">Annulé</span>}{full && ev.status !== 'cancelled' && <span className="badge">Complet · {(ev.waitlist || []).length} en attente</span>}
        <p className="muted-text">{ev.description}</p>{ev.lastChange && <p className="event-change">{ev.lastChange.type === 'cancelled' ? '⛔' : '🔔'} {ev.lastChange.message}</p>}
        <div className="route-actions">{(joined || waiting) && ev.status !== 'cancelled' && <button className="btn btn-danger btn-sm" onClick={() => void toggleJoin(ev)}>Se désinscrire{waiting ? ' de l’attente' : ''}</button>}{!joined && !waiting && ev.status !== 'cancelled' && !mine && <button className="btn btn-gold btn-sm" onClick={() => void toggleJoin(ev)}>{full ? 'Rejoindre la liste d’attente' : 'Rejoindre'}</button>}
        {mine && ev.status !== 'cancelled' && <span className="badge badge-muted">Vous organisez cette sortie</span>}{(joined || mine) && ev.status !== 'cancelled' && <button className="btn btn-outline btn-sm" onClick={() => void openReminder(ev)}>🔔 Rappel</button>}<button className="btn btn-outline btn-sm" onClick={() => openDirections(ev)} data-testid="event-directions">Itinéraire</button>{mine && ev.status !== 'cancelled' && <><button className="btn btn-ghost btn-sm" onClick={() => openEdit(ev)}>Modifier</button><button className="btn btn-danger btn-sm" onClick={() => void cancel(ev)}>Annuler</button></>}</div>
        <small className="muted-xs" style={{ display: 'block', marginTop: 'var(--space-1)' }}>Créé par {ev.creatorName}</small>
      </div>;
    })}
    <Sheet open={open} onClose={() => setOpen(false)} title={editing ? 'Modifier la sortie' : 'Nouvel événement'}>
      <div className="field"><label>Titre</label><input className="input" value={title} onChange={e => setTitle(e.target.value)} maxLength={80} /></div><div className="field"><label>Description</label><textarea className="input" value={desc} onChange={e => setDesc(e.target.value)} maxLength={600} rows={3} /></div><div className="two-col"><div className="field"><label>Date</label><input className="input" type="date" value={date} min={todayLocalInput()} onChange={e => setDate(e.target.value)} /></div><div className="field"><label>Heure locale</label><input className="input" type="time" value={time} onChange={e => setTime(e.target.value)} /></div></div>
      <small className="field-help">Heure du fuseau de votre appareil{LOCAL_TIME_ZONE ? ` (${LOCAL_TIME_ZONE})` : ''} — la date et l’heure s’affichent ensuite selon la langue choisie.</small>
      {!editing && <div className="field"><label>Établissement partenaire (optionnel)</label><select className="input" value={estId} onChange={e => setEstId(e.target.value)}><option value="">Aucun — lieu libre</option>{establishments.map(est => <option key={est.id} value={est.id}>{est.name}</option>)}</select></div>}
      <div className="field"><label>Adresse / point de rendez-vous</label><input className="input" value={address} onChange={e => setAddress(e.target.value)} maxLength={200} placeholder="Ex. Entrée principale du parc" /></div>{!editing && <div className="field"><label>Capacité maximale (vide = illimitée)</label><input className="input" type="number" min={2} max={500} value={capacity} onChange={e => setCapacity(e.target.value)} placeholder="Ex. 20" /></div>}
      <button className="btn btn-gold" onClick={submit} disabled={busy}>{busy ? 'Enregistrement…' : editing ? 'Enregistrer et prévenir' : 'Créer'}</button>
    </Sheet>
    <Sheet open={!!participantEvent} onClose={() => setParticipantEvent(null)} title="Participants"><p className="card-help">{participantEvent?.participants.length} inscrits · {(participantEvent?.waitlist || []).length} en liste d’attente</p>{participants.map(p => <div className="list-row" key={p.uid}><Avatar name={p.displayName} photoURL={p.photoURL} size={38} /><div className="row-main"><div className="row-title">{p.displayName}</div><div className="row-sub">{participantEvent?.participants.includes(p.uid) ? 'Inscrit' : 'Liste d’attente'}</div></div></div>)}</Sheet>
    <DirectionsPanel
      open={!!directionsEvent}
      onClose={() => setDirectionsEvent(null)}
      destination={
        directionsEvent
          ? {
              name: directionsEvent.title,
              address: directionsEvent.location || directionsEvent.establishmentName || null,
              lat: directionsEvent.lat ?? null,
              lng: directionsEvent.lng ?? null,
            }
          : null
      }
      origin={directionsOrigin}
      onLocate={locateForDirections}
    />
    <Sheet open={!!reminderEvent} onClose={() => setReminderEvent(null)} title="Rappel avant le départ"><label className="check-row"><input type="checkbox" checked={reminderEnabled} onChange={e => setReminderEnabled(e.target.checked)} /> Recevoir une notification sur cet appareil</label><div className="field"><label>Délai avant le départ</label><select className="input" value={reminderMinutes} onChange={e => setReminderMinutes(Number(e.target.value))}><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={60}>1 heure</option><option value={120}>2 heures</option><option value={1440}>La veille</option></select></div><button className="btn btn-gold" onClick={saveReminder}>Enregistrer le rappel</button></Sheet>
  </div>;
}
