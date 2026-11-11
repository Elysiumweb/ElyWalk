import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import Sheet from '../components/Sheet';
import { createCommunityEvent, watchCommunityEvents, joinCommunityEvent, leaveCommunityEvent } from '../lib/db';
import { listEstablishments, type Establishment } from '../lib/establishments';
import type { CommunityEvent } from '../lib/types';
import { useNavigate } from 'react-router-dom';
import { deviceTimeZone, formatEventDate, isPastEvent, localDateInput, parseLocalDateTime } from '../lib/events';

// ============================================================================
// Rencontres communautaires.
//
// La saisie et l'affichage des dates passent par `lib/events.ts` : date locale
// (`AAAA-MM-JJ`) + heure, jamais un horodatage UTC, et formatage dans la locale
// de l'appareil. Une rencontre déjà passée ne peut pas être créée.
// ============================================================================

export default function EventsPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const nav = useNavigate();
  const [events, setEvents] = useState<CommunityEvent[]>([]);
  const [establishments, setEstablishments] = useState<Establishment[]>([]);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  // Date locale de l'appareil (et non `toISOString()`, qui est en UTC).
  const [date, setDate] = useState(localDateInput());
  const [time, setTime] = useState('10:00');
  const [estId, setEstId] = useState('');
  const [busy, setBusy] = useState(false);

  const timeZone = useMemo(() => deviceTimeZone(), []);
  const today = localDateInput();
  const formIsPast = isPastEvent(date, time);

  useEffect(() => watchCommunityEvents(setEvents), []);
  useEffect(() => {
    listEstablishments().then(setEstablishments).catch(() => undefined);
  }, []);

  const create = async () => {
    if (!profile) return;
    if (!title.trim()) {
      toast('Titre requis', 'error');
      return;
    }
    if (!parseLocalDateTime(date, time)) {
      toast('Date ou heure invalide.', 'error');
      return;
    }
    if (isPastEvent(date, time)) {
      toast('Impossible de créer une rencontre déjà passée : choisissez une date à venir.', 'error');
      return;
    }
    setBusy(true);
    try {
      const est = establishments.find((e) => e.id === estId);
      await createCommunityEvent(profile, {
        title: title.trim(),
        description: desc.trim() || 'Sortie communautaire ElyWalk',
        establishmentId: est?.id || undefined,
        establishmentName: est?.name || undefined,
        location: est?.address || undefined,
        lat: est?.lat || undefined,
        lng: est?.lng || undefined,
        date,
        time,
      });
      toast('Événement créé !', 'success');
      setOpen(false);
      setTitle('');
      setDesc('');
      setDate(localDateInput());
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggleJoin = async (ev: CommunityEvent) => {
    if (!profile) return;
    const joined = ev.participants.includes(profile.uid);
    if (!joined && isPastEvent(ev.date, ev.time)) {
      toast('Cette rencontre est déjà passée.', 'error');
      return;
    }
    try {
      if (joined) await leaveCommunityEvent(profile.uid, ev.id!);
      else await joinCommunityEvent(profile.uid, ev.id!);
      toast(joined ? 'Désinscrit' : 'Inscrit !', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <div className="screen" data-testid="events-screen">
      <div className="screen-header">
        <div>
          <h1 className="screen-title">Rencontres</h1>
          <div className="screen-sub">Marcher ensemble · établissements partenaires</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => nav(-1)}>Retour</button>
      </div>

      <div className="card stack">
        <div className="card-title">Sorties communautaires Elysium</div>
        <p className="card-help">
          Organisez ou rejoignez une marche groupée liée aux établissements de la carte.
          Idéal pour découvrir les partenaires et se motiver ensemble.
        </p>
        <button className="btn btn-gold" onClick={() => setOpen(true)} data-testid="create-event-button">
          + Proposer une sortie
        </button>
        {timeZone && (
          <p className="card-help" data-testid="events-timezone">
            Les horaires sont affichés dans votre fuseau : {timeZone}.
          </p>
        )}
      </div>

      {events.length === 0 ? (
        <div className="card empty-state">
          <div className="display">Aucun événement</div>
          Soyez le premier à proposer une marche ensemble !
        </div>
      ) : (
        events.map((ev) => {
          const past = isPastEvent(ev.date, ev.time);
          const joined = !!profile && ev.participants.includes(profile.uid);
          return (
            <div key={ev.id} className={`card event-card ${past ? 'event-card-past' : ''}`} data-testid="event-card">
              <div className="row-between">
                <div className="spacer">
                  <div className="event-title">{ev.title}</div>
                  {/* Date lisible dans la locale de l'appareil, jamais une chaîne ISO brute. */}
                  <time className="row-sub" dateTime={`${ev.date}${ev.time ? `T${ev.time}` : ''}`}>
                    {formatEventDate(ev.date, ev.time)}
                    {ev.establishmentName ? ` · 📍 ${ev.establishmentName}` : ev.location ? ` · ${ev.location}` : ''}
                  </time>
                  {past && <span className="badge badge-muted mt-1">Terminée</span>}
                </div>
                <span className="badge text-nowrap">{ev.participants.length} inscrits</span>
              </div>
              <p className="event-description">{ev.description}</p>
              {profile && (
                <button
                  className={`btn btn-sm event-join ${joined ? 'btn-danger' : 'btn-gold'}`}
                  onClick={() => toggleJoin(ev)}
                  disabled={past && !joined}
                >
                  {joined ? 'Se désinscrire' : past ? 'Rencontre passée' : 'Rejoindre'}
                </button>
              )}
              <small className="card-help event-creator">Créé par {ev.creatorName}</small>
            </div>
          );
        })
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title="Nouvel événement" testId="create-event-sheet">
        <div className="field">
          <label>Titre</label>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={80}
            placeholder="ex. Marche matinale au parc"
            data-testid="event-title-input"
          />
        </div>
        <div className="field">
          <label>Description</label>
          <textarea
            className="input"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            maxLength={600}
            rows={3}
            placeholder="Détails, point de rendez-vous..."
          />
        </div>
        <div className="two-col">
          <div className="field">
            <label>Date</label>
            <input
              className="input"
              type="date"
              // Empêche de choisir un jour déjà passé dans le sélecteur natif.
              min={today}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              data-testid="event-date-input"
            />
          </div>
          <div className="field">
            <label>Heure</label>
            <input
              className="input"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              data-testid="event-time-input"
            />
          </div>
        </div>
        {timeZone && <p className="field-help">Heure locale ({timeZone}).</p>}
        {formIsPast && (
          <p className="field-error" role="alert" data-testid="event-past-error">
            Cette date est déjà passée : choisissez un moment à venir.
          </p>
        )}
        <div className="field">
          <label>Établissement partenaire (optionnel)</label>
          <select className="input" value={estId} onChange={(e) => setEstId(e.target.value)}>
            <option value="">Aucun — lieu libre</option>
            {establishments.map((est) => (
              <option key={est.id} value={est.id}>{est.name}</option>
            ))}
          </select>
        </div>
        <button className="btn btn-gold" onClick={create} disabled={busy || formIsPast} data-testid="save-event-button">
          {busy ? 'Création...' : 'Créer'}
        </button>
      </Sheet>
    </div>
  );
}
