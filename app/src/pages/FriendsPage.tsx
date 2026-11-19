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
  watchDirectMessages,
  markConversationRead,
} from '../lib/db';
import { unreadByFriend, totalUnread, conversationSummaries, previewText } from '../lib/messaging';
import { isUnshareableOrigin, shareUrlForReferral } from '../lib/share';
import Avatar from '../components/Avatar';
import { EmptyState, ErrorState, Skeleton } from '../components/AsyncState';
import ActivityFeed from '../components/ActivityFeed';
import QRCode, { shareFriendCode } from '../components/QRCode';
import { fmtNumber, dateStr } from '../lib/coins';
import type { UserProfile, FriendRequest, DirectMessage } from '../lib/types';
import NotificationBell from '../components/NotificationBell';
import ConfirmSheet from '../components/ConfirmSheet';

type Tab = 'friends' | 'feed' | 'messages';
type FriendRef = { uid: string; name: string };
type SearchState = 'idle' | 'loading' | 'done' | 'error';

const MSG_MAX = 500;
const MSG_COUNTER_FROM = 450;

const ICONS = {
  message: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  cheer: (
    <>
      <path d="M7 10v12" />
      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="19" cy="12" r="1.4" />
    </>
  ),
  close: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  share: (
    <>
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <path d="m16 6-4-4-4 4" />
      <path d="M12 2v13" />
    </>
  ),
  qr: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3z" />
      <path d="M21 14v7h-4" />
    </>
  ),
  flame: (
    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
  ),
  steps: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  bolt: <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />,
  flag: (
    <>
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <path d="M4 22v-7" />
    </>
  ),
  send: (
    <>
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4 20-7z" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  user: (
    <>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  userMinus: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 11h-6" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
} as const;

function Icon({ name, size = 18 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0 }}
    >
      {ICONS[name]}
    </svg>
  );
}

const fmtTime = (value: DirectMessage['createdAt']) =>
  new Date(value).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

const fmtWhen = (ms: number) => {
  const d = new Date(ms);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
};

