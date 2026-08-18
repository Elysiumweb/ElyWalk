import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { listDailySteps, updateUserFields } from '../lib/db';
import type { DailySteps } from '../lib/types';
import { fmtNumber } from '../lib/coins';

export default function HistoryPage() {
  const { profile } = useAuth(); const [days, setDays] = useState<DailySteps[]>([]);
  const [goal, setGoal] = useState(profile?.dailyStepGoal || 10000); const [stride, setStride] = useState(profile?.strideLengthCm || 75);
  useEffect(() => { if (profile) listDailySteps(profile.uid).then(setDays); }, [profile?.uid]);
  const max = Math.max(goal, ...days.map(d => d.steps), 1);
  const save = async () => { if (!profile) return; await updateUserFields(profile.uid, { dailyStepGoal: Math.max(1000, Math.min(100000, goal)), strideLengthCm: Math.max(30, Math.min(150, stride)) }); };
  return <div className="screen"><div className="screen-header"><div><h1 className="screen-title">Activité</h1><div className="screen-sub">Historique des 30 derniers jours</div></div></div>
    <div className="card"><div className="card-title">Objectifs & mesure</div><div className="two-col"><div className="field"><label>Objectif quotidien</label><input className="input" type="number" value={goal} onChange={e=>setGoal(+e.target.value)}/></div><div className="field"><label>Longueur du pas (cm)</label><input className="input" type="number" value={stride} onChange={e=>setStride(+e.target.value)}/></div></div><button className="btn btn-gold" onClick={save}>Enregistrer</button></div>
    <div className="card"><div className="card-title">Pas quotidiens</div>{days.length === 0 ? <div className="empty-state">Validez vos pas pour créer votre historique.</div> : <div className="step-chart">{days.map(d => <div className="chart-column" key={d.date} title={`${d.date}: ${d.steps} pas`}><span>{d.steps >= goal ? '✓' : ''}</span><div style={{height:`${Math.max(3,d.steps/max*130)}px`}}/><small>{d.date.slice(8)}</small></div>)}</div>}</div>
    <div className="stat-grid"><div className="stat"><div className="stat-value">{fmtNumber(days.reduce((s,d)=>s+d.steps,0))}</div><div className="stat-label">pas sur la période</div></div><div className="stat"><div className="stat-value">{((days.reduce((s,d)=>s+d.steps,0)*stride)/100000).toFixed(1)}</div><div className="stat-label">km estimés</div></div><div className="stat"><div className="stat-value">{days.filter(d=>d.steps>=goal).length}</div><div className="stat-label">objectifs atteints</div></div></div>
  </div>;
}
