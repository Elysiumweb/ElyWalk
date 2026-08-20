import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import Sheet from '../components/Sheet';
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
} from '../lib/db';
import Avatar from '../components/Avatar';
import { fmtNumber, dateStr } from '../lib/coins';
import type { UserProfile, FriendRequest } from '../lib/types';

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

  useEffect(() => {
    if (!profile) return;
    const unsub1 = watchIncomingRequests(profile.uid, setRequests);
    const unsub2 = watchFriendships(profile.uid, async (uids) => {
      const profiles = await getProfiles(uids);
      setFriends(profiles);
      setLoading(false);
    });
    const unsub3 = watchOutgoingRequests(profile.uid, setOutgoing);
    const unsub4 = watchFriendReactions(profile.uid, setReactions);
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.uid]);

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
  const share = async () => { if(!profile)return; const text=`Rejoins-moi sur ElyWalk : ${location.origin}/?ref=${profile.referralCode}`; if(navigator.share)await navigator.share({text});else{await navigator.clipboard.writeText(text);toast('Lien copié !','success')} };
  const today = dateStr();

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

      <div className="card">
        <div className="card-title">Mon code ami</div>
        <div className="display" style={{ fontSize: 22, color: 'var(--gold)', letterSpacing: '0.2em' }} data-testid="my-friend-code">
          {profile?.referralCode}
        </div>
        <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 6 }}>Partagez ce code : il sert aussi de code de parrainage (+10 EC par filleul éligible).</p><button className="btn btn-outline btn-sm" style={{marginTop:10}} onClick={share}>Partager / copier</button>
      </div>

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
          <div className="empty-state">Chargement...</div>
        ) : friends.length === 0 ? (
          <div className="empty-state" data-testid="friends-empty-state">
            <div className="display">Aucun ami pour l’instant</div>
            Ajoutez vos amis avec leur code pour comparer vos pas, séries et calories.
          </div>
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
              <button className="icon-danger" onClick={()=>profile&&sendFriendReaction(profile,f.uid,'👏',prompt('Petit message (optionnel)')||'').then(()=>toast('Encouragement envoyé !','success'))} aria-label="Encourager">👏</button><button className="icon-danger" onClick={()=>remove(f.uid)} aria-label="Supprimer">✕</button>
            </div>
          ))
        )}
      </div>

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
    </div>
  );
}
