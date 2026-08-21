import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { ActivitySession, UserProfile } from './types';
import { fmtNumber, formatDistance } from './coins';

export type ShareResult = 'shared' | 'downloaded';

/**
 * Partage (ou télécharge) une image PNG générée par l'application.
 *
 * - Sur mobile natif : on écrit le fichier dans le cache puis on ouvre
 *   la feuille de partage système (ce qui manquait — le téléchargement
 *   d'un blob via <a download> ne fonctionne pas dans la WebView).
 * - Sur le web : feuille de partage du navigateur si disponible, sinon
 *   téléchargement classique.
 */
async function shareDataUrl(dataUrl: string, filename: string, title: string, text: string): Promise<ShareResult> {
  if (Capacitor.isNativePlatform()) {
    const base64 = dataUrl.substring(dataUrl.indexOf(',') + 1);
    await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache, recursive: true });
    const uri = await Filesystem.getUri({ directory: Directory.Cache, path: filename });
    try {
      await Share.share({ title, text, dialogTitle: title, files: [uri.uri] });
    } catch (e) {
      // L'utilisateur qui ferme simplement la feuille de partage n'est pas une erreur.
      const msg = (e as Error)?.message || '';
      if (!/cancel|abort/i.test(msg)) throw e;
    }
    return 'shared';
  }

  const blob = await (await fetch(dataUrl)).blob();
  const file = new File([blob], filename, { type: 'image/png' });
  if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
    await navigator.share({ title, text, files: [file] });
    return 'shared';
  }
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
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

/** Génère une vraie carte PNG partageable puis ouvre le partage natif. */
export async function shareDailyStats(profile: UserProfile, steps: number, distance: string, calories: number): Promise<ShareResult> {
  const canvas = dailyCanvas(profile, steps, distance, calories);
  const dataUrl = canvas.toDataURL('image/png');
  return shareDataUrl(dataUrl, 'elywalk-pas-du-jour.png', 'Mes pas du jour avec ElyWalk', `J'ai marché ${fmtNumber(steps)} pas aujourd'hui !`);
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
  // Fond du cadre
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
    // On compense la déformation longitude/latitude pour un rendu lisible.
    const nx = (p.lng - minLng) / spanLng;
    const ny = (p.lat - minLat) / spanLat;
    const px = x + pad + nx * (w - pad * 2);
    const py = y + h - pad - ny * (h - pad * 2); // lat croissante vers le haut
    return [px, py] as const;
  };
  // Tracé du parcours
  ctx.strokeStyle = '#D8CA82'; ctx.lineWidth = 9; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => {
    const [px, py] = project(p);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  });
  ctx.stroke();
  // Départ (vert) et arrivée (or)
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

  // Carte du parcours
  drawRoute(ctx, session, 70, 300, 940, 470);

  // Statistiques
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

/** Génère une carte PNG d'une sortie (trajet + stats) puis ouvre le partage natif. */
export async function shareActivity(session: ActivitySession, profile: UserProfile, strideCm = 75): Promise<ShareResult> {
  const canvas = activityCanvas(session, profile, strideCm);
  const dataUrl = canvas.toDataURL('image/png');
  const filename = `elywalk-sortie-${session.id || session.startedAt}.png`;
  const km = ((session.distanceM || 0) / 1000).toFixed(2);
  return shareDataUrl(dataUrl, filename, 'Ma sortie ElyWalk', `J'ai parcouru ${km} km avec ElyWalk !`);
}
