import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { ActivitySession, UserProfile } from './types';
import { fmtNumber, formatDistance } from './coins';

export type ShareResult = 'shared' | 'downloaded';

/** Blob PNG → base64 brut (sans le préfixe data:). */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const s = String(reader.result || '');
      resolve(s.indexOf(',') >= 0 ? s.substring(s.indexOf(',') + 1) : s);
    };
    reader.onerror = () => reject(new Error('Lecture de l’image impossible.'));
    reader.readAsDataURL(blob);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  // JPEG : un fond dégradé produit un PNG énorme (plusieurs Mo) qui sature
  // la mémoire au passage du pont Capacitor et fait planter l'app au partage.
  // En JPEG, la même carte fait ~100 Ko -> partage instantané et stable.
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Génération de l’image impossible.'))), 'image/jpeg', 0.9);
  });
}

/**
 * Partage (ou télécharge) une image PNG générée par l’application.
 *
 * - Sur mobile natif : on écrit le fichier dans le cache puis on ouvre la
 *   feuille de partage système (le téléchargement d’un blob via <a download>
 *   ne fonctionne pas dans la WebView).
 * - Sur le web : feuille de partage du navigateur si disponible, sinon
 *   téléchargement classique.
 *
 * Ne lève jamais d’erreur non attrapée : en cas d’échec du partage natif,
 * on retombe sur le téléchargement, puis sur un message d’erreur lisible.
 */
async function shareCanvas(canvas: HTMLCanvasElement, filename: string, title: string, text: string): Promise<ShareResult> {
  const blob = await canvasToBlob(canvas);

  if (Capacitor.isNativePlatform()) {
    try {
      const base64 = await blobToBase64(blob);
      await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
      const uri = await Filesystem.getUri({ directory: Directory.Cache, path: filename });
      await Share.share({ title, text, dialogTitle: title, files: [uri.uri] });
      return 'shared';
    } catch (e) {
      const msg = (e as Error)?.message || '';
      // L’utilisateur qui ferme la feuille de partage n’est pas une erreur.
      if (/cancel|abort/i.test(msg)) return 'shared';
      // Sinon : repli sur le téléchargement (ci-dessous) avant d’abandonner.
    }
  }

  const file = new File([blob], filename, { type: 'image/jpeg' });
  if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
    try {
      await navigator.share({ title, text, files: [file] });
      return 'shared';
    } catch (e) {
      if (/cancel|abort/i.test((e as Error)?.message || '')) return 'shared';
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return 'downloaded';
}

function dailyCanvas(profile: UserProfile, steps: number, distance: string, calories: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 1080; canvas.height = 1350;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, 1080, 1350);
  gradient.addColorStop(0, '#25241e'); gradient.addColorStop(1, '#111111');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#D8CA82'; ctx.lineWidth = 3; ctx.strokeRect(38, 38, 1004, 1274);
  ctx.fillStyle = '#D8CA82'; ctx.font = '700 46px Arial'; ctx.fillText('ELYWALK', 84, 125);
  ctx.fillStyle = '#ffffff'; ctx.font = '700 62px Arial'; ctx.fillText('Mes pas du jour', 84, 280);
  ctx.fillStyle = '#D8CA82'; ctx.font = '700 152px Arial'; ctx.fillText(fmtNumber(steps), 84, 520);
  ctx.fillStyle = '#98948a'; ctx.font = '38px Arial'; ctx.fillText('PAS', 88, 580);
  const stats = [`${distance}`, `${calories} kcal`];
  stats.forEach((value, i) => {
    ctx.fillStyle = '#ffffff'; ctx.font = '700 54px Arial'; ctx.fillText(value, 90 + i * 430, 790);
    ctx.fillStyle = '#98948a'; ctx.font = '28px Arial'; ctx.fillText(i === 0 ? 'DISTANCE' : 'ÉNERGIE', 94 + i * 430, 840);
  });
  ctx.fillStyle = '#d8d2c2'; ctx.font = '34px Arial'; ctx.fillText(`Bravo ${profile.displayName} !`, 84, 1120);
  ctx.fillStyle = '#98948a'; ctx.font = '26px Arial'; ctx.fillText('Marchez. Progressez. Gagnez.', 84, 1180);
  return canvas;
}

/** Génère une vraie carte JPEG partageable puis ouvre le partage natif. */
export async function shareDailyStats(profile: UserProfile, steps: number, distance: string, calories: number): Promise<ShareResult> {
  return shareCanvas(dailyCanvas(profile, steps, distance, calories), 'elywalk-pas-du-jour.jpg', 'Mes pas du jour avec ElyWalk', `J'ai marché ${fmtNumber(steps)} pas aujourd'hui !`);
}

