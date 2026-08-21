import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { listDailySteps, updateUserFields } from '../lib/db';
import type { DailySteps, HealthProfile, UnitSystem } from '../lib/types';
import { caloriesForSteps, formatDistance, fmtNumber } from '../lib/coins';
import { dateStr } from '../lib/coins';

const today = new Date();
const dayNames = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const monthNames = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function localDate(y: number, m: number, d: number): string { return dateStr(new Date(y, m, d)); }

export default function HistoryPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [days, setDays] = useState<DailySteps[]>([]);
  const [goal, setGoal] = useState(profile?.dailyStepGoal || 10000);
  const [stride, setStride] = useState(profile?.strideLengthCm || 75);
  const [unit, setUnit] = useState<UnitSystem>(profile?.unitSystem || profile?.health?.unitSystem || 'metric');
  const [health, setHealth] = useState<HealthProfile>(profile?.health || {});
  const [selectedDate, setSelectedDate] = useState(dateStr());

  useEffect(() => { if (profile) { listDailySteps(profile.uid, 60).then(setDays).catch(() => undefined); setGoal(profile.dailyStepGoal || 10000); setStride(profile.strideLengthCm || 75); setHealth(profile.health || {}); setUnit(profile.unitSystem || profile.health?.unitSystem || 'metric'); } }, [profile?.uid]);

  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const firstOffset = (monthStart.getDay() + 6) % 7;
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const calendar = Array.from({ length: Math.ceil((firstOffset + daysInMonth) / 7) * 7 }, (_, i) => {
    const day = i - firstOffset + 1;
    return day > 0 && day <= daysInMonth ? localDate(today.getFullYear(), today.getMonth(), day) : null;
  });
  const detail = byDate.get(selectedDate);
  const total = days.reduce((s, d) => s + d.steps, 0);
  const max = Math.max(goal, ...days.map((d) => d.steps), 1);
  const save = async () => {
    if (!profile) return;
    const cleanHealth: HealthProfile = { unitSystem: unit };
    if (health.weightKg) cleanHealth.weightKg = Math.max(20, Math.min(300, Number(health.weightKg)));
    if (health.heightCm) cleanHealth.heightCm = Math.max(100, Math.min(240, Number(health.heightCm)));
    if (health.age) cleanHealth.age = Math.max(13, Math.min(110, Number(health.age)));
    try {
      await updateUserFields(profile.uid, { dailyStepGoal: Math.max(1000, Math.min(100000, goal)), strideLengthCm: Math.max(30, Math.min(150, stride)), health: cleanHealth, unitSystem: unit });
      toast('Objectifs et profil santé enregistrés.', 'success');
    } catch (e) { toast((e as Error).message, 'error'); }
  };

  return <div className="screen" data-testid="history-screen">
    <div className="screen-header"><div><h1 className="screen-title">Activité</h1><div className="screen-sub">Calendrier, historique et estimation personnalisée</div></div></div>
    <div className="card health-card"><div className="card-title">Santé & unités</div><p className="card-help">Ces données restent privées et servent seulement à affiner les kcal et les distances. Les résultats ne remplacent pas un avis médical.</p>
      <div className="unit-toggle"><button className={unit === 'metric' ? 'selected' : ''} onClick={() => setUnit('metric')}>Métrique · km</button><button className={unit === 'imperial' ? 'selected' : ''} onClick={() => setUnit('imperial')}>Impérial · mi</button></div>
      <div className="two-col"><div className="field"><label>Poids (kg)</label><input className="input" type="number" min="20" max="300" value={health.weightKg || ''} placeholder="ex. 72" onChange={(e) => setHealth({ ...health, weightKg: Number(e.target.value) || undefined })} /></div><div className="field"><label>Taille (cm)</label><input className="input" type="number" min="100" max="240" value={health.heightCm || ''} placeholder="ex. 175" onChange={(e) => setHealth({ ...health, heightCm: Number(e.target.value) || undefined })} /></div></div>
      <div className="two-col"><div className="field"><label>Âge</label><input className="input" type="number" min="13" max="110" value={health.age || ''} placeholder="ex. 30" onChange={(e) => setHealth({ ...health, age: Number(e.target.value) || undefined })} /></div><div className="field"><label>Longueur du pas (cm)</label><input className="input" type="number" value={stride} onChange={(e) => setStride(Number(e.target.value))} /></div></div>
      <div className="two-col"><div className="field"><label>Objectif quotidien</label><input className="input" type="number" value={goal} onChange={(e) => setGoal(Number(e.target.value))} /></div><div className="health-estimate"><span>Estimation actuelle</span><strong>{caloriesForSteps(10000, health, stride)} kcal / 10 000 pas</strong></div></div>
      <button className="btn btn-gold" onClick={save}>Enregistrer</button>
    </div>

    <div className="card activity-calendar"><div className="card-title">{monthNames[today.getMonth()]} {today.getFullYear()}</div><div className="calendar-grid calendar-head">{dayNames.map((d, i) => <span key={`${d}${i}`}>{d}</span>)}</div><div className="calendar-grid">{calendar.map((date, i) => { const item = date ? byDate.get(date) : undefined; return <button key={`${date || 'blank'}-${i}`} className={`calendar-day ${date === selectedDate ? 'calendar-selected' : ''} ${item && item.steps >= goal ? 'calendar-goal' : ''}`} disabled={!date} onClick={() => date && setSelectedDate(date)}>{date ? <><span>{Number(date.slice(-2))}</span>{item && <i style={{ height: `${Math.max(4, Math.min(24, item.steps / max * 24))}px` }} />}</> : null}</button>; })}</div>{detail ? <div className="calendar-detail"><strong>{new Date(`${detail.date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</strong><span>{fmtNumber(detail.steps)} pas · {formatDistance(detail.steps * stride / 100, unit)} · {detail.calories} kcal · +{detail.coins} EC</span></div> : <div className="calendar-detail muted">Touchez une journée validée pour voir le détail.</div>}</div>

    <div className="card"><div className="card-title">30 derniers jours</div>{days.length === 0 ? <div className="empty-state">Validez vos pas pour créer votre historique.</div> : <div className="step-chart">{days.slice(-30).map((d) => <button className="chart-column" key={d.date} title={`${d.date}: ${d.steps} pas`} onClick={() => setSelectedDate(d.date)}><span>{d.steps >= goal ? '✓' : ''}</span><div style={{ height: `${Math.max(3, d.steps / max * 130)}px` }} /><small>{d.date.slice(5)}</small></button>)}</div>}</div>
    <div className="stat-grid"><div className="stat"><div className="stat-value">{fmtNumber(total)}</div><div className="stat-label">pas sur la période</div></div><div className="stat"><div className="stat-value">{formatDistance(total * stride / 100, unit)}</div><div className="stat-label">distance estimée</div></div><div className="stat"><div className="stat-value">{days.filter((d) => d.steps >= goal).length}</div><div className="stat-label">objectifs atteints</div></div></div>
  </div>;
}
