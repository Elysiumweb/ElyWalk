import { fmtNumber } from '../lib/coins';
import { fmtDuration } from '../lib/activity';

/**
 * Aperçu d'une sortie telle que la voit **le destinataire d'un lien** (A7).
 *
 * Le même composant sert à deux endroits :
 *  - la page publique `/s/:sessionId` (visiteur sans compte) ;
 *  - l'écran du propriétaire, section « Ce que voit mon destinataire », pour
 *    éviter d'envoyer un lien sans savoir ce qu'il montre.
 */
export interface SharedActivityView {
  title: string;
  ownerName?: string;
  type?: 'walk' | 'run';
  startedAt: number;
  durationSec: number;
  distanceM: number;
  calories?: number;
  steps?: number;
  caption?: string;
}

function formatDate(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return 'Date inconnue';
  return new Date(ts).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' });
}

function distanceLabel(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return '—';
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(2).replace('.', ',')} km`;
}

export default function SharedActivityCard({
  activity,
  compact = false,
  children,
}: {
  activity: SharedActivityView;
  compact?: boolean;
  children?: React.ReactNode;
}) {
  const activityLabel = activity.type === 'run' ? 'Course' : 'Marche';
  return (
    <div className={`shared-card ${compact ? 'shared-card-compact' : ''}`} data-testid="shared-activity-card">
      <div className="shared-card-brand">
        <img src="/elywalk-logo.png" alt="" width={28} height={28} />
        <span>ElyWalk</span>
        <span className="shared-card-kind">{activityLabel}</span>
      </div>
      <h2 className="shared-card-title" data-testid="shared-activity-title">{activity.title}</h2>
      <p className="shared-card-meta">
        {activity.ownerName ? `par ${activity.ownerName} · ` : ''}
        {formatDate(activity.startedAt)}
      </p>
      <div className="shared-card-stats" data-testid="shared-activity-stats">
        <div>
          <strong>{distanceLabel(activity.distanceM)}</strong>
          <span>distance</span>
        </div>
        <div>
          <strong>{fmtDuration(activity.durationSec)}</strong>
          <span>durée</span>
        </div>
        {activity.steps ? (
          <div>
            <strong>{fmtNumber(activity.steps)}</strong>
            <span>pas</span>
          </div>
        ) : (
          <div>
            <strong>{activity.calories ? fmtNumber(activity.calories) : '—'}</strong>
            <span>kcal</span>
          </div>
        )}
      </div>
      {activity.caption ? <p className="shared-card-caption">« {activity.caption} »</p> : null}
      {children}
    </div>
  );
}
