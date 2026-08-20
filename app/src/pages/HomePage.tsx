import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import ProgressRing from '../components/ProgressRing';
import Sheet from '../components/Sheet';
import { pedometer } from '../lib/pedometer';
import { showInterstitial, showRewardedAd } from '../lib/ads';
import { validateSteps, creditAdReward, syncTodaySteps } from '../lib/db';
import { coinsForSteps, caloriesForSteps, fmtCoins, fmtNumber, dateStr } from '../lib/coins';
import { DAILY_STEP_GOAL, STEP_TIERS, AD_REWARD_COINS, ATTESTATION_WORKER_URL } from '../lib/constants';
import { Capacitor } from '@capacitor/core';

type PermState = 'granted' | 'denied' | 'prompt' | 'unavailable';

export default function HomePage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [steps, setSteps] = useState(0);
  const [perm, setPerm] = useState<PermState>('unavailable');
  const [showTiers, setShowTiers] = useState(false);
  const [busyValidate, setBusyValidate] = useState(false);
  const [busyAd, setBusyAd] = useState(false);

  const isNative = Capacitor.isNativePlatform();
  const today = dateStr();
  const alreadyValidated = profile?.lastValidatedDate === today;

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
      toast(`+${fmtCoins(result.coins)} ElyCoins · Série de ${result.streak} jour${result.streak > 1 ? 's' : ''} !`, 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusyValidate(false);
    }
  };

  const onWatchAd = async () => {
    if (!profile || busyAd) return;
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
  const calories = caloriesForSteps(steps);

  return (
    <div className="screen" data-testid="home-screen">
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
        <ProgressRing progress={steps / (profile?.dailyStepGoal || DAILY_STEP_GOAL)}>
          <div className="display" style={{ fontSize: 34, color: '#fff' }} data-testid="today-steps-value">
            {fmtNumber(steps)}
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 2 }}>
            pas aujourd’hui
          </div>
          <div style={{ color: 'var(--gold)', fontSize: 13, marginTop: 6, fontFamily: 'var(--font-display)' }}>
            ≈ {potentialCoins} EC
          </div>
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
            <div className="stat-value" data-testid="stat-total-steps">{(steps * (profile?.strideLengthCm || 75) / 100000).toFixed(2)}</div>
            <div className="stat-label">km aujourd’hui</div>
          </div>
        </div>
      </div>

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

      <button
        className="btn btn-gold"
        onClick={onValidate}
        disabled={busyValidate || alreadyValidated || !profile}
        data-testid="validate-steps-button"
      >
        {alreadyValidated
          ? 'Pas validés aujourd’hui ✓'
          : busyValidate
            ? 'Validation...'
            : `Valider mes pas (+${potentialCoins} EC)`}
      </button>
      <div className="section-gap" />
      <button className="btn btn-outline" onClick={onWatchAd} disabled={busyAd} data-testid="watch-ad-button">
        {busyAd ? 'Chargement de la pub...' : `Regarder une pub (+${fmtCoins(AD_REWARD_COINS)} EC)`}
      </button>
      <div className="section-gap" />
      <button className="btn btn-ghost" onClick={() => setShowTiers(true)} data-testid="show-tiers-button">Voir le barème des gains</button>
      <div className="section-gap" />
      <button className="btn btn-ghost" onClick={() => navigate('/history')}>Historique, objectifs & badges</button>
      <div className="card" style={{marginTop:12}}><div className="card-title">Défis</div><div className="badge-grid"><span className="badge">{(profile?.streak||0)>=7?'🏅':'🔒'} Série 7 jours</span><span className="badge">{(profile?.streak||0)>=30?'🏆':'🔒'} Série 30 jours</span><span className="badge">{(profile?.totalSteps||0)>=100000?'🥾':'🔒'} 100 000 pas</span></div></div>

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
