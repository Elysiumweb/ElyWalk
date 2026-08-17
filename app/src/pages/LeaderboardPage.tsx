import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getLeaderboard } from '../lib/db';
import Avatar from '../components/Avatar';
import { fmtCoins, fmtNumber } from '../lib/coins';
import { isPresidentUid, PRESIDENT_UID } from '../lib/constants';
import type { UserProfile } from '../lib/types';

export default function LeaderboardPage() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getLeaderboard(50)
      .then(setRows)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="screen" data-testid="leaderboard-screen">
      <div className="screen-header">
        <div>
          <h1 className="screen-title">Classement</h1>
          <div className="screen-sub">Top 50 des marcheurs Elysium</div>
        </div>
      </div>

      {loading ? (
        <div className="card"><div className="empty-state">Chargement...</div></div>
      ) : rows.length === 0 ? (
        <div className="card">
          <div className="empty-state" data-testid="leaderboard-empty-state">
            <div className="display">Aucun marcheur</div>
            Soyez le premier au classement !
          </div>
        </div>
      ) : (
        <>
          {rows.length >= 1 && (
            <div className="podium" data-testid="leaderboard-podium">
              {[1, 0, 2].map((idx) => {
                const u = rows[idx];
                const cls = idx === 0 ? 'first' : idx === 1 ? 'second' : 'third';
                if (!u) return <div className="podium-col" key={idx} />;
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
                    <div className="podium-coins">{fmtCoins(u.elycoins)} EC</div>
                    <div className="podium-base">{idx + 1}</div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="card">
            {rows.map((u, i) => (
              <div
                className="list-row"
                key={u.uid}
                style={u.uid === profile?.uid ? { background: 'var(--gold-dim)', borderRadius: 10, padding: '12px 8px' } : undefined}
                data-testid="leaderboard-row"
              >
                <div className="row-value" style={{ width: 22, textAlign: 'center', color: i < 3 ? 'var(--gold)' : 'var(--muted)' }}>
                  {i + 1}
                </div>
                <Avatar name={u.displayName} photoURL={u.photoURL} size={42} />
                <div className="row-main">
                  <div className="row-title">
                    {u.displayName}{' '}
                    {isPresidentUid(u.uid) && (
                      <span className="badge" style={{ marginLeft: 4 }}>
                        👑 {u.uid === PRESIDENT_UID ? 'Président' : 'Co-Président'}
                      </span>
                    )}
                  </div>
                  <div className="row-sub">
                    {fmtNumber(u.totalSteps)} pas · 🔥 {u.streak} j
                  </div>
                </div>
                <div className="row-value">{fmtCoins(u.elycoins)} EC</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
