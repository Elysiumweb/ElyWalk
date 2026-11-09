import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getUserProfile, listUserBadges, sendFriendRequest, sendFriendReaction, getProfiles, findUserByCode } from '../lib/db';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import type { UserProfile, UserBadge } from '../lib/types';
import Avatar from '../components/Avatar';
import BadgeGrid from '../components/BadgeGrid';
import LevelBadge from '../components/LevelBadge';
import { fmtCoins, fmtNumber, dateStr, formatDistance } from '../lib/coins';

export default function PublicProfilePage(){
  const {uid}=useParams();
  const nav=useNavigate();
  const { profile: me }=useAuth();
  const { toast }=useToast();
  const [p,setP]=useState<UserProfile|null>(null);
  const [badges,setBadges]=useState<UserBadge[]>([]);
  const [busy,setBusy]=useState(false);
  useEffect(()=>{if(uid) getUserProfile(uid).then(setP)},[uid]);
  useEffect(()=>{if(uid) listUserBadges(uid).then(setBadges).catch(()=>undefined)},[uid]);

  const isMe = me?.uid===p?.uid;

  const onAddFriend=async()=>{
    if(!me||!p) return;
    setBusy(true);
    try{ await sendFriendRequest(me,p); toast(`Demande envoyée à ${p.displayName} !`,'success'); }
    catch(e){ toast((e as Error).message,'error'); } finally{setBusy(false);}
  };
  const onEncourage=async()=>{
    if(!me||!p) return;
    const msg=prompt('Petit message d’encouragement (optionnel)')||'';
    setBusy(true);
    try{ await sendFriendReaction(me,p.uid,'👏',msg); toast('Encouragement envoyé ! 👏','success'); }
    catch(e){ toast((e as Error).message,'error'); } finally{setBusy(false);}
  };

  if(!p) return <div className="screen"><div className="screen-header"><h1 className="screen-title">Profil public</h1><button className="btn btn-ghost btn-sm" onClick={()=>nav(-1)}>Retour</button></div><div className="empty-state">Profil introuvable.</div></div>;

  const totalDistance = (p.totalSteps * (p.strideLengthCm||75))/100;
  const memberSince = new Date(p.createdAt).toLocaleDateString('fr-FR',{month:'long',year:'numeric'});

  return <div className="screen" data-testid="public-profile-screen">
    <div className="screen-header"><h1 className="screen-title">Profil public</h1><button className="btn btn-ghost btn-sm" onClick={()=>nav(-1)}>Retour</button></div>
    <div className="gold-hero profile-public">
      <Avatar name={p.displayName} photoURL={p.photoURL} size={76}/>
      <h2>{p.displayName}</h2>
      <p>{p.bio||'Membre de la communauté ElyWalk'}</p>
      <div style={{marginTop:10, display:'flex', gap:8, justifyContent:'center', flexWrap:'wrap'}}>
        <span className="badge">{fmtCoins(p.elycoins)} EC</span>
        <span className="badge">🔥 {p.streak} j</span>
      </div>
    </div>

    {!isMe && (
      <div className="card" style={{display:'flex', gap:8}}>
        <button className="btn btn-gold" style={{flex:1}} onClick={onAddFriend} disabled={busy} data-testid="public-add-friend">+ Ajouter en ami</button>
        <button className="btn btn-outline" style={{flex:1}} onClick={onEncourage} disabled={busy} data-testid="public-encourage">👏 Encourager</button>
      </div>
    )}

    <div className="stat-grid">
      <div className="stat"><div className="stat-value">{fmtNumber(p.todayDate===dateStr()?p.todaySteps:0)}</div><div className="stat-label">pas aujourd’hui</div></div>
      <div className="stat"><div className="stat-value">{p.streak}</div><div className="stat-label">série</div></div>
      <div className="stat"><div className="stat-value">{fmtCoins(p.elycoins)}</div><div className="stat-label">EC</div></div>
    </div>
    <div className="stat-grid" style={{marginTop:10}}>
      <div className="stat"><div className="stat-value">{fmtNumber(p.totalSteps)}</div><div className="stat-label">pas cumulés</div></div>
      <div className="stat"><div className="stat-value">{formatDistance(totalDistance, p.unitSystem||'metric')}</div><div className="stat-label">distance totale</div></div>
      <div className="stat"><div className="stat-value">{fmtNumber(p.totalCalories)}</div><div className="stat-label">kcal totales</div></div>
    </div>

    <div style={{marginTop:12}}>
      <LevelBadge totalSteps={p.totalSteps} />
    </div>

    <div className="card">
      <div className="card-title">Badges · {badges.length}</div>
      {badges.length>0 ? <BadgeGrid badges={badges} size="small" /> : <div className="empty-state" style={{padding:'12px 0'}}>Aucun badge encore débloqué.</div>}
    </div>

    <div className="card">
      <div className="card-title">À propos</div>
      <div className="list-row">
        <div className="row-main"><div className="row-title" style={{fontSize:13}}>Membre depuis</div><div className="row-sub">{memberSince}</div></div>
      </div>
      <div className="list-row">
        <div className="row-main"><div className="row-title" style={{fontSize:13}}>Objectif quotidien</div><div className="row-sub">{fmtNumber(p.dailyStepGoal||10000)} pas</div></div>
      </div>
      {p.bio && <div style={{marginTop:10, padding:10, background:'var(--surface-2)', borderRadius:8, color:'#d8d2c2', fontSize:13}}>{p.bio}</div>}
    </div>

    {!isMe && (
      <div className="card">
        <div className="card-title">Actions</div>
        <p className="card-help">Ajoutez {p.displayName} pour comparer vos pas, défier et voir son fil d’activité.</p>
      </div>
    )}
  </div>
}
