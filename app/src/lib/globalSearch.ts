import type { CommunityEvent, SavedRoute, UserProfile } from './types';
import type { Establishment } from './establishments';

/**
 * Recherche globale (A11).
 *
 * Constat : la recherche était cloisonnée — `/routes` filtrait la bibliothèque
 * chargée, `/map` les partenaires, `/friends` un pseudo. Aucun point d'entrée
 * unique.
 *
 * Ce module ne fait **aucune requête lui-même** : il reçoit les fonctions de
 * chargement (`GlobalSearchLoaders`) et croise les résultats. C'est ce qui le
 * rend testable sans Firebase, et réutilisable par l'accueil (champ unique) ou
 * par l'écran de recherche (appui long sur l'onglet Carte).
 */

export interface SearchPerson {
  uid: string;
  displayName: string;
  photoURL?: string | null;
  totalSteps?: number;
  streak?: number;
  /** `true` quand la correspondance vient du code ami, pas du pseudo. */
  byCode?: boolean;
}

export interface SearchRoute {
  id: string;
  name: string;
  authorName?: string;
  distanceM: number;
  visibility?: 'private' | 'public';
}

export interface SearchEvent {
  id: string;
  title: string;
  date: string;
  time?: string | null;
  location?: string | null;
}

export interface SearchPartner {
  id: string;
  name: string;
  city?: string;
  address?: string;
}

export interface GlobalSearchResults {
  walkers: SearchPerson[];
  routes: SearchRoute[];
  events: SearchEvent[];
  partners: SearchPartner[];
}

export interface GlobalSearchLoaders {
  /** Marcheurs par pseudo (et éventuellement par code ami). */
  walkers: (term: string) => Promise<SearchPerson[]>;
  /** Parcours accessibles (les siens et les parcours publics). */
  routes: () => Promise<SavedRoute[]>;
  /** Rencontres à venir. */
  events: () => Promise<CommunityEvent[]>;
  /** Établissements partenaires. */
  partners: () => Promise<Establishment[]>;
}

export const EMPTY_SEARCH_RESULTS: GlobalSearchResults = {
  walkers: [],
  routes: [],
  events: [],
  partners: [],
};

/** Longueur minimale d'une recherche (évite une requête par touche). */
export const MIN_SEARCH_LENGTH = 2;

/** Normalise pour comparer sans accents ni casse (« Tête d'Or » = « tete d or »). */
export function normalizeSearchText(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** `true` si `haystack` contient tous les mots de `term`. */
export function matchesQuery(haystack: string, term: string): boolean {
  const target = normalizeSearchText(haystack);
  const words = normalizeSearchText(term).split(' ').filter(Boolean);
  if (!words.length) return false;
  return words.every((word) => target.includes(word));
}

export function totalResults(results: GlobalSearchResults): number {
  return results.walkers.length + results.routes.length + results.events.length + results.partners.length;
}

/** Applique la recherche locale sur les collections déjà chargées. */
export function filterLoaded(
  term: string,
  data: { routes: SavedRoute[]; events: CommunityEvent[]; partners: Establishment[] },
): Pick<GlobalSearchResults, 'routes' | 'events' | 'partners'> {
  return {
    routes: data.routes
      .filter((route) => matchesQuery(`${route.name} ${route.description || ''}`, term))
      .slice(0, 6)
      .map((route) => ({
        id: route.id || '',
        name: route.name,
        authorName: route.ownerName,
        distanceM: route.distanceM ?? 0,
        visibility: route.visibility,
      })),
    events: data.events
      .filter((event) => matchesQuery(`${event.title} ${event.location || ''} ${event.establishmentName || ''}`, term))
      .slice(0, 6)
      .map((event) => ({
        id: event.id || '',
        title: event.title,
        date: event.date,
        time: event.time,
        location: event.location || event.establishmentName || null,
      })),
    partners: data.partners
      .filter((partner) => matchesQuery(`${partner.name} ${partner.address} ${partner.description || ''}`, term))
      .slice(0, 6)
      .map((partner) => ({
        id: partner.id || '',
        name: partner.name,
        address: partner.address,
      })),
  };
}

/**
 * Lance les quatre recherches **en parallèle** et renvoie des sections.
 *
 * Une source en échec ne doit pas vider les autres : chaque chargement est
 * isolé (`allSettled`), et le compte rendu indique quelles sections ont échoué.
 */
export async function runGlobalSearch(
  term: string,
  loaders: GlobalSearchLoaders,
): Promise<{ results: GlobalSearchResults; failed: Array<keyof GlobalSearchResults> }> {
  const clean = term.trim();
  if (clean.length < MIN_SEARCH_LENGTH) {
    return { results: EMPTY_SEARCH_RESULTS, failed: [] };
  }
  const failed: Array<keyof GlobalSearchResults> = [];
  const settle = async <T,>(name: keyof GlobalSearchResults, promise: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await promise;
    } catch {
      failed.push(name);
      return fallback;
    }
  };

  const [walkers, routes, events, partners] = await Promise.all([
    settle('walkers', loaders.walkers(clean), [] as SearchPerson[]),
    settle('routes', loaders.routes(), [] as SavedRoute[]),
    settle('events', loaders.events(), [] as CommunityEvent[]),
    settle('partners', loaders.partners(), [] as Establishment[]),
  ]);

  const filtered = filterLoaded(clean, { routes, events, partners });
  return {
    results: {
      walkers: walkers.filter((person) => matchesQuery(`${person.displayName} ${person.uid}`, clean) || person.byCode).slice(0, 6),
      ...filtered,
    },
    failed,
  };
}

/** Convertisseurs vers les types d'affichage (utilisés par l'écran). */
export function personFromProfile(profile: UserProfile, byCode = false): SearchPerson {
  return {
    uid: profile.uid,
    displayName: profile.displayName,
    photoURL: profile.photoURL || null,
    totalSteps: profile.totalSteps,
    streak: profile.streak,
    byCode,
  };
}
