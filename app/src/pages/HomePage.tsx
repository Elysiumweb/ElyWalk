import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import NotificationBell from '../components/NotificationBell';
import ProgressRing from '../components/ProgressRing';
import Sheet from '../components/Sheet';
import { pedometer } from '../lib/pedometer';
import { adGate, openAdPrivacyOptions, showInterstitial, showRewardedAd } from '../lib/ads';
import { validateSteps, getTodayValidatedSteps, creditAdReward, syncTodaySteps, listMyDailySteps } from '../lib/db';
import { pendingCoins } from '../lib/stepValidation';
import { coinsForSteps, caloriesForSteps, fmtCoins, fmtNumber, dateStr, nextStepTier, formatDistance } from '../lib/coins';
import { shareDailyStats } from '../lib/share';
import { DAILY_STEP_GOAL, STEP_TIERS, AD_REWARD_COINS } from '../lib/constants';
import LevelBadge from '../components/LevelBadge';
import { Capacitor } from '@capacitor/core';
import { hapticSuccess, hapticTap } from '../lib/haptics';
import { syncEveningReminder } from '../lib/eveningReminder';
import { useAlerts } from '../context/AlertsContext';
import {
  DEFAULT_WEEKLY_STEP_GOAL,
  formatWalkMinutes,
  weeklyGoalLabel,
  weeklyProgress,
} from '../lib/weeklyGoal';
import type { DailySteps } from '../lib/types';

type PermState = 'granted' | 'denied' | 'prompt' | 'unavailable';

function timestampMs(value: unknown): number | null {
  if (!value) return null;
  if (typeof value === 'object' && value !== null && 'toMillis' in value && typeof (value as { toMillis?: unknown }).toMillis === 'function') return (value as { toMillis: () => number }).toMillis();
  if (typeof value === 'object' && value !== null && 'seconds' in value) return Number((value as { seconds: number }).seconds) * 1000;
  const number = typeof value === 'number' ? value : Date.parse(String(value));
  return Number.isFinite(number) ? number : null;
}

