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
  serverTimestamp,
  deleteDoc,
  writeBatch,
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
import { getDeviceSignals } from './device';
import type {
  UserProfile,
  CoinTransaction,
  Withdrawal,
  PartnerRequest,
  FriendRequest,
  Friendship,
  ReferralClaim,
  Role,
  DailySteps,
  PartnerOffer,
  ChallengeDefinition,
  UserChallenge,
  ActivitySession,
  ActivityPoint,
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

  // Signaux appareil à l'inscription (anti-fraude parrainage).
  const signals = await getDeviceSignals();

  const code = genReferralCode(user.uid);
  const profile: UserProfile = {
    uid: user.uid,
    displayName:
      displayNameOverride || user.displayName || user.email?.split('@')[0] || 'Marcheur',
    photoURL: user.photoURL || null,
    email: user.email,
    signupIp: signals.ip,
    lastIp: signals.ip,
    hwid: signals.hwid,
    hwids: signals.hwid ? [signals.hwid] : [],
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
    dailyStepGoal: 10000,
    strideLengthCm: 75,
    onboardingDone: false,
    streakFreezes: 1,
    health: { unitSystem: 'metric' },
    unitSystem: 'metric',
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
  await updateUserFields(uid, { referredBy: sponsorUid, referralRejected: false });
  return true;
}

// ---- Anti-fraude parrainage (IP + HWID) ----

function knownIps(p: UserProfile | null): string[] {
  const ips = new Set<string>();
  if (p?.signupIp) ips.add(p.signupIp);
  if (p?.lastIp) ips.add(p.lastIp);
  return [...ips];
}

function knownHwids(p: UserProfile | null): string[] {
  const hwids = new Set<string>();
  if (p?.hwid) hwids.add(p.hwid);
  (p?.hwids || []).forEach((h) => h && hwids.add(h));
  return [...hwids];
}

/**
 * Vérifie que le filleul et le parrain n'utilisent pas la même adresse IP
 * ni le même appareil (HWID). Retourne la raison du refus, ou null si OK.
 */
function referralFraudReason(
  sponsor: UserProfile,
  myIp: string | null,
  myHwid: string | null
): 'hwid' | 'ip' | null {
  if (myHwid && knownHwids(sponsor).includes(myHwid)) return 'hwid';
  if (myIp && knownIps(sponsor).includes(myIp)) return 'ip';
  return null;
}

/**
 * Le filleul crée la réclamation de bonus de parrainage.
 * Anti-fraude : refusé si le filleul partage l'adresse IP ou le HWID
 * (identifiant matériel) du parrain — cela bloque la création de
 * multiples comptes utilisés pour s'auto-parrainer.
 */
export async function maybeCreateReferralClaim(me: UserProfile): Promise<void> {
  if (!me.referredBy || me.referralRejected) return;
  const claimRef = doc(db, 'referralClaims', me.uid);
  const existing = await getDoc(claimRef);
  if (existing.exists()) return;
  const sponsor = await getUserProfile(me.referredBy);
  if (!sponsor) return;

  const signals = await getDeviceSignals();
  const reason = referralFraudReason(sponsor, signals.ip, signals.hwid);
  if (reason) {
    // Même appareil ou même connexion : pas de bonus.
    await updateUserFields(me.uid, { referralRejected: true }).catch(() => undefined);
    console.warn('[Referral] bonus refusé :', reason === 'hwid' ? 'même HWID' : 'même IP');
    return;
  }

  const claim: ReferralClaim = {
    sponsorUid: me.referredBy,
    referredUid: me.uid,
    referredName: me.displayName,
    referredIp: signals.ip,
    referredHwid: signals.hwid,
    claimed: false,
    createdAt: Date.now(),
  };
  await setDoc(claimRef, claim).catch(() => undefined);
  // Mémoriser les signaux utilisés côté filleul (vérifications futures).
  await updateUserFields(me.uid, {
    ...(signals.ip ? { lastIp: signals.ip } : {}),
    ...(signals.hwid ? { hwids: [...new Set([...(me.hwids || []), signals.hwid])] } : {}),
    referralRejected: false,
  }).catch(() => undefined);
}

/**
 * Mémorise les signaux appareil du compte connecté (IP + HWID).
 * Appelé à chaque connexion pour garder l'historique à jour.
 */
export async function recordDeviceSignals(uid: string): Promise<void> {
  const signals = await getDeviceSignals();
  const me = await getUserProfile(uid);
  if (!me) return;
  const fields: Partial<UserProfile> = {};
  if (signals.ip) {
    fields.lastIp = signals.ip;
    if (!me.signupIp) fields.signupIp = signals.ip;
  }
  if (signals.hwid) {
    fields.hwids = [...new Set([...(me.hwids || []), signals.hwid])];
    if (!me.hwid) fields.hwid = signals.hwid;
  }
  if (Object.keys(fields).length === 0) return;
  await updateUserFields(uid, fields).catch(() => undefined);
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
        tx.update(doc(db, 'users', uid), { elycoins: increment(REFERRAL_BONUS), lastReferralClaim: claimSnap.id });
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
  freezeUsed: boolean;
}

function daysSince(date: string | null, today: string): number | null {
  if (!date) return null;
  const from = new Date(`${date}T00:00:00`);
  const to = new Date(`${today}T00:00:00`);
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

/** Crédite les ElyCoins du jour (une seule validation par jour). */
export async function validateSteps(uid: string, steps: number): Promise<ValidationResult> {
  if (!Number.isInteger(steps) || steps < 0 || steps > 60000) {
    throw new Error('Nombre de pas incohérent (maximum quotidien : 60 000).');
  }
  const today = dateStr();
  const coins = coinsForSteps(steps);

  return runTransaction(db, async (tx) => {
    const userRef = doc(db, 'users', uid);
    const snap = await tx.get(userRef);
    if (!snap.exists()) throw new Error('Profil introuvable.');
    const profile = snap.data() as UserProfile;
    const calories = caloriesForSteps(steps, profile.health, profile.strideLengthCm || 75);
    if (profile.lastValidatedDate === today) {
      throw new Error('Pas déjà validés aujourd’hui. Revenez demain !');
    }
    const gap = daysSince(profile.lastValidatedDate, today);
    const availableFreezes = Math.max(0, profile.streakFreezes ?? 1);
    const freezeUsed = gap === 2 && availableFreezes > 0;
    const streak = gap === 1 || freezeUsed ? profile.streak + 1 : 1;
    tx.update(userRef, {
      elycoins: increment(coins),
      totalSteps: increment(Math.floor(steps)),
      totalCalories: increment(calories),
      streak,
      streakFreezes: availableFreezes - (freezeUsed ? 1 : 0),
      lastValidatedDate: today,
      todaySteps: Math.floor(steps),
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
    return { coins, streak, freezeUsed };
  });
}

// ============ Défis ============

function dayValue(date: string): number {
  return new Date(`${date}T00:00:00`).getTime();
}

function challengeIsActive(challenge: ChallengeDefinition, today = dateStr()): boolean {
  return dayValue(today) >= dayValue(challenge.startsAt) && dayValue(today) <= dayValue(challenge.endsAt);
}

/** Lit les défis actifs et la progression personnelle enregistrée. */
export async function listMyChallenges(uid: string, challenges: ChallengeDefinition[]): Promise<UserChallenge[]> {
  const active = challenges.filter((c) => challengeIsActive(c));
  const [daily, profile] = await Promise.all([listDailySteps(uid, 370), getUserProfile(uid)]);
  const docs = await getDocs(collection(db, 'users', uid, 'challenges'));
  const saved = new Map(docs.docs.map((d) => [d.id, d.data() as UserChallenge]));
  const result: UserChallenge[] = [];
  for (const challenge of active) {
    const ownDays = daily.filter((d) => d.date >= challenge.startsAt && d.date <= challenge.endsAt);
    let progress = 0;
    if (challenge.metric === 'steps') progress = ownDays.reduce((sum, d) => sum + d.steps, 0);
    if (challenge.metric === 'activeDays') progress = ownDays.filter((d) => d.steps > 0).length;
    if (challenge.metric === 'streak') progress = profile?.streak || 0;
    // Collective challenges are deliberately based on the same daily records
    // as personal challenges; the server can later replace this with an aggregate.
    if (challenge.kind === 'collective') {
      const users = await getLeaderboard(200);
      const all = await Promise.all(users.map((u) => listDailySteps(u.uid, 370).catch(() => [])));
      progress = all.flat().filter((d) => d.date >= challenge.startsAt && d.date <= challenge.endsAt).reduce((sum, d) => sum + d.steps, 0);
    }
    const old = saved.get(challenge.id);
    result.push({
      challengeId: challenge.id, uid, progress: Math.min(progress, challenge.target),
      completed: progress >= challenge.target, claimed: old?.claimed || false,
      updatedAt: Date.now(), claimedAt: old?.claimedAt,
    });
  }
  return result;
}

/** Réclame une récompense une seule fois, dans la même transaction que le solde. */
export async function claimChallengeReward(uid: string, challenge: ChallengeDefinition, progress: number): Promise<void> {
  if (progress < challenge.target) throw new Error('Défi pas encore terminé.');
  await runTransaction(db, async (tx) => {
    const userRef = doc(db, 'users', uid);
    const claimRef = doc(db, 'users', uid, 'challenges', challenge.id);
    const [userSnap, claimSnap] = await Promise.all([tx.get(userRef), tx.get(claimRef)]);
    if (!userSnap.exists()) throw new Error('Profil introuvable.');
    if (claimSnap.exists() && (claimSnap.data() as UserChallenge).claimed) throw new Error('Récompense déjà récupérée.');
    tx.update(userRef, { elycoins: increment(challenge.reward), lastChallengeClaim: challenge.id });
    tx.set(claimRef, { challengeId: challenge.id, uid, progress, completed: true, claimed: true, reward: challenge.reward, updatedAt: Date.now(), claimedAt: Date.now() } satisfies UserChallenge);
    tx.set(doc(collection(db, 'users', uid, 'transactions')), {
      type: 'challenge', coins: challenge.reward, note: `Défi : ${challenge.title}`, createdAt: Date.now(),
    } satisfies CoinTransaction);
  });
}

// ============ Sorties GPS ============

export async function createActivitySession(uid: string, type: ActivitySession['type']): Promise<string> {
  const ref = await addDoc(collection(db, 'activitySessions'), {
    uid, type, startedAt: Date.now(), durationSec: 0, distanceM: 0, calories: 0, points: [], status: 'active',
  } satisfies ActivitySession);
  return ref.id;
}

export async function updateActivitySession(uid: string, id: string, data: Partial<ActivitySession>): Promise<void> {
  await updateDoc(doc(db, 'activitySessions', id), data as Record<string, unknown>);
}

export async function appendActivityPoint(uid: string, id: string, point: ActivityPoint[], distanceM: number, durationSec: number, calories: number): Promise<void> {
  await updateActivitySession(uid, id, { points: point, distanceM, durationSec, calories });
}

export async function finishActivitySession(uid: string, id: string, data: Pick<ActivitySession, 'points' | 'distanceM' | 'durationSec' | 'calories' | 'steps'>): Promise<void> {
  await updateActivitySession(uid, id, { ...data, endedAt: Date.now(), status: 'completed' });
}

export async function getActivitySession(id: string): Promise<ActivitySession | null> {
  const snap = await getDoc(doc(db, 'activitySessions', id));
  return snap.exists() ? { id: snap.id, ...(snap.data() as ActivitySession) } : null;
}

export async function listActivitySessions(uid: string, count = 20): Promise<ActivitySession[]> {
  const snaps = await getDocs(query(collection(db, 'activitySessions'), where('uid', '==', uid), limit(count)));
  return snaps.docs.map((d) => ({ id: d.id, ...(d.data() as ActivitySession) })).sort((a, b) => b.startedAt - a.startedAt);
}

// ============ Récompense publicitaire ============

export async function creditAdReward(uid: string): Promise<void> {
  const now = new Date();
  const slot = `${uid}_${dateStr(now)}_${String(now.getHours()).padStart(2, '0')}`;
  await runTransaction(db, async (tx) => {
    const claimRef = doc(db, 'adClaims', slot);
    if ((await tx.get(claimRef)).exists()) throw new Error('Une seule récompense publicitaire est autorisée par heure.');
    tx.set(claimRef, { uid, slot, coins: AD_REWARD_COINS, createdAt: Date.now() });
    tx.update(doc(db, 'users', uid), { elycoins: increment(AD_REWARD_COINS), lastAdSlot: slot, lastAdRewardAt: serverTimestamp() });
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
      status: 'pending',
      createdAt: Date.now(),
      notified: false,
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

export async function updateWithdrawalStatus(id: string, status: Withdrawal['status']): Promise<void> {
  await runTransaction(db, async (tx) => {
    const wRef = doc(db, 'withdrawals', id);
    const snap = await tx.get(wRef);
    if (!snap.exists()) throw new Error('Opération introuvable.');
    const withdrawal = snap.data() as Withdrawal;
    if (withdrawal.status !== 'pending') throw new Error('Cette opération a déjà été traitée.');
    tx.update(wRef, { status, processedAt: Date.now() });
    if (status === 'rejected') {
      tx.update(doc(db, 'users', withdrawal.uid), { elycoins: increment(withdrawal.coins) });
      tx.set(doc(collection(db, 'users', withdrawal.uid, 'transactions')), {
        type: withdrawal.type, coins: withdrawal.coins,
        note: `Remboursement automatique — opération refusée`, createdAt: Date.now(),
      } satisfies CoinTransaction);
    }
  });
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
    notified: false,
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

export async function listDailySteps(uid: string, count = 30): Promise<DailySteps[]> {
  const snaps = await getDocs(query(collection(db, 'users', uid, 'dailySteps'), orderBy('validatedAt', 'desc'), limit(count)));
  return snaps.docs.map(d => ({ date: d.id, ...(d.data() as Omit<DailySteps, 'date'>) })).reverse();
}

export function watchOutgoingRequests(uid: string, cb: (reqs: FriendRequest[]) => void): Unsubscribe {
  return onSnapshot(query(collection(db, 'friendRequests'), where('from', '==', uid), where('status', '==', 'pending')),
    s => cb(s.docs.map(d => ({ id: d.id, ...(d.data() as FriendRequest) }))));
}

export async function searchUsersByName(name: string): Promise<UserProfile[]> {
  const term = name.trim();
  if (term.length < 2) return [];
  const snaps = await getDocs(query(collection(db, 'users'), orderBy('displayName'), limit(50)));
  return snaps.docs.map(d => d.data() as UserProfile).filter(p => p.displayName.toLocaleLowerCase('fr').includes(term.toLocaleLowerCase('fr'))).slice(0, 10);
}

export async function sendFriendReaction(from: UserProfile, toUid: string, emoji: string, message = ''): Promise<void> {
  if (!['👏','🔥','💛','👋'].includes(emoji)) throw new Error('Réaction invalide.');
  await addDoc(collection(db, 'friendReactions'), { from: from.uid, fromName: from.displayName, to: toUid, emoji, message: message.slice(0, 160), createdAt: Date.now() });
}

export function watchFriendReactions(uid: string, cb: (items: {id:string;fromName:string;emoji:string;message:string}[]) => void): Unsubscribe {
  return onSnapshot(query(collection(db, 'friendReactions'), where('to','==',uid), limit(20)), s => cb(s.docs.map(d => ({id:d.id,...d.data()} as {id:string;fromName:string;emoji:string;message:string}))));
}

export async function removeFriendship(uid: string, friendUid: string): Promise<void> {
  const snaps = await getDocs(query(collection(db, 'friendships'), where('members', 'array-contains', uid)));
  const match = snaps.docs.find(d => (d.data() as Friendship).members.includes(friendUid));
  if (match) await deleteDoc(match.ref);
}

export async function createPartnerOffer(offer: Omit<PartnerOffer,'id'|'createdAt'>): Promise<void> {
  await addDoc(collection(db,'partnerOffers'),{...offer,createdAt:Date.now()});
}

export async function listPartnerOffers(): Promise<PartnerOffer[]> {
  const snaps = await getDocs(query(collection(db, 'partnerOffers'), where('active', '==', true)));
  return snaps.docs.map(d => ({ id: d.id, ...(d.data() as PartnerOffer) }));
}

export async function redeemPartnerOffer(profile: UserProfile, offer: PartnerOffer): Promise<void> {
  if (!offer.id || offer.coins <= 0) throw new Error('Offre invalide.');
  await runTransaction(db, async tx => {
    const userRef = doc(db, 'users', profile.uid);
    const userSnap = await tx.get(userRef);
    const fresh = userSnap.data() as UserProfile;
    if (fresh.elycoins < offer.coins) throw new Error('Solde insuffisant.');
    tx.update(userRef, { elycoins: increment(-offer.coins) });
    tx.set(doc(collection(db, 'withdrawals')), {
      uid: profile.uid, userName: profile.displayName, type: 'partner', coins: offer.coins,
      euros: offer.coins / COINS_PER_EURO, paypalEmail: null, status: 'pending', createdAt: Date.now(),
      offerId: offer.id, offerTitle: offer.title,
    });
    tx.set(doc(collection(db, 'users', profile.uid, 'transactions')), {
      type: 'partner', coins: -offer.coins, note: `Offre partenaire : ${offer.title}`, createdAt: Date.now(),
    } satisfies CoinTransaction);
  });
}

export async function exportAccountData(uid: string): Promise<Record<string, unknown>> {
  const [profile, daily, transactions, withdrawals, activities] = await Promise.all([
    getUserProfile(uid), listDailySteps(uid, 3650), listMyTransactions(uid), listMyWithdrawals(uid), listActivitySessions(uid, 1000),
  ]);
  return { exportedAt: new Date().toISOString(), profile, dailySteps: daily, transactions, withdrawals, activities };
}

export async function deleteAccountData(uid: string): Promise<void> {
  const refs = [collection(db, 'users', uid, 'dailySteps'), collection(db, 'users', uid, 'transactions'), collection(db, 'users', uid, 'challenges')];
  for (const ref of refs) {
    const snaps = await getDocs(ref);
    for (let i = 0; i < snaps.docs.length; i += 400) {
      const batch = writeBatch(db); snaps.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref)); await batch.commit();
    }
  }
  const activities = await getDocs(query(collection(db, 'activitySessions'), where('uid', '==', uid)));
  for (const activity of activities.docs) await deleteDoc(activity.ref);
  const friendships = await getDocs(query(collection(db, 'friendships'), where('members', 'array-contains', uid)));
  for (const f of friendships.docs) await deleteDoc(f.ref);
  for (const field of ['from','to'] as const) { const requests=await getDocs(query(collection(db,'friendRequests'),where(field,'==',uid))); for(const r of requests.docs) await deleteDoc(r.ref); }
  const withdrawals=await getDocs(query(collection(db,'withdrawals'),where('uid','==',uid))); for(const w of withdrawals.docs) await updateDoc(w.ref,{userName:'Compte supprimé',paypalEmail:null,deletedUser:true});
  const partners=await getDocs(query(collection(db,'partnerRequests'),where('uid','==',uid))); for(const p of partners.docs) await updateDoc(p.ref,{userName:'Compte supprimé',contactEmail:'supprimé',message:'Données supprimées',deletedUser:true});
  await deleteDoc(doc(db, 'referralClaims', uid)).catch(() => undefined);
  await deleteDoc(doc(db, 'referralCodes', (await getUserProfile(uid))?.referralCode || '_')).catch(() => undefined);
  await deleteDoc(doc(db, 'users', uid));
}
