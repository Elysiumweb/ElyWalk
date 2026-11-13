import { useToast } from '../Toast';
import { useAuth } from '../../context/AuthContext';
import { updateActivityPrivacy } from '../../lib/db';

const ITEMS = [
  { key: 'shareGoals', title: 'Objectifs atteints', hint: 'Quand vous validez 10k pas', on: 'Objectifs partagés', off: 'Objectifs masqués' },
  { key: 'shareActivities', title: 'Sorties GPS', hint: 'Fin de sortie', on: 'Sorties partagées', off: 'Sorties masquées' },
  { key: 'shareBadges', title: 'Badges', hint: 'Trophées débloqués', on: 'Badges partagés', off: 'Badges masqués' },
  { key: 'shareChallenges', title: 'Défis', hint: 'Victoires et challenges', on: 'Défis partagés', off: 'Défis masqués' },
] as const;

/** Réglages → Confidentialité du fil d'activité (D07). */
export default function ActivityPrivacySection() {
  const { profile } = useAuth();
  const { toast } = useToast();
  if (!profile) return null;
  return (
    <div className="card" data-testid="settings-activity-privacy">
      <div className="card-title">Confidentialité du fil d’activité</div>
      <p className="card-help">Choisissez ce que vos amis voient dans leur fil.</p>
      {ITEMS.map((item) => {
        const shared = profile.activityPrivacy?.[item.key] !== false;
        return (
          <div className="list-row" key={item.key}>
            <div className="row-main">
              <div className="row-title" style={{ fontSize: 13 }}>{item.title}</div>
              <div className="row-sub">{item.hint}</div>
            </div>
            <button
              className={`btn btn-sm ${shared ? 'btn-gold' : 'btn-ghost'}`}
              aria-pressed={shared}
              onClick={async () => {
                await updateActivityPrivacy(profile.uid, {
                  ...(profile.activityPrivacy || {}),
                  [item.key]: !shared,
                });
                toast(!shared ? item.on : item.off, 'info');
              }}
            >
              {shared ? 'Partagé' : 'Masqué'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
