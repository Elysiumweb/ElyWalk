import { useEffect, useMemo, useState } from 'react';
import type { ActivityFeedItem } from '../lib/types';
import Avatar from './Avatar';
import {
  watchFriendFeed,
  listFriendFeed,
  toggleFeedKudos,
  watchFeedReactions,
  watchFeedComments,
  addFeedComment,
  deleteFeedComment,
  type FeedComment,
  type FeedReaction,
} from '../lib/db';
import { useAuth } from '../context/AuthContext';
import { useToast } from './Toast';
import { hapticTap } from '../lib/haptics';

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

/**
 * Fil d'activité **interactif** (A8).
 *
 * Avant : des lignes passives, sans aucune action (ni kudos, ni commentaire).
 * Chaque élément propose désormais :
 *  - un 👏 unique par personne et par élément (identifiant déterministe côté
 *    règles : impossible de voter deux fois) ;
 *  - les commentaires courts (≤ 200 caractères) dépliables ;
 *  - le compteur de réactions, pour que l'auteur voie qu'on l'encourage.
 */
export default function ActivityFeed(){
  const { profile }=useAuth();
  const { toast }=useToast();
  const [items,setItems]=useState<ActivityFeedItem[]>([]);
  const [loading,setLoading]=useState(true);
  const [reactions,setReactions]=useState<Record<string, FeedReaction[]>>({});
  const [comments,setComments]=useState<Record<string, FeedComment[]>>({});
  const [openComments,setOpenComments]=useState<string | null>(null);
  const [draft,setDraft]=useState('');
  const [sending,setSending]=useState(false);

  useEffect(()=>{
    if(!profile) return;
    let live = false;
    listFriendFeed(profile.uid, 30).then((list)=>{ if(!live) setItems(list); }).catch(()=>undefined).finally(()=>setLoading(false));
    const unsub=watchFriendFeed(profile.uid, (list)=>{ live = true; setItems(list); });
    return unsub;
  },[profile?.uid]);

  // Réactions et commentaires des éléments visibles (10 identifiants maximum
  // par requête, limite Firestore de l'opérateur `in`).
  const itemIds = useMemo(() => items.map((item) => item.id || '').filter(Boolean), [items]);
  const idsKey = itemIds.slice(0, 10).join('|');
  useEffect(() => {
    if (!idsKey) { setReactions({}); setComments({}); return; }
    const ids = idsKey.split('|');
    // Les deux abonnements sont best effort : une règle refusée ne doit pas
    // empêcher l'affichage du fil.
    const unsubReactions = watchFeedReactions(ids, setReactions, () => undefined);
    const unsubComments = watchFeedComments(ids, setComments, () => undefined);
    return () => { unsubReactions(); unsubComments(); };
  }, [idsKey]);

  const kudos = async (item: ActivityFeedItem) => {
    if (!profile || !item.id) return;
    if (item.uid === profile.uid) { toast('Vous ne pouvez pas vous encourager vous-même.', 'info'); return; }
    try {
      const active = await toggleFeedKudos(item.id, profile);
      void hapticTap();
      if (active) toast('Encouragement envoyé !', 'success');
    } catch (e) {
      toast((e as Error).message || 'Encouragement impossible.', 'error');
    }
  };

  const sendComment = async (item: ActivityFeedItem) => {
    if (!profile || !item.id || !draft.trim() || sending) return;
    setSending(true);
    try {
      await addFeedComment(item, profile, draft);
      setDraft('');
    } catch (e) {
      // Le brouillon reste en place : l'utilisateur ne perd pas son texte.
      toast((e as Error).message || 'Commentaire impossible.', 'error');
    } finally {
      setSending(false);
    }
  };

  const removeComment = async (comment: FeedComment) => {
    try {
      await deleteFeedComment(comment);
    } catch (e) {
      toast((e as Error).message || 'Suppression impossible.', 'error');
    }
  };

  if(loading) return <div className="card"><div className="card-title">Fil d’activité</div><div className="empty-state">Chargement...</div></div>;
  if(items.length===0) return <div className="card" data-testid="feed-empty"><div className="card-title">Fil d’activité des amis</div><div className="empty-state">Aucune activité récente. Encouragez vos amis à marcher !</div></div>;
  return (
    <div className="card" data-testid="activity-feed">
      <div className="card-title">Fil d’activité · Amis</div>
      {items.map(it=>{
        const list = reactions[it.id || ''] || [];
        const mine = !!profile && list.some((reaction) => reaction.uid === profile.uid);
        const itemComments = comments[it.id || ''] || [];
        const isMine = it.uid === profile?.uid;
        const commentsOpen = openComments === it.id;
        return (
          <div key={it.id} className="feed-item" data-testid="feed-item">
            <div className="list-row">
              <Avatar name={it.displayName} photoURL={it.photoURL} size={38} />
              <div className="row-main">
                <div className="row-title" style={{fontSize:13}}><span style={{marginRight:6}}>{iconFor(it.type)}</span>{it.displayName} <span style={{color:'var(--muted)', fontWeight:400}}>{it.message}</span></div>
                <div className="row-sub">{timeAgo(it.createdAt)}</div>
              </div>
            </div>
            <div className="feed-actions">
              <button
                type="button"
                className={`feed-action ${mine ? 'feed-action-active' : ''}`}
                onClick={() => void kudos(it)}
                aria-pressed={mine}
                aria-label={mine ? 'Retirer mon encouragement' : `Encourager ${it.displayName}`}
                disabled={isMine}
                data-testid="feed-kudos"
              >
                👏 {list.length > 0 ? list.length : 'Bravo'}
              </button>
              <button
                type="button"
                className={`feed-action ${commentsOpen ? 'feed-action-active' : ''}`}
                onClick={() => { setOpenComments(commentsOpen ? null : (it.id || null)); setDraft(''); }}
                aria-expanded={commentsOpen}
                data-testid="feed-comments-toggle"
              >
                💬 {itemComments.length > 0 ? itemComments.length : 'Commenter'}
              </button>
            </div>
            {commentsOpen && it.id && (
              <div className="feed-comments" data-testid="feed-comments">
                {itemComments.map((comment) => (
                  <div className="feed-comment" key={comment.id}>
                    <strong>{comment.name}</strong>
                    <span>{comment.text}</span>
                    {comment.uid === profile?.uid && (
                      <button
                        type="button"
                        className="icon-danger"
                        aria-label="Supprimer mon commentaire"
                        onClick={() => void removeComment(comment)}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                {itemComments.length === 0 && <p className="muted-xs">Aucun commentaire. Soyez le premier.</p>}
                <div className="field" style={{ marginTop: 6 }}>
                  <input
                    className="input"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value.slice(0, 200))}
                    onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void sendComment(it); } }}
                    placeholder="Un mot d’encouragement (200 caractères)"
                    maxLength={200}
                    aria-label="Votre commentaire"
                    data-testid="feed-comment-input"
                  />
                  <small style={{ color: 'var(--muted)' }}>{draft.length}/200</small>
                </div>
                <button
                  type="button"
                  className="btn btn-gold btn-sm"
                  onClick={() => void sendComment(it)}
                  disabled={sending || !draft.trim()}
                  data-testid="feed-comment-send"
                >
                  {sending ? 'Envoi…' : 'Publier'}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
