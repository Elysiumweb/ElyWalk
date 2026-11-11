/**
 * Photos de profil — **stockées en base64 dans Firestore**.
 *
 * Choix produit : l'application n'utilise pas Firebase Storage (bucket non
 * configuré sur le projet). L'ancienne implémentation tentait `uploadBytes`,
 * laissait la requête en attente très longtemps (d'où le chargement infini)
 * puis basculait sur une data-URL, elle-même parfois rejetée par les règles
 * Firestore (`request.resource.size` d'un document ≤ 1 Mio).
 *
 * Ici, tout est recadré et compressé **côté client** avant l'écriture, jusqu'à
 * obtenir une data-URL suffisamment compacte pour tenir dans le document
 * `users/{uid}` avec une marge confortable : 192 px, puis 160, 128, 112 et 96
 * à qualité décroissante (cible < 60 Ko). Aucun appel réseau autre que
 * l'écriture Firestore.
 */

/**
 * 1 Mio = limite dure d'un document Firestore ; on vise < 60 Ko. Le profil est
 * relu à chaque connexion, et le classement lit plusieurs profils d'affilée :
 * des avatars compactes gardent ces lectures légères.
 */
const MAX_DATA_URL_BYTES = 60_000;

/** Recadre au carré et compresse une image en JPEG. */
export function compressImage(file: Blob, maxSize = 256, quality = 0.72): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const side = Math.min(img.width, img.height);
        if (!side) throw new Error('Image vide.');
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

/** Paliers essayés du plus généreux au plus compact. */
const AVATAR_STEPS: Array<{ size: number; quality: number }> = [
  { size: 192, quality: 0.72 },
  { size: 160, quality: 0.66 },
  { size: 128, quality: 0.6 },
  { size: 112, quality: 0.55 },
  { size: 96, quality: 0.5 },
];

/**
 * Convertit un fichier en data-URL JPEG compacte prête pour Firestore.
 * Lève une erreur explicite si l'image reste trop lourde après compression.
 */
export async function toFirestoreAvatarDataUrl(file: Blob): Promise<string> {
  for (const step of AVATAR_STEPS) {
    const blob = await compressImage(file, step.size, step.quality);
    const dataUrl = await blobToDataUrl(blob);
    // Les data-URL sont en ASCII : la longueur ≈ le nombre d'octets stockés.
    if (dataUrl.length <= MAX_DATA_URL_BYTES) return dataUrl;
  }
  throw new Error('Photo trop lourde, choisissez une image plus simple (moins de détails).');
}

/**
 * Plus rien à supprimer côté Storage : la photo vit dans le document du profil
 * et disparaît avec lui. Les anciennes URL Storage éventuelles ne sont pas
 * accessibles (bucket absent), on ignore donc les erreurs.
 */
export async function deleteAvatar(_uid: string): Promise<void> {
  /* no-op — conservé pour les appelants existants */
}

/** `true` si la chaîne est une image embarquée (data-URL), utile pour l'UI. */
export function isEmbeddedImage(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith('data:image/');
}

/**
 * Réduit une data-URL trop volumineuse déjà stockée (profils enregistrés avec
 * l'ancienne limite de 150 Ko). Utilisé au chargement du profil : la photo est
 * réécrite une seule fois, uniquement si elle dépasse la limite actuelle.
 */
export async function shrinkStoredAvatar(dataUrl: string): Promise<string | null> {
  if (!isEmbeddedImage(dataUrl) || dataUrl.length <= MAX_DATA_URL_BYTES) return null;
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    return await toFirestoreAvatarDataUrl(blob);
  } catch {
    return null;
  }
}
