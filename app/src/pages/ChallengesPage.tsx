import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import Sheet from '../components/Sheet';
import Avatar from '../components/Avatar';
import { getChallengeDefinitions } from '../lib/constants';
import { claimChallengeReward, listMyChallenges, createFriendChallenge, watchFriendChallenges, getFriendChallengeProgress, deleteFriendChallenge, watchFriendships, getProfiles } from '../lib/db';
import type { ChallengeDefinition, UserChallenge, FriendChallenge, UserProfile } from '../lib/types';
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
  const [tab, setTab] = useState<'global'|'friends'>('global');
  const [friendChallenges, setFriendChallenges] = useState<FriendChallenge[]>([]);
  const [friendProgress, setFriendProgress] = useState<Record<string, { uid:string;displayName:string;photoURL?:string|null;progress:number;percent:number }[]>>({});
  const [createOpen, setCreateOpen]=useState(false);
  const [title, setTitle]=useState('50 000 pas cette semaine');
  const [target, setTarget]=useState('50000');
  const [friends, setFriends]=useState<UserProfile[]>([]);
  const [selected, setSelected]=useState<string[]>([]);
  const [busy, setBusy]=useState(false);

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

  useEffect(()=>{
    if(!profile) return;
    const unsub=watchFriendChallenges(profile.uid, async (items)=>{
      setFriendChallenges(items);
      // load progress for each
      for(const ch of items){
        getFriendChallengeProgress(ch).then(p=>setFriendProgress(prev=>({...prev,[ch.id!]:p}))).catch(()=>undefined);
      }
    });
    return unsub;
  },[profile?.uid]);

  useEffect(()=>{
    if(!profile) return;
    const unsub=watchFriendships(profile.uid, async (uids)=>{
      const profs=await getProfiles(uids);
      setFriends(profs);
    });
    return unsub;
  },[profile?.uid]);

  const claim = async (challenge: ChallengeDefinition, state: UserChallenge) => {
    if (!profile) return;
    try { await claimChallengeReward(profile.uid, challenge, state.progress); toast(`+${fmtNumber(challenge.reward)} EC · défi terminé !`, 'success'); await load(); }
    catch (e) { toast((e as Error).message, 'error'); }
  };

  const onCreateFriendChallenge=async()=>{
    if(!profile) return;
    if(selected.length===0){ toast('Sélectionnez au moins un ami','error'); return; }
    if(selected.length>5){ toast('Max 5 amis','error'); return; }
    setBusy(true);
    try{
      await createFriendChallenge(profile, { title: title.trim()||'Défi entre amis', target: Number(target)||50000, participantUids: selected });
      toast('Défi entre amis créé !','success');
      setCreateOpen(false);
      setTitle('50 000 pas cette semaine'); setTarget('50000'); setSelected([]);
    }catch(e){ toast((e as Error).message,'error'); } finally{ setBusy(false); }
  };

  return <div className="screen" data-testid="challenges-screen">
    <div className="screen-header"><div><h1 className="screen-title">Défis</h1><div className="screen-sub">Des objectifs datés, collectifs et saisonniers</div></div><button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}>Retour</button></div>
    <div className="chip-row" style={{marginBottom:12}}>
      <button className={`chip ${tab==='global'?'chip-active':''}`} onClick={()=>setTab('global')}>Globaux</button>
      <button className={`chip ${tab==='friends'?'chip-active':''}`} onClick={()=>setTab('friends')}>Entre amis {friendChallenges.length>0 && `· ${friendChallenges.length}`}</button>
    </div>
    {tab==='global' && <>
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
    </>}
    {tab==='friends' && (
      <div>
        <div className="card" style={{display:'flex', flexDirection:'column', gap:10}}>
          <div className="card-title">Défis entre amis</div>
          <p className="card-help">Lancez un défi 1 vs 1 ou petit groupe (2-6). Ex. « 50 000 pas cette semaine contre @Paul » — comparaison en direct des pas validés.</p>
          <button className="btn btn-gold" onClick={()=>setCreateOpen(true)}>+ Créer un défi privé</button>
        </div>
        {friendChallenges.length===0 ? <div className="card empty-state"><div className="display">Aucun défi entre amis</div>Créez votre premier défi pour défier vos amis !</div> : friendChallenges.map(ch=>{
          const prog=friendProgress[ch.id!];
          const isCreator=ch.creatorUid===profile?.uid;
          return <div key={ch.id} className="card" data-testid="friend-challenge-card">
            <div className="challenge-top"><span className="challenge-icon">⚔️</span><div className="row-main"><div className="challenge-kind">DÉFI AMIS · {ch.metric==='steps'?'PAS':'DISTANCE'}</div><h2>{ch.title}</h2><small style={{color:'var(--muted)'}}>par {ch.creatorName} · {daysLeft(ch.endsAt)}</small></div>{isCreator && <button className="btn btn-ghost btn-sm" onClick={async()=>{ if(confirm('Supprimer ce défi ?')){ await deleteFriendChallenge(profile!.uid,ch.id!); toast('Défi supprimé','info'); }}}>✕</button>}</div>
            <div style={{marginTop:10}}>
              {prog ? prog.map(p=>(
                <div key={p.uid} className="list-row">
                  <Avatar name={p.displayName} photoURL={p.photoURL} size={36} />
                  <div className="row-main"><div className="row-title" style={{fontSize:13}}>{p.displayName}{p.uid===profile?.uid?' (vous)':''}</div><div className="row-sub">{fmtNumber(p.progress)} / {fmtNumber(ch.target)} {ch.metric==='steps'?'pas':'m'}</div></div>
                  <div className="row-value" style={{fontSize:12}}>{p.percent}%</div>
                </div>
              )): <div className="empty-state" style={{padding:10}}>Calcul en cours...</div>}
            </div>
            {prog && <div className="challenge-progress" style={{marginTop:8}}><div style={{width:`${Math.max(...prog.map(x=>x.percent))}%`}} /></div>}
            <div className="challenge-meta" style={{marginTop:6}}><span>{ch.participants.length} participants</span><span>{ch.startsAt} → {ch.endsAt}</span></div>
          </div>;
        })}
      </div>
    )}
    <Sheet open={createOpen} onClose={()=>setCreateOpen(false)} title="Créer un défi entre amis">
      <div className="field"><label>Titre</label><input className="input" value={title} onChange={e=>setTitle(e.target.value)} maxLength={60} placeholder="ex. 50 000 pas cette semaine" /></div>
      <div className="field"><label>Objectif (pas)</label><input className="input" type="number" value={target} onChange={e=>setTarget(e.target.value)} min={1000} max={500000} /></div>
      <div className="field"><label>Amis à défier (max 5)</label>
        {friends.length===0 ? <div className="empty-state">Aucun ami — ajoutez-en d’abord.</div> : friends.map(f=>(
          <label key={f.uid} className="list-row" style={{cursor:'pointer'}}>
            <input type="checkbox" checked={selected.includes(f.uid)} onChange={e=>{
              if(e.target.checked) setSelected(s=>[...s,f.uid]);
              else setSelected(s=>s.filter(x=>x!==f.uid));
            }} />
            <Avatar name={f.displayName} photoURL={f.photoURL} size={36} />
            <div className="row-main"><div className="row-title" style={{fontSize:13}}>{f.displayName}</div></div>
          </label>
        ))}
      </div>
      <button className="btn btn-gold" onClick={onCreateFriendChallenge} disabled={busy||selected.length===0}>{busy?'Création...':'Lancer le défi ⚔️'}</button>
    </Sheet>
  </div>;
}
