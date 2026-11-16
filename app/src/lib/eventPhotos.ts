import {
  collection, deleteDoc, doc, getDocs, onSnapshot, query, setDoc, where,
} from 'firebase/firestore';
import { db } from './firebase';
import { compressImage } from './avatar';
import type { UserProfile } from './types';

/**
 * Galerie d'une rencontre (A10) — **3 photos maximum**, compressées côté
 * client et stockées dans Firestore.
 *
 * Pourquoi Firestore et pas Storage : le projet n'a pas de bucket Storage
 * configuré (voir `lib/avatar.ts`, même contrainte pour les avatars). Une photo
 * est recadrée et compressée jusqu'à tenir sous 90 Ko de data-URL, donc trois
 * photos restent très loin de la limite d'1 Mio d'un document.
 *
 * Identifiant déterministe `<eventId>_<slot>` : une seule photo par
 * emplacement, remplaçable par le même appareil photo/participant — la galerie
 * ne peut donc pas grossir sans contrôle.
 */

export const EVENT_PHOTO_SLOTS = 3;
/** Taille maximale d'une data-URL stockée (octets ≈ caractères ASCII). */
export const EVENT_PHOTO_MAX_CHARS = 90_000;

export interface EventPhoto {
  id?: string;
  eventId: string;
  slot: number;
  uid: string;
  authorName: string;
  dataUrl: string;
  createdAt: number;
}

export function eventPhotoDocId(eventId: string, slot: number): string {
  return `${eventId}_${slot}`;
}

/** Compresse une photo de rencontre en data-URL JPEG compacte. */
export async function compressEventPhoto(file: Blob): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choisissez une image.');
  for (const step of [
    { size: 640, quality: 0.62 },
    { size: 512, quality: 0.55 },
    { size: 384, quality: 0.5 },
  ]) {
    const blob = await compressImage(file, step.size, step.quality);
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Lecture de l’image impossible.'));
      reader.readAsDataURL(blob);
    });
    if (dataUrl.length <= EVENT_PHOTO_MAX_CHARS) return dataUrl;
  }
  throw new Error('Photo trop lourde. Choisissez une image plus simple.');
}

export async function saveEventPhoto(
  eventId: string,
  slot: number,
  author: UserProfile,
  file: Blob,
): Promise<void> {
  if (slot < 0 || slot >= EVENT_PHOTO_SLOTS) throw new Error('Emplacement photo invalide.');
  const dataUrl = await compressEventPhoto(file);
  await setDoc(doc(db, 'eventPhotos', eventPhotoDocId(eventId, slot)), {
    eventId,
    slot,
    uid: author.uid,
    authorName: author.displayName,
    dataUrl,
    createdAt: Date.now(),
  } satisfies EventPhoto);
}

export async function deleteEventPhoto(eventId: string, slot: number): Promise<void> {
  await deleteDoc(doc(db, 'eventPhotos', eventPhotoDocId(eventId, slot)));
}

export async function listEventPhotos(eventId: string): Promise<EventPhoto[]> {
  const snaps = await getDocs(query(collection(db, 'eventPhotos'), where('eventId', '==', eventId)));
  return snaps.docs
    .map((d) => ({ id: d.id, ...(d.data() as EventPhoto) }))
    .sort((a, b) => a.slot - b.slot);
}

/**
 * Écoute les photos d'une rencontre. `onError` est obligatoire dans le
 * composant appelant : une règle refusée ne doit pas laisser la galerie en
 * chargement perpétuel.
 */
export function watchEventPhotos(
  eventId: string,
  cb: (photos: EventPhoto[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  return onSnapshot(
    query(collection(db, 'eventPhotos'), where('eventId', '==', eventId)),
    (snap) => cb(
      snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as EventPhoto) }))
        .sort((a, b) => a.slot - b.slot),
    ),
    (error) => onError?.(error),
  );
}
