import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../context/LocaleContext';
import BadgeGrid, { BadgePreview } from '../components/BadgeGrid';
import LevelBadge from '../components/LevelBadge';
import Sheet from '../components/Sheet';
import NotificationBell from '../components/NotificationBell';
import { getBestStreak, watchUserBadges } from '../lib/db';
import { BADGE_DEFINITIONS } from '../lib/constants';
import { fmtNumber, formatDistance } from '../lib/coins';
import type { BadgeDefinition, UserBadge } from '../lib/types';

/**
 * Progression (D07).
 *
 * Le profil portait à la fois l'identité, les trophées et six cartes de
 * statistiques : la progression se perdait au milieu. Cet écran est la
 * destination unique pour « où j'en suis » — palier courant, prochain palier,
 * statistiques cumulées et collection complète de badges.
 */
export default function ProgressionPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [badges, setBadges] = useState<UserBadge[]>([]);
  const [bestStreak, setBestStreak] = useState<number | null>(null);
  const [badgeSheet, setBadgeSheet] = useState<{ def: BadgeDefinition; badge?: UserBadge } | null>(null);

  useEffect(() => {
    if (!profile) return;
    return watchUserBadges(profile.uid, setBadges);
  }, [profile?.uid]);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    void getBestStreak(profile.uid)
      .then((value) => { if (!cancelled) setBestStreak(value); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [profile?.uid, profile?.streak]);

  if (!profile) return null;
  const units = profile.unitSystem || 'metric';
  const totalDistance = (profile.totalSteps * (profile.strideLengthCm || 75)) / 100;

  return (
    <div className="screen" data-testid="progression-screen">
      <div className="screen-header">
        <div>
          <h1 className="screen-title">Progression</h1>
          <div className="screen-sub">Paliers, statistiques et badges</div>
        </div>
        <div className="header-actions">
          <NotificationBell />
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/profile')}>
            Retour
          </button>
        </div>
      </div>

      <LevelBadge totalSteps={profile.totalSteps} />

      <div className="card" data-testid="progression-stats">
        <div className="card-title">Statistiques</div>
        <div className="stat-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="stat">
            <div className="stat-value">{fmtNumber(profile.totalSteps)}</div>
            <div className="stat-label">pas cumulés</div>
          </div>
          <div className="stat">
            <div className="stat-value">{formatDistance(totalDistance, units)}</div>
            <div className="stat-label">distance totale</div>
          </div>
          <div className="stat">
            <div className="stat-value" data-testid="profile-best-streak">{bestStreak ?? profile.streak}</div>
            <div className="stat-label">meilleure série</div>
          </div>
          <div className="stat">
            <div className="stat-value">{profile.streak}</div>
            <div className="stat-label">série en cours</div>
          </div>
          <div className="stat">
            <div className="stat-value">{fmtNumber(profile.totalCalories)}</div>
            <div className="stat-label">kcal totales</div>
          </div>
        </div>
        <div className="row-sub" style={{ marginTop: 8 }}>
          Membre depuis {new Date(profile.createdAt).toLocaleDateString('fr-FR')}
        </div>
      </div>

      <div className="card" data-testid="badges-card">
        <div className="card-title">Badges · {badges.length}/{BADGE_DEFINITIONS.length}</div>
        <BadgeGrid badges={badges} onSelect={(def, b) => setBadgeSheet({ def, badge: b })} />
        {badges.length === 0 && (
          <p className="card-help" style={{ marginTop: 10 }}>
            Validez vos pas, lancez une sortie GPS ou maintenez une série pour débloquer vos premiers
            trophées !
          </p>
        )}
      </div>

      <Sheet open={!!badgeSheet} onClose={() => setBadgeSheet(null)} title={badgeSheet?.def.title || 'Badge'}>
        {badgeSheet && <BadgePreview def={badgeSheet.def} badge={badgeSheet.badge} />}
      </Sheet>
    </div>
  );
}
