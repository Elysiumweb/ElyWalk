import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { ActivitySession, UserProfile } from './types';
import { fmtNumber, formatDistance } from './coins';
import {
  MAP_STYLES,
  fmtDuration,
  mapStyleLabel,
  weatherLabel,
  type MapStyle,
} from './activity';

export type ShareResult = 'shared' | 'downloaded';

/** Blob JPEG → base64 brut (sans le préfixe data:). */
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

// ============ Carte des pas du jour ============

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

// ============ Carte d'une sortie (trajet sur vraie carte) ============

const TILE = 256;
const TILE_SERVERS = ['a', 'b', 'c', 'd'];

/**
 * Serveurs de tuiles pour les cartes partagées. Tous servent des en-têtes
 * CORS, indispensables pour dessiner dans un canvas sans le « polluer ».
 *
 * - voyager   : rues colorées CARTO (fond clair, très lisible).
 * - dark      : fond sombre CARTO, assorti à la charte ElyWalk.
 * - satellite : imagerie ESRI World Imagery.
 */
function tileUrl(style: MapStyle, z: number, x: number, y: number): string {
  const s = TILE_SERVERS[Math.abs(x + y) % TILE_SERVERS.length];
  if (style === 'dark') return `https://${s}.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`;
  if (style === 'satellite') return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}.png`;
  return `https://${s}.basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}.png`;
}

