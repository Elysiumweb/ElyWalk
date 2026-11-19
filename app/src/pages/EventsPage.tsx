import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Ban, Bell, Calendar, CalendarPlus, Link2, MapPin, MoreHorizontal, Navigation, Pencil, Plus, Users, XCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { useI18n } from '../context/LocaleContext';
import Sheet from '../components/Sheet';
import Avatar from '../components/Avatar';
import AddressAutocomplete from '../components/AddressAutocomplete';
import DirectionsPanel from '../components/DirectionsPanel';
import ConfirmSheet from '../components/ConfirmSheet';
import { getCurrentPosition } from '../lib/geo';
import QRCode, { shareQrCard } from '../components/QRCode';
import EventPhotos from '../components/EventPhotos';
import { buildEventIcs, downloadIcs, icsFilename } from '../lib/ics';
import { shareUrlForPath } from '../lib/share';
import { createCommunityEvent, watchCommunityEvents, joinCommunityEvent, leaveCommunityEvent, updateCommunityEvent, getProfiles } from '../lib/db';
import { listEstablishments, type Establishment } from '../lib/establishments';
import { eventDate, getEventReminder, rescheduleEventReminders, setEventReminder } from '../lib/eventReminders';
import type { CommunityEvent, UserProfile } from '../lib/types';

/** Date du jour au format `YYYY-MM-DD` en heure locale (`toISOString()` renverrait la date UTC). */
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

type View = 'upcoming' | 'mine' | 'past';
type FormErrors = Partial<Record<'title' | 'date' | 'capacity', string>>;

const VIEWS: { id: View; label: string }[] = [
  { id: 'upcoming', label: 'À venir' },
  { id: 'mine', label: 'Mes inscriptions' },
  { id: 'past', label: 'Passées' },
];
const TITLE_MAX = 80;
const DESC_MAX = 600;
const ICON = { size: 14, 'aria-hidden': true } as const;

