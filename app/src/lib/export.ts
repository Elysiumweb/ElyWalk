import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { ActivitySession, DailySteps } from './types';
import {
  buildActivitiesCsv,
  buildDailyStepsCsv,
  buildGpx,
  safeFilename,
  sessionTitle,
  weatherLabel,
} from './activity';

/**
 * Export de fichiers (GPX / CSV) — partage natif sur Android, téléchargement
 * sur le web. Le partage d'image reste dans `share.ts`.
 */

export type ExportResult = 'shared' | 'downloaded';

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Écrit le fichier dans le cache puis ouvre la feuille de partage système. */
async function shareTextFile(
  content: string,
  filename: string,
  mime: string,
  title: string,
  text: string,
): Promise<ExportResult> {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });

  if (Capacitor.isNativePlatform()) {
    try {
      await Filesystem.writeFile({
        path: filename,
        data: content,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
      });
      const uri = await Filesystem.getUri({ directory: Directory.Cache, path: filename });
      await Share.share({ title, text, dialogTitle: title, files: [uri.uri] });
      return 'shared';
    } catch (e) {
      const msg = (e as Error)?.message || '';
      // L’utilisateur qui ferme la feuille de partage n’est pas une erreur.
      if (/cancel|abort/i.test(msg)) return 'shared';
      // Sinon, repli sur le téléchargement ci-dessous.
    }
  }

  const file = new File([blob], filename, { type: mime });
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

/**
 * Exporte une sortie en GPX 1.1 : importable dans Strava, Garmin Connect,
 * Google Earth, OsmAnd, etc.
 */
export async function exportActivityGpx(session: ActivitySession): Promise<ExportResult> {
  const base = safeFilename(sessionTitle(session), 'sortie-elywalk');
  const filename = `elywalk-${base}-${isoDay(session.startedAt)}.gpx`;
  const km = ((session.distanceM || 0) / 1000).toFixed(2);
  return shareTextFile(
    buildGpx(session),
    filename,
    'application/gpx+xml',
    'Sortie ElyWalk (GPX)',
    `${sessionTitle(session)} · ${km} km — export GPX ElyWalk`,
  );
}

/** Exporte une sortie (une ligne) ou plusieurs sorties en CSV. */
export async function exportActivitiesCsv(sessions: ActivitySession[]): Promise<ExportResult> {
  if (!sessions.length) throw new Error('Aucune sortie à exporter.');
  const filename = sessions.length === 1
    ? `elywalk-sortie-${isoDay(sessions[0].startedAt)}.csv`
    : `elywalk-sorties-${isoDay(Date.now())}.csv`;
  return shareTextFile(
    buildActivitiesCsv(sessions, weatherLabel),
    filename,
    'text/csv',
    'Sorties ElyWalk (CSV)',
    sessions.length === 1 ? 'Export CSV de ma sortie ElyWalk' : `Export CSV de ${sessions.length} sorties ElyWalk`,
  );
}

/** Exporte les pas quotidiens en CSV (complète l'export RGPD JSON). */
export async function exportDailyStepsCsv(days: DailySteps[], strideCm = 75): Promise<ExportResult> {
  if (!days.length) throw new Error('Aucune journée à exporter.');
  const filename = `elywalk-pas-quotidiens-${isoDay(Date.now())}.csv`;
  return shareTextFile(
    buildDailyStepsCsv(days, strideCm),
    filename,
    'text/csv',
    'Mes pas ElyWalk (CSV)',
    `Export CSV de ${days.length} journées de pas ElyWalk`,
  );
}
