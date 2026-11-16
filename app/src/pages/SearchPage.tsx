import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import Avatar from '../components/Avatar';
import NotificationBell from '../components/NotificationBell';
import {
  findUserByCode,
  listCommunityEvents,
  searchUsersByName,
} from '../lib/db';
import { listEstablishments } from '../lib/establishments';
import { listRoutesForSearch } from '../lib/routes';
import {
  EMPTY_SEARCH_RESULTS,
  MIN_SEARCH_LENGTH,
  personFromProfile,
  runGlobalSearch,
  totalResults,
  type GlobalSearchLoaders,
  type GlobalSearchResults,
} from '../lib/globalSearch';
import { fmtNumber, formatDistance } from '../lib/coins';

/**
 * Recherche globale (A11) — un seul champ, quatre sections.
 *
 * Cherche en parallèle : marcheurs (pseudo et code ami), parcours (nom,
 * auteur), rencontres (titre, lieu) et partenaires (nom, ville, adresse).
 * Chaque section a son état vide ; une section en échec ne masque pas les
 * autres (le module de recherche isole les erreurs).
 *
 * L'URL porte la requête (`/search?q=…`) : elle peut être partagée, et le
 * bouton retour ramène à la recherche précédente.
 */
export default function SearchPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const initial = params.get('q') || '';
  const [term, setTerm] = useState(initial);
  const [results, setResults] = useState<GlobalSearchResults>(EMPTY_SEARCH_RESULTS);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<string[]>([]);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const loaders = useMemo<GlobalSearchLoaders>(() => ({
    walkers: async (query) => {
      const [byName, byCode] = await Promise.all([
        searchUsersByName(query).catch(() => []),
        // Un code ami est court et structuré : on ne tente la résolution que si
        // la saisie y ressemble, pour ne pas multiplier les lectures.
        /^[A-Z0-9]{5,8}$/i.test(query) ? findUserByCode(query).catch(() => null) : Promise.resolve(null),
      ]);
      const people = byName.map((user) => personFromProfile(user));
      if (byCode && !people.some((person) => person.uid === byCode.uid)) {
        people.unshift(personFromProfile(byCode, true));
      }
      return people.filter((person) => person.uid !== profile?.uid);
    },
    routes: () => (profile ? listRoutesForSearch(profile.uid) : Promise.resolve([])),
    events: () => listCommunityEvents(40),
    partners: () => listEstablishments(),
  }), [profile?.uid]);

  // Recherche différée (350 ms) : une requête par pause de frappe, pas par touche.
  useEffect(() => {
    const clean = term.trim();
    if (clean.length < MIN_SEARCH_LENGTH) {
      setResults(EMPTY_SEARCH_RESULTS);
      setSearched(false);
      setFailed([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void runGlobalSearch(clean, loaders)
        .then(({ results: next, failed: failures }) => {
          if (cancelled) return;
          setResults(next);
          setFailed(failures);
          setSearched(true);
          setParams(clean ? { q: clean } : {}, { replace: true });
        })
        .catch((e) => {
          if (!cancelled) toast((e as Error).message || 'Recherche indisponible.', 'error');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, loaders]);

  const count = totalResults(results);
  const sectionFailed = (key: keyof GlobalSearchResults) => failed.includes(key);

  return (
    <div className="screen" data-testid="search-screen">
      <div className="screen-header">
        <div>
          <h1 className="screen-title">Recherche</h1>
          <div className="screen-sub">Marcheurs · parcours · rencontres · partenaires</div>
        </div>
        <div className="header-actions">
          <NotificationBell />
          <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}>Retour</button>
        </div>
      </div>

      <div className="card">
        <label className="field" htmlFor="global-search-input">
          <span>Que cherchez-vous ?</span>
          <input
            ref={inputRef}
            id="global-search-input"
            className="input"
            type="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Pseudo, code ami, parcours, lieu, partenaire…"
            autoComplete="off"
            maxLength={80}
            data-testid="global-search-input"
          />
        </label>
        <p className="card-help">
          La recherche couvre à la fois les marcheurs (nom ou code), vos parcours et les parcours
          publics, les rencontres à venir et les établissements partenaires.
        </p>
      </div>

      {loading && (
        <div className="card empty-state" data-testid="search-loading">
          <span className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> Recherche en cours…
        </div>
      )}

      {!loading && searched && count === 0 && (
        <div className="card empty-state" data-testid="search-empty">
          <div className="display">Aucun résultat</div>
          <p className="muted-text">
            Vérifiez l’orthographe, essayez un mot plus court, ou entrez directement un code ami
            (ex. A3F7K9).
          </p>
          {failed.length > 0 && (
            <p className="muted-xs">
              Certaines sources n’ont pas répondu ({failed.length}) : réessayez dans un instant.
            </p>
          )}
        </div>
      )}

      {!loading && term.trim().length > 0 && term.trim().length < MIN_SEARCH_LENGTH && (
        <p className="muted-xs" style={{ padding: '0 4px' }}>
          Saisissez au moins {MIN_SEARCH_LENGTH} caractères.
        </p>
      )}

      {!loading && results.walkers.length > 0 && (
        <section className="card" data-testid="search-walkers">
          <div className="card-title">Marcheurs · {results.walkers.length}</div>
          {results.walkers.map((person) => (
            <button
              key={person.uid}
              type="button"
              className="list-row search-row"
              onClick={() => navigate(`/user/${person.uid}`)}
            >
              <Avatar name={person.displayName} photoURL={person.photoURL} size={38} />
              <span className="row-main">
                <span className="row-title">{person.displayName}</span>
                <span className="row-sub">
                  {person.byCode ? 'Code ami trouvé · ' : ''}
                  {fmtNumber(person.totalSteps || 0)} pas cumulés
                  {person.streak ? ` · série de ${person.streak} j` : ''}
                </span>
              </span>
              <span aria-hidden="true">→</span>
            </button>
          ))}
        </section>
      )}

      {!loading && results.routes.length > 0 && (
        <section className="card" data-testid="search-routes">
          <div className="card-title">Parcours · {results.routes.length}</div>
          {results.routes.map((route) => (
            <button
              key={route.id}
              type="button"
              className="list-row search-row"
              onClick={() => navigate('/routes')}
            >
              <span style={{ fontSize: 20 }} aria-hidden="true">🧭</span>
              <span className="row-main">
                <span className="row-title">{route.name}</span>
                <span className="row-sub">
                  {formatDistance(route.distanceM, 'metric')}
                  {route.authorName ? ` · ${route.authorName}` : ''}
                </span>
              </span>
            </button>
          ))}
        </section>
      )}

      {!loading && results.events.length > 0 && (
        <section className="card" data-testid="search-events">
          <div className="card-title">Rencontres · {results.events.length}</div>
          {results.events.map((event) => (
            <button
              key={event.id}
              type="button"
              className="list-row search-row"
              onClick={() => navigate(`/events?e=${event.id}`)}
            >
              <span style={{ fontSize: 20 }} aria-hidden="true">👥</span>
              <span className="row-main">
                <span className="row-title">{event.title}</span>
                <span className="row-sub">
                  {new Date(`${event.date}T${event.time || '09:00'}`).toLocaleDateString('fr-FR', {
                    dateStyle: 'medium',
                  })}
                  {event.location ? ` · ${event.location}` : ''}
                </span>
              </span>
            </button>
          ))}
        </section>
      )}

      {!loading && results.partners.length > 0 && (
        <section className="card" data-testid="search-partners">
          <div className="card-title">Partenaires · {results.partners.length}</div>
          {results.partners.map((partner) => (
            <button
              key={partner.id}
              type="button"
              className="list-row search-row"
              onClick={() => navigate('/map')}
            >
              <span style={{ fontSize: 20 }} aria-hidden="true">📍</span>
              <span className="row-main">
                <span className="row-title">{partner.name}</span>
                <span className="row-sub">{partner.address || 'Adresse non renseignée'}</span>
              </span>
            </button>
          ))}
        </section>
      )}

      {!loading && searched && count > 0 && failed.length > 0 && (
        <p className="muted-xs" data-testid="search-partial">
          Une partie des sources n’a pas répondu : certains résultats peuvent manquer.
        </p>
      )}
      {/* Silence volontaire sur les sections vides : l'état vide global suffit. */}
      {sectionFailed('walkers') && null}
    </div>
  );
}
