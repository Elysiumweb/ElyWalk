import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { listDailySteps, updateUserFields } from '../lib/db';
import type { DailySteps, HealthProfile, UnitSystem } from '../lib/types';
import { caloriesForSteps, formatDistance, fmtNumber } from '../lib/coins';
import { dateStr } from '../lib/coins';
import { exportDailyStepsCsv } from '../lib/export';
import { shareSummary, type ShareSummary } from '../lib/share';
import {
  currentMonthRange,
  currentWeekRange,
  formatChange,
  percentChange,
  previousMonthRange,
  previousWeekRange,
  summarizeRange,
  type DateRange,
} from '../lib/activity';

const today = new Date();
const dayNames = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const monthNames = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function localDate(y: number, m: number, d: number): string { return dateStr(new Date(y, m, d)); }

function parseDay(date: string): Date {
  return new Date(`${date}T12:00:00`);
}

/** « 20 → 26 oct. 2026 » (fin exclusive -> dernier jour inclus). */
function rangeLabel(range: DateRange): string {
  const start = parseDay(range.start);
  const end = parseDay(range.end);
  end.setDate(end.getDate() - 1);
  const startLabel = start.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  const endLabel = end.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${startLabel} → ${endLabel}`;
}

export default function HistoryPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [days, setDays] = useState<DailySteps[]>([]);
  const [goal, setGoal] = useState(profile?.dailyStepGoal || 10000);
  const [stride, setStride] = useState(profile?.strideLengthCm || 75);
  const [unit, setUnit] = useState<UnitSystem>(profile?.unitSystem || profile?.health?.unitSystem || 'metric');
  const [health, setHealth] = useState<HealthProfile>(profile?.health || {});
  const [selectedDate, setSelectedDate] = useState(dateStr());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (profile) {
      listDailySteps(profile.uid, 70).then(setDays).catch(() => undefined);
      setGoal(profile.dailyStepGoal || 10000);
      setStride(profile.strideLengthCm || 75);
      setHealth(profile.health || {});
      setUnit(profile.unitSystem || profile.health?.unitSystem || 'metric');
    }
  }, [profile?.uid]);

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

  // ===== Synthèses semaine / mois =====
  const weekRange = useMemo(() => currentWeekRange(today), []);
  const prevWeekRange = useMemo(() => previousWeekRange(today), []);
  const monthRange = useMemo(() => currentMonthRange(today), []);
  const prevMonthRange = useMemo(() => previousMonthRange(today), []);

  const week = useMemo(() => summarizeRange(days, weekRange.start, weekRange.end, stride), [days, weekRange, stride]);
  const prevWeek = useMemo(() => summarizeRange(days, prevWeekRange.start, prevWeekRange.end, stride), [days, prevWeekRange, stride]);
  const month = useMemo(() => summarizeRange(days, monthRange.start, monthRange.end, stride), [days, monthRange, stride]);
  const prevMonth = useMemo(() => summarizeRange(days, prevMonthRange.start, prevMonthRange.end, stride), [days, prevMonthRange, stride]);
  const weekChange = percentChange(week.steps, prevWeek.steps);
  const monthChange = percentChange(month.steps, prevMonth.steps);
  const weekGoalDays = days.filter((d) => d.date >= weekRange.start && d.date < weekRange.end && d.steps >= goal).length;

  const summaryPayload = (title: string, subtitle: string, current: typeof week, previous: typeof prevWeek): ShareSummary => ({
    title,
    subtitle,
    steps: current.steps,
    distanceM: current.distanceM,
    calories: current.calories,
    activeDays: current.activeDays,
    previousSteps: previous.steps > 0 ? previous.steps : null,
    changePct: percentChange(current.steps, previous.steps),
    unitSystem: unit,
  });

  const onShareWeek = async () => {
    if (!profile) return;
    setBusy(true);
    try {
      const result = await shareSummary(profile, summaryPayload('Ma semaine', rangeLabel(weekRange), week, prevWeek));
      toast(result === 'shared' ? 'Synthèse de la semaine partagée !' : 'Synthèse enregistrée dans vos téléchargements.', 'success');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const onShareMonth = async () => {
    if (!profile) return;
    setBusy(true);
    try {
      const result = await shareSummary(profile, summaryPayload('Mon mois', `${monthNames[today.getMonth()]} ${today.getFullYear()}`, month, prevMonth));
      toast(result === 'shared' ? 'Synthèse du mois partagée !' : 'Synthèse enregistrée dans vos téléchargements.', 'success');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const onExportCsv = async () => {
    if (!profile) return;
    setBusy(true);
    try {
      // L'écran n'affiche que 60 jours : l'export CSV couvre tout l'historique.
      const all = await listDailySteps(profile.uid, 3650).catch(() => days);
      const result = await exportDailyStepsCsv(all.length ? all : days, stride);
      toast(result === 'shared' ? 'CSV des pas partagé.' : 'CSV enregistré dans vos téléchargements.', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!profile) return;
    const cleanHealth: HealthProfile = { unitSystem: unit };
    if (health.weightKg) cleanHealth.weightKg = Math.max(20, Math.min(300, Number(health.weightKg)));
    if (health.heightCm) cleanHealth.heightCm = Math.max(100, Math.min(240, Number(health.heightCm)));
    if (health.age) cleanHealth.age = Math.max(13, Math.min(110, Number(health.age)));
    try {
      await updateUserFields(profile.uid, {
        dailyStepGoal: Math.max(1000, Math.min(100000, goal)),
        strideLengthCm: Math.max(30, Math.min(150, stride)),
        health: cleanHealth,
        unitSystem: unit,
      });
      toast('Objectifs et profil santé enregistrés.', 'success');
    } catch (e) { toast((e as Error).message, 'error'); }
  };

  return <div className="screen" data-testid="history-screen">
    <div className="screen-header"><div><h1 className="screen-title">Activité</h1><div className="screen-sub">Calendrier, historique et estimation personnalisée</div></div></div>

    {/* ===== Résumés semaine / mois ===== */}
    <div className="card summary-card" data-testid="weekly-summary">
      <div className="summary-head">
        <div>
          <div className="card-title">Cette semaine</div>
          <small className="summary-range">{rangeLabel(weekRange)}</small>
        </div>
        <span className={`summary-trend ${weekChange == null ? 'trend-flat' : weekChange >= 0 ? 'trend-up' : 'trend-down'}`}>
          {formatChange(weekChange)}
        </span>
      </div>
      <div className="summary-stats">
        <div><strong>{fmtNumber(week.steps)}</strong><span>pas</span></div>
        <div><strong>{formatDistance(week.distanceM, unit)}</strong><span>distance</span></div>
        <div><strong>{fmtNumber(week.calories)}</strong><span>kcal</span></div>
        <div><strong>{week.activeDays}/7</strong><span>jours actifs</span></div>
      </div>
      <div className="summary-compare">
        {weekChange == null
          ? 'Première semaine enregistrée — la comparaison arrivera la semaine prochaine.'
          : `${weekChange >= 0 ? 'En hausse' : 'En baisse'} de ${Math.abs(weekChange)} % par rapport à la semaine précédente (${fmtNumber(prevWeek.steps)} pas).`}
        {weekGoalDays > 0 ? ` · ${weekGoalDays} objectif${weekGoalDays > 1 ? 's' : ''} quotidien${weekGoalDays > 1 ? 's' : ''} atteint${weekGoalDays > 1 ? 's' : ''}.` : ''}
      </div>
      <div className="summary-actions">
        <button className="btn btn-gold btn-sm" onClick={onShareWeek} disabled={busy || week.steps === 0}>📤 Partager ma semaine</button>
        <button className="btn btn-outline btn-sm" onClick={onExportCsv} disabled={busy || days.length === 0}>📄 CSV des pas</button>
      </div>
    </div>

    <div className="card summary-card summary-card-compact" data-testid="monthly-summary">
      <div className="summary-head">
        <div>
          <div className="card-title">Ce mois-ci</div>
          <small className="summary-range">{monthNames[today.getMonth()]} {today.getFullYear()}</small>
        </div>
        <span className={`summary-trend ${monthChange == null ? 'trend-flat' : monthChange >= 0 ? 'trend-up' : 'trend-down'}`}>
          {formatChange(monthChange)}
        </span>
      </div>
      <div className="summary-stats">
        <div><strong>{fmtNumber(month.steps)}</strong><span>pas</span></div>
        <div><strong>{formatDistance(month.distanceM, unit)}</strong><span>distance</span></div>
        <div><strong>{fmtNumber(month.calories)}</strong><span>kcal</span></div>
        <div><strong>{month.activeDays}</strong><span>jours actifs</span></div>
      </div>
      <div className="summary-actions">
        <button className="btn btn-outline btn-sm" onClick={onShareMonth} disabled={busy || month.steps === 0}>📤 Partager mon mois</button>
      </div>
    </div>

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
