import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { getChallengeDefinitions } from '../lib/constants';
import { claimChallengeReward, listMyChallenges } from '../lib/db';
import type { ChallengeDefinition, UserChallenge } from '../lib/types';
import { fmtNumber } from '../lib/coins';

function daysLeft(end: string): string {
  const diff = Math.ceil((new Date(`${end}T23:59:59`).getTime() - Date.now()) / 86400000);
  return diff <= 0 ? 'Se termine aujourd’hui' : `${diff} jour${diff > 1 ? 's' : ''} restant${diff > 1 ? 's' : ''}`;
}

export default function ChallengesPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [items, setItems] = useState<{ challenge: ChallengeDefinition; state: UserChallenge }[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    try {
      const definitions = getChallengeDefinitions();
      const states = await listMyChallenges(profile.uid, definitions);
      setItems(states.map((state) => ({ challenge: definitions.find((d) => d.id === state.challengeId)!, state })));
    } catch (e) { toast((e as Error).message || 'Impossible de charger les défis.', 'error'); }
    finally { setLoading(false); }
  }, [profile?.uid, toast]);
  useEffect(() => { load(); }, [load]);

  const claim = async (challenge: ChallengeDefinition, state: UserChallenge) => {
    if (!profile) return;
    try { await claimChallengeReward(profile.uid, challenge, state.progress); toast(`+${fmtNumber(challenge.reward)} EC · défi terminé !`, 'success'); await load(); }
    catch (e) { toast((e as Error).message, 'error'); }
  };

  return <div className="screen" data-testid="challenges-screen">
    <div className="screen-header"><div><h1 className="screen-title">Défis</h1><div className="screen-sub">Des objectifs datés, collectifs et saisonniers</div></div><button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}>Retour</button></div>
    <div className="challenge-intro card"><strong>Marchez ensemble, gagnez vraiment.</strong><span>Chaque défi possède une période, une progression sauvegardée et une récompense ElyCoins récupérable une seule fois.</span></div>
    {loading ? <div className="card empty-state">Chargement des défis…</div> : items.map(({ challenge, state }) => {
      const progress = Math.min(state.progress, challenge.target); const percent = Math.min(100, progress / challenge.target * 100);
      return <article className={`challenge-card card ${state.completed ? 'challenge-complete' : ''}`} key={challenge.id} data-testid={`challenge-${challenge.id}`}>
        <div className="challenge-top"><span className="challenge-icon">{challenge.icon}</span><div className="row-main"><div className="challenge-kind">{challenge.kind === 'collective' ? 'COLLECTIF' : challenge.kind === 'seasonal' ? 'SAISONNIER' : 'DÉFI DATÉ'}</div><h2>{challenge.title}</h2></div><span className="challenge-reward">+{challenge.reward} EC</span></div>
        <p className="challenge-description">{challenge.description}</p>
        <div className="challenge-meta"><span>{daysLeft(challenge.endsAt)}</span><span>{challenge.participantLabel || (challenge.metric === 'activeDays' ? 'jours actifs' : challenge.metric === 'streak' ? 'jours de série' : 'pas')}</span></div>
        <div className="challenge-progress"><div style={{ width: `${percent}%` }} /></div>
        <div className="challenge-numbers"><span>{challenge.metric === 'steps' ? fmtNumber(progress) : progress} / {challenge.metric === 'steps' ? fmtNumber(challenge.target) : challenge.target}</span><span>{state.claimed ? 'Récompense récupérée ✓' : state.completed ? 'Terminé !' : `${Math.round(percent)} %`}</span></div>
        {state.completed && !state.claimed && <button className="btn btn-gold" onClick={() => claim(challenge, state)}>Récupérer +{challenge.reward} EC</button>}
      </article>;
    })}
  </div>;
}