const STYLES = `
.fv2-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:16px}
.fv2-tab{position:relative;display:flex;align-items:center;justify-content:center;gap:6px;min-height:44px;width:100%;white-space:nowrap}
.fv2-pill{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;border-radius:999px;font-size:11px;line-height:1}
.fv2-stack{display:flex;flex-direction:column;gap:16px}
.fv2-anim{animation:fv2-in .22s ease-out both}
@keyframes fv2-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.fv2-touch{min-height:44px;min-width:44px;display:inline-flex;align-items:center;justify-content:center;gap:6px}
.fv2-icon-btn{min-height:44px;min-width:44px;display:inline-flex;align-items:center;justify-content:center;background:transparent;border:0;border-radius:12px;color:var(--muted);cursor:pointer;transition:color .15s ease,background-color .15s ease}
.fv2-icon-btn:hover,.fv2-icon-btn:focus-visible{color:var(--gold);background:var(--gold-dim)}
.fv2-highlight{border:1px solid var(--gold)}
.fv2-code-row{display:flex;align-items:center;gap:8px}
.fv2-code{flex:1;min-width:0;font-size:22px;color:var(--gold);letter-spacing:.2em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fv2-help{color:var(--muted);font-size:12px;line-height:1.45;margin:8px 0 0}
.fv2-friend{padding:14px 0;border-top:1px solid rgba(128,128,128,.18)}
.fv2-friend:first-of-type{border-top:0}
.fv2-friend-head{display:flex;align-items:center;gap:12px}
.fv2-friend-name{flex:1;min-width:0;min-height:44px;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fv2-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:10px 0 12px}
.fv2-stat{display:flex;flex-direction:column;gap:2px;min-width:0}
.fv2-stat-value{display:flex;align-items:center;gap:5px;font-size:14px;font-weight:600;color:var(--white)}
.fv2-stat-value svg{color:var(--gold)}
.fv2-stat-label{font-size:11px;color:var(--muted)}
.fv2-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.fv2-pending{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--muted)}
.fv2-conv{display:flex;align-items:center;gap:12px;width:100%;min-height:64px;padding:10px 0;background:transparent;border:0;border-top:1px solid rgba(128,128,128,.18);color:inherit;text-align:left;cursor:pointer;font:inherit}
.fv2-conv:first-of-type{border-top:0}
.fv2-conv-main{flex:1;min-width:0}
.fv2-conv-preview{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fv2-conv-unread .fv2-conv-preview{color:var(--white);font-weight:600}
.fv2-conv-side{display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0}
.fv2-conv-time{font-size:11px;color:var(--muted)}
.fv2-chat{max-height:50vh;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding:4px 0 12px;overscroll-behavior:contain}
.fv2-msg{display:flex;align-items:flex-end;gap:2px;max-width:86%}
.fv2-msg-me{align-self:flex-end;flex-direction:row-reverse}
.fv2-msg-them{align-self:flex-start}
.fv2-bubble{padding:9px 12px;border-radius:16px;font-size:14px;line-height:1.4;color:var(--white);white-space:pre-wrap;overflow-wrap:anywhere}
.fv2-msg-me .fv2-bubble{background:var(--gold-dim);border-bottom-right-radius:4px}
.fv2-msg-them .fv2-bubble{border:1px solid rgba(128,128,128,.28);border-bottom-left-radius:4px}
.fv2-bubble-time{display:block;margin-top:3px;font-size:10px;color:var(--muted);text-align:right}
.fv2-composer{display:flex;align-items:flex-end;gap:8px}
.fv2-composer textarea{flex:1;min-width:0;min-height:44px;resize:none}
.fv2-counter{display:block;margin-top:4px;font-size:11px;color:var(--muted);text-align:right}
.fv2-modes{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px}
.fv2-inline{display:flex;align-items:flex-end;gap:8px}
.fv2-inline .field{flex:1;min-width:0;margin-bottom:0}
.fv2-note{color:var(--muted);font-size:13px;padding:14px 0;text-align:center}
.fv2-menu{display:flex;flex-direction:column;gap:8px}
.fv2-menu .btn{justify-content:flex-start}
@media (prefers-reduced-motion:reduce){.fv2-anim{animation:none}.fv2-icon-btn{transition:none}}
`;

