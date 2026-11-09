import type { UserBadge, BadgeDefinition } from '../lib/types';
import { BADGE_DEFINITIONS, getBadgeDef } from '../lib/constants';

interface Props {
  badges: UserBadge[];
  size?: 'small' | 'medium';
  onSelect?: (def: BadgeDefinition, badge?: UserBadge) => void;
}

export default function BadgeGrid({ badges, size = 'medium', onSelect }: Props) {
  const owned = new Set(badges.map(b => b.badgeId));
  return (
    <div className={`badge-grid ${size === 'small' ? 'badge-grid-small' : ''}`} data-testid="badge-grid">
      {BADGE_DEFINITIONS.map(def => {
        const has = owned.has(def.id);
        const badge = badges.find(b => b.badgeId === def.id);
        return (
          <button
            key={def.id}
            className={`badge-item ${has ? 'badge-unlocked' : 'badge-locked'} tier-${def.tier}`}
            onClick={() => onSelect?.(def, badge)}
            title={has ? `${def.title}: ${def.description}` : `🔒 ${def.title}: ${def.description}`}
            data-testid={`badge-${def.id}`}
            disabled={!onSelect}
            style={{ cursor: onSelect ? 'pointer' : 'default' }}
          >
            <span className="badge-icon">{has ? def.icon : '🔒'}</span>
            <span className="badge-name">{def.title}</span>
            {!has && <span className="badge-desc">{def.description}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function BadgePreview({ def, badge }: { def: BadgeDefinition; badge?: UserBadge }) {
  return (
    <div className="badge-preview" data-testid="badge-preview">
      <div className={`badge-icon large tier-${def.tier}`}>{def.icon}</div>
      <h3>{def.title}</h3>
      <p>{def.description}</p>
      {badge && <small style={{ color: 'var(--muted)' }}>Obtenu le {new Date(badge.unlockedAt).toLocaleDateString('fr-FR')}</small>}
      {!badge && <small style={{ color: 'var(--muted)' }}>🔒 Non débloqué</small>}
      <span className={`badge-tier tier-${def.tier}`}>{def.tier}</span>
    </div>
  );
}