/** Repli si le style choisi ne répond pas (réseau, quotas). */
function fallbackTileUrl(z: number, x: number, y: number): string {
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${z}/${y}/${x}.png`;
}

function attributionFor(style: MapStyle): string {
  if (style === 'satellite') return '© Esri · © OpenStreetMap';
  return '© OpenStreetMap · © CARTO';
}

/** Couleurs du tracé selon le fond (l'or reste lisible sur les trois). */
function traceColors(style: MapStyle): { halo: string; line: string; start: string; end: string } {
  if (style === 'satellite') return { halo: 'rgba(0,0,0,0.65)', line: '#FFD84D', start: '#7CF08C', end: '#FFD84D' };
  if (style === 'voyager') return { halo: 'rgba(17,17,17,0.6)', line: '#B8860B', start: '#2E9E44', end: '#B8860B' };
  return { halo: 'rgba(0,0,0,0.55)', line: '#D8CA82', start: '#5bd46f', end: '#D8CA82' };
}

/** Projection Web Mercator : (lat,lng) -> coordonnées de tuile fractionnaire. */
function latLngToTileXY(lat: number, lng: number, zoom: number): [number, number] {
  const n = Math.pow(2, zoom);
  const tx = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const ty = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return [tx, ty];
}

/** Charge une tuile en CORS (canvas non pollué). Renvoie null si échec. */
function loadTile(url: string, timeoutMs = 6000): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    let done = false;
    const finish = (val: HTMLImageElement | null) => { if (!done) { done = true; clearTimeout(timer); resolve(val); } };
    const timer = setTimeout(() => finish(null), timeoutMs);
    img.onload = () => finish(img);
    img.onerror = () => finish(null);
    img.src = url;
  });
}

/** Sous-échantillonne les points pour rester rapide sur les longues sorties. */
function downsample<T>(arr: T[], max = 700): T[] {
  if (arr.length <= max) return arr;
  const step = Math.ceil(arr.length / max);
  const out: T[] = [];
  for (let i = 0; i < arr.length; i += step) out.push(arr[i]);
  if (out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1]);
  return out;
}

/**
 * Dessine le trajet sur une vraie carte (tuiles de rue). Projection Web
 * Mercator pour un alignement correct sur les tuiles. Si les tuiles
 * échouent (hors-ligne / réseau), le trajet reste dessiné sur fond sombre.
 */
async function drawMapRoute(
  ctx: CanvasRenderingContext2D,
  rawPoints: { lat: number; lng: number }[],
  x: number,
  y: number,
  w: number,
  h: number,
  style: MapStyle = 'voyager',
): Promise<void> {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = '#0e0e10'; ctx.fillRect(x, y, w, h);

  if (!rawPoints || rawPoints.length < 2) {
    ctx.fillStyle = '#5a5847'; ctx.font = '34px Arial'; ctx.textAlign = 'center';
    ctx.fillText('Parcours non disponible', x + w / 2, y + h / 2);
    ctx.textAlign = 'left'; ctx.restore(); return;
  }

  const points = downsample(rawPoints);

  // Choix du zoom : le plus élevé qui contienne le trajet avec une marge.
  const pad = 52;
  let zoom = 19;
  for (let z = 19; z >= 3; z--) {
    let minTx = Infinity, maxTx = -Infinity, minTy = Infinity, maxTy = -Infinity;
    for (const p of points) { const [tx, ty] = latLngToTileXY(p.lat, p.lng, z); minTx = Math.min(minTx, tx); maxTx = Math.max(maxTx, tx); minTy = Math.min(minTy, ty); maxTy = Math.max(maxTy, ty); }
    if ((maxTx - minTx) * TILE <= w - 2 * pad && (maxTy - minTy) * TILE <= h - 2 * pad) { zoom = z; break; }
  }

  let minTx = Infinity, maxTx = -Infinity, minTy = Infinity, maxTy = -Infinity;
  for (const p of points) { const [tx, ty] = latLngToTileXY(p.lat, p.lng, zoom); minTx = Math.min(minTx, tx); maxTx = Math.max(maxTx, tx); minTy = Math.min(minTy, ty); maxTy = Math.max(maxTy, ty); }
  const mapLeftPx = ((minTx + maxTx) / 2) * TILE - w / 2;
  const mapTopPx = ((minTy + maxTy) / 2) * TILE - h / 2;

  // Tuiles couvrant la zone (limitées à ~20 pour rester réactif).
  const tx0 = Math.floor(mapLeftPx / TILE), tx1 = Math.min(tx0 + 6, Math.floor((mapLeftPx + w - 1) / TILE));
  const ty0 = Math.floor(mapTopPx / TILE), ty1 = Math.min(ty0 + 5, Math.floor((mapTopPx + h - 1) / TILE));
  const tiles: Array<{ tx: number; ty: number }> = [];
  for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) tiles.push({ tx, ty });

  // Style demandé, puis repli ESRI si aucune tuile ne répond.
  let imgs = await Promise.all(tiles.map((t) => loadTile(tileUrl(style, zoom, t.tx, t.ty))));
  if (!imgs.some((i) => i)) imgs = await Promise.all(tiles.map((t) => loadTile(fallbackTileUrl(zoom, t.tx, t.ty))));
  for (let i = 0; i < tiles.length; i++) {
    const img = imgs[i];
    if (img) ctx.drawImage(img, x + tiles[i].tx * TILE - mapLeftPx, y + tiles[i].ty * TILE - mapTopPx);
  }

  // Projection d'un point trajet -> pixel canvas.
  const project = (p: { lat: number; lng: number }): [number, number] => {
    const [tx, ty] = latLngToTileXY(p.lat, p.lng, zoom);
    return [x + tx * TILE - mapLeftPx, y + ty * TILE - mapTopPx];
  };

  // Contour sombre puis ligne colorée (lisible sur fond clair ou sombre).
  const colors = traceColors(style);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const trace = (color: string, width: number) => {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
    points.forEach((p, i) => { const [px, py] = project(p); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
    ctx.stroke();
  };
  trace(colors.halo, 14);
  trace(colors.line, 8);

  // Départ (vert) et arrivée (or).
  const [sx, sy] = project(points[0]);
  const [ex, ey] = project(points[points.length - 1]);
  const marker = (px: number, py: number, fill: string) => {
    ctx.beginPath(); ctx.arc(px, py, 13, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#111'; ctx.stroke();
  };
  marker(sx, sy, colors.start);
  marker(ex, ey, colors.end);

  // Attribution (exigée par les fournisseurs de tuiles).
  const lightText = style !== 'voyager';
  ctx.save();
  ctx.shadowColor = lightText ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.7)';
  ctx.shadowBlur = 4;
  ctx.fillStyle = lightText ? 'rgba(255,255,255,0.8)' : 'rgba(17,17,17,0.85)';
  ctx.font = '20px Arial'; ctx.textAlign = 'left';
  ctx.fillText(attributionFor(style), x + 10, y + h - 12);
  ctx.fillStyle = lightText ? 'rgba(255,255,255,0.95)' : 'rgba(17,17,17,0.9)';
  ctx.font = '600 20px Arial'; ctx.textAlign = 'right';
  ctx.fillText(mapStyleLabel(style).toUpperCase(), x + w - 12, y + h - 12);
  ctx.restore();
  ctx.textAlign = 'left';
  ctx.restore();
}

function estimateSteps(session: ActivitySession, strideCm = 75): number {
  if (typeof session.steps === 'number' && session.steps > 0) return session.steps;
  return Math.round((session.distanceM || 0) / (strideCm / 100));
}
function speedKmh(distanceM: number, durationSec: number): number {
  if (durationSec <= 0) return 0;
  return distanceM / 1000 / (durationSec / 3600);
}

async function buildActivityCanvas(
  session: ActivitySession,
  profile: UserProfile,
  strideCm = 75,
  options: { mapStyle?: MapStyle } = {},
): Promise<HTMLCanvasElement> {
  const mapStyle = options.mapStyle || 'voyager';
  const canvas = document.createElement('canvas');
  canvas.width = 1080; canvas.height = 1350;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, 1080, 1350);
  gradient.addColorStop(0, '#25241e'); gradient.addColorStop(1, '#111111');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#D8CA82'; ctx.lineWidth = 3; ctx.strokeRect(38, 38, 1004, 1274);
  ctx.fillStyle = '#D8CA82'; ctx.font = '700 44px Arial'; ctx.fillText('ELYWALK', 84, 120);
  // Titre personnalisé (tronqué si trop long) sinon titre générique.
  const title = session.title?.trim() || 'Ma sortie ElyWalk';
  ctx.fillStyle = '#ffffff'; ctx.font = '700 58px Arial';
  ctx.fillText(fitText(ctx, title, 910), 84, 200);
  ctx.fillStyle = '#98948a'; ctx.font = '32px Arial';
  const label = session.type === 'run' ? 'Course' : 'Marche';
  const date = new Date(session.startedAt).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const weather = weatherLabel(session.weather);
  ctx.fillText(`${label} · ${date}${weather ? ` · ${weather}` : ''}`, 84, 248);

  // Carte réelle avec le trajet, au style choisi.
  await drawMapRoute(ctx, session.points || [], 70, 300, 940, 470, mapStyle);

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
  if (session.pausedSec && session.pausedSec >= 30) {
    ctx.fillStyle = '#98948a'; ctx.font = '26px Arial';
    ctx.fillText(`Pauses exclues · ${fmtDuration(session.pausedSec)}`, 84, 920);
  }
  ctx.fillStyle = '#d8d2c2'; ctx.font = '34px Arial'; ctx.fillText(`Bravo ${profile.displayName} !`, 84, 1170);
  ctx.fillStyle = '#98948a'; ctx.font = '26px Arial'; ctx.fillText('Marchez. Progressez. Gagnez.', 84, 1220);
  return canvas;
}

/** Réduit la police puis tronque proprement un texte trop large. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut.trim()}…`;
}

