import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../Toast';
import { updateDailyStepGoal, updateWeeklyStepGoal } from '../../lib/db';
import {
  DEFAULT_WEEKLY_STEP_GOAL,
  MAX_WEEKLY_STEP_GOAL,
  MIN_WEEKLY_STEP_GOAL,
  sanitizeWeeklyGoal,
} from '../../lib/weeklyGoal';
import { DAILY_STEP_GOAL } from '../../lib/constants';
import { fmtNumber } from '../../lib/coins';

/**
 * Objectifs (A9) — quotidien et **hebdomadaire**.
 *
 * Le réglage précédent n'exposait que l'objectif quotidien (dans le profil).
 * L'objectif hebdomadaire porte l'anneau de l'accueil et le récapitulatif du
 * dimanche ; il est borné côté client et côté règles Firestore.
 */
export default function GoalsSection() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [daily, setDaily] = useState('10000');
  const [weekly, setWeekly] = useState(String(DEFAULT_WEEKLY_STEP_GOAL));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDaily(String(profile?.dailyStepGoal || DAILY_STEP_GOAL));
    setWeekly(String(profile?.weeklyStepGoal || DEFAULT_WEEKLY_STEP_GOAL));
  }, [profile?.dailyStepGoal, profile?.weeklyStepGoal]);

  const save = async () => {
    if (!profile) return;
    setBusy(true);
    try {
      const dailyValue = await updateDailyStepGoal(profile.uid, Number(daily) || DAILY_STEP_GOAL);
      const weeklyValue = await updateWeeklyStepGoal(profile.uid, sanitizeWeeklyGoal(weekly));
      setDaily(String(dailyValue));
      setWeekly(String(weeklyValue));
      toast('Objectifs enregistrés.', 'success');
    } catch (e) {
      toast((e as Error).message || 'Enregistrement impossible.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const weeklyNumber = sanitizeWeeklyGoal(weekly);
  const perDay = Math.round(weeklyNumber / 7);

  return (
    <div className="card" data-testid="settings-goals">
      <div className="card-title">Objectifs</div>
      <div className="field">
        <label htmlFor="daily-goal">Objectif quotidien (pas)</label>
        <input
          id="daily-goal"
          className="input"
          type="number"
          min={1000}
          max={60000}
          step={500}
          value={daily}
          onChange={(event) => setDaily(event.target.value)}
          data-testid="daily-goal-input"
        />
        <small className="field-help">Il pilote l'anneau de l'accueil et la célébration d'objectif.</small>
      </div>
      <div className="field">
        <label htmlFor="weekly-goal">Objectif hebdomadaire (pas)</label>
        <input
          id="weekly-goal"
          className="input"
          type="number"
          min={MIN_WEEKLY_STEP_GOAL}
          max={MAX_WEEKLY_STEP_GOAL}
          step={1000}
          value={weekly}
          onChange={(event) => setWeekly(event.target.value)}
          data-testid="weekly-goal-input"
        />
        <small className="field-help">
          Soit environ {fmtNumber(perDay)} pas par jour. Le dimanche soir, un récapitulatif indique
          les pas restants et le temps de marche nécessaire (désactivable plus haut, dans les
          alertes).
        </small>
      </div>
      <button className="btn btn-gold" onClick={() => void save()} disabled={busy} data-testid="save-goals">
        {busy ? 'Enregistrement…' : 'Enregistrer mes objectifs'}
      </button>
    </div>
  );
}
