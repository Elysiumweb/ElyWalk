import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { firebaseApp } from './firebase';

/** Compresse une image en JPEG carré (recadrage centré). */
export function compressImage(file: Blob, maxSize = 256, quality = 0.72): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const side = Math.min(img.width, img.height);
        const sx = Math.floor((img.width - side) / 2);
        const sy = Math.floor((img.height - side) / 2);
        const out = Math.min(maxSize, side);
        const canvas = document.createElement('canvas');
        canvas.width = out;
        canvas.height = out;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas indisponible.');
        ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out);
        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(url);
            if (blob) resolve(blob);
            else reject(new Error('Compression impossible.'));
          },
          'image/jpeg',
          quality
        );
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image illisible.'));
    };
    img.src = url;
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Lecture du fichier impossible.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Envoie la photo vers Firebase Storage, ou bascule sur une data-URL
 * compacte si le bucket n'est pas encore configuré.
 */
export async function uploadAvatar(uid: string, file: Blob): Promise<string> {
  const blob = await compressImage(file, 256, 0.74);
  try {
    const storage = getStorage(firebaseApp);
    const r = ref(storage, `avatars/${uid}.jpg`);
    await uploadBytes(r, blob, { contentType: 'image/jpeg', cacheControl: 'public,max-age=3600' });
    return await getDownloadURL(r);
  } catch (e) {
    console.warn('[Avatar] Storage indisponible, fallback data-URL', e);
    const small = await compressImage(file, 160, 0.62);
    const dataUrl = await blobToDataUrl(small);
    if (dataUrl.length > 180_000) {
      throw new Error('Photo trop lourde. Choisissez une image plus petite.');
    }
    return dataUrl;
  }
}
