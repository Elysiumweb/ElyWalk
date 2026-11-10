import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { useI18n } from '../context/LocaleContext';
import Sheet from '../components/Sheet';
import Avatar from '../components/Avatar';
import { createCommunityEvent, watchCommunityEvents, joinCommunityEvent, leaveCommunityEvent, updateCommunityEvent, getProfiles } from '../lib/db';
import { listEstablishments, type Establishment } from '../lib/establishments';
import { eventDate, getEventReminder, rescheduleEventReminders, setEventReminder } from '../lib/eventReminders';
import type { CommunityEvent, UserProfile } from '../lib/types';

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
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); const [time, setTime] = useState('10:00');
  const [estId, setEstId] = useState(''); const [address, setAddress] = useState(''); const [capacity, setCapacity] = useState('');
  const [busy, setBusy] = useState(false);
  const [participants, setParticipants] = useState<UserProfile[]>([]);
  const [participantEvent, setParticipantEvent] = useState<CommunityEvent | null>(null);
  const [reminderEvent, setReminderEvent] = useState<CommunityEvent | null>(null);
  const [reminderEnabled, setReminderEnabled] = useState(false); const [reminderMinutes, setReminderMinutes] = useState(60);

  useEffect(() => watchCommunityEvents(items => { setEvents(items); void rescheduleEventReminders(items); }), []);
  useEffect(() => { listEstablishments().then(setEstablishments).catch(() => undefined); }, []);

  const reset = () => { setTitle(''); setDesc(''); setAddress(''); setCapacity(''); setEstId(''); setEditing(null); };
  const openEdit = (ev: CommunityEvent) => { setEditing(ev); setTitle(ev.title); setDesc(ev.description); setAddress(ev.location || ''); setCapacity(ev.maxParticipants?.toString() || ''); setDate(ev.date); setTime(ev.time || '10:00'); setOpen(true); };
  const submit = async () => {
    if (!profile) return;
    if (!title.trim() || !date || !time) { toast('Titre, date et heure sont requis.', 'error'); return; }
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
  const directions = (ev: CommunityEvent) => { const destination = ev.lat != null && ev.lng != null ? `${ev.lat},${ev.lng}` : encodeURIComponent(ev.location || ev.establishmentName || ''); if (destination) window.open(`https://www.google.com/maps/dir/?api=1&destination=${destination}`, '_blank', 'noopener'); };

  return <div className="screen" data-testid="events-screen">
    <div className="screen-header"><div><h1 className="screen-title">Rencontres</h1><div className="screen-sub">Marcher ensemble · établissements partenaires</div></div><button className="btn btn-ghost btn-sm" onClick={() => nav(-1)}>Retour</button></div>
    <div className="card"><div className="card-title">Sorties communautaires Elysium</div><p className="card-help">Organisez ou rejoignez une marche. Les rappels sont facultatifs et les inscrits sont prévenus des changements.</p><button className="btn btn-gold" onClick={() => { reset(); setOpen(true); }}>+ Proposer une sortie</button></div>
    {events.length === 0 ? <div className="card empty-state"><div className="display">Aucun événement</div>Soyez le premier à proposer une marche ensemble !</div> : events.map(ev => {
      const mine = profile?.uid === ev.creatorUid; const joined = !!profile && ev.participants.includes(profile.uid); const waiting = !!profile && (ev.waitlist || []).includes(profile.uid); const full = !!ev.maxParticipants && ev.participants.length >= ev.maxParticipants;
      return <div key={ev.id} className={`card ${ev.status === 'cancelled' ? 'event-cancelled' : ''}`} data-testid="event-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}><div><div style={{ fontWeight: 700 }}>{ev.title}</div><div className="row-sub">📅 {formatDate(eventDate(ev), { dateStyle: 'full', timeStyle: 'short' })}</div><div className="row-sub">📍 {ev.location || ev.establishmentName || 'Lieu à préciser'}</div></div><button className="badge" onClick={() => void showParticipants(ev)}>{ev.participants.length}{ev.maxParticipants ? ` / ${ev.maxParticipants}` : ''} inscrits</button></div>
        {ev.status === 'cancelled' && <span className="badge badge-danger">Annulé</span>}{full && ev.status !== 'cancelled' && <span className="badge">Complet · {(ev.waitlist || []).length} en attente</span>}
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>{ev.description}</p>{ev.lastChange && <p className="event-change">{ev.lastChange.type === 'cancelled' ? '⛔' : '🔔'} {ev.lastChange.message}</p>}
        <div className="route-actions">{(joined || waiting) && ev.status !== 'cancelled' && <button className="btn btn-danger btn-sm" onClick={() => void toggleJoin(ev)}>Se désinscrire{waiting ? ' de l’attente' : ''}</button>}{!joined && !waiting && ev.status !== 'cancelled' && !mine && <button className="btn btn-gold btn-sm" onClick={() => void toggleJoin(ev)}>{full ? 'Rejoindre la liste d’attente' : 'Rejoindre'}</button>}{(joined || mine) && ev.status !== 'cancelled' && <button className="btn btn-outline btn-sm" onClick={() => void openReminder(ev)}>🔔 Rappel</button>}<button className="btn btn-outline btn-sm" onClick={() => directions(ev)}>Itinéraire</button>{mine && ev.status !== 'cancelled' && <><button className="btn btn-ghost btn-sm" onClick={() => openEdit(ev)}>Modifier</button><button className="btn btn-danger btn-sm" onClick={() => void cancel(ev)}>Annuler</button></>}</div>
        <small style={{ color: 'var(--muted)', display: 'block', marginTop: 6 }}>Créé par {ev.creatorName}</small>
      </div>;
    })}
    <Sheet open={open} onClose={() => setOpen(false)} title={editing ? 'Modifier la sortie' : 'Nouvel événement'}>
      <div className="field"><label>Titre</label><input className="input" value={title} onChange={e => setTitle(e.target.value)} maxLength={80} /></div><div className="field"><label>Description</label><textarea className="input" value={desc} onChange={e => setDesc(e.target.value)} maxLength={600} rows={3} /></div><div className="two-col"><div className="field"><label>Date</label><input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} /></div><div className="field"><label>Heure locale</label><input className="input" type="time" value={time} onChange={e => setTime(e.target.value)} /></div></div>
      {!editing && <div className="field"><label>Établissement partenaire (optionnel)</label><select className="input" value={estId} onChange={e => setEstId(e.target.value)}><option value="">Aucun — lieu libre</option>{establishments.map(est => <option key={est.id} value={est.id}>{est.name}</option>)}</select></div>}
      <div className="field"><label>Adresse / point de rendez-vous</label><input className="input" value={address} onChange={e => setAddress(e.target.value)} maxLength={200} placeholder="Ex. Entrée principale du parc" /></div>{!editing && <div className="field"><label>Capacité maximale (vide = illimitée)</label><input className="input" type="number" min={2} max={500} value={capacity} onChange={e => setCapacity(e.target.value)} placeholder="Ex. 20" /></div>}
      <button className="btn btn-gold" onClick={submit} disabled={busy}>{busy ? 'Enregistrement…' : editing ? 'Enregistrer et prévenir' : 'Créer'}</button>
    </Sheet>
    <Sheet open={!!participantEvent} onClose={() => setParticipantEvent(null)} title="Participants"><p className="card-help">{participantEvent?.participants.length} inscrits · {(participantEvent?.waitlist || []).length} en liste d’attente</p>{participants.map(p => <div className="list-row" key={p.uid}><Avatar name={p.displayName} photoURL={p.photoURL} size={38} /><div className="row-main"><div className="row-title">{p.displayName}</div><div className="row-sub">{participantEvent?.participants.includes(p.uid) ? 'Inscrit' : 'Liste d’attente'}</div></div></div>)}</Sheet>
    <Sheet open={!!reminderEvent} onClose={() => setReminderEvent(null)} title="Rappel avant le départ"><label className="check-row"><input type="checkbox" checked={reminderEnabled} onChange={e => setReminderEnabled(e.target.checked)} /> Recevoir une notification sur cet appareil</label><div className="field"><label>Délai avant le départ</label><select className="input" value={reminderMinutes} onChange={e => setReminderMinutes(Number(e.target.value))}><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={60}>1 heure</option><option value={120}>2 heures</option><option value={1440}>La veille</option></select></div><button className="btn btn-gold" onClick={saveReminder}>Enregistrer le rappel</button></Sheet>
  </div>;
}
