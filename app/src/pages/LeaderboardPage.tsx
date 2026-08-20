import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getLeaderboard, listDailySteps, watchFriendships } from '../lib/db';
import Avatar from '../components/Avatar';
import { fmtCoins, fmtNumber } from '../lib/coins';
import { isPresidentUid, PRESIDENT_UID } from '../lib/constants';
import type { UserProfile } from '../lib/types';

export default function LeaderboardPage() {
  const { profile } = useAuth(); const navigate=useNavigate();
  const [rows, setRows] = useState<UserProfile[]>([]); const [mode,setMode]=useState<'coins'|'today'|'steps'|'week'|'month'|'friends'>('coins'); const [friendIds,setFriendIds]=useState<string[]>([]); const [periodScores,setPeriodScores]=useState<Record<string,{week:number;month:number}>>({});
  const [loading, setLoading] = useState(true);
  const currentRowRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    setLoading(true); const users=await getLeaderboard(50); setRows(users);
    const now=Date.now(), week=now-7*86400000, month=now-30*86400000; const scores:Record<string,{week:number;month:number}>={};
    await Promise.all(users.map(async u=>{const days=await listDailySteps(u.uid,30);scores[u.uid]={week:days.filter(d=>d.validatedAt>=week).reduce((s,d)=>s+d.steps,0),month:days.filter(d=>d.validatedAt>=month).reduce((s,d)=>s+d.steps,0)}}));
    setPeriodScores(scores); setLoading(false);
  };
  useEffect(() => { load().catch(()=>setLoading(false)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>profile?watchFriendships(profile.uid,setFriendIds):undefined,[profile?.uid]);

  const score=(u:UserProfile)=>mode==='today'?(u.todaySteps||0):mode==='steps'?u.totalSteps:mode==='week'?(periodScores[u.uid]?.week||0):mode==='month'?(periodScores[u.uid]?.month||0):u.elycoins;
  const allRows = profile && !rows.some(u => u.uid === profile.uid) ? [...rows, profile] : rows;
  const ranked=(mode==='friends'?allRows.filter(u=>u.uid===profile?.uid||friendIds.includes(u.uid)):[...allRows]).sort((a,b)=>score(b)-score(a));
  useEffect(() => {
    if (!loading) requestAnimationFrame(() => currentRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }, [loading, mode]);
  return (
    <div className="screen" data-testid="leaderboard-screen">
      <div className="screen-header">
        <div>
          <h1 className="screen-title">Classement</h1>
          <div className="screen-sub">Top 50 des marcheurs Elysium</div>
        </div>
      </div>

      <div className="chip-row"><button className={`chip ${mode==='coins'?'chip-active':''}`} onClick={()=>setMode('coins')}>ElyCoins</button><button className={`chip ${mode==='today'?'chip-active':''}`} onClick={()=>setMode('today')}>Pas du jour</button><button className={`chip ${mode==='steps'?'chip-active':''}`} onClick={()=>setMode('steps')}>Pas cumulés</button><button className={`chip ${mode==='week'?'chip-active':''}`} onClick={()=>setMode('week')}>7 jours</button><button className={`chip ${mode==='month'?'chip-active':''}`} onClick={()=>setMode('month')}>30 jours</button><button className={`chip ${mode==='friends'?'chip-active':''}`} onClick={()=>setMode('friends')}>Mes amis</button><button className="chip" onClick={load}>Actualiser</button></div>
      {loading ? (
        <div className="card leaderboard-skeleton" aria-label="Chargement du classement">{[1,2,3,4,5].map(i=><div className="skeleton-row" key={i}><span/><div><b/><small/></div></div>)}</div>
      ) : ranked.length === 0 ? (
        <div className="card">
          <div className="empty-state" data-testid="leaderboard-empty-state">
            <div className="display">Aucun marcheur</div>
            Soyez le premier au classement !
          </div>
        </div>
      ) : (
        <>
          {ranked.length >= 1 && (
            <div className="podium" data-testid="leaderboard-podium">
              {[{ index: 1, rank: 2, cls: 'second' }, { index: 0, rank: 1, cls: 'first' }, { index: 2, rank: 3, cls: 'third' }].map(({ index: idx, rank, cls }) => {
                const u = ranked[idx];
                if (!u) return <div className="podium-col" key={rank} />;
                return (
                  <div className={`podium-col ${cls}`} key={u.uid} data-testid="leaderboard-podium-item">
                    {idx === 0 && <div className="podium-crown">👑</div>}
                    <Avatar
                      className="podium-avatar"
                      name={u.displayName}
                      photoURL={u.photoURL}
                      size={idx === 0 ? 72 : 58}
                    />
                    <div className="podium-name">{u.displayName}</div>
                    <div className="podium-coins">{mode==='coins'||mode==='friends'?`${fmtCoins(score(u))} EC`:`${fmtNumber(score(u))} pas`}</div>
                    <div className="podium-base" aria-label={`Place ${rank}`}>{rank}</div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="card">
            {ranked.map((u, i) => (
              <div
                ref={u.uid === profile?.uid ? currentRowRef : undefined}
                className={`list-row ${u.uid === profile?.uid ? 'current-user-row' : ''}`}
                key={u.uid}
                style={u.uid === profile?.uid ? { background: 'var(--gold-dim)', borderRadius: 10, padding: '12px 8px' } : undefined}
                data-testid="leaderboard-row"
              >
                <div className="row-value" style={{ width: 22, textAlign: 'center', color: i < 3 ? 'var(--gold)' : 'var(--muted)' }}>
                  {i + 1}
                </div>
                <Avatar name={u.displayName} photoURL={u.photoURL} size={42} />
                <div className="row-main">
                  <button className="link-title" onClick={() => navigate(`/user/${u.uid}`)}>
                    {u.displayName}{' '}
                    {isPresidentUid(u.uid) && (
                      <span className="badge" style={{ marginLeft: 4 }}>
                        👑 {u.uid === PRESIDENT_UID ? 'Président' : 'Co-Président'}
                      </span>
                    )}
                  </button>
                  <div className="row-sub">
                    {fmtNumber(u.totalSteps)} pas · 🔥 {u.streak} j
                  </div>
                </div>
                <div className="row-value">{mode==='coins'||mode==='friends'?`${fmtCoins(u.elycoins)} EC`:`${fmtNumber(score(u))} pas`}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