export default function HomePage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const { preferences: alertPrefs } = useAlerts();
  const navigate = useNavigate();
  const [steps, setSteps] = useState(0);
  const [perm, setPerm] = useState<PermState>('unavailable');
  const [showTiers, setShowTiers] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(true);
  const [busyValidate, setBusyValidate] = useState(false);
  const [busyAd, setBusyAd] = useState(false);
  const [celebration, setCelebration] = useState<string | null>(null);
  const [clock, setClock] = useState(Date.now());
  const previousSteps = useRef<number | null>(null);
  const celebratedToday = useRef(false);
  const [weekDays, setWeekDays] = useState<DailySteps[]>([]);

  const isNative = Capacitor.isNativePlatform();
  const today = dateStr();
  /**
   * Validation **multiple** dans la journée (2.2.5) : on suit le cumul de pas
   * déjà validé (`dailySteps/{today}`), et non plus un simple « jour validé ou
   * pas ». `alreadyValidated` ne sert plus qu'à masquer le rappel du soir.
   */
  const [validatedDay, setValidatedDay] = useState<{ day: string; steps: number }>({ day: today, steps: 0 });
  // Le cumul appartient à **une** date : à minuit, l'accueil repart de zéro au
  // lieu d'afficher les pas d'hier comme « déjà validés ».
  const validatedSteps = validatedDay.day === today ? validatedDay.steps : 0;
  const alreadyValidated = validatedSteps > 0 || profile?.lastValidatedDate === today;
  const newSteps = Math.max(0, Math.floor(steps) - validatedSteps);
  const rewardPending = pendingCoins(steps, validatedSteps);
  const canValidate = !!profile && !busyValidate && newSteps > 0;
  const dailyGoal = profile?.dailyStepGoal || DAILY_STEP_GOAL;
  const lastAdAt = timestampMs(profile?.lastAdRewardAt);
  const adRemaining = lastAdAt ? Math.max(0, lastAdAt + 3600000 - clock) : 0;
  const adAvailable = adRemaining === 0;
  const adCountdown = `${String(Math.floor(adRemaining / 60000)).padStart(2, '0')}:${String(Math.floor(adRemaining / 1000) % 60).padStart(2, '0')}`;

  const celebrate = (message: string) => {
    setCelebration(message);
    // A12.3 — retour haptique natif (moteur Android) et repli web.
    void hapticSuccess();
    window.setTimeout(() => setCelebration(null), 4200);
  };

  useEffect(() => {
    const id = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const celebrationKey = `elywalk.goalCelebrated.${today}`;
    const crossed = previousSteps.current !== null && previousSteps.current < dailyGoal && steps >= dailyGoal;
    const recoveredWhileClosed = steps >= dailyGoal && localStorage.getItem(celebrationKey) !== '1';
    if ((crossed || recoveredWhileClosed) && !celebratedToday.current) {
      celebratedToday.current = true;
      localStorage.setItem(celebrationKey, '1');
      celebrate('Objectif quotidien atteint !');
    }
    previousSteps.current = steps;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps, dailyGoal]);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    (async () => {
      const persisted = await pedometer.loadPersisted();
      setSteps(persisted);
      unsub = pedometer.subscribe(setSteps);
      if (!isNative) {
        setPerm('unavailable');
        return;
      }
      const p = await pedometer.checkPermission();
      setPerm(p);
      if (p === 'granted') {
        await pedometer.start();
      }
    })();
    return () => {
      if (unsub) unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Partage des pas du jour avec les amis (sync au montage).
  useEffect(() => {
    if (profile && steps > 0) {
      const t = setTimeout(() => syncTodaySteps(profile.uid, steps), 3000);
      return () => clearTimeout(t);
    }
  }, [profile?.uid, Math.floor(steps / 200)]); // eslint-disable-line react-hooks/exhaustive-deps

  // Vérification badges au chargement (rattrapage pour anciens comptes)
  useEffect(()=>{
    if(!profile) return;
    import('../lib/db').then(m=>m.checkAndUnlockBadges(profile, { stepsToday: profile.todaySteps, totalSteps: profile.totalSteps }).catch(()=>undefined));
  },[profile?.uid]);

  const askPermission = async () => {
    const granted = await pedometer.requestPermission();
    if (granted) {
      setPerm('granted');
      await pedometer.start();
      toast('Comptage des pas activé !', 'success');
    } else {
      setPerm('denied');
      toast("Permission refusée. Activez « Activité physique » dans les paramètres de l'application.", 'error');
    }
  };

  const onValidate = async () => {
    if (!profile || busyValidate) return;
    const stepsToValidate = pedometer.getTodaySteps();
    if (stepsToValidate <= validatedSteps) {
      toast('Aucun nouveau pas depuis votre dernière validation. Marchez encore un peu !', 'info');
      return;
    }
    setBusyValidate(true);
    try {
      // Annonce interstitielle **à chaque validation** (placement
      // « Interstitial #2 ») : elle encadre le crédit, pas la journée.
      await showInterstitial();
      const result = await validateSteps(profile.uid, stepsToValidate);
      setValidatedDay({ day: today, steps: result.daySteps });
      void hapticTap();
      const detail = result.firstOfDay
        ? `Série de ${result.streak} jour${result.streak > 1 ? 's' : ''} !`
        : `Journée à ${fmtNumber(result.daySteps)} pas (mise à jour).`;
      if (result.coins > 0) {
        toast(`+${fmtCoins(result.coins)} ElyCoins · ${detail}${result.freezeUsed ? ' Gel utilisé pour rattraper la journée manquée.' : ''}`, 'success');
      } else {
        toast(`+${fmtNumber(result.addedSteps)} pas crédités · ${detail}`, 'success');
      }
      if (result.firstOfDay && (result.streak === 7 || result.streak === 30)) {
        celebrate(`Palier de série atteint : ${result.streak} jours !`);
      }
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusyValidate(false);
    }
  };

  const onWatchAd = async () => {
    if (!profile || busyAd || !adAvailable) return;
    setBusyAd(true);
    try {
      if (!isNative) {
        toast('Les publicités sont disponibles uniquement sur l’application Android.', 'error');
        return;
      }
      // F04 — un seul chemin d'erreur explicite avant de lancer la vidéo.
      const gate = await adGate();
      if (gate === 'no-consent') {
        toast('Choisissez vos préférences publicitaires pour débloquer cette récompense.', 'info');
        openAdPrivacyOptions();
        return;
      }
      if (gate === 'unavailable') {
        toast('La vidéo récompensée est indisponible pour le moment. Réessayez dans un instant.', 'error');
        return;
      }
      const reward = await showRewardedAd(profile.uid);
      if (reward.rewarded) {
        // LevelPlay ne fournit pas de vérification serveur signée vers notre
        // backend : le crédit reste côté client, mais il est borné par la
        // transaction Firestore `adClaims` (1 récompense par heure et par
        // compte, règle `validAdCredit`, montant fixé à 0,1 EC).
        // L'ad unit récompensée déclare « ElyCoin » × 1 → 0,1 ElyCoin.
        await creditAdReward(profile.uid);
        toast(`+${fmtCoins(AD_REWARD_COINS)} ElyCoins !`, 'success');
      } else {
        toast('Publicité non terminée — aucune récompense.', 'error');
      }
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusyAd(false);
    }
  };

  const onShare = async () => {
    if (!profile) return;
    try {
      const result = await shareDailyStats(profile, steps, formatDistance(distanceMeters, unitSystem), calories);
      toast(result === 'shared' ? 'Carte partagée !' : 'Carte enregistrée dans vos téléchargements.', 'success');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast((e as Error).message, 'error');
    }
  };

  /**
   * Cumul de pas **déjà validé** aujourd'hui. Rechargé après chaque validation
   * (via `profile.totalSteps`) et au changement de date : l'accueil peut ainsi
   * afficher « encore 2 400 pas à valider » au lieu d'un bouton mort jusqu'au
   * lendemain.
   */
  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    void getTodayValidatedSteps(profile.uid, today)
      .then((n) => { if (!cancelled) setValidatedDay({ day: today, steps: n }); })
      .catch(() => undefined);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.uid, profile?.totalSteps, today]);

  /**
   * A9 — objectif de la semaine. Les 14 derniers jours sont chargés pour que le
   * calcul reste juste même à cheval sur deux semaines ; seuls les jours de la
   * semaine en cours comptent dans le total.
   */
  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    void listMyDailySteps(profile.uid, 14)
      .then((days) => { if (!cancelled) setWeekDays(days); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [profile?.uid, profile?.lastValidatedDate, profile?.totalSteps]);

  const weekly = weeklyProgress(weekDays, profile?.weeklyStepGoal || DEFAULT_WEEKLY_STEP_GOAL, {
    strideCm: profile?.strideLengthCm,
  });

  /**
   * A12.6 — rappel de fin de journée. Reprogrammé à chaque changement notable
   * (pas, validation, préférence) : il est annulé dès que la journée est
   * validée ou que l'utilisateur le désactive dans les Réglages.
   */
  useEffect(() => {
    if (!profile) return;
    void syncEveningReminder({
      alreadyValidated,
      steps,
      goal: dailyGoal,
      enabled: alertPrefs.eveningReminder,
    }).catch(() => undefined);
  }, [profile?.uid, alreadyValidated, Math.floor(steps / 500), dailyGoal, alertPrefs.eveningReminder]);

  const potentialCoins = coinsForSteps(steps);
  const calories = caloriesForSteps(steps, profile?.health, profile?.strideLengthCm || 75);
  const unitSystem = profile?.unitSystem || profile?.health?.unitSystem || 'metric';
  const distanceMeters = steps * (profile?.strideLengthCm || 75) / 100;
  const nextTier = nextStepTier(steps);
  const freezes = profile?.streakFreezes ?? 1;
  const shortcutStyle = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 } as const;

  return (
    <div className="screen" data-testid="home-screen">
      {celebration && (
        <div className="celebration-overlay" role="status" aria-live="polite">
          <div className="celebration-card pop-in">
            <div className="celebration-confetti" aria-hidden="true" style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
              <StarIcon size={18} /><StarIcon size={26} /><StarIcon size={18} />
            </div>
            <strong>{celebration}</strong>
            <span>Continuez comme ça, marcheur ElyWalk !</span>
            <div className="celebration-actions">
              <button className="btn btn-gold" onClick={() => setCelebration(null)}>Super !</button>
              <button className="btn btn-ghost" onClick={onShare}>Partager</button>
            </div>
          </div>
        </div>
      )}

      {/* 1. En-tête allégé : le solde ouvre le barème, la loupe mène à la recherche. */}
      <div className="screen-header">
        <div>
          <h1 className="screen-title">ElyWalk</h1>
          <div className="screen-sub">Bonjour, {profile?.displayName}</div>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="badge"
            onClick={() => setShowTiers(true)}
            aria-label="Voir le barème ElyCoins"
            style={{ cursor: 'pointer', font: 'inherit', border: 0 }}
            data-testid="home-balance-badge"
          >
            <CoinIcon /> {fmtCoins(profile?.elycoins || 0)} EC
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => navigate('/search')}
            aria-label="Rechercher un marcheur, un parcours, un lieu"
            style={{ padding: 8, lineHeight: 0 }}
            data-testid="home-search-button"
          >
            <SearchIcon />
          </button>
          <NotificationBell />
        </div>
      </div>

      {/* 2. Héros « pas du jour » : anneau + validation dans le même bloc. */}
      <div className="gold-hero">
        <img src="/deco-1.webp" className="hero-deco" alt="" />
        <ProgressRing progress={steps / dailyGoal}>
          <div className="display" style={{ fontSize: 34, color: 'var(--white)' }} data-testid="today-steps-value">
            {fmtNumber(steps)}
          </div>
          <div className="goal-label">
            sur {fmtNumber(dailyGoal)} pas
          </div>
          <div className="hero-coins">
            ≈ {potentialCoins} EC
          </div>
          <div className="next-tier-note">{nextTier ? `Encore ${fmtNumber(nextTier.remaining)} pas pour le palier ${fmtNumber(nextTier.target)} · ${nextTier.coins} EC` : 'Palier ElyCoins maximum atteint'}</div>
        </ProgressRing>

        {!isNative && (
          <p className="muted-xs web-counter-note" style={{ marginTop: 12, textAlign: 'center' }} data-testid="web-counter-note">
            <strong>Compteur en mode aperçu</strong> — le navigateur n’accède pas au capteur de pas. Ouvrez ElyWalk sur votre téléphone Android.
          </p>
        )}

        {isNative && perm !== 'granted' && (
          <div className="card" style={{ marginTop: 12 }} data-testid="permission-card">
            <div className="card-title">Activer le comptage des pas</div>
            <p className="muted-text" style={{ marginBottom: 'var(--space-3)' }}>
              ElyWalk utilise le capteur de pas de votre téléphone, même lorsque
              l’application est fermée. Autorisez « Activité physique » — une
              notification discrète restera visible pour continuer à compter.
            </p>
            <button className="btn btn-gold" onClick={askPermission} data-testid="request-permission-button">
              Autoriser l’activité physique
            </button>
          </div>
        )}

        <section className={`daily-action ${canValidate ? '' : 'daily-action-done'}`} aria-live="polite" style={{ marginTop: 16 }}>
          {alreadyValidated && (
            <div className="validation-success" data-testid="validation-status" style={{ alignItems: 'center' }}>
              <span aria-hidden="true" style={{ lineHeight: 0 }}><CheckIcon /></span>
              <div>
                <strong>{newSteps > 0 ? 'Encore des pas à valider' : 'Journée à jour'}</strong>
                <small>
                  {newSteps > 0
                    ? ` · ${fmtNumber(newSteps)} nouveaux pas (${fmtNumber(validatedSteps)} déjà validés)`
                    : ` · ${fmtNumber(validatedSteps)} pas validés aujourd’hui`}
                </small>
              </div>
            </div>
          )}
          <button
            type="button"
            className="btn btn-gold"
            onClick={onValidate}
            disabled={!canValidate}
            data-testid="validate-steps-button"
          >
            {busyValidate
              ? 'Validation...'
              : newSteps <= 0
                ? 'Tous mes pas sont validés ✓'
                : rewardPending > 0
                  ? `Valider mes pas (+${fmtCoins(rewardPending)} EC)`
                  : 'Valider mes pas'}
          </button>
          <p className="muted-xs daily-action-hint">
            Validation illimitée, à tout moment de la journée.
          </p>
          <div className="secondary-actions">
            <button type="button" className="text-button" onClick={onWatchAd} disabled={busyAd || !adAvailable} data-testid="watch-ad-button">
              {busyAd ? 'Chargement...' : adAvailable ? `Voir une pub · +${fmtCoins(AD_REWARD_COINS)} EC` : `Prochaine pub dans ${adCountdown}`}
            </button>
          </div>
        </section>
      </div>

      {/* 3. Activité et santé : une rangée de stats, l'objectif hebdo, puis série & niveau. */}
      <div className="stat-grid" data-testid="home-stat-grid">
        <div className="stat">
          <div className="stat-icon"><FlameIcon /></div>
          <div className="stat-value" data-testid="stat-streak">{profile?.streak || 0}</div>
          <div className="stat-label">jours d’affilée</div>
        </div>
        <div className="stat">
          <div className="stat-icon"><BoltIcon /></div>
          <div className="stat-value" data-testid="stat-calories">{fmtNumber(calories)}</div>
          <div className="stat-label">kcal du jour</div>
        </div>
        <div className="stat">
          <div className="stat-icon"><StepsIcon /></div>
          <div className="stat-value" data-testid="stat-total-steps">{formatDistance(distanceMeters, unitSystem)}</div>
          <div className="stat-label">distance aujourd’hui</div>
        </div>
      </div>

      <div className="card weekly-goal-card" data-testid="weekly-goal-card">
        <div className="row-between">
          <div className="card-title">Objectif de la semaine</div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/settings')} data-testid="weekly-goal-edit">
            Modifier
          </button>
        </div>
        <div className="weekly-goal-row">
          <ProgressRing progress={weekly.ratio} size={104} stroke={9}>
            <div className="weekly-goal-percent" data-testid="weekly-goal-percent">
              {weekly.percent}%
            </div>
          </ProgressRing>
          <div className="weekly-goal-text">
            <strong data-testid="weekly-goal-label">{weeklyGoalLabel(weekly)}</strong>
            {weekly.achieved ? (
              <span>Objectif atteint ! Profitez du week-end.</span>
            ) : (
              <span>
                Encore {fmtNumber(weekly.remaining)} pas, soit environ{' '}
                {formatWalkMinutes(weekly.minutesRemaining)} de marche.{' '}
                {weekly.daysLeftIncludingToday <= 2
                  ? `Il reste ${weekly.daysLeftIncludingToday} jour${weekly.daysLeftIncludingToday > 1 ? 's' : ''}.`
                  : `≈ ${fmtNumber(weekly.perDayRemaining)} pas par jour.`}
              </span>
            )}
          </div>
        </div>
        <small className="muted-xs">
          Semaine du {new Date(`${weekly.weekStart}T00:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
          {' '}au {new Date(`${weekly.weekEnd}T00:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
          {' '}· récapitulatif le dimanche soir (désactivable dans Réglages → Notifications).
        </small>
      </div>

      <div className="card streak-freeze-card" data-testid="streak-level-card">
        <div className="card-title">Série &amp; niveau</div>
        <div className="list-row">
          <div className="row-main" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="stat-icon" aria-hidden="true"><FlameIcon /></span>
            <div className="row-title" style={{ fontSize: 14 }}>Jours d’affilée</div>
          </div>
          <div className="row-value" data-testid="streak-days-value">{profile?.streak || 0}</div>
        </div>
        <div className="list-row">
          <div className="row-main" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="stat-icon" aria-hidden="true"><SnowflakeIcon /></span>
            <div className="row-title" style={{ fontSize: 14 }}>Gels disponibles</div>
          </div>
          <div className="row-value freeze-count" data-testid="streak-freeze-count">{freezes}</div>
        </div>
        {profile && (
          <div className="list-row" style={{ borderBottom: 0 }}>
            <div className="row-main" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="stat-icon" aria-hidden="true"><StarIcon /></span>
              <div className="row-title" style={{ fontSize: 14 }}>Niveau actuel</div>
            </div>
            <div className="row-value"><LevelBadge totalSteps={profile.totalSteps} /></div>
          </div>
        )}
        <p className="muted-xs" style={{ marginTop: 8 }}>
          Un gel rattrape automatiquement une journée manquée : votre série ne repart plus forcément à 1.
        </p>
      </div>

      {/* 4. Découverte et social : cinq raccourcis, repliables. */}
      <section className="home-shortcuts" aria-label="Raccourcis">
        <button
          type="button"
          className="home-shortcuts-head"
          aria-expanded={showShortcuts}
          aria-controls="home-shortcuts-grid"
          onClick={() => setShowShortcuts((v) => !v)}
          data-testid="toggle-shortcuts-button"
        >
          <span>Raccourcis</span>
          <span aria-hidden="true">{showShortcuts ? '▾' : '▸'}</span>
        </button>
        {showShortcuts && (
          <div className="home-shortcuts-grid" id="home-shortcuts-grid">
            <button type="button" className="btn btn-outline" style={shortcutStyle} onClick={() => navigate('/history')} data-testid="shortcut-history"><HistoryIcon /> Historique</button>
            <button type="button" className="btn btn-outline" style={shortcutStyle} onClick={() => navigate('/challenges')} data-testid="shortcut-challenges"><TrophyIcon /> Défis</button>
            <button type="button" className="btn btn-outline" style={shortcutStyle} onClick={() => navigate('/events')} data-testid="shortcut-events"><GroupIcon /> Rencontres</button>
            <button type="button" className="btn btn-outline" style={shortcutStyle} onClick={() => navigate('/activity')} data-testid="shortcut-activity"><GpsIcon /> Sortie GPS</button>
            <button type="button" className="btn btn-outline" style={shortcutStyle} onClick={onShare} data-testid="shortcut-share"><ShareIcon /> Partager</button>
          </div>
        )}
      </section>

      {/* 5. Feuille Barème : ouverte depuis le solde dans l'en-tête. */}
      <Sheet open={showTiers} onClose={() => setShowTiers(false)} title="Barème quotidien" testId="tiers-sheet">
        {STEP_TIERS.map((t) => (
          <div className="list-row" key={t.min}>
            <div className="row-main">
              <div className="row-title" style={{ fontSize: 14 }}>
                {t.max === Infinity
                  ? `${fmtNumber(t.min)}+ pas`
                  : `${fmtNumber(t.min)} – ${fmtNumber(t.max)} pas`}
              </div>
            </div>
            <div className="row-value">{t.coins} EC</div>
          </div>
        ))}
        <div className="list-row">
          <div className="row-main">
            <div className="row-title" style={{ fontSize: 14 }}>1 pub récompensée</div>
          </div>
          <div className="row-value">0,1 EC</div>
        </div>
        <div className="list-row">
          <div className="row-main">
            <div className="row-title" style={{ fontSize: 14 }}>1000 ElyCoins</div>
          </div>
          <div className="row-value">1 €</div>
        </div>
      </Sheet>
    </div>
  );
}

function CoinIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M9 9.5h4.5a2 2 0 1 1 0 4H9" strokeLinecap="round" />
    </svg>
  );
}
function FlameIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 3s5.5 4.5 5.5 10a5.5 5.5 0 0 1-11 0c0-2 .8-3.6 1.8-5C9 9.5 10 10.5 10 12c1.5-1.5 2-5.5 2-9Z" strokeLinejoin="round" />
    </svg>
  );
}
function BoltIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M13 2 4.5 13.5H11L9.5 22 19 10h-6.5L13 2Z" strokeLinejoin="round" />
    </svg>
  );
}
function StepsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M7 3.5c2 0 3 1.6 3 3.5s-.7 3.5-2.5 3.5S5 9 5 7.2 5.5 3.5 7 3.5ZM6 12.5h3.5V15a1.8 1.8 0 0 1-3.5 0v-2.5ZM17 9.5c-2 0-3 1.6-3 3.5s.7 3.5 2.5 3.5 2.5-1.5 2.5-3.3-.5-3.7-2-3.7ZM18 18.5h-3.5V21a1.8 1.8 0 0 0 3.5 0v-2.5Z" strokeLinejoin="round" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" strokeLinecap="round" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="m5 12.5 4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function HistoryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" strokeLinecap="round" />
    </svg>
  );
}
function TrophyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M8 4h8v5a4 4 0 0 1-8 0V4ZM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function GroupIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 5.5a3 3 0 0 1 0 6M17.5 14.5a5 5 0 0 1 3.5 4.5" strokeLinecap="round" />
    </svg>
  );
}
function GpsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" strokeLinecap="round" />
    </svg>
  );
}
function ShareIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 3v12M8 7l4-4 4 4M5 13v6h14v-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function SnowflakeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 2v20M4 7l16 10M4 17 20 7M12 2l-2.5 2.5M12 2l2.5 2.5M12 22l-2.5-2.5M12 22l2.5-2.5M4 7l3.4 1M4 7l.9-3.4M20 17l-3.4-1M20 17l-.9 3.4M4 17l3.4-1M4 17l.9 3.4M20 7l-3.4 1M20 7l-.9-3.4" strokeLinecap="round" />
    </svg>
  );
}
function StarIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="m12 3 2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 17l-5.4 2.8 1.1-6.1L3.2 9.4l6.1-.8L12 3Z" strokeLinejoin="round" />
    </svg>
  );
}
