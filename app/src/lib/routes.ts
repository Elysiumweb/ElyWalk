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

export async function listRoutes(uid: string): Promise<SavedRoute[]> {
  // Deux petites requêtes évitent de rendre publics les parcours privés.
  const own = await getDocs(query(collection(db, 'savedRoutes'), where('uid', '==', uid), limit(50)));
  const publicQuery: QueryConstraint[] = [where('visibility', '==', 'public'), orderBy('updatedAt', 'desc'), limit(50)];
  const shared = await getDocs(query(collection(db, 'savedRoutes'), ...publicQuery));
  const all = [...own.docs, ...shared.docs];
  const unique = new Map(all.map(d => [d.id, { id: d.id, ...(d.data() as SavedRoute) }]));
  return [...unique.values()].sort((a, b) => b.updatedAt - a.updatedAt);
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
