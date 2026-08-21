import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import ProgressRing from '../components/ProgressRing';
import Sheet from '../components/Sheet';
import { pedometer } from '../lib/pedometer';
import { showInterstitial, showRewardedAd } from '../lib/ads';
import { validateSteps, creditAdReward, syncTodaySteps } from '../lib/db';
import { coinsForSteps, caloriesForSteps, fmtCoins, fmtNumber, dateStr, nextStepTier, formatDistance } from '../lib/coins';
import { shareDailyStats } from '../lib/share';
import { DAILY_STEP_GOAL, STEP_TIERS, AD_REWARD_COINS, ATTESTATION_WORKER_URL } from '../lib/constants';
import { Capacitor } from '@capacitor/core';

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
  const navigate = useNavigate();
  const [steps, setSteps] = useState(0);
  const [perm, setPerm] = useState<PermState>('unavailable');
  const [showTiers, setShowTiers] = useState(false);
  const [busyValidate, setBusyValidate] = useState(false);
  const [busyAd, setBusyAd] = useState(false);
  const [celebration, setCelebration] = useState<string | null>(null);
  const [clock, setClock] = useState(Date.now());
  const previousSteps = useRef<number | null>(null);
  const celebratedToday = useRef(false);

  const isNative = Capacitor.isNativePlatform();
  const today = dateStr();
  const alreadyValidated = profile?.lastValidatedDate === today;
  const dailyGoal = profile?.dailyStepGoal || DAILY_STEP_GOAL;
  const lastAdAt = timestampMs(profile?.lastAdRewardAt);
  const adRemaining = lastAdAt ? Math.max(0, lastAdAt + 3600000 - clock) : 0;
  const adAvailable = adRemaining === 0;
  const adCountdown = `${String(Math.floor(adRemaining / 60000)).padStart(2, '0')}:${String(Math.floor(adRemaining / 1000) % 60).padStart(2, '0')}`;

  const celebrate = (message: string) => {
    setCelebration(message);
    if ('vibrate' in navigator) navigator.vibrate?.([40, 50, 80]);
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
    if (!profile || alreadyValidated || busyValidate) return;
    setBusyValidate(true);
    try {
      const stepsToValidate = pedometer.getTodaySteps();
      // Annonce interstitielle avant le crédit.
      await showInterstitial();
      const result = await validateSteps(profile.uid, stepsToValidate);
      toast(`+${fmtCoins(result.coins)} ElyCoins · Série de ${result.streak} jour${result.streak > 1 ? 's' : ''} !${result.freezeUsed ? ' Gel utilisé pour rattraper la journée manquée.' : ''}`, 'success');
      if (result.streak === 7 || result.streak === 30) celebrate(`Palier de série atteint : ${result.streak} jours !`);
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
      const rewarded = await showRewardedAd(profile.uid);
      if (rewarded) {
        if (ATTESTATION_WORKER_URL) {
          // SSV active : la récompense est créditée par le serveur (callback
          // AdMob vérifié) pour éviter toute fraude côté client.
          toast('Récompense en cours de vérification (serveur)…', 'success');
        } else {
          // Fallback temporaire (SSV non configurée) : crédit client borné.
          await creditAdReward(profile.uid);
          toast(`+${fmtCoins(AD_REWARD_COINS)} ElyCoins !`, 'success');
        }
      } else {
        toast('Publicité non terminée — aucune récompense.', 'error');
      }
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusyAd(false);
    }
  };

  const potentialCoins = coinsForSteps(steps);
  const calories = caloriesForSteps(steps, profile?.health, profile?.strideLengthCm || 75);
  const unitSystem = profile?.unitSystem || profile?.health?.unitSystem || 'metric';
  const distanceMeters = steps * (profile?.strideLengthCm || 75) / 100;
  const nextTier = nextStepTier(steps);
  return (
    <div className="screen" data-testid="home-screen">
      {celebration && <div className="celebration-overlay" role="status" aria-live="polite"><div className="celebration-card pop-in"><div className="celebration-confetti">✦ ✧ ✦</div><strong>{celebration}</strong><span>Continuez comme ça, marcheur ElyWalk !</span><div className="celebration-actions"><button className="btn btn-gold" onClick={() => setCelebration(null)}>Super !</button><button className="btn btn-ghost" onClick={async () => { if (!profile) return; try { await shareDailyStats(profile, steps, formatDistance(distanceMeters, unitSystem), calories); } catch (e) { if ((e as Error).name !== 'AbortError') toast((e as Error).message, 'error'); } }}>Partager</button></div></div></div>}
      <div className="screen-header">
        <div>
          <h1 className="screen-title">ElyWalk</h1>
          <div className="screen-sub">Bonjour, {profile?.displayName}</div>
        </div>
        <span className="badge" data-testid="home-balance-badge">
          <CoinIcon /> {fmtCoins(profile?.elycoins || 0)} EC
        </span>
      </div>

      <div className="gold-hero">
        <img src="/deco-1.webp" className="hero-deco" alt="" />
        <ProgressRing progress={steps / dailyGoal}>
          <div className="display" style={{ fontSize: 34, color: '#fff' }} data-testid="today-steps-value">
            {fmtNumber(steps)}
          </div>
          <div className="goal-label">
            sur {fmtNumber(dailyGoal)} pas
          </div>
          <div style={{ color: 'var(--gold)', fontSize: 13, marginTop: 6, fontFamily: 'var(--font-display)' }}>
            ≈ {potentialCoins} EC
          </div>
          <div className="next-tier-note">{nextTier ? `Encore ${fmtNumber(nextTier.remaining)} pas pour le palier ${fmtNumber(nextTier.target)} · ${nextTier.coins} EC` : 'Palier ElyCoins maximum atteint'}</div>
        </ProgressRing>

        <div className="stat-grid" style={{ marginTop: 16 }}>
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
      </div>

      {!isNative && (
        <div className="card web-counter-note" data-testid="web-counter-note">
          <div className="card-title">Compteur en mode aperçu</div>
          <p>Le navigateur ne peut pas accéder au capteur de pas Android. Ouvrez ElyWalk sur votre téléphone pour compter automatiquement votre activité.</p>
        </div>
      )}

      {isNative && perm !== 'granted' && (
        <div className="card" data-testid="permission-card">
          <div className="card-title">Activer le comptage des pas</div>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 12 }}>
            ElyWalk utilise le capteur de pas de votre téléphone, même lorsque
            l’application est fermée. Autorisez « Activité physique » — une
            notification discrète restera visible pour continuer à compter.
          </p>
          <button className="btn btn-gold" onClick={askPermission} data-testid="request-permission-button">
            Autoriser l’activité physique
          </button>
        </div>
      )}

      <section className={`daily-action ${alreadyValidated ? 'daily-action-done' : ''}`} aria-live="polite">
        {alreadyValidated && <div className="validation-success"><span>✓</span><div><strong>Journée validée</strong><small>Revenez demain pour poursuivre votre série.</small></div></div>}
        <button
          type="button"
          className="btn btn-gold"
          onClick={onValidate}
          disabled={busyValidate || alreadyValidated || !profile}
          data-testid="validate-steps-button"
        >
          {alreadyValidated ? 'Pas validés aujourd’hui ✓' : busyValidate ? 'Validation...' : `Valider mes pas (+${potentialCoins} EC)`}
        </button>
        <div className="secondary-actions">
          <button type="button" className="text-button" onClick={onWatchAd} disabled={busyAd || !adAvailable} data-testid="watch-ad-button">
            {busyAd ? 'Chargement...' : adAvailable ? `Voir une pub · +${fmtCoins(AD_REWARD_COINS)} EC` : `Prochaine pub dans ${adCountdown}`}
          </button>
          <button type="button" className="text-button" onClick={() => setShowTiers(true)} data-testid="show-tiers-button">Barème des gains</button>
        </div>
      </section>
      <div className="home-actions">
        <button type="button" className="btn btn-ghost" onClick={() => navigate('/history')}>Historique, santé & calendrier</button>
        <button type="button" className="btn btn-outline" onClick={() => navigate('/challenges')}>🏆 Ouvrir les défis datés</button>
        <button type="button" className="btn btn-outline" onClick={() => navigate('/activity')}>▶ Commencer une sortie</button>
        <button type="button" className="btn btn-outline" onClick={async () => { if (!profile) return; try { const result = await shareDailyStats(profile, steps, formatDistance(distanceMeters, unitSystem), calories); toast(result === 'shared' ? 'Carte partagée !' : 'Carte enregistrée dans vos téléchargements.', 'success'); } catch (e) { if ((e as Error).name !== 'AbortError') toast((e as Error).message, 'error'); } }}>Partager mes pas du jour</button>
      </div>
      <div className="card streak-freeze-card"><div className="card-title">Série protégée</div><div className="freeze-count">🧊 {profile?.streakFreezes ?? 1} gel disponible</div><p>Une journée manquée peut être rattrapée automatiquement le lendemain. Votre série ne repart plus forcément à 1.</p></div>

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
