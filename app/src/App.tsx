import { useEffect, useState, type ReactElement } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './components/Toast';
import TabBar from './components/TabBar';
import AppErrorBoundary from './components/AppErrorBoundary';
import AdBanner from './components/AdBanner';
import ConsentGate from './components/ConsentGate';
import {
  CONSENT_RESET_EVENT,
  hasConsentDecision,
  initAds,
  loadAppOpenAd,
  needsConsentPrompt,
  prefetchAds,
  setAdsUser,
  showAppOpenAdIfReady,
} from './lib/ads';
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
import ChallengesPage from './pages/ChallengesPage';
import ActivityPage from './pages/ActivityPage';
import ActivityDetailPage from './pages/ActivityDetailPage';
import EventsPage from './pages/EventsPage';
import ProductStatus from './components/ProductStatus';
import { setupNotifications } from './lib/notifications';

function Shell() {
  // Écran de consentement publicitaire : affiché une fois, avant la première
  // requête d'annonce, et seulement dans les zones qui l'exigent.
  const [consentPrompt, setConsentPrompt] = useState(false);
  const { user, profile, loading, setPendingReferralCode } = useAuth();
  const location = useLocation();

  useEffect(() => {
    const ref = new URLSearchParams(location.search).get('ref');
    if (ref) setPendingReferralCode(ref.toUpperCase());
  }, [location.search, setPendingReferralCode]);

  // Démarre le service de pas dès la connexion (survit à la fermeture de l'app).
  // Toute erreur native (permission, service de premier plan refusé par une ROM)
  // est absorbée : elle ne doit jamais interrompre le démarrage de l'interface.
  useEffect(() => {
    if (!user || !Capacitor.isNativePlatform()) return;
    (async () => {
      try {
        const p = await pedometer.checkPermission();
        if (p === 'granted') await pedometer.start();
      } catch (e) {
        console.warn('[Pedometer] démarrage impossible', e);
      }
    })();
  }, [user?.uid]);

  useEffect(() => { if (user) setupNotifications(user.uid).catch(console.warn); }, [user?.uid]);

  // La validation serveur des récompenses (Meta S2S) a besoin de savoir à qui
  // créditer la vidéo : l'identifiant est transmis à chaque chargement.
  useEffect(() => { setAdsUser(user?.uid ?? null); }, [user?.uid]);

  // Liens entrants (parrainage) : `new URL()` reçoit parfois une chaîne vide ou
  // malformée, d'où une exception non capturée qui interrompt le démarrage.
  useEffect(() => {
    const open = (raw: string) => {
      try {
        const url = new URL(raw);
        const ref = url.searchParams.get('ref') || (url.protocol === 'elywalk:' ? url.searchParams.get('code') : null);
        if (ref) setPendingReferralCode(ref.toUpperCase());
      } catch (e) {
        console.warn('[App] lien entrant illisible', raw, e);
      }
    };
    CapApp.getLaunchUrl().then((r) => r?.url && open(r.url)).catch(() => undefined);
    const sub = CapApp.addListener('appUrlOpen', (e) => open(e.url));
    return () => { sub.then((h) => h.remove()).catch(() => undefined); };
  }, [setPendingReferralCode]);

  // Régie publicitaire : choix de consentement une seule fois, puis
  // préchargement des annonces (validation des pas, fin de sortie, retrait).
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    (async () => {
      const [needs, decided] = await Promise.all([needsConsentPrompt(), hasConsentDecision()]);
      if (needs && !decided) {
        setConsentPrompt(true);
        return; // pas d'annonce tant que l'utilisateur n'a pas tranché
      }
      await initAds();
      await prefetchAds();
    })().catch(console.warn);
  }, []);

  // « Modifier mes choix publicitaires » (Profil) : le choix est effacé, on
  // réaffiche l'écran de consentement plutôt que de laisser l'utilisateur sans
  // publicité ni moyen d'en redonner.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const onReset = () => setConsentPrompt(true);
    window.addEventListener(CONSENT_RESET_EVENT, onReset);
    return () => window.removeEventListener(CONSENT_RESET_EVENT, onReset);
  }, []);

  // L'utilisateur vient de trancher : on démarre la régie (refus compris, il
  // n'y aura alors simplement aucune annonce).
  const onConsentDone = () => {
    setConsentPrompt(false);
    initAds()
      .then(() => prefetchAds())
      .catch(console.warn);
  };

  // Annonce à l'ouverture + au retour sur l'application (App Open Ad).
  // Garde-fous : exemptée tant que l'onboarding n'est pas terminé, plafonnée
  // quotidiennement, espacée d'un cooldown et jamais enchaînée sur une autre
  // annonce plein écran (voir ads.ts).
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (!profile?.onboardingDone) return;
    let cancelled = false;
    let launchHandled = false;
    (async () => {
      await loadAppOpenAd();
      if (cancelled) return;
      // Affiche l'annonce d'ouverture peu après le lancement.
      setTimeout(() => {
        if (cancelled || launchHandled) return;
        launchHandled = true;
        void showAppOpenAdIfReady();
      }, 3500);
    })();
    const sub = CapApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) return;
      launchHandled = true;
      void showAppOpenAdIfReady();
    });
    return () => {
      cancelled = true;
      sub.then((h) => h.remove());
    };
  }, [profile?.onboardingDone]);

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
        <Route path="/challenges" element={<ChallengesPage />} />
        <Route path="/activity" element={<ActivityPage />} />
        <Route path="/activity/:id" element={<ActivityDetailPage />} />
        <Route path="/user/:uid" element={<PublicProfilePage />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/whats-new" element={<WhatsNewPage />} />
        <Route path="/legal/:doc" element={<LegalPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ProductStatus />
      <TabBar />
      {/* Bannière Meta sur chaque écran de l'application (vue native). */}
      <AdBanner />
      {consentPrompt && <ConsentGate onDone={onConsentDone} />}
    </div>
  );
}

export default function App() {
  return (
    // Une erreur de rendu ne doit jamais laisser un écran blanc : l'utilisateur
    // voit un écran de secours avec un bouton « Réessayer ».
    <AppErrorBoundary>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <Shell />
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </AppErrorBoundary>
  );
}
