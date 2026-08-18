import { useEffect, useState } from 'react';
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
} from '../lib/db';
import Avatar from '../components/Avatar';
import { fmtNumber, dateStr } from '../lib/coins';
import type { UserProfile, FriendRequest } from '../lib/types';

export default function FriendsPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [friends, setFriends] = useState<UserProfile[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
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
    return () => {
      unsub1();
      unsub2();
    };
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
        <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 6 }}>
          Partagez ce code : il sert aussi de code de parrainage (+10 EC par
          filleul éligible — appareil et adresse IP différents requis).
        </p>
      </div>

      {requests.length > 0 && (
        <div className="card" data-testid="friend-requests-card">
          <div className="card-title">Demandes reçues</div>
          {requests.map((r) => (
            <div className="list-row" key={r.id} data-testid="friend-request-row">
              <div className="avatar">{r.fromName.charAt(0).toUpperCase()}</div>
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
                <div className="row-title">{f.displayName}</div>
                <div className="row-sub">
                  🔥 {f.streak} j d’affilée · {fmtNumber(f.todayDate === today ? f.todaySteps : 0)} pas
                  aujourd’hui · {fmtNumber(f.totalCalories)} kcal au total
                </div>
              </div>
              <div className="row-value">{fmtNumber(f.totalSteps)} pas</div>
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
        <button className="btn btn-gold" onClick={onAdd} disabled={busy} data-testid="send-friend-request-button">
          {busy ? '...' : 'Envoyer la demande'}
        </button>
      </Sheet>
    </div>
  );
}
