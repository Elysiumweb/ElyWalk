import { useEffect, useState } from 'react';
import type { ActivityFeedItem } from '../lib/types';
import Avatar from './Avatar';
import { watchFriendFeed, listFriendFeed } from '../lib/db';
import { useAuth } from '../context/AuthContext';

function iconFor(type: string) {
  return ({ goal: '🎯', activity: '🏃', challenge: '🏆', badge: '🏅', streak: '🔥', friend: '🤝' } as Record<string,string>)[type] || '✦';
}
function timeAgo(ts:number){
  const s=Math.floor((Date.now()-ts)/1000);
  if(s<60) return `il y a ${s}s`;
  if(s<3600) return `il y a ${Math.floor(s/60)} min`;
  if(s<86400) return `il y a ${Math.floor(s/3600)} h`;
  return new Date(ts).toLocaleDateString('fr-FR');
}

export default function ActivityFeed(){
  const { profile }=useAuth();
  const [items,setItems]=useState<ActivityFeedItem[]>([]);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{
    if(!profile) return;
    listFriendFeed(profile.uid, 30).then(setItems).catch(()=>undefined).finally(()=>setLoading(false));
    const unsub=watchFriendFeed(profile.uid, setItems);
    return unsub;
  },[profile?.uid]);
  if(loading) return <div className="card"><div className="card-title">Fil d’activité</div><div className="empty-state">Chargement...</div></div>;
  if(items.length===0) return <div className="card" data-testid="feed-empty"><div className="card-title">Fil d’activité des amis</div><div className="empty-state">Aucune activité récente. Encouragez vos amis à marcher !</div></div>;
  return (
    <div className="card" data-testid="activity-feed">
      <div className="card-title">Fil d’activité · Amis</div>
      {items.map(it=>(
        <div key={it.id} className="list-row" data-testid="feed-item">
          <Avatar name={it.displayName} photoURL={it.photoURL} size={38} />
          <div className="row-main">
            <div className="row-title" style={{fontSize:13}}><span style={{marginRight:6}}>{iconFor(it.type)}</span>{it.displayName} <span style={{color:'var(--muted)', fontWeight:400}}>{it.message}</span></div>
            <div className="row-sub">{timeAgo(it.createdAt)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