/**
 * Génère une carte JPEG d'une sortie (trajet sur vraie carte + stats) puis
 * ouvre le partage natif. `mapStyle` permet de choisir le fond de carte
 * (voyager / sombre / satellite).
 */
export async function shareActivity(
  session: ActivitySession,
  profile: UserProfile,
  strideCm = 75,
  options: { mapStyle?: MapStyle } = {},
): Promise<ShareResult> {
  const canvas = await buildActivityCanvas(session, profile, strideCm, options);
  const filename = `elywalk-sortie-${session.id || session.startedAt}.jpg`;
  const km = ((session.distanceM || 0) / 1000).toFixed(2);
  const title = session.title?.trim() || 'Ma sortie ElyWalk';
  return shareCanvas(canvas, filename, title, `J'ai parcouru ${km} km avec ElyWalk !`);
}

// ============ Synthèse hebdomadaire / mensuelle ============

export interface ShareSummary {
  /** « Ma semaine » ou « Mon mois ». */
  title: string;
  /** « 20 → 26 octobre » ou « octobre 2026 ». */
  subtitle: string;
  steps: number;
  distanceM: number;
  calories: number;
  activeDays: number;
  previousSteps: number | null;
  changePct: number | null;
  goalDays?: number;
  unitSystem?: 'metric' | 'imperial';
}

