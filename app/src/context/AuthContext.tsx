import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../lib/firebase';
import {
  ensureUserDoc,
  watchUserProfile,
  maybeCreateReferralClaim,
  claimReferralBonuses,
  recordDeviceSignals,
} from '../lib/db';
import type { UserProfile } from '../lib/types';

interface AuthCtx {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  pendingReferralCode: string | null;
  setPendingReferralCode: (code: string | null) => void;
  setPendingDisplayName: (name: string | null) => void;
}

const Ctx = createContext<AuthCtx>({
  user: null,
  profile: null,
  loading: true,
  pendingReferralCode: null,
  setPendingReferralCode: () => undefined,
  setPendingDisplayName: () => undefined,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingReferralCode, setPendingReferralCode] = useState<string | null>(null);
  const [pendingDisplayName, setPendingDisplayName] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        setProfile(null);
        setLoading(false);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!user) return;
    let unsubProfile: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        // S'abonner d'abord : la compensation de latence Firestore affiche
        // le profil instantanément, même avant l'ack serveur.
        unsubProfile = watchUserProfile(user.uid, (p) => {
          setProfile(p);
          setLoading(false);
        });
        await ensureUserDoc(user, pendingReferralCode || undefined, pendingDisplayName || undefined);
        if (cancelled) return;
        // Anti-fraude : mémoriser les signaux appareil (IP + HWID).
        recordDeviceSignals(user.uid).catch(() => undefined);
        // Bonus de parrainage : côté filleul puis côté parrain.
        claimReferralBonuses(user.uid).catch(() => undefined);
      } catch (e) {
        console.warn('[Auth] ensureUserDoc error', e);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (unsubProfile) unsubProfile();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  // Dès qu'un parrain est défini, tente de créer la réclamation de
  // parrainage côté filleul (vérification anti-fraude IP + HWID incluse).
  useEffect(() => {
    if (profile?.referredBy) {
      maybeCreateReferralClaim(profile).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.uid, profile?.referredBy]);

  const setCode = useCallback((code: string | null) => setPendingReferralCode(code), []);

  return (
    <Ctx.Provider
      value={{
        user,
        profile,
        loading,
        pendingReferralCode,
        setPendingReferralCode: setCode,
        setPendingDisplayName,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthCtx {
  return useContext(Ctx);
}
