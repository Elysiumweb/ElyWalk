import { getWalkerLevel, getNextLevel } from '../lib/constants';
import { fmtNumber } from '../lib/coins';

export default function LevelBadge({ totalSteps, compact=false }: { totalSteps:number; compact?:boolean }) {
  const level = getWalkerLevel(totalSteps);
  const next = getNextLevel(totalSteps);
  const progress = next ? Math.min(100, ((totalSteps - level.minSteps) / (next.minSteps - level.minSteps))*100) : 100;
  if (compact) {
    return (
      <span className="level-badge compact" style={{ borderColor: level.color }} data-testid="walker-level-compact">
        <span style={{ fontSize: 16 }}>{level.icon}</span> {level.title}
      </span>
    );
  }
  return (
    <div className="level-card" data-testid="walker-level-card" style={{ borderColor: level.color }}>
      <div className="level-top">
        <span className="level-icon" style={{ background: level.color }}>{level.icon}</span>
        <div>
          <div className="level-title">{level.title}</div>
          <div className="level-sub">Niveau {level.level} · {fmtNumber(totalSteps)} pas totaux</div>
        </div>
        <span className="level-progress-text">{next ? `${Math.round(progress)}%` : 'MAX'}</span>
      </div>
      <div className="level-bar"><div style={{ width: `${progress}%`, background: level.color }} /></div>
      {next && <div className="level-next">Prochain : {next.title} à {fmtNumber(next.minSteps)} pas</div>}
      {!next && <div className="level-next">👑 Rang ultime atteint !</div>}
    </div>
  );
}