export default function FriendsPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const myUid = profile?.uid || '';

  const [friends, setFriends] = useState<UserProfile[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [requestProfiles, setRequestProfiles] = useState<Record<string, UserProfile>>({});
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);
  const [reactions, setReactions] = useState<{ id: string; from: string; fromName: string; emoji: string; message: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  // Incrémenter cette clé relance réellement les abonnements.
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState<Tab>('friends');
  const [qrOpen, setQrOpen] = useState(false);
  const [messages, setMessages] = useState<DirectMessage[]>([]);

  useEffect(() => {
    if (!profile) return;
    const unsub1 = watchIncomingRequests(profile.uid, setRequests);
    const unsub2 = watchFriendships(
      profile.uid,
      async (uids) => {
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

  useEffect(() => {
    const ids = [...new Set(requests.map((r) => r.from))];
    if (!ids.length) { setRequestProfiles({}); return; }
    getProfiles(ids)
      .then((items) => setRequestProfiles(Object.fromEntries(items.map((item) => [item.uid, item]))))
      .catch(() => undefined);
  }, [requests]);

  /* ---------- Demandes reçues ---------- */
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const respond = async (req: FriendRequest, accept: boolean) => {
    setRespondingId(req.id ?? req.from);
    try {
      await respondFriendRequest(req, accept);
      toast(accept ? 'Ami ajouté !' : 'Demande refusée.', accept ? 'success' : 'info');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setRespondingId(null);
    }
  };

  /* ---------- Ajouter un ami ---------- */
  const [addOpen, setAddOpen] = useState(false);
  const [addMode, setAddMode] = useState<'code' | 'name'>('code');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [nameQuery, setNameQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [searchState, setSearchState] = useState<SearchState>('idle');
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string[]>([]);

  const closeAdd = () => {
    setAddOpen(false);
    setCode('');
    setNameQuery('');
    setSearchResults([]);
    setSearchState('idle');
  };

  const onAdd = async () => {
    if (!profile || !code.trim()) return;
    setBusy(true);
    try {
      const target = await findUserByCode(code.trim());
      if (!target) throw new Error('Aucun utilisateur trouvé avec ce code.');
      await sendFriendRequest(profile, target);
      toast(`Demande envoyée à ${target.displayName} !`, 'success');
      closeAdd();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const doSearch = async () => {
    if (!nameQuery.trim()) return;
    setSearchState('loading');
    try {
      setSearchResults(await searchUsersByName(nameQuery.trim()));
      setSearchState('done');
    } catch {
      setSearchResults([]);
      setSearchState('error');
    }
  };

  const addFromSearch = async (u: UserProfile) => {
    if (!profile) return;
    setSendingTo(u.uid);
    try {
      await sendFriendRequest(profile, u);
      setSentTo((list) => [...list, u.uid]);
      toast(`Demande envoyée à ${u.displayName} !`, 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSendingTo(null);
    }
  };

  const visibleResults = searchResults.filter((u) => u.uid !== myUid);
  const friendUids = new Set(friends.map((f) => f.uid));
  const pendingNames = new Set(outgoing.map((r) => r.toName));

  /* ---------- Retrait / encouragement ---------- */
  const [menuFor, setMenuFor] = useState<FriendRef | null>(null);
  const [pendingRemove, setPendingRemove] = useState<FriendRef | null>(null);
  const [removing, setRemoving] = useState(false);
  const remove = async () => {
    if (!profile || !pendingRemove) return;
    setRemoving(true);
    try {
      await removeFriendship(profile.uid, pendingRemove.uid);
      toast('Ami supprimé.', 'info');
      setPendingRemove(null);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setRemoving(false);
    }
  };

  const [pendingCheer, setPendingCheer] = useState<FriendRef | null>(null);
  const sendCheer = async (message: string) => {
    if (!profile || !pendingCheer) return;
    try {
      await sendFriendReaction(profile, pendingCheer.uid, '👏', message);
      toast('Encouragement envoyé !', 'success');
      setPendingCheer(null);
    } catch (e) {
      // La feuille reste ouverte : le message saisi n'est pas perdu.
      toast((e as Error).message, 'error');
    }
  };

  /* ---------- Partage ---------- */
  // Lien construit sur le domaine public et vérifié avant l'envoi ; `url` est passé séparément de `text`.
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
  const shareQR = async () => {
    if (!profile) return;
    try {
      const r = await shareFriendCode(profile.referralCode, profile.displayName);
      toast(r === 'shared' ? 'QR partagé !' : 'Image enregistrée.', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  /* ---------- Messagerie ---------- */
  const [msgOpen, setMsgOpen] = useState<FriendRef | null>(null);
  const [msgText, setMsgText] = useState('');
  const [chatMessages, setChatMessages] = useState<DirectMessage[]>([]);
  const [msgBusy, setMsgBusy] = useState(false);
  const [reportedMessage, setReportedMessage] = useState<DirectMessage | null>(null);
  // Une seule écoute de conversation à la fois (F08).
  const chatUnsubRef = useRef<(() => void) | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const closeChat = () => {
    chatUnsubRef.current?.();
    chatUnsubRef.current = null;
    setMsgOpen(null);
    setChatMessages([]);
  };
  const openChat = (uid: string, name: string) => {
    if (!profile) return;
    chatUnsubRef.current?.();
    setChatMessages([]);
    setMsgOpen({ uid, name });
    chatUnsubRef.current = watchDirectMessages(profile.uid, uid, setChatMessages);
    void markConversationRead(profile.uid, uid).catch(() => undefined);
  };
  useEffect(() => () => {
    chatUnsubRef.current?.();
    chatUnsubRef.current = null;
  }, []);

  useEffect(() => {
    if (!msgOpen) return;
    chatEndRef.current?.scrollIntoView({ block: 'end' });
  }, [msgOpen?.uid, chatMessages.length]);

  const sendMsg = async () => {
    if (!profile || !msgOpen || !msgText.trim()) return;
    setMsgBusy(true);
    try { await sendDirectMessage(profile, msgOpen.uid, msgText); setMsgText(''); }
    catch (e) { toast((e as Error).message, 'error'); }
    finally { setMsgBusy(false); }
  };

  const unread = unreadByFriend(messages, myUid);
  const unreadTotal = totalUnread(messages, myUid);
  const conversations = conversationSummaries(messages, myUid);

  // Heure du dernier message par ami, déduite des messages récents (reçus : `from` ; envoyés : `toName`).
  const uidByName = new Map(friends.map((f) => [f.displayName, f.uid]));
  const lastAt: Record<string, number> = {};
  for (const m of messages) {
    const uid = m.from === myUid ? uidByName.get(m.toName) : m.from;
    if (!uid) continue;
    const t = new Date(m.createdAt).getTime();
    if (!lastAt[uid] || t > lastAt[uid]) lastAt[uid] = t;
  }
  const convRows = friends
    .map((f) => ({ friend: f, conv: conversations.find((c) => c.friendUid === f.uid), at: lastAt[f.uid] || 0 }))
    .sort((a, b) => b.at - a.at);

  const today = dateStr();
  const retry = () => { setLoading(true); setLoadError(null); setReloadKey((k) => k + 1); };

  const tabs: { id: Tab; label: string; testId: string }[] = [
    { id: 'friends', label: 'Amis', testId: 'friends-tab-button' },
    { id: 'feed', label: 'Fil d’activité', testId: 'feed-tab-button' },
    { id: 'messages', label: 'Messages', testId: 'messages-tab-button' },
  ];

  return (
    <div className="screen" data-testid="friends-screen">
      <style>{STYLES}</style>

      <div className="screen-header">
        <div>
          <h1 className="screen-title">Amis</h1>
          <div className="screen-sub">Partagez vos stats d’activité</div>
        </div>
        <div className="header-actions">
          <NotificationBell />
          <button className="btn btn-gold btn-sm fv2-touch" onClick={() => setAddOpen(true)} data-testid="add-friend-button">
            <Icon name="plus" size={16} /> Ajouter
          </button>
        </div>
      </div>

      <div className="fv2-tabs" role="tablist" aria-label="Sections de la page Amis">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`chip fv2-tab ${tab === t.id ? 'chip-active' : ''}`}
            onClick={() => setTab(t.id)}
            data-testid={t.testId}
          >
            {t.label}
            {t.id === 'messages' && unreadTotal > 0 && (
              <b
                className="tab-badge fv2-pill"
                aria-label={`${unreadTotal} non lu${unreadTotal > 1 ? 's' : ''}`}
                data-testid="messages-tab-unread-badge"
              >
                {unreadTotal > 99 ? '99+' : unreadTotal}
              </b>
            )}
          </button>
        ))}
      </div>

      {tab === 'friends' && (
        <div className="fv2-stack fv2-anim" role="tabpanel" data-testid="friends-tab">
          {requests.length > 0 && (
            <div className="card fv2-highlight" data-testid="friend-requests-card">
              <div className="card-title">Demandes reçues ({requests.length})</div>
              {requests.map((r) => {
                const pending = respondingId === (r.id ?? r.from);
                return (
                  <div className="list-row" key={r.id} data-testid="friend-request-row">
                    <Avatar name={r.fromName} photoURL={requestProfiles[r.from]?.photoURL} size={42} />
                    <div className="row-main">
                      <div className="row-title">{r.fromName}</div>
                      <div className="row-sub">veut devenir votre ami</div>
                    </div>
                    <button
                      className="btn btn-gold btn-sm fv2-touch"
                      onClick={() => respond(r, true)}
                      disabled={pending}
                      data-testid="accept-friend-button"
                    >
                      <Icon name="check" size={16} /> Accepter
                    </button>
                    <button
                      className="fv2-icon-btn"
                      onClick={() => respond(r, false)}
                      disabled={pending}
                      aria-label={`Refuser la demande de ${r.fromName}`}
                      data-testid="reject-friend-button"
                    >
                      <Icon name="close" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="card" data-testid="my-code-card">
            <div className="card-title">Mon code ami</div>
            <div className="fv2-code-row">
              <div className="display fv2-code" data-testid="my-friend-code">{profile?.referralCode}</div>
              <button className="btn btn-outline btn-sm fv2-touch" onClick={share} aria-label="Partager ou copier mon code ami" data-testid="share-code-button">
                <Icon name="share" size={16} /> Partager
              </button>
              <button className="btn btn-gold btn-sm fv2-touch" onClick={() => setQrOpen(true)} aria-label="Afficher mon QR code" data-testid="qr-code-button">
                <Icon name="qr" size={16} /> QR
              </button>
            </div>
            <p className="fv2-help">Il sert aussi de code de parrainage (+10 EC par filleul éligible).</p>
          </div>

          {reactions.length > 0 && (
            <div className="card" data-testid="received-reactions">
              <div className="card-title">Encouragements reçus</div>
              {reactions.map((r) => (
                <div className="list-row" key={r.id} data-testid="received-reaction-row">
                  <span style={{ fontSize: 24 }} aria-hidden="true">{r.emoji}</span>
                  <div className="row-main">
                    <div className="row-title">{r.fromName}</div>
                    <div className="row-sub">{r.message || 'vous encourage !'}</div>
                  </div>
                  <button
                    className="btn btn-outline btn-sm fv2-touch"
                    onClick={() => setPendingCheer({ uid: r.from, name: r.fromName })}
                    aria-label={`Répondre à ${r.fromName}`}
                    data-testid="reply-reaction-button"
                  >
                    Répondre
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="card" data-testid="friends-list-card">
            <div className="card-title">Mes amis ({friends.length})</div>
            {loading ? (
              <Skeleton rows={4} label="Chargement de vos amis" />
            ) : loadError ? (
              <ErrorState title="Vos amis n’ont pas pu être chargés" error={loadError} onRetry={retry} />
            ) : friends.length === 0 ? (
              <EmptyState
                icon="👋"
                title="Aucun ami pour l’instant"
                hint="Ajoutez vos amis avec leur code pour comparer vos pas, séries et calories."
                action={<button className="btn btn-gold" onClick={() => setAddOpen(true)} data-testid="empty-add-friend-button">Ajouter un ami</button>}
              />
            ) : (
              friends.map((f) => (
                <div className="fv2-friend" key={f.uid} data-testid="friend-row">
                  <div className="fv2-friend-head">
                    <Avatar name={f.displayName} photoURL={f.photoURL} size={42} />
                    <button className="link-title fv2-friend-name" onClick={() => navigate(`/user/${f.uid}`)} data-testid="friend-profile-link">
                      {f.displayName}
                    </button>
                    <button
                      className="fv2-icon-btn"
                      onClick={() => setMenuFor({ uid: f.uid, name: f.displayName })}
                      aria-label={`Plus d’actions pour ${f.displayName}`}
                      data-testid="friend-more-button"
                    >
                      <Icon name="more" />
                    </button>
                  </div>
                  <div className="fv2-stats">
                    <div className="fv2-stat" data-testid="friend-stat-streak">
                      <span className="fv2-stat-value"><Icon name="flame" size={15} />{f.streak} j</span>
                      <span className="fv2-stat-label">d’affilée</span>
                    </div>
                    <div className="fv2-stat" data-testid="friend-stat-steps">
                      <span className="fv2-stat-value"><Icon name="steps" size={15} />{fmtNumber(f.todayDate === today ? f.todaySteps : 0)}</span>
                      <span className="fv2-stat-label">pas aujourd’hui</span>
                    </div>
                    <div className="fv2-stat" data-testid="friend-stat-calories">
                      <span className="fv2-stat-value"><Icon name="bolt" size={15} />{fmtNumber(f.totalCalories)}</span>
                      <span className="fv2-stat-label">kcal au total</span>
                    </div>
                  </div>
                  <div className="fv2-actions">
                    <button
                      className="btn btn-outline btn-sm fv2-touch"
                      onClick={() => openChat(f.uid, f.displayName)}
                      aria-label={`Message à ${f.displayName}${unread[f.uid] ? ` (${unread[f.uid]} non lu${unread[f.uid] > 1 ? 's' : ''})` : ''}`}
                      data-testid="friend-message-button"
                    >
                      <Icon name="message" size={16} /> Message
                      {unread[f.uid] ? <b className="tab-badge fv2-pill" data-testid="friend-unread-badge">{unread[f.uid]}</b> : null}
                    </button>
                    <button
                      className="btn btn-outline btn-sm fv2-touch"
                      onClick={() => setPendingCheer({ uid: f.uid, name: f.displayName })}
                      aria-label={`Encourager ${f.displayName}`}
                      data-testid="friend-cheer-button"
                    >
                      <Icon name="cheer" size={16} /> Encourager
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {outgoing.length > 0 && (
            <div className="card" data-testid="outgoing-requests-card">
              <div className="card-title">Demandes envoyées</div>
              {outgoing.map((r) => (
                <div className="list-row" key={r.id} data-testid="outgoing-request-row">
                  <Avatar name={r.toName} size={36} />
                  <div className="row-main">
                    <div className="row-title">{r.toName}</div>
                  </div>
                  <span className="fv2-pending"><Icon name="clock" size={14} /> En attente</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'feed' && (
        <div className="fv2-anim" role="tabpanel" data-testid="feed-tab">
          <ActivityFeed />
        </div>
      )}

      {tab === 'messages' && (
        <div className="card fv2-anim" role="tabpanel" data-testid="messages-tab">
          <div className="card-title">Messagerie légère</div>
          <p className="card-help">Messages courts entre amis (max 500 car.). Respect et bienveillance — tout abus peut être signalé.</p>
          {loading ? (
            <Skeleton rows={3} label="Chargement de vos conversations" />
          ) : loadError ? (
            <ErrorState title="Vos conversations n’ont pas pu être chargées" error={loadError} onRetry={retry} />
          ) : friends.length === 0 ? (
            <EmptyState
              icon="💬"
              title="Aucune conversation"
              hint="Ajoutez des amis pour discuter."
              action={<button className="btn btn-gold" onClick={() => setAddOpen(true)} data-testid="messages-add-friend-button">Ajouter un ami</button>}
            />
          ) : (
            convRows.map(({ friend: f, conv, at }) => {
              const count = unread[f.uid] || 0;
              return (
                <button
                  key={f.uid}
                  className={`fv2-conv ${count ? 'fv2-conv-unread' : ''}`}
                  onClick={() => openChat(f.uid, f.displayName)}
                  aria-label={`Ouvrir la conversation avec ${f.displayName}${count ? `, ${count} non lu${count > 1 ? 's' : ''}` : ''}`}
                  data-testid="conversation-row"
                >
                  <Avatar name={f.displayName} photoURL={f.photoURL} size={40} />
                  <div className="fv2-conv-main">
                    <div className="row-title">{f.displayName}</div>
                    <div className="row-sub fv2-conv-preview" data-testid="conversation-preview">
                      {conv ? `${conv.fromMe ? 'Vous : ' : ''}${previewText(conv.lastText)}` : 'Démarrer la conversation'}
                    </div>
                  </div>
                  <div className="fv2-conv-side">
                    {at > 0 && <span className="fv2-conv-time" data-testid="conversation-time">{fmtWhen(at)}</span>}
                    {count > 0 && <b className="tab-badge fv2-pill" data-testid="conversation-unread">{count}</b>}
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}

      <Sheet open={addOpen} onClose={closeAdd} title="Ajouter un ami" testId="add-friend-sheet">
        <div className="fv2-modes" role="tablist" aria-label="Méthode d’ajout">
          <button role="tab" aria-selected={addMode === 'code'} className={`chip fv2-tab ${addMode === 'code' ? 'chip-active' : ''}`} onClick={() => setAddMode('code')} data-testid="add-mode-code-button">
            Par code
          </button>
          <button role="tab" aria-selected={addMode === 'name'} className={`chip fv2-tab ${addMode === 'name' ? 'chip-active' : ''}`} onClick={() => setAddMode('name')} data-testid="add-mode-name-button">
            Par pseudo
          </button>
        </div>

        {addMode === 'code' ? (
          <form onSubmit={(e) => { e.preventDefault(); void onAdd(); }}>
            <div className="field">
              <label htmlFor="fv2-friend-code">Code ami</label>
              <input
                id="fv2-friend-code"
                className="input"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="Ex. A3F7K9"
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                data-testid="friend-code-input"
              />
            </div>
            <button type="submit" className="btn btn-gold fv2-touch" style={{ width: '100%' }} disabled={busy || !code.trim()} data-testid="send-friend-request-button">
              {busy ? 'Envoi…' : 'Envoyer la demande'}
            </button>
          </form>
        ) : (
          <>
            <form className="fv2-inline" onSubmit={(e) => { e.preventDefault(); void doSearch(); }}>
              <div className="field">
                <label htmlFor="fv2-friend-name">Pseudo</label>
                <input
                  id="fv2-friend-name"
                  className="input"
                  value={nameQuery}
                  onChange={(e) => { setNameQuery(e.target.value); setSearchState('idle'); }}
                  placeholder="Ex. Camille"
                  autoComplete="off"
                  data-testid="friend-name-input"
                />
              </div>
              <button type="submit" className="btn btn-gold fv2-touch" disabled={searchState === 'loading' || !nameQuery.trim()} aria-label="Chercher ce pseudo" data-testid="search-friend-button">
                <Icon name="search" size={16} /> Chercher
              </button>
            </form>

            <div aria-live="polite" data-testid="friend-search-results">
              {searchState === 'loading' && <Skeleton rows={2} label="Recherche en cours" />}
              {searchState === 'error' && (
                <div className="fv2-note" data-testid="friend-search-error">
                  La recherche a échoué. Vérifiez votre connexion puis réessayez.
                </div>
              )}
              {searchState === 'done' && visibleResults.length === 0 && (
                <div className="fv2-note" data-testid="friend-search-empty">
                  Aucun utilisateur trouvé pour « {nameQuery.trim()} ».
                </div>
              )}
              {searchState === 'done' && visibleResults.map((u) => {
                const isFriend = friendUids.has(u.uid);
                const isPending = sentTo.includes(u.uid) || pendingNames.has(u.displayName);
                return (
                  <div className="list-row fv2-anim" key={u.uid} data-testid="friend-search-row">
                    <Avatar name={u.displayName} photoURL={u.photoURL} size={40} />
                    <div className="row-main"><div className="row-title">{u.displayName}</div></div>
                    {isFriend ? (
                      <span className="fv2-pending" data-testid="friend-search-already-friend"><Icon name="check" size={14} /> Déjà ami</span>
                    ) : isPending ? (
                      <span className="fv2-pending" data-testid="friend-search-pending"><Icon name="clock" size={14} /> Demande envoyée</span>
                    ) : (
                      <button className="btn btn-gold btn-sm fv2-touch" onClick={() => addFromSearch(u)} disabled={sendingTo === u.uid} data-testid="friend-search-add-button">
                        {sendingTo === u.uid ? 'Envoi…' : 'Ajouter'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Sheet>

      <Sheet open={qrOpen} onClose={() => setQrOpen(false)} title="QR code ami" testId="qr-sheet">
        <div style={{ textAlign: 'center', padding: '8px 0' }}>
          {profile && <QRCode value={shareUrlForReferral(profile.referralCode)} size={220} title={`Code ${profile.referralCode}`} />}
          <div style={{ marginTop: 12, fontFamily: 'var(--font-display)', fontSize: 24, color: 'var(--gold)', letterSpacing: '0.2em' }}>{profile?.referralCode}</div>
          <p className="fv2-help">Montrez ce QR à vos amis en présentiel — scan instantané.</p>
          <button className="btn btn-gold fv2-touch" style={{ marginTop: 16 }} onClick={shareQR} data-testid="share-qr-button">
            <Icon name="share" size={16} /> Partager l’image stylée ElyWalk
          </button>
        </div>
      </Sheet>

      <Sheet open={!!menuFor} onClose={() => setMenuFor(null)} title={menuFor?.name || ''} testId="friend-menu-sheet">
        <div className="fv2-menu">
          <button
            className="btn btn-outline fv2-touch"
            onClick={() => { if (menuFor) navigate(`/user/${menuFor.uid}`); setMenuFor(null); }}
            data-testid="friend-menu-profile-button"
          >
            <Icon name="user" /> Voir le profil
          </button>
          <button
            className="btn btn-danger fv2-touch"
            onClick={() => { setPendingRemove(menuFor); setMenuFor(null); }}
            data-testid="friend-menu-remove-button"
          >
            <Icon name="userMinus" /> Retirer cet ami
          </button>
        </div>
      </Sheet>

      <ConfirmSheet
        open={!!pendingRemove}
        title={`Retirer ${pendingRemove?.name || 'cet ami'} ?`}
        danger
        busy={removing}
        confirmLabel="Retirer cet ami"
        consequences={[
          'Vous ne verrez plus ses sorties ni ses statistiques.',
          'La conversation et les encouragements existants ne sont pas effacés.',
          'Vous pourrez renvoyer une demande d’ami plus tard avec son code.',
        ]}
        onConfirm={remove}
        onClose={() => setPendingRemove(null)}
        testId="remove-friend-sheet"
      />
      <ConfirmSheet
        open={!!pendingCheer}
        title={`Encourager ${pendingCheer?.name || 'cet ami'}`}
        confirmLabel="Envoyer l’encouragement"
        textField={{ label: 'Petit message (facultatif)', placeholder: 'Continue comme ça !', maxLength: 160 }}
        onConfirm={(text) => sendCheer(text)}
        onClose={() => setPendingCheer(null)}
        testId="cheer-sheet"
      />

      <Sheet open={!!msgOpen} onClose={closeChat} title={msgOpen?.name || ''} testId="chat-sheet">
        <div className="fv2-chat" role="log" aria-live="polite" data-testid="chat-messages">
          {chatMessages.length === 0 ? (
            <div className="fv2-note" data-testid="chat-empty">Aucun message pour l’instant. Dites bonjour !</div>
          ) : (
            chatMessages.map((m) => {
              const mine = m.from === myUid;
              return (
                <div key={m.id} className={`fv2-msg ${mine ? 'fv2-msg-me' : 'fv2-msg-them'}`} data-testid={mine ? 'chat-message-sent' : 'chat-message-received'}>
                  <div className="fv2-bubble">
                    {m.text}
                    <span className="fv2-bubble-time">{fmtTime(m.createdAt)}</span>
                  </div>
                  {!mine && (
                    <button className="fv2-icon-btn" aria-label="Signaler ce message" onClick={() => setReportedMessage(m)} data-testid="report-message-button">
                      <Icon name="flag" size={15} />
                    </button>
                  )}
                </div>
              );
            })
          )}
          <div ref={chatEndRef} />
        </div>
        <div className="fv2-composer">
          <textarea
            className="input"
            rows={1}
            maxLength={MSG_MAX}
            value={msgText}
            onChange={(e) => setMsgText(e.target.value)}
            placeholder="Votre message — restez bienveillant"
            aria-label={`Message à ${msgOpen?.name || 'cet ami'}`}
            data-testid="message-input"
          />
          <button className="btn btn-gold fv2-touch" onClick={sendMsg} disabled={msgBusy || !msgText.trim()} aria-label="Envoyer le message" data-testid="send-message-button">
            <Icon name="send" />
          </button>
        </div>
        {msgText.length >= MSG_COUNTER_FROM && (
          <small className="fv2-counter" data-testid="message-counter">{msgText.length}/{MSG_MAX}</small>
        )}
      </Sheet>

      {reportedMessage && (
        <ReportDialog open onClose={() => setReportedMessage(null)} targetUid={reportedMessage.from} targetType="message" targetId={reportedMessage.id!} />
      )}
    </div>
  );
}
