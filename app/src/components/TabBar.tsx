import { useEffect, useState, type ComponentType } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { watchIncomingRequests } from '../lib/db';
import Sheet from './Sheet';

/**
 * Barre d'onglets — 5 destinations principales + un onglet « Plus ».
 *
 * Sur téléphone, les libellés restent **visibles** (courts, 11 px, coupés
 * proprement sur deux lignes si besoin) : une barre d'icônes seules n'indique
 * pas où l'on va. Les destinations secondaires (défis, rencontres, sortie GPS,
 * historique, nouveautés) sont regroupées dans une feuille « Plus », en lignes
 * de 48 px avec un libellé complet et une description.
 *
 * Les six anciens onglets ne tenaient pas avec un libellé lisible : 6 × 64 px
 * sur un écran de 360 px ne laisse que 60 px par onglet, insuffisant pour
 * « Portefeuille ». D'où le regroupement.
 */

type Tab = {
  to: string;
  label: string;
  /** Libellé du `aria-label` (plus explicite que le libellé compact). */
  ariaLabel: string;
  testId: string;
  icon: ComponentType;
};

const PRIMARY_TABS: Tab[] = [
  { to: '/', label: 'Accueil', ariaLabel: 'Accueil', testId: 'tab-home', icon: HomeIcon },
  { to: '/map', label: 'Carte', ariaLabel: 'Carte des partenaires', testId: 'tab-map', icon: MapIcon },
  { to: '/friends', label: 'Amis', ariaLabel: 'Amis', testId: 'tab-friends', icon: FriendsIcon },
  { to: '/wallet', label: 'Gains', ariaLabel: 'Portefeuille et gains', testId: 'tab-wallet', icon: WalletIcon },
  { to: '/profile', label: 'Profil', ariaLabel: 'Profil', testId: 'tab-profile', icon: ProfileIcon },
];

/** Destinations secondaires regroupées sous « Plus ». */
const MORE_LINKS: { to: string; label: string; hint: string; icon: string }[] = [
  { to: '/leaderboard', label: 'Classement', hint: 'Jour, semaine, mois et amis', icon: '🏆' },
  { to: '/challenges', label: 'Défis', hint: 'Objectifs datés et défis entre amis', icon: '🎯' },
  { to: '/events', label: 'Rencontres', hint: 'Marcher ensemble près des partenaires', icon: '👥' },
  { to: '/activity', label: 'Sortie GPS', hint: 'Enregistrer un parcours avec pause et export', icon: '▶' },
  { to: '/history', label: 'Historique & santé', hint: 'Calendrier, statistiques et réglages', icon: '📊' },
  { to: '/partners', label: 'Partenaires', hint: 'Offres Elysium et établissements', icon: '📍' },
  { to: '/whats-new', label: 'Nouveautés', hint: 'Les évolutions de cette version', icon: '✦' },
];

const MORE_PATHS = MORE_LINKS.map((link) => link.to);

export default function TabBar() {
  const { profile } = useAuth();
  const { pathname } = useLocation();
  const [pending, setPending] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    if (!profile) return;
    return watchIncomingRequests(profile.uid, (requests) => setPending(requests.length));
  }, [profile?.uid]);

  // La feuille « Plus » se referme à chaque changement de page.
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  // Une destination secondaire active justifie l'onglet « Plus ».
  const moreActive = MORE_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));

  return (
    <>
      <nav className="tabbar" data-testid="bottom-tab-bar" aria-label="Navigation principale">
        {PRIMARY_TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === '/'}
            data-testid={tab.testId}
            className={({ isActive }) => `tab ${isActive ? 'tab-active' : ''}`}
            aria-label={tab.ariaLabel}
          >
            <span className="tab-icon" aria-hidden="true">
              <tab.icon />
              {tab.to === '/friends' && pending > 0 && <b className="tab-badge">{pending > 9 ? '9+' : pending}</b>}
            </span>
            <span className="tab-label">{tab.label}</span>
          </NavLink>
        ))}

        <button
          type="button"
          className={`tab tab-more ${moreActive ? 'tab-active' : ''}`}
          onClick={() => setMoreOpen(true)}
          data-testid="tab-more"
          aria-label="Plus de destinations"
          aria-expanded={moreOpen}
        >
          <span className="tab-icon" aria-hidden="true">
            <MoreIcon />
          </span>
          <span className="tab-label">Plus</span>
        </button>
      </nav>

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="Plus" testId="more-sheet">
        <div className="more-links">
          {MORE_LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) => `more-link ${isActive ? 'more-link-active' : ''}`}
              data-testid={`more-${link.to.replace(/\//g, '')}`}
            >
              <span className="more-link-icon" aria-hidden="true">{link.icon}</span>
              <span className="more-link-main">
                <span className="more-link-title">{link.label}</span>
                <span className="more-link-hint">{link.hint}</span>
              </span>
            </NavLink>
          ))}
        </div>
      </Sheet>
    </>
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
function MoreIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
