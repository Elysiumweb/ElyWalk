import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { useI18n } from '../context/LocaleContext';
import Sheet from '../components/Sheet';
import Avatar from '../components/Avatar';
import AddressAutocomplete from '../components/AddressAutocomplete';
import DirectionsPanel from '../components/DirectionsPanel';
import ConfirmSheet from '../components/ConfirmSheet';
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
  const location = useLocation();
  const [events, setEvents] = useState<CommunityEvent[]>([]);
  const [establishments, setEstablishments] = useState<Establishment[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CommunityEvent | null>(null);
  const [title, setTitle] = useState(''); const [desc, setDesc] = useState('');
  const [date, setDate] = useState(todayLocalInput()); const [time, setTime] = useState('10:00');
  const [estId, setEstId] = useState(''); const [address, setAddress] = useState(''); const [capacity, setCapacity] = useState('');
  // Coordonnées de l'adresse choisie dans la liste de suggestions : elles
  // alimentent la carte et l'itinéraire de la sortie (avant, seul le texte de
  // l'adresse était conservé, l'itinéraire partait donc d'un géocodage).
  const [addressPoint, setAddressPoint] = useState<{ lat: number; lng: number } | null>(null);
  // Vues « À venir / Mes inscriptions / Passées » (F09).
  const [view, setView] = useState<'upcoming' | 'mine' | 'past'>('upcoming');
  const [visibleCount, setVisibleCount] = useState(10);
  const [busy, setBusy] = useState(false);
  const [participants, setParticipants] = useState<UserProfile[]>([]);
  const [participantEvent, setParticipantEvent] = useState<CommunityEvent | null>(null);
  const [reminderEvent, setReminderEvent] = useState<CommunityEvent | null>(null);
  const [reminderEnabled, setReminderEnabled] = useState(false); const [reminderMinutes, setReminderMinutes] = useState(60);
  // Itinéraire calculé dans l'application (adresse + 4 modes), sans redirection Maps.
  const [directionsEvent, setDirectionsEvent] = useState<CommunityEvent | null>(null);
  const [directionsOrigin, setDirectionsOrigin] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => watchCommunityEvents(items => { setEvents(items); void rescheduleEventReminders(items); }), []);
  useEffect(() => { setVisibleCount(10); }, [view]);
  /**
   * Ouverture ciblée depuis une notification (« Votre rencontre commence
   * bientôt », « Rencontre près de vous », rappel local) : l'écran bascule sur
   * « Mes inscriptions » puis « À venir » et met la carte concernée en avant,
   * au lieu de laisser l'utilisateur chercher la sortie dans la liste.
   */
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const targetEventId = (location.state as { eventId?: string } | null)?.eventId;
  useEffect(() => {
    if (!targetEventId) return;
    setHighlightId(targetEventId);
    // « Mes inscriptions » ne suffit pas : un rappel peut venir d'une sortie
    // qu'on organise sans y être inscrit. « À venir » couvre les deux cas.
    setView('upcoming');
    const timer = window.setTimeout(() => {
      document
        .querySelector(`[data-event-id="${targetEventId}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [targetEventId, events.length]);
  useEffect(() => { listEstablishments().then(setEstablishments).catch(() => undefined); }, []);

  const reset = () => { setTitle(''); setDesc(''); setAddress(''); setAddressPoint(null); setCapacity(''); setEstId(''); setEditing(null); setDate(todayLocalInput()); };
  const openEdit = (ev: CommunityEvent) => { setEditing(ev); setTitle(ev.title); setDesc(ev.description); setAddress(ev.location || ''); setAddressPoint(ev.lat != null && ev.lng != null ? { lat: ev.lat, lng: ev.lng } : null); setCapacity(ev.maxParticipants?.toString() || ''); setDate(ev.date); setTime(ev.time || '10:00'); setOpen(true); };
  /** Champ en défaut : l'erreur est posée au champ, pas seulement en toast. */
  const [submitError, setSubmitError] = useState<'title' | 'date' | 'capacity' | null>(null);

  const submit = async () => {
    if (!profile) return;
    if (!title.trim()) { setSubmitError('title'); return; }
    if (!date || !time) { setSubmitError('date'); return; }
    // Date et heure sont saisies en heure locale (aucun passage par UTC) :
    // une sortie ne peut pas être créée dans le passé (audit § 2.6).
    const startsAt = new Date(`${date}T${time}`);
    if (Number.isNaN(startsAt.getTime())) { setSubmitError('date'); return; }
    const dateChanged = !editing || editing.date !== date || (editing.time || '') !== time;
    if (dateChanged && startsAt.getTime() < Date.now() - 60 * 1000) {
      setSubmitError('date');
      return;
    }
    const max = capacity ? Number(capacity) : null;
    if (max != null && (!Number.isInteger(max) || max < 2 || max > 500)) { setSubmitError('capacity'); return; }
    setSubmitError(null);
    setBusy(true);
    try {
      const est = establishments.find(e => e.id === estId);
      const location = address.trim() || est?.address;
      const lat = addressPoint?.lat ?? est?.lat;
      const lng = addressPoint?.lng ?? est?.lng;
      if (editing) await updateCommunityEvent(profile.uid, editing.id!, { title: title.trim(), description: desc.trim(), location, lat, lng, date, time, message: 'La date, l’heure ou le lieu de la sortie a été modifié.' });
      else await createCommunityEvent(profile, { title: title.trim(), description: desc.trim() || 'Sortie communautaire ElyWalk', establishmentId: est?.id, establishmentName: est?.name, location, lat, lng, date, time, maxParticipants: max });
      toast(editing ? 'Événement modifié, participants prévenus.' : 'Événement créé !', 'success'); setOpen(false); reset();
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };
  const toggleJoin = async (ev: CommunityEvent) => {
    if (!profile) return;
    const joined = ev.participants.includes(profile.uid) || (ev.waitlist || []).includes(profile.uid);
    try { if (joined) { await leaveCommunityEvent(profile.uid, ev.id!); toast('Désinscrit', 'success'); } else { const result = await joinCommunityEvent(profile.uid, ev.id!); toast(result === 'joined' ? 'Inscrit !' : 'Ajouté à la liste d’attente.', 'success'); } }
    catch (e) { toast((e as Error).message, 'error'); }
  };
  /**
   * Annulation d'une rencontre : plus de `confirm()` natif. La feuille énonce
   * les conséquences (prévenance de tous les inscrits, irréversibilité) avant
   * validation (D06).
   */
  const [pendingCancel, setPendingCancel] = useState<CommunityEvent | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const cancel = async () => {
    if (!profile || !pendingCancel) return;
    setCancelling(true);
    try {
      await updateCommunityEvent(profile.uid, pendingCancel.id!, {
        status: 'cancelled',
        message: 'L’organisateur a annulé cette sortie.',
      });
      toast('Sortie annulée, participants prévenus.', 'success');
      setPendingCancel(null);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setCancelling(false);
    }
  };
  const showParticipants = async (ev: CommunityEvent) => { setParticipantEvent(ev); setParticipants(await getProfiles([...ev.participants, ...(ev.waitlist || [])])); };
  const openReminder = async (ev: CommunityEvent) => { const setting = await getEventReminder(ev.id!); setReminderEnabled(setting.enabled); setReminderMinutes(setting.minutes); setReminderEvent(ev); };
  const saveReminder = async () => { if (!reminderEvent) return; try { await setEventReminder(reminderEvent, reminderEnabled, reminderMinutes); toast(reminderEnabled ? 'Rappel programmé.' : 'Rappel désactivé.', 'success'); setReminderEvent(null); } catch (e) { toast((e as Error).message, 'error'); } };
  /**
   * « Itinéraire » d'une rencontre : on ouvre directement la carte ElyWalk avec
   * le trajet, pour **tous** les modes (à pied, vélo, voiture, transports).
   * La position est demandée dès l'ouverture : sans elle, la feuille restait
   * sur « Position non détectée » et aucun tracé n'était calculé.
   */
  const openDirections = (ev: CommunityEvent) => {
    setDirectionsEvent(ev);
    setDirectionsOrigin(null);
    void locateForDirections();
  };

  /**
   * Filtrage des trois vues. Une sortie est « passée » dès que son départ est
   * dépassé (ou si elle est annulée et déjà commencée) ; une sortie sans date
   * exploitable reste visible dans « À venir » plutôt que de disparaître.
   */
  const filteredEvents = (() => {
    const now = Date.now();
    const withStart = events.map((ev) => ({ ev, start: eventDate(ev).getTime() }));
    const sorted = withStart.sort((a, b) => {
      const aValid = Number.isFinite(a.start);
      const bValid = Number.isFinite(b.start);
      if (view === 'past') return (bValid ? b.start : 0) - (aValid ? a.start : 0);
      if (!aValid && !bValid) return 0;
      if (!aValid) return 1;
      if (!bValid) return -1;
      return a.start - b.start;
    });
    return sorted
      .filter(({ ev, start }) => {
        const isPast = Number.isFinite(start) && start < now - 60 * 60 * 1000;
        const joined = !!profile && (ev.participants.includes(profile.uid) || (ev.waitlist || []).includes(profile.uid));
        if (view === 'past') return isPast;
        if (view === 'mine') return joined && !isPast;
        return !isPast;
      })
      .map(({ ev }) => ev);
  })();
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
    {/*
      F09 — trois vues explicites. Avant, la liste s'arrêtait aux vingt
      premières dates croissantes sans filtre : des sorties passées occupaient
      toute la sélection et les événements à venir n'apparaissaient jamais.
    */}
    <div className="chip-row" role="tablist" aria-label="Filtrer les rencontres" data-testid="events-views">
      {([
        { id: 'upcoming', label: 'À venir' },
        { id: 'mine', label: 'Mes inscriptions' },
        { id: 'past', label: 'Passées' },
      ] as const).map((item) => (
        <button
          key={item.id}
          role="tab"
          aria-selected={view === item.id}
          className={`chip ${view === item.id ? 'chip-active' : ''}`}
          onClick={() => { setView(item.id); setVisibleCount(10); }}
          data-testid={`events-view-${item.id}`}
        >
          {item.label}
        </button>
      ))}
    </div>
    {filteredEvents.length === 0 ? <div className="card empty-state" data-testid="events-empty"><div className="display">{view === 'past' ? 'Aucune sortie passée' : view === 'mine' ? 'Aucune inscription' : 'Aucun événement à venir'}</div>{view === 'mine' ? 'Rejoignez une sortie depuis l’onglet « À venir ».' : 'Soyez le premier à proposer une marche ensemble !'}</div> : filteredEvents.slice(0, visibleCount).map(ev => {
      const mine = profile?.uid === ev.creatorUid; const joined = !!profile && ev.participants.includes(profile.uid); const waiting = !!profile && (ev.waitlist || []).includes(profile.uid); const full = !!ev.maxParticipants && ev.participants.length >= ev.maxParticipants;
      return <div
        key={ev.id}
        className={`card ${ev.status === 'cancelled' ? 'event-cancelled' : ''} ${highlightId === ev.id ? 'event-highlight' : ''}`.trim()}
        data-testid="event-card"
        data-event-id={ev.id}
      >
        <div className="row-between"><div><div className="title-sm">{ev.title}</div><div className="row-sub">📅 {formatDate(eventDate(ev), { dateStyle: 'full', timeStyle: 'short' })}</div><div className="row-sub">📍 {ev.location || ev.establishmentName || 'Lieu à préciser'}</div></div><button className="badge" onClick={() => void showParticipants(ev)}>{ev.participants.length}{ev.maxParticipants ? ` / ${ev.maxParticipants}` : ''} inscrits</button></div>
        {ev.status === 'cancelled' && <span className="badge badge-danger">Annulé</span>}{full && ev.status !== 'cancelled' && <span className="badge">Complet · {(ev.waitlist || []).length} en attente</span>}
        <p className="muted-text">{ev.description}</p>{ev.lastChange && <p className="event-change">{ev.lastChange.type === 'cancelled' ? '⛔' : '🔔'} {ev.lastChange.message}</p>}
        <div className="route-actions">{(joined || waiting) && ev.status !== 'cancelled' && <button className="btn btn-danger btn-sm" onClick={() => void toggleJoin(ev)}>Se désinscrire{waiting ? ' de l’attente' : ''}</button>}{!joined && !waiting && ev.status !== 'cancelled' && !mine && <button className="btn btn-gold btn-sm" onClick={() => void toggleJoin(ev)}>{full ? 'Rejoindre la liste d’attente' : 'Rejoindre'}</button>}
        {mine && ev.status !== 'cancelled' && <span className="badge badge-muted">Vous organisez cette sortie</span>}{(joined || mine) && ev.status !== 'cancelled' && <button className="btn btn-outline btn-sm" onClick={() => void openReminder(ev)}>🔔 Rappel</button>}<button className="btn btn-outline btn-sm" onClick={() => openDirections(ev)} data-testid="event-directions">Itinéraire</button>{mine && ev.status !== 'cancelled' && <><button className="btn btn-ghost btn-sm" onClick={() => openEdit(ev)}>Modifier</button><button className="btn btn-danger btn-sm" onClick={() => setPendingCancel(ev)}>Annuler</button></>}</div>
        <small className="muted-xs" style={{ display: 'block', marginTop: 'var(--space-1)' }}>Créé par {ev.creatorName}</small>
      </div>;
    })}
    {filteredEvents.length > visibleCount && (
      <button
        className="btn btn-outline"
        onClick={() => setVisibleCount((count) => count + 10)}
        data-testid="events-load-more"
      >
        Afficher plus de sorties ({filteredEvents.length - visibleCount} restantes)
      </button>
    )}
    <Sheet open={open} onClose={() => setOpen(false)} title={editing ? 'Modifier la sortie' : 'Nouvel événement'} testId="event-form-sheet">
      {/* Formulaire réel : Entrée valide, libellés associés, erreurs au champ. */}
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }} noValidate>
      <div className="field"><label htmlFor="event-title">Titre</label><input id="event-title" className="input" value={title} onChange={e => { setTitle(e.target.value); if (submitError === 'title') setSubmitError(null); }} maxLength={80} required aria-invalid={submitError === 'title'} /></div>
      {submitError === 'title' && <small className="field-error" role="alert">Un titre est nécessaire pour que les autres trouvent la sortie.</small>}
      <div className="field"><label htmlFor="event-desc">Description</label><textarea id="event-desc" className="input" value={desc} onChange={e => setDesc(e.target.value)} maxLength={600} rows={3} /></div>
      <div className="two-col"><div className="field"><label htmlFor="event-date">Date</label><input id="event-date" className="input" type="date" value={date} min={todayLocalInput()} onChange={e => { setDate(e.target.value); if (submitError === 'date') setSubmitError(null); }} aria-invalid={submitError === 'date'} /></div><div className="field"><label htmlFor="event-time">Heure locale</label><input id="event-time" className="input" type="time" value={time} onChange={e => setTime(e.target.value)} aria-invalid={submitError === 'date'} /></div></div>
      {submitError === 'date' && <small className="field-error" role="alert">Choisissez une date et une heure à venir.</small>}
      <small className="field-help">Heure du fuseau de votre appareil{LOCAL_TIME_ZONE ? ` (${LOCAL_TIME_ZONE})` : ''} — la date et l’heure s’affichent ensuite selon la langue choisie.</small>
      {!editing && <div className="field"><label>Établissement partenaire (optionnel)</label><select className="input" value={estId} onChange={e => setEstId(e.target.value)}><option value="">Aucun — lieu libre</option>{establishments.map(est => <option key={est.id} value={est.id}>{est.name}</option>)}</select></div>}
      <AddressAutocomplete
        label="Adresse / point de rendez-vous"
        value={address}
        onChange={(value) => { setAddress(value); setAddressPoint(null); }}
        onSelect={(suggestion) => setAddressPoint({ lat: suggestion.lat, lng: suggestion.lng })}
        placeholder="Ex. Entrée principale du parc"
        helpText="Tapez les premières lettres : les adresses connues d’OpenStreetMap sont proposées. Choisir une suggestion place la sortie sur la carte et rend l’itinéraire fiable."
        testId="event-address"
      />{!editing && <div className="field"><label htmlFor="event-capacity">Capacité maximale (vide = illimitée)</label><input id="event-capacity" className="input" type="number" min={2} max={500} value={capacity} onChange={e => { setCapacity(e.target.value); if (submitError === 'capacity') setSubmitError(null); }} placeholder="Ex. 20" aria-invalid={submitError === 'capacity'} /></div>}
      {submitError === 'capacity' && <small className="field-error" role="alert">La capacité doit être comprise entre 2 et 500.</small>}
      <button className="btn btn-gold" type="submit" disabled={busy}>{busy ? 'Enregistrement…' : editing ? 'Enregistrer et prévenir' : 'Créer'}</button>
      </form>
    </Sheet>
    <Sheet open={!!participantEvent} onClose={() => setParticipantEvent(null)} title="Participants"><p className="card-help">{participantEvent?.participants.length} inscrits · {(participantEvent?.waitlist || []).length} en liste d’attente</p>{participants.map(p => <div className="list-row" key={p.uid}><Avatar name={p.displayName} photoURL={p.photoURL} size={38} /><div className="row-main"><div className="row-title">{p.displayName}</div><div className="row-sub">{participantEvent?.participants.includes(p.uid) ? 'Inscrit' : 'Liste d’attente'}</div></div></div>)}</Sheet>
    <ConfirmSheet
      open={!!pendingCancel}
      title="Annuler cette rencontre ?"
      danger
      busy={cancelling}
      confirmLabel="Annuler la rencontre"
      cancelLabel="Non, la garder"
      consequences={[
        `« ${pendingCancel?.title || 'Cette rencontre'} » sera marquée annulée pour tout le monde.`,
        `Les ${pendingCancel?.participants.length ?? 0} inscrit(s) recevront une notification.`,
        'Cette annulation est définitive : les inscriptions ne seront pas rouvertes.',
      ]}
      onConfirm={cancel}
      onClose={() => setPendingCancel(null)}
      testId="event-cancel-sheet"
    />
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
