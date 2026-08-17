import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  onSnapshot,
  runTransaction,
  increment,
  type Unsubscribe,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from './firebase';
import {
  isPresidentUid,
  PRESIDENT_UID,
  REFERRAL_BONUS,
  AD_REWARD_COINS,
  COINS_PER_EURO,
} from './constants';
import { coinsForSteps, caloriesForSteps, dateStr, yesterdayStr } from './coins';
import type {
  UserProfile,
  CoinTransaction,
  Withdrawal,
  PartnerRequest,
  FriendRequest,
  Friendship,
  ReferralClaim,
  Role,
} from './types';

// ============ Profil utilisateur ============

function genReferralCode(uid: string): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function roleForUid(uid: string): Role {
  if (uid === PRESIDENT_UID) return 'president';
  if (isPresidentUid(uid)) return 'copresident';
  return 'member';
}

/** Crée le document utilisateur au premier login (idempotent). */
export async function ensureUserDoc(
  user: User,
  referralCodeInput?: string,
  displayNameOverride?: string
): Promise<UserProfile> {
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    return snap.data() as UserProfile;
  }

  let referredBy: string | null = null;
  if (referralCodeInput) {
    referredBy = await resolveReferralCode(referralCodeInput.trim().toUpperCase());
    if (referredBy === user.uid) referredBy = null;
  }

  const code = genReferralCode(user.uid);
  const profile: UserProfile = {
    uid: user.uid,
    displayName:
      displayNameOverride || user.displayName || user.email?.split('@')[0] || 'Marcheur',
    photoURL: user.photoURL || null,
    email: user.email,
    phoneNumber: user.phoneNumber,
    phoneVerified: !!user.phoneNumber,
    elycoins: 0,
    totalSteps: 0,
    totalCalories: 0,
    streak: 0,
    lastValidatedDate: null,
    todaySteps: 0,
    todayDate: dateStr(),
    referralCode: code,
    referredBy,
    paypalEmail: null,
    role: roleForUid(user.uid),
    createdAt: Date.now(),
  };
  await setDoc(ref, profile);
  await setDoc(doc(db, 'referralCodes', code), { uid: user.uid }).catch(() => undefined);
  return profile;
}

export function watchUserProfile(uid: string, cb: (p: UserProfile | null) => void): Unsubscribe {
  return onSnapshot(doc(db, 'users', uid), (snap) => {
    cb(snap.exists() ? (snap.data() as UserProfile) : null);
  });
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? (snap.data() as UserProfile) : null;
}

export async function updateUserFields(uid: string, fields: Partial<UserProfile>): Promise<void> {
  await updateDoc(doc(db, 'users', uid), fields as Record<string, unknown>);
}

/** Synchronise les pas du jour (visible par les amis). */
export async function syncTodaySteps(uid: string, steps: number): Promise<void> {
  await updateDoc(doc(db, 'users', uid), {
    todaySteps: Math.floor(steps),
    todayDate: dateStr(),
  }).catch(() => undefined);
}

// ============ Parrainage ============

export async function resolveReferralCode(code: string): Promise<string | null> {
  if (!code) return null;
  const snap = await getDoc(doc(db, 'referralCodes', code));
  return snap.exists() ? (snap.data() as { uid: string }).uid : null;
}

/** Définit le parrain après coup (si pas fait à l'inscription). */
export async function setReferredBy(uid: string, code: string): Promise<boolean> {
  const sponsorUid = await resolveReferralCode(code.trim().toUpperCase());
  if (!sponsorUid || sponsorUid === uid) return false;
  const me = await getUserProfile(uid);
  if (!me || me.referredBy) return false;
  await updateUserFields(uid, { referredBy: sponsorUid });
  return true;
}

/**
 * Le filleul crée la réclamation de bonus quand parrain ET filleul
 * ont leur téléphone vérifié.
 */
export async function maybeCreateReferralClaim(me: UserProfile): Promise<void> {
  if (!me.referredBy || !me.phoneVerified) return;
  const claimRef = doc(db, 'referralClaims', me.uid);
  const existing = await getDoc(claimRef);
  if (existing.exists()) return;
  const sponsor = await getUserProfile(me.referredBy);
  if (!sponsor || !sponsor.phoneVerified) return;
  const claim: ReferralClaim = {
    sponsorUid: me.referredBy,
    referredUid: me.uid,
    referredName: me.displayName,
    claimed: false,
    createdAt: Date.now(),
  };
  await setDoc(claimRef, claim).catch(() => undefined);
}

