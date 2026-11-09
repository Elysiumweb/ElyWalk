import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  updateDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';

export interface Establishment {
  id?: string;
  name: string;
  address: string;
  description: string;
  logoDataUrl: string | null;
  lat: number;
  lng: number;
  openingHours?: string;
  website?: string;
  phone?: string;
  offerText?: string;
  createdBy: string;
  createdAt: number;
}

/** Géocode une adresse via Nominatim (OpenStreetMap). */
export async function geocodeAddress(
  address: string
): Promise<{ lat: number; lng: number; display: string } | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const data = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  if (!data.length) return null;
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), display: data[0].display_name };
}

/** Redimensionne un logo en dataURL compact (max 160px) pour Firestore. */
export function resizeLogoToDataUrl(file: File, maxSize = 160): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => reject(new Error('Image illisible.'));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error('Lecture du fichier impossible.'));
    reader.readAsDataURL(file);
  });
}

export async function createEstablishment(
  data: Omit<Establishment, 'id' | 'createdAt'>
): Promise<void> {
  await addDoc(collection(db, 'establishments'), { ...data, createdAt: Date.now() });
}

export async function updateEstablishment(id: string, data: Partial<Establishment>): Promise<void> {
  await updateDoc(doc(db, 'establishments', id), data);
}

export async function deleteEstablishment(id: string): Promise<void> {
  await deleteDoc(doc(db, 'establishments', id));
}

export async function listEstablishments(): Promise<Establishment[]> {
  const snaps = await getDocs(collection(db, 'establishments'));
  return snaps.docs
    .map((d) => ({ id: d.id, ...(d.data() as Establishment) }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function watchEstablishments(cb: (list: Establishment[]) => void): Unsubscribe {
  return onSnapshot(collection(db, 'establishments'), (snaps) => {
    cb(snaps.docs.map((d) => ({ id: d.id, ...(d.data() as Establishment) })));
  });
}
