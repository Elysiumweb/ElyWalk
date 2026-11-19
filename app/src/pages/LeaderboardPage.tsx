import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getLeaderboard, getProfiles, listDailySteps, watchFriendships, type LeaderboardMetric } from '../lib/db';
import Avatar from '../components/Avatar';
import { ErrorState, friendlyError, Skeleton } from '../components/AsyncState';
import NotificationBell from '../components/NotificationBell';
import { fmtCoins, fmtNumber } from '../lib/coins';
import { isPresidentUid, PRESIDENT_UID, getWalkerLevel } from '../lib/constants';
import type { UserProfile } from '../lib/types';

type Mode = 'coins' | 'today' | 'steps' | 'week' | 'month' | 'friends';

const MODES: { id: Mode; label: string }[] = [
  { id: 'coins', label: 'Solde EC' },
  { id: 'today', label: 'Pas du jour' },
  { id: 'steps', label: 'Pas cumulés' },
  { id: 'week', label: '7 jours' },
  { id: 'month', label: '30 jours' },
  { id: 'friends', label: 'Mes amis' },
];

const PODIUM = [
  { index: 1, rank: 2, cls: 'second' },
  { index: 0, rank: 1, cls: 'first' },
  { index: 2, rank: 3, cls: 'third' },
];

export default function LeaderboardPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<UserProfile[]>([]);
  const [mode, setMode] = useState<Mode>('coins');
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [friendIds, setFriendIds] = useState<string[]>([]);
  const [periodScores, setPeriodScores] = useState<Record<string, { week: number; month: number }>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  // F10 — documents quotidiens mis en cache par UID : un changement d'onglet ne relit rien.
  const daysCacheRef = useRef(new Map<string, { at: number; days: Awaited<ReturnType<typeof listDailySteps>> }>());
  const DAYS_TTL_MS = 5 * 60 * 1000;
  const currentRowRef = useRef<HTMLDivElement>(null);

  // F07 — la requête porte sur la métrique affichée ; les périodes 7 / 30 jours
  // sont agrégées depuis les documents quotidiens, « Mes amis » charge tous les amis.
  const load = async (current: Mode = mode) => {
    setLoading(true);
    setLoadError(null);
    try {
      const metric: LeaderboardMetric = current === 'today' ? 'today' : current === 'steps' || current === 'friends' ? 'steps' : 'coins';
      const users = await getLeaderboard(100, metric);
      setRows(users);
      if (current === 'week' || current === 'month') {
        const now = Date.now(), week = now - 7 * 86400000, month = now - 30 * 86400000;
        const scores: Record<string, { week: number; month: number }> = {};
        await Promise.all(users.map(async (u) => {
          if (u.uid === profile?.uid && periodScores[u.uid]) {
            scores[u.uid] = periodScores[u.uid];
            return;
          }
          const cached = daysCacheRef.current.get(u.uid);
          let days = cached && now - cached.at < DAYS_TTL_MS ? cached.days : null;
          if (!days) {
            days = await listDailySteps(u.uid, 30).catch(() => []);
            daysCacheRef.current.set(u.uid, { at: now, days });
          }
          scores[u.uid] = {
            week: days.filter((d) => d.validatedAt >= week).reduce((sum, d) => sum + d.steps, 0),
            month: days.filter((d) => d.validatedAt >= month).reduce((sum, d) => sum + d.steps, 0),
          };
        }));
        setPeriodScores(scores);
      }
      const missing = friendIds.filter((uid) => !users.some((u) => u.uid === uid));
      if (missing.length) {
        const extra = await getProfiles(missing).catch(() => []);
        setRows((prev) => [...prev, ...extra.filter((u) => !prev.some((p) => p.uid === u.uid))]);
      }
    } catch (e) {
      // F10 — un échec s'affiche et peut être relancé, au lieu d'une liste vide trompeuse.
      setLoadError(e);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!profile) return;
    const unsub = watchFriendships(profile.uid, (ids) => {
      setFriendIds(ids);
      void load(modeRef.current);
    }, () => {
      // Refus de règle : seul l'onglet « Mes amis » se limite à l'utilisateur courant.
      setFriendIds([]);
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.uid]);

  const score = (u: UserProfile) =>
    mode === 'today' ? (u.todaySteps || 0)
      : mode === 'steps' || mode === 'friends' ? u.totalSteps
        : mode === 'week' ? (periodScores[u.uid]?.week || 0)
          : mode === 'month' ? (periodScores[u.uid]?.month || 0)
            : u.elycoins;
  const fmtScore = (value: number) => (mode === 'coins' ? `${fmtCoins(value)} EC` : `${fmtNumber(value)} pas`);
  const inTop = !!profile && rows.some((u) => u.uid === profile.uid);
  const allRows = profile && !inTop ? [...rows, profile] : rows;
  const ranked = (mode === 'friends' ? allRows.filter((u) => u.uid === profile?.uid || friendIds.includes(u.uid)) : [...allRows]).sort((a, b) => score(b) - score(a));
  useEffect(() => {
    if (!loading) requestAnimationFrame(() => currentRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }, [loading, mode]);

  const selectMode = (next: Mode) => { setMode(next); void load(next); };
  const openProfile = (uid: string) => navigate(`/user/${uid}`);
  const onRowKey = (event: KeyboardEvent<HTMLDivElement>, uid: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openProfile(uid);
    }
  };

  const noFriends = mode === 'friends' && friendIds.length === 0;
  const myIndex = profile ? ranked.findIndex((u) => u.uid === profile.uid) : -1;
  const me = myIndex >= 0 ? ranked[myIndex] : null;
  const ahead = myIndex > 0 ? ranked[myIndex - 1] : null;
  const outsideTop = mode !== 'friends' && !inTop;
  const gap = me && ahead ? score(ahead) - score(me) : 0;
  const gapText = !me
    ? ''
    : !ahead
      ? (mode === 'friends' ? 'Vous êtes en tête de vos amis' : 'Vous êtes en tête du classement')
      : gap === 0
        ? `À égalité avec ${ahead.displayName}`
        : outsideTop
          ? `${fmtScore(gap)} pour entrer dans le top 100`
          : `${fmtScore(gap)} de retard sur ${ahead.displayName}`;

  return (
    <div className="screen" data-testid="leaderboard-screen">
      <div className="screen-header">
        <div>
          <h1 className="screen-title">Classement</h1>
          <div className="screen-sub" data-testid="leaderboard-subtitle">
            {rows.length > 0
              ? `${rows.length} marcheur${rows.length > 1 ? 's' : ''} classé${rows.length > 1 ? 's' : ''} · top 100`
              : 'Top 100 des marcheurs Elysium'}
          </div>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="chip"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Actualiser le classement"
            data-testid="leaderboard-refresh-button"
          >
            {loading ? 'Actualisation…' : 'Actualiser'}
          </button>
          <NotificationBell />
        </div>
      </div>

      <div className="chip-row" role="tablist" aria-label="Type de classement" data-testid="leaderboard-mode-selector">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={mode === m.id}
            className={`chip ${mode === m.id ? 'chip-active' : ''}`}
            onClick={() => selectMode(m.id)}
            data-testid={`leaderboard-mode-${m.id}`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {loading ? (
        <>
          <div className="card"><Skeleton rows={1} label="Chargement de votre position" /></div>
          <div className="card"><Skeleton rows={6} label="Chargement du classement" /></div>
        </>
      ) : loadError ? (
        <div className="card">
          <ErrorState
            error={loadError}
            title={/permission|denied/i.test(friendlyError(loadError)) ? 'Classement réservé' : 'Classement indisponible'}
            onRetry={() => void load()}
          />
        </div>
      ) : noFriends ? (
        <div className="card">
          <div className="empty-state" data-testid="leaderboard-empty-state">
            <div className="display">Aucun ami pour l’instant</div>
            Ajoutez des amis pour comparer vos pas avec les leurs.
          </div>
        </div>
      ) : ranked.length === 0 ? (
        <div className="card">
          <div className="empty-state" data-testid="leaderboard-empty-state">
            <div className="display">Aucun marcheur</div>
            Soyez le premier au classement !
          </div>
        </div>
      ) : (
        <>
          {me && (
            <div className="card" data-testid="leaderboard-my-position">
              <div className="card-title">Ma position{mode === 'friends' ? ' parmi mes amis' : ''}</div>
              <div className="list-row">
                <div
                  className="row-value"
                  style={{ minWidth: 44, textAlign: 'center', fontSize: 22, color: 'var(--gold)' }}
                  aria-label={outsideTop ? 'Hors du top 100' : `Rang ${myIndex + 1}`}
                  data-testid="leaderboard-my-rank"
                >
                  {outsideTop ? '100+' : `${myIndex + 1}`}
                </div>
                <Avatar name={me.displayName} photoURL={me.photoURL} size={42} />
                <div className="row-main">
                  <div className="row-title" data-testid="leaderboard-my-score">{fmtScore(score(me))}</div>
                  <div className="row-sub" data-testid="leaderboard-my-gap">{gapText}</div>
                </div>
              </div>
            </div>
          )}

          <div className="podium" data-testid="leaderboard-podium">
            {PODIUM.map(({ index: idx, rank, cls }) => {
              const u = ranked[idx];
              if (!u) return <div className="podium-col" key={rank} />;
              return (
                <div className={`podium-col ${cls}`} key={u.uid} data-testid="leaderboard-podium-item">
                  {idx === 0 && <div className="podium-crown" aria-hidden="true">👑</div>}
                  <Avatar
                    className="podium-avatar"
                    name={u.displayName}
                    photoURL={u.photoURL}
                    size={idx === 0 ? 72 : 58}
                  />
                  <div className="podium-name">{u.displayName}</div>
                  <div className="podium-coins">{fmtScore(score(u))}</div>
                  <div className="podium-base" aria-label={`Place ${rank}`}>{rank}</div>
                </div>
              );
            })}
          </div>

          <div className="card" data-testid="leaderboard-list">
            {ranked.map((u, i) => {
              const isMe = u.uid === profile?.uid;
              const level = getWalkerLevel(u.totalSteps);
              return (
                <div
                  ref={isMe ? currentRowRef : undefined}
                  className={`list-row ${isMe ? 'current-user-row' : ''}`}
                  key={u.uid}
                  role="link"
                  tabIndex={0}
                  aria-label={`${u.displayName}, rang ${i + 1}, ${fmtScore(score(u))}. Voir le profil`}
                  onClick={() => openProfile(u.uid)}
                  onKeyDown={(event) => onRowKey(event, u.uid)}
                  style={{
                    cursor: 'pointer',
                    ...(isMe ? { background: 'var(--gold-dim)', borderRadius: 10, padding: '12px 8px' } : {}),
                  }}
                  data-testid="leaderboard-row"
                >
                  <div className="row-value" style={{ width: 28, textAlign: 'center', color: i < 3 ? 'var(--gold)' : 'var(--muted)' }}>
                    {i + 1}
                  </div>
                  <Avatar name={u.displayName} photoURL={u.photoURL} size={42} />
                  <div className="row-main" style={{ minWidth: 0 }}>
                    <div className="row-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {u.displayName}{isMe ? ' (vous)' : ''}
                    </div>
                    <div className="row-sub" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                      {isPresidentUid(u.uid) && (
                        <span className="badge">👑 {u.uid === PRESIDENT_UID ? 'Président' : 'Co-Président'}</span>
                      )}
                      <span
                        className="badge"
                        style={{ background: `${level.color}22`, color: level.color, borderColor: level.color }}
                        title={level.title}
                      >
                        {level.icon} {level.title.split(' ').pop()}
                      </span>
                      <span>🔥 {u.streak} j</span>
                      {mode !== 'steps' && mode !== 'friends' && <span>{fmtNumber(u.totalSteps)} pas au total</span>}
                    </div>
                  </div>
                  <div className="row-value" style={{ whiteSpace: 'nowrap' }}>{fmtScore(score(u))}</div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
