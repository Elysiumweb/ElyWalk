import type { CSSProperties } from 'react';
import { getWalkerLevel, getNextLevel } from '../lib/constants';
import { fmtNumber } from '../lib/coins';

/**
 * La teinte de niveau vient de la table `WALKER_LEVELS` (donnée dynamique) :
 * on la transmet par variable CSS plutôt que par une propriété codée en dur,
 * pour que les règles de style restent centralisées dans la feuille.
 */
function colorVar(color: string): CSSProperties {
  return { ['--level-color' as string]: color } as CSSProperties;
}

export default function LevelBadge({ totalSteps, compact=false }: { totalSteps:number; compact?:boolean }) {
  const level = getWalkerLevel(totalSteps);
  const next = getNextLevel(totalSteps);
  const progress = next ? Math.min(100, ((totalSteps - level.minSteps) / (next.minSteps - level.minSteps))*100) : 100;
  if (compact) {
    return (
      <span className="level-badge compact" style={colorVar(level.color)} data-testid="walker-level-compact">
        <span className="level-badge-icon">{level.icon}</span> {level.title}
      </span>
    );
  }
  return (
    <div className="level-card" data-testid="walker-level-card" style={colorVar(level.color)}>
      <div className="level-top">
        <span className="level-icon level-icon-colored">{level.icon}</span>
        <div>
          <div className="level-title">{level.title}</div>
          <div className="level-sub">Niveau {level.level} · {fmtNumber(totalSteps)} pas totaux</div>
        </div>
        <span className="level-progress-text">{next ? `${Math.round(progress)}%` : 'MAX'}</span>
      </div>
      <div className="level-bar"><div className="level-bar-fill level-bar-colored" style={{ width: `${progress}%` }} /></div>
      {next && <div className="level-next">Prochain : {next.title} à {fmtNumber(next.minSteps)} pas</div>}
      {!next && <div className="level-next">👑 Rang ultime atteint !</div>}
    </div>
  );
}