/** Estime le nombre de pas d'une sortie quand le podomètre n'était pas dispo. */
function estimateSteps(session: ActivitySession, strideCm = 75): number {
  if (typeof session.steps === 'number' && session.steps > 0) return session.steps;
  return Math.round((session.distanceM || 0) / (strideCm / 100));
}

function speedKmh(distanceM: number, durationSec: number): number {
  if (durationSec <= 0) return 0;
  return distanceM / 1000 / (durationSec / 3600);
}

function drawRoute(ctx: CanvasRenderingContext2D, session: ActivitySession, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = '#1c1b16'; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#3a382a'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
  const pts = session.points || [];
  if (pts.length < 2) {
    ctx.fillStyle = '#5a5847'; ctx.font = '34px Arial'; ctx.textAlign = 'center';
    ctx.fillText('Parcours non disponible', x + w / 2, y + h / 2);
    ctx.textAlign = 'left';
    return;
  }
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of pts) {
    minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng);
  }
  const pad = 60;
  const spanLat = Math.max(maxLat - minLat, 1e-6);
  const spanLng = Math.max(maxLng - minLng, 1e-6);
  const project = (p: { lat: number; lng: number }) => {
    const nx = (p.lng - minLng) / spanLng;
    const ny = (p.lat - minLat) / spanLat;
    const px = x + pad + nx * (w - pad * 2);
    const py = y + h - pad - ny * (h - pad * 2);
    return [px, py] as const;
  };
  ctx.strokeStyle = '#D8CA82'; ctx.lineWidth = 9; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => {
    const [px, py] = project(p);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  });
  ctx.stroke();
  const [sx, sy] = project(pts[0]);
  const [ex, ey] = project(pts[pts.length - 1]);
  ctx.fillStyle = '#5bd46f'; ctx.beginPath(); ctx.arc(sx, sy, 16, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#D8CA82'; ctx.beginPath(); ctx.arc(ex, ey, 16, 0, Math.PI * 2); ctx.fill();
}

function activityCanvas(session: ActivitySession, profile: UserProfile, strideCm = 75): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 1080; canvas.height = 1350;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, 1080, 1350);
  gradient.addColorStop(0, '#25241e'); gradient.addColorStop(1, '#111111');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#D8CA82'; ctx.lineWidth = 3; ctx.strokeRect(38, 38, 1004, 1274);
  ctx.fillStyle = '#D8CA82'; ctx.font = '700 44px Arial'; ctx.fillText('ELYWALK', 84, 120);
  ctx.fillStyle = '#ffffff'; ctx.font = '700 58px Arial'; ctx.fillText('Ma sortie ElyWalk', 84, 200);
  ctx.fillStyle = '#98948a'; ctx.font = '32px Arial';
  const label = session.type === 'run' ? 'Course' : 'Marche';
  const date = new Date(session.startedAt).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  ctx.fillText(`${label} · ${date}`, 84, 248);

  drawRoute(ctx, session, 70, 300, 940, 470);

  const steps = estimateSteps(session, strideCm);
  const speed = speedKmh(session.distanceM || 0, session.durationSec || 0);
  const cells: Array<[string, string]> = [
    [formatDistance(session.distanceM || 0, profile.unitSystem || profile.health?.unitSystem || 'metric'), 'DISTANCE'],
    [`${Math.floor((session.durationSec || 0) / 60)} min`, 'DURÉE'],
    [fmtNumber(steps), 'PAS'],
    [`${session.calories || 0}`, 'KCAL'],
    [`${speed.toFixed(1)} km/h`, 'VITESSE MOY.'],
  ];
  const startY = 830;
  const colW = 940 / cells.length;
  cells.forEach(([value, name], i) => {
    const cx = 70 + colW * i + colW / 2;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#D8CA82'; ctx.font = '700 52px Arial'; ctx.fillText(value, cx, startY);
    ctx.fillStyle = '#98948a'; ctx.font = '24px Arial'; ctx.fillText(name, cx, startY + 44);
  });
  ctx.textAlign = 'left';
  ctx.fillStyle = '#d8d2c2'; ctx.font = '34px Arial'; ctx.fillText(`Bravo ${profile.displayName} !`, 84, 1170);
  ctx.fillStyle = '#98948a'; ctx.font = '26px Arial'; ctx.fillText('Marchez. Progressez. Gagnez.', 84, 1220);
  return canvas;
}

/** Génère une carte JPEG d'une sortie (trajet + stats) puis ouvre le partage natif. */
export async function shareActivity(session: ActivitySession, profile: UserProfile, strideCm = 75): Promise<ShareResult> {
  const filename = `elywalk-sortie-${session.id || session.startedAt}.jpg`;
  const km = ((session.distanceM || 0) / 1000).toFixed(2);
  return shareCanvas(activityCanvas(session, profile, strideCm), filename, 'Ma sortie ElyWalk', `J'ai parcouru ${km} km avec ElyWalk !`);
}
