import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import Sheet from '../components/Sheet';
import ReportDialog from '../components/ReportDialog';
import {
  findUserByCode,
  sendFriendRequest,
  watchIncomingRequests,
  respondFriendRequest,
  watchFriendships,
  getProfiles,
  watchOutgoingRequests,
  searchUsersByName,
  removeFriendship,
  sendFriendReaction,
  watchFriendReactions,
  sendDirectMessage,
  watchRecentMessages,
  listRecentMessages,
  watchDirectMessages,
} from '../lib/db';
import { isUnshareableOrigin, shareUrlForReferral } from '../lib/share';
import Avatar from '../components/Avatar';
import { EmptyState, ErrorState, Skeleton } from '../components/AsyncState';
import ActivityFeed from '../components/ActivityFeed';
import QRCode, { shareFriendCode } from '../components/QRCode';
import { fmtNumber, dateStr } from '../lib/coins';
import type { UserProfile, FriendRequest, DirectMessage } from '../lib/types';

export default function FriendsPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [friends, setFriends] = useState<UserProfile[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [requestProfiles, setRequestProfiles] = useState<Record<string, UserProfile>>({});
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [reactions,setReactions]=useState<{id:string;fromName:string;emoji:string;message:string}[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  // Incrémenter cette clé relance réellement les abonnements (le bouton
  // « Réessayer » ne faisait auparavant que masquer l'erreur).
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState<'friends'|'feed'|'messages'>('friends');
  const [qrOpen, setQrOpen] = useState(false);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [msgOpen, setMsgOpen] = useState<{uid:string; name:string}|null>(null);
  const [msgText, setMsgText] = useState('');
  const [chatMessages, setChatMessages] = useState<DirectMessage[]>([]);
  const [msgBusy, setMsgBusy]=useState(false);
  const [reportedMessage,setReportedMessage]=useState<DirectMessage|null>(null);

  useEffect(() => {
    if (!profile) return;
    const unsub1 = watchIncomingRequests(profile.uid, setRequests);
    const unsub2 = watchFriendships(
      profile.uid,
      async (uids) => {
        // F10 — une lecture de profils refusée laissait auparavant la liste en
        // « Chargement… » indéfiniment : on sort explicitement de l'état
        // chargement et on expose l'erreur pour pouvoir réessayer.
        try {
          const profiles = await getProfiles(uids);
          setFriends(profiles);
          setLoadError(null);
        } catch (e) {
          setLoadError(e);
        } finally {
          setLoading(false);
        }
      },
      // Refus de règle ou coupure réseau : sans ce gestionnaire, le callback
      // n'était jamais appelé et l'écran restait bloqué sur le squelette.
      (error) => {
        setLoadError(error);
        setLoading(false);
      },
    );
    const unsub3 = watchOutgoingRequests(profile.uid, setOutgoing, () => setOutgoing([]));
    const unsub4 = watchFriendReactions(profile.uid, setReactions, () => setReactions([]));
    const unsub5 = watchRecentMessages(profile.uid, setMessages);
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); unsub5(); };
  }, [profile?.uid, reloadKey]);

  const onAdd = async () => {
    if (!profile || !code.trim()) return;
    setBusy(true);
    try {
      const target = await findUserByCode(code.trim());
      if (!target) throw new Error('Aucun utilisateur trouvé avec ce code.');
      await sendFriendRequest(profile, target);
      toast(`Demande envoyée à ${target.displayName} !`, 'success');
      setAddOpen(false);
      setCode('');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const respond = async (req: FriendRequest, accept: boolean) => {
    try {
      await respondFriendRequest(req, accept);
      toast(accept ? 'Ami ajouté !' : 'Demande refusée.', accept ? 'success' : 'info');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  useEffect(() => {
    const ids = [...new Set(requests.map(r => r.from))];
    if (!ids.length) { setRequestProfiles({}); return; }
    getProfiles(ids).then(items => setRequestProfiles(Object.fromEntries(items.map(item => [item.uid, item]))));
  }, [requests]);

  const doSearch = async () => { setSearchResults(await searchUsersByName(code)); };
  const remove = async (uid:string) => { if(!profile||!confirm('Supprimer cet ami ?'))return; await removeFriendship(profile.uid,uid); toast('Ami supprimé.','info'); };
  /**
   * Partage du code de parrainage.
   *
   * Le lien est construit sur le domaine public (jamais `location.origin`, qui
   * vaut `https://localhost` dans la WebView) et vérifié **avant** l'envoi : un
   * lien non partageable est refusé avec un message clair plutôt que copié tel
   * quel dans une conversation. `navigator.share` reçoit `url` séparément de
   * `text` : sur Android, `text` seul est parfois tronqué par certaines
   * applications et l'URL devenait locale.
   */
  const share = async () => {
    if (!profile) return;
    const url = shareUrlForReferral(profile.referralCode);
    if (isUnshareableOrigin(url)) {
      toast('Lien indisponible : réessayez depuis une version à jour de l’application.', 'error');
      return;
    }
    const text = `Rejoins-moi sur ElyWalk avec le code ${profile.referralCode}`;
    try {
      if (navigator.share) await navigator.share({ title: 'ElyWalk', text, url });
      else { await navigator.clipboard.writeText(`${text} ${url}`); toast('Lien copié !', 'success'); }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast((e as Error).message || 'Partage impossible.', 'error');
    }
  };
  const shareQR = async()=>{ if(!profile)return; try{ const r=await shareFriendCode(profile.referralCode, profile.displayName); toast(r==='shared'?'QR partagé !':'Image enregistrée.','success'); }catch(e){toast((e as Error).message,'error')} };
  const today = dateStr();

  /**
   * Ouvre une conversation en **fermant l'écoute précédente**.
   * Avant, chaque ouverture empilait un abonnement : en alternant rapidement
   * entre deux amis, les messages de l'un s'affichaient chez l'autre (F08).
   */
  const chatUnsubRef = useRef<(() => void) | null>(null);
  const closeChat = () => {
    chatUnsubRef.current?.();
    chatUnsubRef.current = null;
    setMsgOpen(null);
    setChatMessages([]);
  };
  const openChat = (uid:string, name:string)=>{
    if(!profile) return;
    chatUnsubRef.current?.();
    setChatMessages([]);
    setMsgOpen({uid,name});
    chatUnsubRef.current = watchDirectMessages(profile.uid, uid, setChatMessages);
  };
  // Fermeture de la feuille ou démontage : aucun abonnement ne doit survivre.
  useEffect(() => () => {
    chatUnsubRef.current?.();
    chatUnsubRef.current = null;
  }, []);
  const sendMsg = async()=>{
    if(!profile||!msgOpen||!msgText.trim()) return;
    setMsgBusy(true);
    try{ await sendDirectMessage(profile, msgOpen.uid, msgText); setMsgText(''); }
    catch(e){ toast((e as Error).message,'error'); }
    finally{ setMsgBusy(false); }
  };

  return (
    <div className="screen" data-testid="friends-screen">
      <div className="screen-header">
        <div>
          <h1 className="screen-title">Amis</h1>
          <div className="screen-sub">Partagez vos stats d’activité</div>
        </div>
        <button className="btn btn-gold btn-sm" onClick={() => setAddOpen(true)} data-testid="add-friend-button">
          + Ajouter
        </button>
      </div>

      <div className="chip-row" style={{marginBottom:8}}>
        <button className={`chip ${tab==='friends'?'chip-active':''}`} onClick={()=>setTab('friends')}>Amis</button>
        <button className={`chip ${tab==='feed'?'chip-active':''}`} onClick={()=>setTab('feed')}>Fil d’activité</button>
        <button className={`chip ${tab==='messages'?'chip-active':''}`} onClick={()=>setTab('messages')}>Messages {messages.length>0 && `· ${messages.length}`}</button>
      </div>

      <div className="card">
        <div className="card-title">Mon code ami</div>
        <div className="display" style={{ fontSize: 22, color: 'var(--gold)', letterSpacing: '0.2em' }} data-testid="my-friend-code">
          {profile?.referralCode}
        </div>
        <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 6 }}>Partagez ce code : il sert aussi de code de parrainage (+10 EC par filleul éligible).</p>
        <div className="two-col" style={{marginTop:10}}>
          <button className="btn btn-outline btn-sm" onClick={share}>Partager / copier</button>
          <button className="btn btn-gold btn-sm" onClick={()=>setQrOpen(true)}>QR code</button>
        </div>
      </div>

      {tab==='friends' && <>
      {requests.length > 0 && (
        <div className="card" data-testid="friend-requests-card">
          <div className="card-title">Demandes reçues</div>
          {requests.map((r) => (
            <div className="list-row" key={r.id} data-testid="friend-request-row">
              <Avatar name={r.fromName} photoURL={requestProfiles[r.from]?.photoURL} size={42} />
              <div className="row-main">
                <div className="row-title">{r.fromName}</div>
                <div className="row-sub">veut devenir votre ami</div>
              </div>
              <button className="btn btn-gold btn-sm" onClick={() => respond(r, true)} data-testid="accept-friend-button">
                Accepter
              </button>
              <button className="btn btn-danger btn-sm" onClick={() => respond(r, false)} data-testid="reject-friend-button">
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {reactions.length>0&&<div className="card"><div className="card-title">Encouragements reçus</div>{reactions.map(r=><div className="list-row" key={r.id}><span style={{fontSize:24}}>{r.emoji}</span><div className="row-main"><div className="row-title">{r.fromName}</div><div className="row-sub">{r.message||'vous encourage !'}</div></div></div>)}</div>}
      {outgoing.length>0&&<div className="card"><div className="card-title">Demandes envoyées</div>{outgoing.map(r=><div className="list-row" key={r.id}><div className="row-main"><div className="row-title">{r.toName}</div><div className="row-sub">En attente</div></div></div>)}</div>}

      <div className="card">
        <div className="card-title">Mes amis ({friends.length})</div>
        {loading ? (
          <Skeleton rows={4} label="Chargement de vos amis" />
        ) : loadError ? (
          <ErrorState
            title="Vos amis n’ont pas pu être chargés"
            error={loadError}
            onRetry={() => { setLoading(true); setLoadError(null); setReloadKey((k) => k + 1); }}
          />
        ) : friends.length === 0 ? (
          <EmptyState
            icon="👋"
            title="Aucun ami pour l’instant"
            hint="Ajoutez vos amis avec leur code pour comparer vos pas, séries et calories."
            action={<button className="btn btn-gold" onClick={() => setAddOpen(true)}>Ajouter un ami</button>}
          />
        ) : (
          friends.map((f) => (
            <div className="list-row" key={f.uid} data-testid="friend-row">
              <Avatar name={f.displayName} photoURL={f.photoURL} size={42} />
              <div className="row-main">
                <button className="link-title" onClick={()=>navigate(`/user/${f.uid}`)}>{f.displayName}</button>
                <div className="row-sub">
                  🔥 {f.streak} j d’affilée · {fmtNumber(f.todayDate === today ? f.todaySteps : 0)} pas
                  aujourd’hui · {fmtNumber(f.totalCalories)} kcal au total
                </div>
              </div>
              <button className="icon-danger" title="Message" onClick={()=>openChat(f.uid,f.displayName)} aria-label="Message">💬</button>
              <button className="icon-danger" onClick={()=>profile&&sendFriendReaction(profile,f.uid,'👏',prompt('Petit message (optionnel)')||'').then(()=>toast('Encouragement envoyé !','success'))} aria-label="Encourager">👏</button><button className="icon-danger" onClick={()=>remove(f.uid)} aria-label="Supprimer">✕</button>
            </div>
          ))
        )}
      </div>

      <ActivityFeed />
      </>}

      {tab==='feed' && <ActivityFeed />}

      {tab==='messages' && (
        <div className="card" data-testid="messages-tab">
          <div className="card-title">Messagerie légère</div>
          <p className="card-help">Messages courts entre amis (max 500 car.). Respect et bienveillance — tout abus peut être signalé.</p>
          {friends.length===0 ? <div className="empty-state">Ajoutez des amis pour discuter.</div> : friends.map(f=>(
            <div key={f.uid} className="list-row">
              <Avatar name={f.displayName} photoURL={f.photoURL} size={40} />
              <div className="row-main"><div className="row-title">{f.displayName}</div><div className="row-sub">💬 Conversation privée</div></div>
              <button className="btn btn-gold btn-sm" onClick={()=>openChat(f.uid,f.displayName)}>Ouvrir</button>
            </div>
          ))}
          {messages.length>0 && (
            <div style={{marginTop:12}}>
              <div className="card-title" style={{fontSize:12}}>Derniers messages</div>
              {messages.slice(0,5).map(m=>(
                <div key={m.id} className="list-row" style={{opacity:0.9}}>
                  <span style={{fontSize:18}}>{m.from===profile?.uid?'↗':'↘'}</span>
                  <div className="row-main"><div className="row-title" style={{fontSize:12}}>{m.from===profile?.uid?`À ${m.toName}`:m.fromName}</div><div className="row-sub">{m.text.slice(0,60)}</div></div>
                  <small style={{color:'var(--muted)'}}>{new Date(m.createdAt).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</small>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title="Ajouter un ami" testId="add-friend-sheet">
        <div className="field">
          <label>Code ami</label>
          <input
            className="input"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="Ex. A3F7K9"
            data-testid="friend-code-input"
          />
        </div>
        <div className="two-col"><button className="btn btn-gold" onClick={onAdd} disabled={busy} data-testid="send-friend-request-button">{busy ? '...' : 'Ajouter par code'}</button><button className="btn btn-outline" onClick={doSearch}>Chercher pseudo</button></div>
        {searchResults.map(u=><div className="list-row" key={u.uid}><Avatar name={u.displayName} photoURL={u.photoURL}/><div className="row-main"><div className="row-title">{u.displayName}</div></div><button className="btn btn-gold btn-sm" onClick={()=>profile&&sendFriendRequest(profile,u).then(()=>toast('Demande envoyée','success'))}>Ajouter</button></div>)}
      </Sheet>

      <Sheet open={qrOpen} onClose={()=>setQrOpen(false)} title="QR code ami">
        <div style={{textAlign:'center', padding:'8px 0'}}>
          {profile && <QRCode value={shareUrlForReferral(profile.referralCode)} size={220} title={`Code ${profile.referralCode}`} />}
          <div style={{marginTop:12, fontFamily:'var(--font-display)', fontSize:24, color:'var(--gold)', letterSpacing:'0.2em'}}>{profile?.referralCode}</div>
          <p style={{color:'var(--muted)', fontSize:12, marginTop:8}}>Montrez ce QR à vos amis en présentiel — scan instantané.</p>
          <button className="btn btn-gold" style={{marginTop:12}} onClick={shareQR}>Partager l’image stylée ElyWalk</button>
        </div>
      </Sheet>

      <Sheet open={!!msgOpen} onClose={closeChat} title={`💬 ${msgOpen?.name||''}`}>
        <div style={{maxHeight:'50vh', overflow:'auto', marginBottom:12}}>
          {chatMessages.length===0 ? <div className="empty-state">Aucun message. Dites bonjour ! 👋</div> : chatMessages.map(m=>(
            <div key={m.id} className={`list-row ${m.from===profile?.uid?'':'incoming'}`} style={{background: m.from===profile?.uid?'var(--gold-dim)':'transparent', borderRadius:8, margin:'6px 0', padding:'8px 10px'}}>
              <div className="row-main">
                <div className="row-title" style={{fontSize:12}}>{m.from===profile?.uid?'Vous':m.fromName} <span style={{color:'var(--muted)', fontWeight:400}}>{new Date(m.createdAt).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</span></div>
                <div className="row-sub" style={{color:'var(--white)'}}>{m.text}</div>
              </div>
              {m.from!==profile?.uid&&<button className="icon-danger" aria-label="Signaler ce message" onClick={()=>setReportedMessage(m)}>⚑</button>}
            </div>
          ))}
        </div>
        <div className="field">
          <textarea className="input" rows={2} maxLength={500} value={msgText} onChange={e=>setMsgText(e.target.value)} placeholder="Message (500 car. max) — restez bienveillant" data-testid="message-input" />
          <small style={{color:'var(--muted)'}}>{msgText.length}/500</small>
        </div>
        <button className="btn btn-gold" onClick={sendMsg} disabled={msgBusy||!msgText.trim()} data-testid="send-message-button">{msgBusy?'Envoi...':'Envoyer'}</button>
      </Sheet>
      {reportedMessage&&<ReportDialog open onClose={()=>setReportedMessage(null)} targetUid={reportedMessage.from} targetType="message" targetId={reportedMessage.id!} />}
    </div>
  );
}
