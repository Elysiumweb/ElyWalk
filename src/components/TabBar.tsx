import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { watchIncomingRequests } from '../lib/db';

const tabs = [
  { to: '/', label: 'Accueil', testId: 'tab-home', icon: HomeIcon },
  { to: '/map', label: 'Carte', testId: 'tab-map', icon: MapIcon },
  { to: '/friends', label: 'Amis', testId: 'tab-friends', icon: FriendsIcon },
  { to: '/leaderboard', label: 'Classement', testId: 'tab-leaderboard', icon: TrophyIcon },
  { to: '/wallet', label: 'Portefeuille', testId: 'tab-wallet', icon: WalletIcon },
  { to: '/profile', label: 'Profil', testId: 'tab-profile', icon: ProfileIcon },
];

export default function TabBar() {
  const { profile } = useAuth(); const [pending,setPending]=useState(0);
  useEffect(()=>profile?watchIncomingRequests(profile.uid,r=>setPending(r.length)):undefined,[profile?.uid]);
  return (
    <nav className="tabbar" data-testid="bottom-tab-bar">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.to === '/'}
          data-testid={t.testId}
          className={({ isActive }) => `tab ${isActive ? 'tab-active' : ''}`}
          aria-label={t.label}
        >
          <span className="tab-icon" aria-hidden="true"><t.icon />{t.to==='/friends'&&pending>0&&<b className="tab-badge">{pending}</b>}</span>
          <span className="tab-label">{t.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function HomeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 10.5 12 3l9 7.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 9.5V21h14V9.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function MapIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4Z" strokeLinejoin="round" />
      <path d="M9 4v14M15 6v14" />
    </svg>
  );
}
function FriendsIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.8 20c.8-3.2 3.2-5 6.2-5s5.4 1.8 6.2 5" strokeLinecap="round" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M15.6 14.4c2.6.2 4.6 1.7 5.4 4.6" strokeLinecap="round" />
    </svg>
  );
}
function TrophyIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" strokeLinejoin="round" />
      <path d="M8 5H4.5a3.5 3.5 0 0 0 3.6 3.5M16 5h3.5a3.5 3.5 0 0 1-3.6 3.5" strokeLinecap="round" />
      <path d="M12 13v4m-4 4h8m-6.5-4h5" strokeLinecap="round" />
    </svg>
  );
}
function WalletIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M3 10h18" />
      <circle cx="17" cy="14.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}
function ProfileIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20.5c1-3.8 4-6 7.5-6s6.5 2.2 7.5 6" strokeLinecap="round" />
    </svg>
  );
}
