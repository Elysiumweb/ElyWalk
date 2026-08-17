import { useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './components/Toast';
import TabBar from './components/TabBar';
import { initAds, loadAppOpenAd, showAppOpenAdIfReady } from './lib/ads';
import AuthPage from './pages/AuthPage';
import HomePage from './pages/HomePage';
import FriendsPage from './pages/FriendsPage';
import LeaderboardPage from './pages/LeaderboardPage';
import WalletPage from './pages/WalletPage';
import ProfilePage from './pages/ProfilePage';
import PartnersPage from './pages/PartnersPage';
import AdminPage from './pages/AdminPage';
import MapPage from './pages/MapPage';

function Shell() {
  const { user, loading } = useAuth();

  // Annonce à l'ouverture + au retour sur l'application (App Open Ad).
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let firstLoad = true;
    (async () => {
      await initAds();
      await loadAppOpenAd();
      // Affiche l'annonce d'ouverture peu après le lancement.
      setTimeout(() => {
        if (firstLoad) {
          firstLoad = false;
          showAppOpenAdIfReady();
        }
      }, 3500);
    })();
    const sub = CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive && !firstLoad) {
        showAppOpenAdIfReady();
      }
    });
    return () => {
      sub.then((h) => h.remove());
    };
  }, []);

  if (loading) {
    return (
      <div className="loading-screen" data-testid="loading-screen">
        <div className="loading-emblem">
          <img src="/elywalk-logo.png" alt="ElyWalk" style={{ width: 110 }} />
        </div>
        <div className="spinner" />
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  return (
    <div className="app-shell">
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/map" element={<MapPage />} />
        <Route path="/friends" element={<FriendsPage />} />
        <Route path="/leaderboard" element={<LeaderboardPage />} />
        <Route path="/wallet" element={<WalletPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/partners" element={<PartnersPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <TabBar />
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <ToastProvider>
        <AuthProvider>
          <Shell />
        </AuthProvider>
      </ToastProvider>
    </HashRouter>
  );
}
