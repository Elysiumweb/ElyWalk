import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query,
  updateDoc, where, type QueryConstraint,
} from 'firebase/firestore';
import { db } from './firebase';
import { distanceBetween } from './activity';
import type { ActivityPoint, SavedRoute, UserProfile } from './types';

/** Statistiques calculées localement : aucune position n'est envoyée à un service tiers. */
export function routeStats(points: ActivityPoint[]) {
  let distanceM = 0;
  let elevationGainM = 0;
  let elevationLossM = 0;
  for (let i = 1; i < points.length; i++) {
    distanceM += distanceBetween(points[i - 1], points[i]);
    const before = points[i - 1].altitude;
    const after = points[i].altitude;
    if (before != null && after != null) {
      // Filtre les petites variations barométriques/GPS (seuil de 3 m).
      const delta = after - before;
      if (delta >= 3) elevationGainM += delta;
      else if (delta <= -3) elevationLossM += -delta;
    }
  }
  return { distanceM: Math.round(distanceM), elevationGainM: Math.round(elevationGainM), elevationLossM: Math.round(elevationLossM) };
}

/** Import GPX local : balisage parsé par le navigateur, jamais téléversé. */
export function parseGpx(xml: string): { name: string; points: ActivityPoint[] } {
  if (xml.length > 5_000_000) throw new Error('Le fichier GPX dépasse 5 Mo.');
  const documentXml = new DOMParser().parseFromString(xml, 'application/xml');
  if (documentXml.querySelector('parsererror')) throw new Error('Fichier GPX invalide.');
  const elements = Array.from(documentXml.getElementsByTagName('trkpt'));
  const points = elements.map((node, index): ActivityPoint => {
    const lat = Number(node.getAttribute('lat'));
    const lng = Number(node.getAttribute('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw new Error('Coordonnée GPX invalide.');
    }
    const elevationText = node.getElementsByTagName('ele')[0]?.textContent;
    const timeText = node.getElementsByTagName('time')[0]?.textContent;
    const altitude = elevationText == null ? undefined : Number(elevationText);
    const recorded = timeText ? Date.parse(timeText) : NaN;
    return {
      lat, lng,
      altitude: altitude != null && Number.isFinite(altitude) ? altitude : undefined,
      recordedAt: Number.isFinite(recorded) ? recorded : index,
    };
  });
  if (points.length < 2) throw new Error('Le GPX doit contenir une trace d’au moins deux points.');
  if (points.length > 5000) throw new Error('Le parcours est limité à 5 000 points.');
  const name = documentXml.getElementsByTagName('name')[0]?.textContent?.trim() || 'Parcours importé';
  return { name: name.slice(0, 80), points };
}

export function routeToGpx(route: SavedRoute): string {
  const escape = (s: string) => s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]!));
  const points = route.points.map(p => `    <trkpt lat="${p.lat}" lon="${p.lng}">${p.altitude == null ? '' : `\n      <ele>${p.altitude}</ele>`}\n    </trkpt>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="ElyWalk" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata><name>${escape(route.name)}</name></metadata>\n  <trk><name>${escape(route.name)}</name><trkseg>\n${points}\n  </trkseg></trk>\n</gpx>`;
}

export async function saveRoute(owner: UserProfile, input: { name: string; description?: string; points: ActivityPoint[]; visibility?: SavedRoute['visibility'] }): Promise<string> {
  if (input.points.length < 2 || input.points.length > 5000) throw new Error('Le parcours doit contenir entre 2 et 5 000 points.');
  const ref = await addDoc(collection(db, 'savedRoutes'), {
    uid: owner.uid, ownerName: owner.displayName,
    name: input.name.trim().slice(0, 80) || 'Parcours sans nom',
    description: (input.description || '').trim().slice(0, 500),
    points: input.points,
    ...routeStats(input.points),
    visibility: input.visibility || 'private',
    createdAt: Date.now(), updatedAt: Date.now(),
  } satisfies SavedRoute);
  return ref.id;
}

export interface SavedRoutesPage {
  items: SavedRoute[];
  /** Curseurs de reprise pour chaque source (`own`, `public`). */
  cursor: { own: number | null; shared: number | null };
  hasMore: boolean;
}

const ROUTES_PAGE_SIZE = 20;