function buildSummaryCanvas(profile: UserProfile, summary: ShareSummary): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 1080; canvas.height = 1350;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, 1080, 1350);
  gradient.addColorStop(0, '#25241e'); gradient.addColorStop(1, '#111111');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#D8CA82'; ctx.lineWidth = 3; ctx.strokeRect(38, 38, 1004, 1274);

  ctx.fillStyle = '#D8CA82'; ctx.font = '700 44px Arial'; ctx.fillText('ELYWALK', 84, 120);
  ctx.fillStyle = '#ffffff'; ctx.font = '700 62px Arial'; ctx.fillText(summary.title, 84, 220);
  ctx.fillStyle = '#98948a'; ctx.font = '32px Arial'; ctx.fillText(summary.subtitle, 84, 272);

  ctx.fillStyle = '#D8CA82'; ctx.font = '700 150px Arial'; ctx.fillText(fmtNumber(summary.steps), 84, 470);
  ctx.fillStyle = '#98948a'; ctx.font = '38px Arial'; ctx.fillText('PAS', 88, 530);

  const distance = formatDistance(summary.distanceM, summary.unitSystem || 'metric');
  const stats: Array<[string, string]> = [
    [distance, 'DISTANCE'],
    [`${fmtNumber(summary.calories)}`, 'KCAL'],
    [`${summary.activeDays} j`, 'JOURS ACTIFS'],
  ];
  stats.forEach(([value, name], i) => {
    const x = 84 + (i % 2) * 460;
    const y = 680 + Math.floor(i / 2) * 150;
    ctx.fillStyle = '#ffffff'; ctx.font = '700 54px Arial'; ctx.fillText(value, x, y);
    ctx.fillStyle = '#98948a'; ctx.font = '26px Arial'; ctx.fillText(name, x + 2, y + 42);
  });

  // Comparaison avec la période précédente.
  const comparisonY = 1010;
  if (summary.changePct == null) {
    ctx.fillStyle = '#98948a'; ctx.font = '30px Arial';
    ctx.fillText('Première période enregistrée — continuez !', 84, comparisonY);
  } else {
    const positive = summary.changePct >= 0;
    ctx.fillStyle = positive ? '#5bd46f' : '#e8837a';
    ctx.font = '700 64px Arial';
    ctx.fillText(`${positive ? '↑ +' : '↓ '}${summary.changePct} %`, 84, comparisonY);
    ctx.fillStyle = '#98948a'; ctx.font = '28px Arial';
    ctx.fillText(
      `vs période précédente${summary.previousSteps != null ? ` (${fmtNumber(summary.previousSteps)} pas)` : ''}`,
      84,
      comparisonY + 46,
    );
  }

  ctx.fillStyle = '#d8d2c2'; ctx.font = '34px Arial'; ctx.fillText(`Bravo ${profile.displayName} !`, 84, 1170);
  ctx.fillStyle = '#98948a'; ctx.font = '26px Arial'; ctx.fillText('Marchez. Progressez. Gagnez.', 84, 1220);
  return canvas;
}

/** Partage une synthèse hebdomadaire ou mensuelle (image + texte). */
export async function shareSummary(profile: UserProfile, summary: ShareSummary): Promise<ShareResult> {
  const canvas = buildSummaryCanvas(profile, summary);
  const distance = formatDistance(summary.distanceM, summary.unitSystem || 'metric');
  const filename = `elywalk-${summary.title.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}.jpg`;
  return shareCanvas(
    canvas,
    filename,
    summary.title,
    `${summary.title} : ${fmtNumber(summary.steps)} pas, ${distance} et ${fmtNumber(summary.calories)} kcal avec ElyWalk !`,
  );
}

// Styles de carte exportés pour l'UI de partage.
export { MAP_STYLES };
export type { MapStyle };
