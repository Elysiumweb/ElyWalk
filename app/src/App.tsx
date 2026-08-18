import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './components/Toast';
import TabBar from './components/TabBar';
import { initAds, loadAppOpenAd, showAppOpenAdIfReady } from './lib/ads';
import { pedometer } from './lib/pedometer';
import AuthPage from './pages/AuthPage';
import HomePage from './pages/HomePage';
import FriendsPage from './pages/FriendsPage';
import LeaderboardPage from './pages/LeaderboardPage';
import WalletPage from './pages/WalletPage';
import ProfilePage from './pages/ProfilePage';
import PartnersPage from './pages/PartnersPage';
import AdminPage from './pages/AdminPage';
import MapPage from './pages/MapPage';
import LegalPage from './pages/LegalPage';
import HistoryPage from './pages/HistoryPage';
import PublicProfilePage from './pages/PublicProfilePage';
import WhatsNewPage from './pages/WhatsNewPage';
import ProductStatus from './components/ProductStatus';
import { setupNotifications } from './lib/notifications';

function Shell() {
  const { user, loading, setPendingReferralCode } = useAuth();
  const location = useLocation();

  useEffect(() => {
    const ref = new URLSearchParams(location.search).get('ref');
    if (ref) setPendingReferralCode(ref.toUpperCase());
  }, [location.search, setPendingReferralCode]);

  // Démarre le service de pas dès la connexion (survît à la fermeture de l'app).
  useEffect(() => {
    if (!user || !Capacitor.isNativePlatform()) return;
    (async () => {
      const p = await pedometer.checkPermission();
      if (p === 'granted') await pedometer.start();
    })();
  }, [user?.uid]);

  useEffect(() => { if (user) setupNotifications(user.uid).catch(console.warn); }, [user?.uid]);
  useEffect(() => { const open=(raw:string)=>{const url=new URL(raw);const ref=url.searchParams.get('ref')||(url.protocol==='elywalk:'?url.searchParams.get('code'):null);if(ref)setPendingReferralCode(ref.toUpperCase())}; CapApp.getLaunchUrl().then(r=>r?.url&&open(r.url));const sub=CapApp.addListener('appUrlOpen',e=>open(e.url));return()=>{sub.then(h=>h.remove())}; }, [setPendingReferralCode]);

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

  if (location.pathname.startsWith('/legal/')) return <Routes><Route path="/legal/:doc" element={<LegalPage />} /></Routes>;
  if (!user) return <AuthPage />;

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
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/user/:uid" element={<PublicProfilePage />} />
        <Route path="/whats-new" element={<WhatsNewPage />} />
        <Route path="/legal/:doc" element={<LegalPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ProductStatus />
      <TabBar />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Shell />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