/**
 * Parcours personnels **et** publics, paginés par curseur.
 *
 * Avant : deux requêtes plafonnées à 50 documents chacune, triées en mémoire.
 * Au-delà de 50 parcours, les plus anciens devenaient introuvables — et la
 * recherche textuelle de l'écran ne portait que sur ces 100 documents chargés
 * (F06). Ici chaque source est paginée indépendamment, sans limite fixe, et le
 * curseur est un simple décalage mémorisé côté appelant (`offset`), ce qui
 * suffit pour une bibliothèque personnelle et évite un index composite sur
 * `updatedAt`.
 */
export async function listRoutesPage(
  uid: string,
  options: { offset?: { own: number; shared: number }; pageSize?: number } = {}
): Promise<SavedRoutesPage> {
  const pageSize = Math.min(50, Math.max(1, options.pageSize || ROUTES_PAGE_SIZE));
  const ownOffset = options.offset?.own || 0;
  const sharedOffset = options.offset?.shared || 0;
  const own: QueryConstraint[] = [where('uid', '==', uid), orderBy('updatedAt', 'desc'), limit(ownOffset + pageSize + 1)];
  const publicQuery: QueryConstraint[] = [where('visibility', '==', 'public'), orderBy('updatedAt', 'desc'), limit(sharedOffset + pageSize + 1)];
  const [ownSnaps, sharedSnaps] = await Promise.all([
    getDocs(query(collection(db, 'savedRoutes'), ...own)),
    getDocs(query(collection(db, 'savedRoutes'), ...publicQuery)),
  ]);
  const ownDocs = ownSnaps.docs.slice(ownOffset, ownOffset + pageSize);
  const sharedDocs = sharedSnaps.docs.slice(sharedOffset, sharedOffset + pageSize);
  const unique = new Map<string, SavedRoute>();
  for (const d of [...ownDocs, ...sharedDocs]) unique.set(d.id, { id: d.id, ...(d.data() as SavedRoute) });
  return {
    items: [...unique.values()].sort((a, b) => b.updatedAt - a.updatedAt),
    cursor: {
      own: ownSnaps.docs.length > ownOffset + pageSize ? ownOffset + pageSize : null,
      shared: sharedSnaps.docs.length > sharedOffset + pageSize ? sharedOffset + pageSize : null,
    },
    hasMore: ownDocs.length === pageSize || sharedDocs.length === pageSize,
  };
}

/**
 * Tous les parcours accessibles (bibliothèque complète), page après page.
 * Utilisé par la recherche globale de l'écran Parcours.
 */
export async function listRoutes(uid: string): Promise<SavedRoute[]> {
  const all = new Map<string, SavedRoute>();
  let offset = { own: 0, shared: 0 };
  // Garde-fou : 50 pages de 20 = 1 000 parcours, largement au-delà de l'usage
  // réel, tout en évitant une boucle infinie si le serveur renvoie toujours
  // des documents.
  for (let page = 0; page < 50; page += 1) {
    const result = await listRoutesPage(uid, { offset, pageSize: ROUTES_PAGE_SIZE });
    for (const route of result.items) if (route.id) all.set(route.id, route);
    if (!result.hasMore) break;
    offset = { own: result.cursor.own ?? offset.own, shared: result.cursor.shared ?? offset.shared };
  }
  return [...all.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getRoute(id: string): Promise<SavedRoute | null> {
  const snap = await getDoc(doc(db, 'savedRoutes', id));
  return snap.exists() ? { id: snap.id, ...(snap.data() as SavedRoute) } : null;
}

export async function duplicateRoute(route: SavedRoute, owner: UserProfile): Promise<string> {
  return saveRoute(owner, { name: `${route.name} (copie)`, description: route.description, points: route.points, visibility: 'private' });
}

export async function updateRouteVisibility(uid: string, routeId: string, visibility: SavedRoute['visibility']): Promise<void> {
  await updateDoc(doc(db, 'savedRoutes', routeId), { visibility, updatedAt: Date.now() });
}

export async function deleteRoute(uid: string, routeId: string): Promise<void> {
  await deleteDoc(doc(db, 'savedRoutes', routeId));
}

/** Plus petit écart au tracé, utile pour le guidage sans conserver d'historique supplémentaire. */
export function distanceToRoute(position: Pick<ActivityPoint, 'lat' | 'lng'>, points: ActivityPoint[]): number {
  return points.reduce((best, p) => Math.min(best, distanceBetween(position as ActivityPoint, p)), Number.POSITIVE_INFINITY);
}