/** Le parrain encaisse ses bonus de parrainage en attente. Retourne le nb encaissé. */
export async function claimReferralBonuses(uid: string): Promise<number> {
  const q = query(
    collection(db, 'referralClaims'),
    where('sponsorUid', '==', uid),
    where('claimed', '==', false)
  );
  const snaps = await getDocs(q);
  let count = 0;
  for (const claimSnap of snaps.docs) {
    const data = claimSnap.data() as ReferralClaim;
    try {
      await runTransaction(db, async (tx) => {
        const fresh = await tx.get(claimSnap.ref);
        if (!fresh.exists() || (fresh.data() as ReferralClaim).claimed) return;
        tx.update(claimSnap.ref, { claimed: true });
        tx.update(doc(db, 'users', uid), { elycoins: increment(REFERRAL_BONUS) });
        const txRef = doc(collection(db, 'users', uid, 'transactions'));
        tx.set(txRef, {
          type: 'referral',
          coins: REFERRAL_BONUS,
          note: `Parrainage de ${data.referredName}`,
          createdAt: Date.now(),
        } satisfies CoinTransaction);
      });
      count++;
    } catch (e) {
      console.warn('[Referral] claim error', e);
    }
  }
  return count;
}

// ============ Validation des pas ============

export interface ValidationResult {
  coins: number;
  streak: number;
}

/** Crédite les ElyCoins du jour (une seule validation par jour). */
export async function validateSteps(uid: string, steps: number): Promise<ValidationResult> {
  const today = dateStr();
  const yesterday = yesterdayStr();
  const coins = coinsForSteps(steps);
  const calories = caloriesForSteps(steps);

  return runTransaction(db, async (tx) => {
    const userRef = doc(db, 'users', uid);
    const snap = await tx.get(userRef);
    if (!snap.exists()) throw new Error('Profil introuvable.');
    const profile = snap.data() as UserProfile;
    if (profile.lastValidatedDate === today) {
      throw new Error('Pas déjà validés aujourd’hui. Revenez demain !');
    }
    const streak = profile.lastValidatedDate === yesterday ? profile.streak + 1 : 1;
    tx.update(userRef, {
      elycoins: increment(coins),
      totalSteps: increment(Math.floor(steps)),
      totalCalories: increment(calories),
      streak,
      lastValidatedDate: today,
      todaySteps: 0,
      todayDate: today,
    });
    tx.set(doc(db, 'users', uid, 'dailySteps', today), {
      steps: Math.floor(steps),
      coins,
      calories,
      validatedAt: Date.now(),
    });
    const txRef = doc(collection(db, 'users', uid, 'transactions'));
    tx.set(txRef, {
      type: 'steps',
      coins,
      note: `${Math.floor(steps).toLocaleString('fr-FR')} pas validés`,
      createdAt: Date.now(),
    } satisfies CoinTransaction);
    return { coins, streak };
  });
}

// ============ Récompense publicitaire ============

export async function creditAdReward(uid: string): Promise<void> {
  await runTransaction(db, async (tx) => {
    tx.update(doc(db, 'users', uid), { elycoins: increment(AD_REWARD_COINS) });
    const txRef = doc(collection(db, 'users', uid, 'transactions'));
    tx.set(txRef, {
      type: 'ad',
      coins: AD_REWARD_COINS,
      note: 'Pub récompensée regardée',
      createdAt: Date.now(),
    } satisfies CoinTransaction);
  });
}

// ============ Retraits / Donations ============

export async function requestConversion(
  profile: UserProfile,
  type: 'paypal' | 'donation',
  coins: number,
  paypalEmail?: string
): Promise<void> {
  if (coins <= 0 || coins > profile.elycoins) {
    throw new Error('Montant d’ElyCoins invalide.');
  }
  if (type === 'paypal' && isPresidentUid(profile.uid)) {
    throw new Error('Le Président et le Co-Président sont exclus de la conversion en argent.');
  }
  await runTransaction(db, async (tx) => {
    const userRef = doc(db, 'users', profile.uid);
    const snap = await tx.get(userRef);
    const fresh = snap.data() as UserProfile;
    if (fresh.elycoins < coins) throw new Error('Solde insuffisant.');
    tx.update(userRef, { elycoins: increment(-coins) });
    const wRef = doc(collection(db, 'withdrawals'));
    tx.set(wRef, {
      uid: profile.uid,
      userName: profile.displayName,
      type,
      coins,
      euros: coins / COINS_PER_EURO,
      paypalEmail: type === 'paypal' ? paypalEmail || null : null,
      status: type === 'donation' ? 'received' : 'pending',
      createdAt: Date.now(),
    } satisfies Withdrawal);
    const txRef = doc(collection(db, 'users', profile.uid, 'transactions'));
    tx.set(txRef, {
      type,
      coins: -coins,
      note:
        type === 'paypal'
          ? `Retrait PayPal (${(coins / COINS_PER_EURO).toFixed(2)} €)`
          : 'Donation à Elysium',
      createdAt: Date.now(),
    } satisfies CoinTransaction);
  });
}

