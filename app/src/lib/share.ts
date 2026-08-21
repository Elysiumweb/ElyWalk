import type { UserProfile } from './types';
import { fmtNumber } from './coins';

/** Génère une vraie carte PNG partageable, puis utilise le partage natif quand il existe. */
export async function shareDailyStats(profile: UserProfile, steps: number, distance: string, calories: number): Promise<'shared' | 'downloaded'> {
  const canvas = document.createElement('canvas');
  canvas.width = 1080; canvas.height = 1350;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Création de la carte impossible.');
  const gradient = ctx.createLinearGradient(0, 0, 1080, 1350);
  gradient.addColorStop(0, '#25241e'); gradient.addColorStop(1, '#111111');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#D8CA82'; ctx.lineWidth = 3; ctx.strokeRect(38, 38, 1004, 1274);
  ctx.fillStyle = '#D8CA82'; ctx.font = '700 46px Arial'; ctx.fillText('ELYWALK', 84, 125);
  ctx.fillStyle = '#ffffff'; ctx.font = '700 62px Arial'; ctx.fillText('Mes pas du jour', 84, 280);
  ctx.fillStyle = '#D8CA82'; ctx.font = '700 152px Arial'; ctx.fillText(fmtNumber(steps), 84, 520);
  ctx.fillStyle = '#98948a'; ctx.font = '38px Arial'; ctx.fillText('PAS', 88, 580);
  const stats = [`${distance}`, `${calories} kcal`];
  stats.forEach((value, i) => { ctx.fillStyle = '#ffffff'; ctx.font = '700 54px Arial'; ctx.fillText(value, 90 + i * 430, 790); ctx.fillStyle = '#98948a'; ctx.font = '28px Arial'; ctx.fillText(i === 0 ? 'DISTANCE' : 'ÉNERGIE', 94 + i * 430, 840); });
  ctx.fillStyle = '#d8d2c2'; ctx.font = '34px Arial'; ctx.fillText(`Bravo ${profile.displayName} !`, 84, 1120);
  ctx.fillStyle = '#98948a'; ctx.font = '26px Arial'; ctx.fillText('Marchez. Progressez. Gagnez.', 84, 1180);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error('Image impossible.')), 'image/png'));
  const file = new File([blob], 'elywalk-pas-du-jour.png', { type: 'image/png' });
  if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
    await navigator.share({ title: 'Mes pas du jour avec ElyWalk', text: `J’ai marché ${fmtNumber(steps)} pas aujourd’hui !`, files: [file] });
    return 'shared';
  }
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = file.name; link.click(); URL.revokeObjectURL(url);
  return 'downloaded';
}