export default function EventsPageV2() {
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
  // Coordonnées de l'adresse choisie dans les suggestions : elles alimentent la carte et l'itinéraire.
  const [addressPoint, setAddressPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [view, setView] = useState<View>('upcoming');
  const [visibleCount, setVisibleCount] = useState(10);
  const [busy, setBusy] = useState(false);
  const [participants, setParticipants] = useState<UserProfile[]>([]);
  const [participantsLoading, setParticipantsLoading] = useState(false);
  const [participantEvent, setParticipantEvent] = useState<CommunityEvent | null>(null);
  const [reminderEvent, setReminderEvent] = useState<CommunityEvent | null>(null);
  const [reminderEnabled, setReminderEnabled] = useState(false); const [reminderMinutes, setReminderMinutes] = useState(60);
  const [directionsEvent, setDirectionsEvent] = useState<CommunityEvent | null>(null);
  const [directionsOrigin, setDirectionsOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [inviteEvent, setInviteEvent] = useState<CommunityEvent | null>(null);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [pendingCancel, setPendingCancel] = useState<CommunityEvent | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<CommunityEvent | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  // Feuille « Plus » : on garde l'identifiant pour toujours lire la version à jour de la rencontre.
  const [moreId, setMoreId] = useState<string | null>(null);
  const moreEvent = events.find((ev) => ev.id === moreId) ?? null;

  useEffect(() => watchCommunityEvents(items => { setEvents(items); void rescheduleEventReminders(items); }), []);
  useEffect(() => { setVisibleCount(10); }, [view]);

  // Ouverture ciblée (notification ou lien d'invitation `/events?e=<id>`) : la carte est mise en avant.
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const targetEventId =
    (location.state as { eventId?: string } | null)?.eventId || searchParams.get('e') || undefined;
  useEffect(() => {
    if (!targetEventId) return;
    setHighlightId(targetEventId);
    // « À venir » couvre aussi une sortie qu'on organise sans y être inscrit.
    setView('upcoming');
    const timer = window.setTimeout(() => {
      document
        .querySelector(`[data-event-id="${targetEventId}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [targetEventId, events.length]);
  useEffect(() => { listEstablishments().then(setEstablishments).catch(() => undefined); }, []);

  const reset = () => { setTitle(''); setDesc(''); setAddress(''); setAddressPoint(null); setCapacity(''); setEstId(''); setEditing(null); setDate(todayLocalInput()); setFormErrors({}); };
  const openCreate = () => { reset(); setOpen(true); };
  const openEdit = (ev: CommunityEvent) => { setFormErrors({}); setEditing(ev); setTitle(ev.title); setDesc(ev.description); setAddress(ev.location || ''); setAddressPoint(ev.lat != null && ev.lng != null ? { lat: ev.lat, lng: ev.lng } : null); setCapacity(ev.maxParticipants?.toString() || ''); setDate(ev.date); setTime(ev.time || '10:00'); setOpen(true); };
  const clearFormError = (field: keyof FormErrors) =>
    setFormErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));

  const submit = async () => {
    if (!profile) return;
    const next: FormErrors = {};
    if (!title.trim()) next.title = 'Un titre est nécessaire pour que les autres trouvent la sortie.';
    // Date et heure sont saisies en heure locale : une sortie ne peut pas être créée dans le passé.
    const startsAt = new Date(`${date}T${time}`);
    const dateChanged = !editing || editing.date !== date || (editing.time || '') !== time;
    if (!date || !time || Number.isNaN(startsAt.getTime())) next.date = 'Indiquez la date et l’heure du départ.';
    else if (dateChanged && startsAt.getTime() < Date.now() - 60 * 1000) next.date = 'Choisissez une date et une heure à venir.';
    const max = capacity ? Number(capacity) : null;
    if (max != null && (!Number.isInteger(max) || max < 2 || max > 500)) next.capacity = 'La capacité doit être comprise entre 2 et 500.';
    setFormErrors(next);
    const firstInvalid = next.title ? 'event-title' : next.date ? 'event-date' : next.capacity ? 'event-capacity' : null;
    if (firstInvalid) { document.getElementById(firstInvalid)?.focus(); return; }
    setBusy(true);
    try {
      const est = establishments.find(e => e.id === estId);
      const location = address.trim() || est?.address;
      const lat = addressPoint?.lat ?? est?.lat;
      const lng = addressPoint?.lng ?? est?.lng;
      if (editing) await updateCommunityEvent(profile.uid, editing.id!, { title: title.trim(), description: desc.trim(), location, lat, lng, date, time, startsAt: startsAt.getTime(), message: 'La date, l’heure ou le lieu de la sortie a été modifié.' });
      else await createCommunityEvent(profile, { title: title.trim(), description: desc.trim() || 'Sortie communautaire ElyWalk', establishmentId: est?.id, establishmentName: est?.name, location, lat, lng, date, time, startsAt: startsAt.getTime(), maxParticipants: max });
      toast(editing ? 'Événement modifié, participants prévenus.' : 'Événement créé !', 'success'); setOpen(false); reset();
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };

  const join = async (ev: CommunityEvent) => {
    if (!profile) return;
    setJoiningId(ev.id!);
    try {
      const result = await joinCommunityEvent(profile.uid, ev.id!);
      toast(result === 'joined' ? 'Inscrit !' : 'Ajouté à la liste d’attente.', 'success');
    } catch (e) { toast((e as Error).message, 'error'); } finally { setJoiningId(null); }
  };
  /** Désinscription : confirmée dans une feuille, comme l'annulation. */
  const leave = async () => {
    if (!profile || !pendingLeave) return;
    setLeaving(true);
    try {
      await leaveCommunityEvent(profile.uid, pendingLeave.id!);
      toast('Désinscrit', 'success');
      setPendingLeave(null);
    } catch (e) { toast((e as Error).message, 'error'); } finally { setLeaving(false); }
  };
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
  const showParticipants = async (ev: CommunityEvent) => {
    setParticipantEvent(ev); setParticipants([]); setParticipantsLoading(true);
    try { setParticipants(await getProfiles([...ev.participants, ...(ev.waitlist || [])])); }
    catch (e) { toast((e as Error).message || 'Participants indisponibles.', 'error'); }
    finally { setParticipantsLoading(false); }
  };
  const openReminder = async (ev: CommunityEvent) => { const setting = await getEventReminder(ev.id!); setReminderEnabled(setting.enabled); setReminderMinutes(setting.minutes); setReminderEvent(ev); };
  const saveReminder = async () => { if (!reminderEvent) return; try { await setEventReminder(reminderEvent, reminderEnabled, reminderMinutes); toast(reminderEnabled ? 'Rappel programmé.' : 'Rappel désactivé.', 'success'); setReminderEvent(null); } catch (e) { toast((e as Error).message, 'error'); } };

  /** Localisation pour l'itinéraire : d'abord silencieuse, puis une seule demande de permission ; un refus ne bloque pas la feuille. */
  const locateForDirections = async () => {
    try {
      const quick = await getCurrentPosition({ silent: true });
      if (quick) {
        setDirectionsOrigin({ lat: quick.lat, lng: quick.lng });
        return;
      }
      const pos = await getCurrentPosition({ silent: false });
      if (pos) setDirectionsOrigin({ lat: pos.lat, lng: pos.lng });
      else toast('Position indisponible : saisissez votre adresse de départ dans la feuille d’itinéraire.', 'info');
    } catch {
      toast('Position indisponible : saisissez votre adresse de départ dans la feuille d’itinéraire.', 'info');
    }
  };
  const openDirections = (ev: CommunityEvent) => {
    setDirectionsEvent(ev);
    setDirectionsOrigin(null);
    if (ev.lat == null && !ev.location && !ev.establishmentName) {
      toast('Cette rencontre n’a pas d’adresse : indiquez la destination dans la feuille d’itinéraire.', 'info');
    }
    void locateForDirections();
  };

  /** Export calendrier : le fichier `.ics` est généré localement, sans serveur. */
  const addToCalendar = async (ev: CommunityEvent) => {
    try {
      const content = buildEventIcs(ev, { url: shareUrlForPath(`/events?e=${ev.id}`) });
      const result = await downloadIcs(icsFilename(ev), content);
      toast(result === 'shared' ? 'Fichier calendrier prêt à ouvrir.' : 'Fichier .ics enregistré dans vos téléchargements.', 'success');
    } catch (e) {
      toast((e as Error).message || 'Export calendrier impossible.', 'error');
    }
  };
  const shareInvite = async (ev: CommunityEvent) => {
    const url = shareUrlForPath(`/events?e=${ev.id}`);
    const text = `Rejoins-moi à « ${ev.title} » sur ElyWalk`;
    try {
      if (navigator.share) await navigator.share({ title: 'ElyWalk · Rencontre', text, url });
      else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        toast('Lien d’invitation copié.', 'success');
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast((e as Error).message || 'Partage impossible.', 'error');
    }
  };
  const shareInviteQr = async (ev: CommunityEvent) => {
    try {
      const result = await shareQrCard({
        value: shareUrlForPath(`/events?e=${ev.id}`),
        heading: 'Rejoins-nous !',
        subtitle: ev.title,
        caption: ev.date + (ev.time ? ` · ${ev.time}` : ''),
        captionLabel: 'Scanne pour ouvrir la rencontre dans ElyWalk',
        filename: `elywalk-rencontre-${ev.id}.jpg`,
        shareTitle: 'Invitation ElyWalk',
        shareText: `Rejoins-moi à « ${ev.title} » sur ElyWalk`,
      });
      toast(result === 'shared' ? 'QR partagé !' : 'Image QR enregistrée.', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  /**
   * Répartition dans les trois vues. Une sortie est « passée » une heure après son départ ;
   * une sortie sans date exploitable reste dans « À venir » plutôt que de disparaître.
   */
  const now = Date.now();
  const classified = events.map((ev) => {
    const start = eventDate(ev).getTime();
    return {
      ev,
      start,
      isPast: Number.isFinite(start) && start < now - 60 * 60 * 1000,
      joined: !!profile && (ev.participants.includes(profile.uid) || (ev.waitlist || []).includes(profile.uid)),
    };
  });
  const inView = (item: (typeof classified)[number], target: View) =>
    target === 'past' ? item.isPast : target === 'mine' ? item.joined && !item.isPast : !item.isPast;
  const counts: Record<View, number> = {
    upcoming: classified.filter((item) => inView(item, 'upcoming')).length,
    mine: classified.filter((item) => inView(item, 'mine')).length,
    past: classified.filter((item) => inView(item, 'past')).length,
  };
  const filteredEvents = classified
    .filter((item) => inView(item, view))
    .sort((a, b) => {
      const aValid = Number.isFinite(a.start);
      const bValid = Number.isFinite(b.start);
      if (view === 'past') return (bValid ? b.start : 0) - (aValid ? a.start : 0);
      if (!aValid && !bValid) return 0;
      if (!aValid) return 1;
      if (!bValid) return -1;
      return a.start - b.start;
    })
    .map(({ ev }) => ev);

  /** Ferme la feuille « Plus » avant d'ouvrir l'action choisie. */
  const fromMore = (fn: () => void) => { setMoreId(null); fn(); };
  const moreIsMine = !!moreEvent && profile?.uid === moreEvent.creatorUid;
  const moreIsActive = !!moreEvent && moreEvent.status !== 'cancelled';
  const moreIsJoined = !!moreEvent && !!profile && moreEvent.participants.includes(profile.uid);
  const leavingWaitlist = !!pendingLeave && !!profile && (pendingLeave.waitlist || []).includes(profile.uid);
  const registered = participants.filter((p) => participantEvent?.participants.includes(p.uid));
  const waitlisted = participants.filter((p) => !participantEvent?.participants.includes(p.uid));

  const participantRow = (p: UserProfile) => (
    <div className="list-row" key={p.uid}>
      <Avatar name={p.displayName} photoURL={p.photoURL} size={38} />
      <div className="row-main"><div className="row-title">{p.displayName}</div></div>
    </div>
  );

  return <div className="screen" data-testid="events-screen">
    <div className="screen-header">
      <div><h1 className="screen-title">Rencontres</h1><div className="screen-sub">Marcher ensemble · établissements partenaires</div></div>
      <button className="btn btn-ghost btn-sm" onClick={() => nav(-1)} data-testid="events-back">Retour</button>
    </div>
    <div className="card">
      <p className="card-help">Organisez ou rejoignez une marche : les inscrits sont prévenus de chaque changement.</p>
      <button className="btn btn-gold" onClick={openCreate} data-testid="events-create"><Plus size={16} aria-hidden /> Proposer une sortie</button>
    </div>
    <div className="chip-row" role="tablist" aria-label="Filtrer les rencontres" data-testid="events-views">
      {VIEWS.map((item) => (
        <button
          key={item.id}
          role="tab"
          aria-selected={view === item.id}
          className={`chip ${view === item.id ? 'chip-active' : ''}`}
          onClick={() => { setView(item.id); setVisibleCount(10); }}
          data-testid={`events-view-${item.id}`}
        >
          {item.label} ({counts[item.id]})
        </button>
      ))}
    </div>
    {filteredEvents.length === 0 ? (
      <div className="card empty-state" data-testid="events-empty">
        <div className="display">{view === 'past' ? 'Aucune sortie passée' : view === 'mine' ? 'Aucune inscription' : 'Aucun événement à venir'}</div>
        <p className="card-help">{view === 'mine' ? 'Rejoignez une sortie à venir, ou proposez la vôtre.' : 'Soyez le premier à proposer une marche ensemble !'}</p>
        <div className="route-actions" style={{ justifyContent: 'center' }}>
          {view === 'mine' && <button className="btn btn-outline btn-sm" onClick={() => setView('upcoming')} data-testid="events-empty-browse">Voir les sorties à venir</button>}
          <button className="btn btn-gold btn-sm" onClick={openCreate} data-testid="events-empty-create"><Plus {...ICON} /> Proposer une sortie</button>
        </div>
      </div>
    ) : filteredEvents.slice(0, visibleCount).map(ev => {
      const mine = profile?.uid === ev.creatorUid;
      const joined = !!profile && ev.participants.includes(profile.uid);
      const waiting = !!profile && (ev.waitlist || []).includes(profile.uid);
      const full = !!ev.maxParticipants && ev.participants.length >= ev.maxParticipants;
      const active = ev.status !== 'cancelled';
      return <div
        key={ev.id}
        className={`card ${active ? '' : 'event-cancelled'} ${highlightId === ev.id ? 'event-highlight' : ''}`.trim()}
        data-testid="event-card"
        data-event-id={ev.id}
      >
        <div className="row-between">
          <div className="title-sm" data-testid="event-title">{ev.title}</div>
          {!active && <span className="badge badge-danger" data-testid="event-status-cancelled">Annulé</span>}
          {active && full && <span className="badge" data-testid="event-status-full">Complet · {(ev.waitlist || []).length} en attente</span>}
          {active && !full && mine && <span className="badge badge-muted" data-testid="event-status-organizer">Vous organisez</span>}
        </div>
        {active && full && mine && <span className="badge badge-muted" data-testid="event-status-organizer">Vous organisez</span>}
        <div className="row-sub"><Calendar {...ICON} /> {formatDate(eventDate(ev), { dateStyle: 'full', timeStyle: 'short' })}</div>
        <div className="row-sub"><MapPin {...ICON} /> {ev.location || ev.establishmentName || 'Lieu à préciser'}</div>
        <p className="muted-text">{ev.description}</p>
        {ev.lastChange && <p className="event-change">{ev.lastChange.type === 'cancelled' ? <Ban {...ICON} /> : <Bell {...ICON} />} {ev.lastChange.message}</p>}
        <button className="badge" onClick={() => void showParticipants(ev)} aria-label="Voir les participants" data-testid="event-participants">
          <Users {...ICON} /> {ev.participants.length}{ev.maxParticipants ? ` / ${ev.maxParticipants}` : ''} inscrits{joined ? ' · dont vous' : waiting ? ' · vous êtes en attente' : ''}
        </button>
        <div className="route-actions">
          {active && (joined || waiting) && <button className="btn btn-danger btn-sm" onClick={() => setPendingLeave(ev)} data-testid="event-leave">Se désinscrire{waiting ? ' de l’attente' : ''}</button>}
          {active && !joined && !waiting && !mine && <button className="btn btn-gold btn-sm" onClick={() => void join(ev)} disabled={joiningId === ev.id} data-testid="event-join">{joiningId === ev.id ? 'Inscription…' : full ? 'Rejoindre la liste d’attente' : 'Rejoindre'}</button>}
          <button className="btn btn-outline btn-sm" onClick={() => openDirections(ev)} data-testid="event-directions"><Navigation {...ICON} /> Itinéraire</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setMoreId(ev.id!)} aria-haspopup="dialog" aria-label={`Plus d’actions pour ${ev.title}`} data-testid="event-more"><MoreHorizontal {...ICON} /> Plus</button>
        </div>
        {(joined || mine) && active && ev.id && (
          <EventPhotos eventId={ev.id} canEdit={joined || mine} />
        )}
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

    <Sheet open={!!moreEvent} onClose={() => setMoreId(null)} title={moreEvent?.title || 'Actions'} testId="event-more-sheet">
      {moreEvent && (
        <div className="route-actions">
          {(moreIsJoined || moreIsMine) && moreIsActive && <button className="btn btn-outline btn-sm" onClick={() => fromMore(() => void openReminder(moreEvent))} data-testid="event-reminder"><Bell {...ICON} /> Rappel</button>}
          <button className="btn btn-outline btn-sm" onClick={() => fromMore(() => setInviteEvent(moreEvent))} data-testid="event-invite"><Link2 {...ICON} /> Inviter</button>
          <button className="btn btn-outline btn-sm" onClick={() => fromMore(() => void addToCalendar(moreEvent))} data-testid="event-ics"><CalendarPlus {...ICON} /> Agenda</button>
          {moreIsMine && moreIsActive && <>
            <button className="btn btn-outline btn-sm" onClick={() => fromMore(() => openEdit(moreEvent))} data-testid="event-edit"><Pencil {...ICON} /> Modifier</button>
            <button className="btn btn-danger btn-sm" onClick={() => fromMore(() => setPendingCancel(moreEvent))} data-testid="event-cancel"><XCircle {...ICON} /> Annuler la rencontre</button>
          </>}
        </div>
      )}
    </Sheet>

    <Sheet open={open} onClose={() => setOpen(false)} title={editing ? 'Modifier la sortie' : 'Nouvel événement'} testId="event-form-sheet">
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }} noValidate>
        <div role="group" aria-labelledby="event-group-what">
          <div className="card-title" id="event-group-what">Quoi</div>
          <div className="field">
            <label htmlFor="event-title">Titre</label>
            <input id="event-title" className="input" value={title} onChange={e => { setTitle(e.target.value); clearFormError('title'); }} maxLength={TITLE_MAX} required aria-invalid={!!formErrors.title} aria-describedby="event-title-count" data-testid="event-title-input" />
            {formErrors.title && <small className="field-error" role="alert" data-testid="event-title-error">{formErrors.title}</small>}
            <small className="field-help" id="event-title-count">{title.length} / {TITLE_MAX} caractères</small>
          </div>
          <div className="field">
            <label htmlFor="event-desc">Description</label>
            <textarea id="event-desc" className="input" value={desc} onChange={e => setDesc(e.target.value)} maxLength={DESC_MAX} rows={3} aria-describedby="event-desc-count" data-testid="event-desc-input" />
            <small className="field-help" id="event-desc-count">{desc.length} / {DESC_MAX} caractères</small>
          </div>
          {!editing && (
            <div className="field">
              <label htmlFor="event-capacity">Capacité maximale (vide = illimitée)</label>
              <input id="event-capacity" className="input" type="number" inputMode="numeric" min={2} max={500} value={capacity} onChange={e => { setCapacity(e.target.value); clearFormError('capacity'); }} placeholder="Ex. 20" aria-invalid={!!formErrors.capacity} data-testid="event-capacity-input" />
              {formErrors.capacity && <small className="field-error" role="alert" data-testid="event-capacity-error">{formErrors.capacity}</small>}
            </div>
          )}
        </div>

        <div role="group" aria-labelledby="event-group-when">
          <div className="card-title" id="event-group-when">Quand</div>
          <div className="two-col">
            <div className="field"><label htmlFor="event-date">Date</label><input id="event-date" className="input" type="date" value={date} min={todayLocalInput()} onChange={e => { setDate(e.target.value); clearFormError('date'); }} aria-invalid={!!formErrors.date} data-testid="event-date-input" /></div>
            <div className="field"><label htmlFor="event-time">Heure locale</label><input id="event-time" className="input" type="time" value={time} onChange={e => { setTime(e.target.value); clearFormError('date'); }} aria-invalid={!!formErrors.date} data-testid="event-time-input" /></div>
          </div>
          {formErrors.date && <small className="field-error" role="alert" data-testid="event-date-error">{formErrors.date}</small>}
          <small className="field-help">Heure du fuseau de votre appareil{LOCAL_TIME_ZONE ? ` (${LOCAL_TIME_ZONE})` : ''} — la date et l’heure s’affichent ensuite selon la langue choisie.</small>
        </div>

        <div role="group" aria-labelledby="event-group-where">
          <div className="card-title" id="event-group-where">Où</div>
          {!editing && (
            <div className="field">
              <label htmlFor="event-establishment">Établissement partenaire (optionnel)</label>
              <select id="event-establishment" className="input" value={estId} onChange={e => setEstId(e.target.value)} data-testid="event-establishment-select">
                <option value="">Aucun — lieu libre</option>
                {establishments.map(est => <option key={est.id} value={est.id}>{est.name}</option>)}
              </select>
            </div>
          )}
          <AddressAutocomplete
            label="Adresse / point de rendez-vous"
            value={address}
            onChange={(value) => { setAddress(value); setAddressPoint(null); }}
            onSelect={(suggestion) => setAddressPoint({ lat: suggestion.lat, lng: suggestion.lng })}
            placeholder="Ex. Entrée principale du parc"
            helpText="Tapez les premières lettres : les adresses connues d’OpenStreetMap sont proposées. Choisir une suggestion place la sortie sur la carte et rend l’itinéraire fiable."
            testId="event-address"
          />
        </div>

        <button className="btn btn-gold" type="submit" disabled={busy} data-testid="event-form-submit">{busy ? 'Enregistrement…' : editing ? 'Enregistrer et prévenir' : 'Créer'}</button>
      </form>
    </Sheet>

    <Sheet open={!!participantEvent} onClose={() => setParticipantEvent(null)} title="Participants" testId="event-participants-sheet">
      {participantsLoading ? (
        <p className="card-help" role="status" data-testid="event-participants-loading">Chargement des participants…</p>
      ) : (
        <>
          <div className="card-title">Inscrits ({participantEvent?.participants.length ?? 0})</div>
          {registered.length === 0 ? <p className="card-help">Aucun inscrit pour l’instant.</p> : registered.map(participantRow)}
          {(participantEvent?.waitlist || []).length > 0 && (
            <>
              <div className="card-title">Liste d’attente ({(participantEvent?.waitlist || []).length})</div>
              {waitlisted.map(participantRow)}
            </>
          )}
        </>
      )}
    </Sheet>

    <ConfirmSheet
      open={!!pendingLeave}
      title={leavingWaitlist ? 'Quitter la liste d’attente ?' : 'Se désinscrire de cette rencontre ?'}
      danger
      busy={leaving}
      confirmLabel={leavingWaitlist ? 'Quitter la liste d’attente' : 'Me désinscrire'}
      cancelLabel="Non, je reste"
      consequences={leavingWaitlist
        ? [`Vous ne serez plus en attente pour « ${pendingLeave?.title || 'cette rencontre'} ».`]
        : [
            `Votre place à « ${pendingLeave?.title || 'cette rencontre'} » sera libérée.`,
            'Vous ne recevrez plus les rappels ni les changements de cette sortie.',
          ]}
      onConfirm={leave}
      onClose={() => setPendingLeave(null)}
      testId="event-leave-sheet"
    />
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
    <Sheet open={!!inviteEvent} onClose={() => setInviteEvent(null)} title="Inviter à cette rencontre">
      {inviteEvent && (
        <div style={{ textAlign: 'center' }}>
          <p className="card-help" style={{ textAlign: 'left' }}>
            Partagez ce QR code à proximité, ou envoyez le lien : la rencontre s’ouvre
            directement dans ElyWalk, pour les inscrits comme pour les curieux.
          </p>
          <QRCode value={shareUrlForPath(`/events?e=${inviteEvent.id}`)} size={200} title={inviteEvent.title} />
          <div className="route-actions" style={{ justifyContent: 'center', marginTop: 12 }}>
            <button className="btn btn-gold btn-sm" onClick={() => void shareInvite(inviteEvent)} data-testid="event-share-link">
              Partager le lien
            </button>
            <button className="btn btn-outline btn-sm" onClick={() => void shareInviteQr(inviteEvent)} data-testid="event-share-qr">
              Partager le QR
            </button>
            <button className="btn btn-outline btn-sm" onClick={() => void addToCalendar(inviteEvent)} data-testid="event-invite-ics">
              Ajouter à mon agenda
            </button>
          </div>
        </div>
      )}
    </Sheet>
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
      onOriginResolved={setDirectionsOrigin}
    />
    <Sheet open={!!reminderEvent} onClose={() => setReminderEvent(null)} title="Rappel avant le départ" testId="event-reminder-sheet">
      <label className="check-row"><input type="checkbox" checked={reminderEnabled} onChange={e => setReminderEnabled(e.target.checked)} data-testid="event-reminder-toggle" /> Recevoir une notification sur cet appareil</label>
      <div className="field">
        <label htmlFor="event-reminder-delay">Délai avant le départ</label>
        <select id="event-reminder-delay" className="input" value={reminderMinutes} onChange={e => setReminderMinutes(Number(e.target.value))} data-testid="event-reminder-delay">
          <option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={60}>1 heure</option><option value={120}>2 heures</option><option value={1440}>La veille</option>
        </select>
      </div>
      <button className="btn btn-gold" onClick={saveReminder} data-testid="event-reminder-save">Enregistrer le rappel</button>
    </Sheet>
  </div>;
}