export async function listMyWithdrawals(uid: string): Promise<Withdrawal[]> {
  const q = query(collection(db, 'withdrawals'), where('uid', '==', uid));
  const snaps = await getDocs(q);
  return snaps.docs
    .map((d) => ({ id: d.id, ...(d.data() as Withdrawal) }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function listMyTransactions(uid: string): Promise<CoinTransaction[]> {
  const q = query(
    collection(db, 'users', uid, 'transactions'),
    orderBy('createdAt', 'desc'),
    limit(50)
  );
  const snaps = await getDocs(q);
  return snaps.docs.map((d) => ({ id: d.id, ...(d.data() as CoinTransaction) }));
}

// ============ Demandes de partenariat ============

export async function createPartnerRequest(
  profile: UserProfile,
  organization: string,
  contactEmail: string,
  message: string
): Promise<void> {
  await addDoc(collection(db, 'partnerRequests'), {
    uid: profile.uid,
    userName: profile.displayName,
    organization,
    contactEmail,
    message,
    status: 'pending',
    createdAt: Date.now(),
  } satisfies PartnerRequest);
}

export async function listAllPartnerRequests(): Promise<PartnerRequest[]> {
  const snaps = await getDocs(collection(db, 'partnerRequests'));
  return snaps.docs
    .map((d) => ({ id: d.id, ...(d.data() as PartnerRequest) }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function updatePartnerRequestStatus(
  id: string,
  status: PartnerRequest['status']
): Promise<void> {
  await updateDoc(doc(db, 'partnerRequests', id), { status });
}

export async function listAllWithdrawals(): Promise<Withdrawal[]> {
  const snaps = await getDocs(collection(db, 'withdrawals'));
  return snaps.docs
    .map((d) => ({ id: d.id, ...(d.data() as Withdrawal) }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function updateWithdrawalStatus(
  id: string,
  status: Withdrawal['status']
): Promise<void> {
  await updateDoc(doc(db, 'withdrawals', id), { status });
}

// ============ Amis ============

export async function findUserByCode(code: string): Promise<UserProfile | null> {
  const uid = await resolveReferralCode(code.trim().toUpperCase());
  return uid ? getUserProfile(uid) : null;
}

export async function sendFriendRequest(me: UserProfile, target: UserProfile): Promise<void> {
  if (target.uid === me.uid) throw new Error('Vous ne pouvez pas vous ajouter vous-même.');
  const existing = await getDocs(
    query(
      collection(db, 'friendRequests'),
      where('from', '==', me.uid),
      where('to', '==', target.uid),
      where('status', '==', 'pending')
    )
  );
  if (!existing.empty) throw new Error('Demande déjà envoyée.');
  await addDoc(collection(db, 'friendRequests'), {
    from: me.uid,
    fromName: me.displayName,
    to: target.uid,
    toName: target.displayName,
    status: 'pending',
    createdAt: Date.now(),
  } satisfies FriendRequest);
}

export function watchIncomingRequests(
  uid: string,
  cb: (reqs: FriendRequest[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'friendRequests'),
    where('to', '==', uid),
    where('status', '==', 'pending')
  );
  return onSnapshot(q, (snaps) => {
    cb(snaps.docs.map((d) => ({ id: d.id, ...(d.data() as FriendRequest) })));
  });
}

export async function respondFriendRequest(req: FriendRequest, accept: boolean): Promise<void> {
  if (!req.id) return;
  await updateDoc(doc(db, 'friendRequests', req.id), {
    status: accept ? 'accepted' : 'rejected',
  });
  if (accept) {
    await addDoc(collection(db, 'friendships'), {
      members: [req.from, req.to],
      createdAt: Date.now(),
    } satisfies Friendship);
  }
}

export function watchFriendships(
  uid: string,
  cb: (friendUids: string[]) => void
): Unsubscribe {
  const q = query(collection(db, 'friendships'), where('members', 'array-contains', uid));
  return onSnapshot(q, (snaps) => {
    const uids = snaps.docs
      .map((d) => (d.data() as Friendship).members.find((m) => m !== uid))
      .filter((m): m is string => !!m);
    cb(uids);
  });
}

export async function getProfiles(uids: string[]): Promise<UserProfile[]> {
  const results = await Promise.all(uids.map((u) => getUserProfile(u)));
  return results.filter((p): p is UserProfile => !!p);
}

// ============ Classement ============

export async function getLeaderboard(top = 50): Promise<UserProfile[]> {
  const q = query(collection(db, 'users'), orderBy('elycoins', 'desc'), limit(top));
  const snaps = await getDocs(q);
  return snaps.docs.map((d) => d.data() as UserProfile);
}
