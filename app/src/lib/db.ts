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
  BADGE_DEFINITIONS,
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
  UserBadge,
  BadgeId,
  ActivityFeedItem,
  ActivityFeedType,
  FriendChallenge,
  FriendChallengeProgress,
  DirectMessage,
  CommunityEvent,
  ActivityPrivacySettings,
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
      // badge referral if any claimed
      await unlockBadge(uid, 'referral-first').catch(()=>undefined);
    } catch (e) {
      console.warn('[Referral] claim error', e);
    }
  }
  if (count>0) {
    const prof = await getUserProfile(uid);
    if (prof) await createFeedItem(prof,'friend',`a parrainé ${count} nouvel${count>1?'aux':'au'} marcheur${count>1?'s':''} ! 🤝`, { count }).catch(()=>undefined);
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

  const result = await runTransaction(db, async (tx) => {
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
    return { coins, streak, freezeUsed, prevTotalSteps: profile.totalSteps, newTotal: profile.totalSteps + Math.floor(steps), newStreak: streak };
  });
  // Post-validation side-effects (badges, feed) — best effort, don't block
  try {
    const fresh = await getUserProfile(uid);
    if (fresh) {
      await checkAndUnlockBadges({ ...fresh, streak: result.newStreak, totalSteps: result.newTotal } as UserProfile, { stepsToday: steps, totalSteps: result.newTotal }).catch(()=>undefined);
      // Feed pour objectif atteint
      if (steps >= (fresh.dailyStepGoal || 10000)) {
        await createFeedItem(fresh, 'goal', `a atteint son objectif de ${steps.toLocaleString('fr-FR')} pas ! 🎯`, { steps }).catch(()=>undefined);
      }
      if (result.newStreak>=7) {
        await createFeedItem(fresh, 'streak', `enchaîne ${result.newStreak} jours consécutifs ! 🔥`, { streak: result.newStreak }).catch(()=>undefined);
      }
    }
  } catch {}
  return { coins: result.coins, streak: result.streak, freezeUsed: result.freezeUsed };
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
  try {
    const profile = await getUserProfile(uid);
    if (profile) {
      await unlockBadge(uid, 'challenge-first').catch(()=>undefined);
      await createFeedItem(profile, 'challenge', `a remporté le défi « ${challenge.title} » ! 🏆`, { challengeId: challenge.id }).catch(()=>undefined);
    }
  } catch {}
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
  await updateActivitySession(uid, id, { ...data, endedAt: Date.now(), status: 'completed', visibility: 'private' });
  try {
    const profile = await getUserProfile(uid);
    if (profile) {
      await checkAndUnlockBadges(profile, { hasGpsActivity: true, distanceM: data.distanceM }).catch(()=>undefined);
      await createFeedItem(profile, 'activity', `a terminé une sortie de ${(data.distanceM/1000).toFixed(2)} km en ${Math.floor(data.durationSec/60)} min ! 🏃`, { distanceM: data.distanceM, durationSec: data.durationSec, steps: data.steps }).catch(()=>undefined);
    }
  } catch {}
}

export async function getActivitySession(id: string): Promise<ActivitySession | null> {
  const snap = await getDoc(doc(db, 'activitySessions', id));
  return snap.exists() ? { id: snap.id, ...(snap.data() as ActivitySession) } : null;
}

/**
 * Supprime une sortie et ses points GPS (tracé).
 * Vérifie que la sortie appartient bien à l'utilisateur : les points de parcours
 * sont des données de localisation sensible, on n'autorise pas la suppression
 * de celle d'un tiers.
 */
export async function deleteActivitySession(uid: string, sessionId: string): Promise<void> {
  const ref = doc(db, 'activitySessions', sessionId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const session = snap.data() as ActivitySession;
  if (session.uid !== uid) throw new Error('Cette sortie ne vous appartient pas.');
  await deleteDoc(ref);
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
  // Jetons de notification (identifiants d'appareil) : sous-collection du profil.
  // Firestore ne supprime PAS les sous-collections avec le document parent.
  const tokens = await getDocs(collection(db, 'users', uid, 'notificationTokens'));
  for (const t of tokens.docs) await deleteDoc(t.ref);
  // Réactions entre amis : contiennent le pseudo et un message libre (160 car. max).
  // À supprimer dans les deux sens (émises et reçues).
  for (const field of ['from', 'to'] as const) {
    const reactions = await getDocs(query(collection(db, 'friendReactions'), where(field, '==', uid)));
    for (const r of reactions.docs) await deleteDoc(r.ref);
  }
  const friendships = await getDocs(query(collection(db, 'friendships'), where('members', 'array-contains', uid)));
  for (const f of friendships.docs) await deleteDoc(f.ref);
  for (const field of ['from','to'] as const) { const requests=await getDocs(query(collection(db,'friendRequests'),where(field,'==',uid))); for(const r of requests.docs) await deleteDoc(r.ref); }
  // Retraits : on n'anonymise que les demandes déjà traitées. Une demande encore
  // « pending » conserve son e-mail PayPal le temps d'être payée, sinon
  // l'utilisateur perdrait à la fois ses ElyCoins (débités à la demande) et son
  // paiement. L'adresse est effacée dès le versement effectué.
  const withdrawals=await getDocs(query(collection(db,'withdrawals'),where('uid','==',uid)));
  for (const w of withdrawals.docs) {
    const data = w.data() as Withdrawal;
    if (data.status === 'pending') {
      await updateDoc(w.ref, { userName: 'Compte supprimé', deletedUser: true });
    } else {
      await updateDoc(w.ref, { userName: 'Compte supprimé', paypalEmail: null, deletedUser: true });
    }
  }
  const partners=await getDocs(query(collection(db,'partnerRequests'),where('uid','==',uid))); for(const p of partners.docs) await updateDoc(p.ref,{userName:'Compte supprimé',contactEmail:'supprimé',message:'Données supprimées',deletedUser:true});
  await deleteDoc(doc(db, 'referralClaims', uid)).catch(() => undefined);
  await deleteDoc(doc(db, 'referralCodes', (await getUserProfile(uid))?.referralCode || '_')).catch(() => undefined);
  await deleteDoc(doc(db, 'users', uid));
}

// ============ Badges / Trophées ============
export async function listUserBadges(uid: string): Promise<UserBadge[]> {
  const snaps = await getDocs(collection(db, 'users', uid, 'badges'));
  return snaps.docs.map(d => ({ id: d.id, ...(d.data() as UserBadge) }));
}
export function watchUserBadges(uid: string, cb: (badges: UserBadge[]) => void): Unsubscribe {
  return onSnapshot(collection(db, 'users', uid, 'badges'), snap => cb(snap.docs.map(d => ({ id: d.id, ...(d.data() as UserBadge) }))));
}
export async function unlockBadge(uid: string, badgeId: BadgeId): Promise<boolean> {
  const ref = doc(db, 'users', uid, 'badges', badgeId);
  const snap = await getDoc(ref);
  if (snap.exists()) return false;
  await setDoc(ref, { badgeId, unlockedAt: Date.now(), seen: false } satisfies UserBadge);
  return true;
}
export async function markBadgeSeen(uid: string, badgeId: BadgeId): Promise<void> {
  await updateDoc(doc(db, 'users', uid, 'badges', badgeId), { seen: true }).catch(()=>undefined);
}
export async function checkAndUnlockBadges(profile: UserProfile, opts?: { stepsToday?: number; totalSteps?: number; distanceM?: number; hasGpsActivity?: boolean }): Promise<BadgeId[]> {
  const unlocked: BadgeId[] = [];
  const existing = new Set((await listUserBadges(profile.uid)).map(b=>b.badgeId));
  const tryUnlock = async (id: BadgeId, condition: boolean) => {
    if (condition && !existing.has(id)) {
      const ok = await unlockBadge(profile.uid, id);
      if (ok) { unlocked.push(id); existing.add(id); }
    }
  };
  const today = opts?.stepsToday ?? 0;
  const total = opts?.totalSteps ?? profile.totalSteps;
  const stride = profile.strideLengthCm || 75;
  const totalDistanceM = total * stride / 100;
  const km10 = 10000, km100 = 100000, km500 = 500000;
  await tryUnlock('first-10k', today >= 10000);
  await tryUnlock('streak-7', profile.streak >= 7);
  await tryUnlock('streak-30', profile.streak >= 30);
  await tryUnlock('streak-100', profile.streak >= 100);
  await tryUnlock('first-gps', !!opts?.hasGpsActivity);
  await tryUnlock('km-10', totalDistanceM >= km10);
  await tryUnlock('km-100', totalDistanceM >= km100);
  await tryUnlock('km-500', totalDistanceM >= km500);
  await tryUnlock('steps-100k', total >= 100000);
  await tryUnlock('steps-1m', total >= 1000000);
  // referral badge checked elsewhere when claim succeeds
  if (unlocked.length) {
    // also create feed events for badges if allowed
    for (const bid of unlocked) {
      const def = BADGE_DEFINITIONS.find(b=>b.id===bid);
      await createFeedItem(profile, 'badge', `a débloqué le badge « ${def?.title || bid} » ${def?.icon || '🏅'}`, { badgeId: bid }).catch(()=>undefined);
    }
  }
  return unlocked;
}
export async function unlockReferralBadgeIfEligible(uid: string): Promise<void> {
  const badges = await listUserBadges(uid);
  if (badges.some(b=>b.badgeId==='referral-first')) return;
  const q = query(collection(db,'referralClaims'), where('sponsorUid','==',uid), where('claimed','==',true));
  const snaps = await getDocs(q);
  if (!snaps.empty) await unlockBadge(uid,'referral-first').catch(()=>undefined);
}

// ============ Fil d'activité ============
export async function createFeedItem(me: UserProfile, type: ActivityFeedType, message: string, metadata?: Record<string, unknown>): Promise<void> {
  const privacy = me.activityPrivacy;
  const shouldShare = (() => {
    if (type==='goal' && privacy?.shareGoals===false) return false;
    if (type==='activity' && privacy?.shareActivities===false) return false;
    if (type==='badge' && privacy?.shareBadges===false) return false;
    if (type==='challenge' && privacy?.shareChallenges===false) return false;
    return true;
  })();
  if (!shouldShare) return;
  await addDoc(collection(db,'activityFeed'), {
    uid: me.uid,
    displayName: me.displayName,
    photoURL: me.photoURL || null,
    type,
    message,
    metadata: metadata || undefined,
    createdAt: Date.now(),
  } satisfies ActivityFeedItem);
}
export async function listFriendFeed(uid: string, max = 30): Promise<ActivityFeedItem[]> {
  // get friend ids
  const friendships = await getDocs(query(collection(db,'friendships'), where('members','array-contains',uid)));
  const friendIds = friendships.docs.map(d=>(d.data() as Friendship).members.find(m=>m!==uid)!).filter(Boolean);
  const ids = [uid, ...friendIds];
  if (ids.length===0) return [];
  // Firestore whereIn limited to 10, so chunk
  const all: ActivityFeedItem[] = [];
  for (let i=0;i<ids.length;i+=10){
    const chunk = ids.slice(i,i+10);
    const snaps = await getDocs(query(collection(db,'activityFeed'), where('uid','in',chunk), limit(max*2)));
    all.push(...snaps.docs.map(d=>({ id:d.id, ...(d.data() as ActivityFeedItem)})));
  }
  return all.sort((a,b)=>b.createdAt-a.createdAt).slice(0,max);
}
export function watchFriendFeed(uid: string, cb: (items: ActivityFeedItem[]) => void): Unsubscribe {
  // simple polling via onSnapshot on own feed? For now watch friendships then feed? Simplify: watch all recent feed and filter
  // We'll watch global feed limited to 50 and filter client side (requires read permission)
  // Instead watch per user? We'll watch feed where uid in [uid + friends] by listening to friendships first
  let feedUnsub: Unsubscribe | null = null;
  const unsubFriends = watchFriendships(uid, async (friendUids)=>{
    if (feedUnsub) feedUnsub();
    const ids = [uid, ...friendUids];
    if (!ids.length) { cb([]); return; }
    // Firestore limitation: we can only use 'in' with 10, so watch first 10 for realtime, else fallback
    const chunk = ids.slice(0,10);
    const q = query(collection(db,'activityFeed'), where('uid','in',chunk), limit(30));
    feedUnsub = onSnapshot(q, snap=>{
      const items=snap.docs.map(d=>({id:d.id,...(d.data() as ActivityFeedItem)}));
      items.sort((a,b)=>b.createdAt-a.createdAt);
      cb(items);
    });
  });
  return ()=>{ unsubFriends(); if(feedUnsub) feedUnsub(); };
}

// ============ Défis entre amis ============
export async function createFriendChallenge(creator: UserProfile, opts: { title: string; target: number; metric?: 'steps'|'distance'; participantUids: string[]; days?: number }): Promise<string> {
  const days = opts.days || 7;
  const start = dateStr(new Date());
  const endDate = new Date(); endDate.setDate(endDate.getDate()+days);
  const end = dateStr(endDate);
  const allParticipants = Array.from(new Set([creator.uid, ...opts.participantUids]));
  // fetch names
  const profiles = await getProfiles(allParticipants);
  const names: Record<string,string> = {};
  profiles.forEach(p=>names[p.uid]=p.displayName);
  names[creator.uid]=creator.displayName;
  const docRef = await addDoc(collection(db,'friendChallenges'), {
    creatorUid: creator.uid,
    creatorName: creator.displayName,
    title: opts.title.slice(0,60),
    target: Math.max(1000, Math.min(500000, Math.floor(opts.target))),
    metric: opts.metric || 'steps',
    participants: allParticipants,
    participantNames: names,
    invitedUids: opts.participantUids,
    startsAt: start,
    endsAt: end,
    status: 'active',
    createdAt: Date.now(),
  } satisfies FriendChallenge);
  // feed
  await createFeedItem(creator,'challenge',`a lancé le défi « ${opts.title} » contre ${opts.participantUids.length} ami(s) !`, { challengeId: docRef.id }).catch(()=>undefined);
  return docRef.id;
}
export async function listFriendChallenges(uid: string): Promise<FriendChallenge[]> {
  const snaps = await getDocs(query(collection(db,'friendChallenges'), where('participants','array-contains',uid), limit(20)));
  return snaps.docs.map(d=>({id:d.id,...(d.data() as FriendChallenge)}));
}
export function watchFriendChallenges(uid: string, cb: (items: FriendChallenge[]) => void): Unsubscribe {
  return onSnapshot(query(collection(db,'friendChallenges'), where('participants','array-contains',uid), limit(20)), snap=>{ const items=snap.docs.map(d=>({id:d.id,...(d.data() as FriendChallenge)})); items.sort((a,b)=>b.createdAt-a.createdAt); cb(items); });
}
export async function getFriendChallengeProgress(challenge: FriendChallenge): Promise<FriendChallengeProgress[]> {
  const results: FriendChallengeProgress[] = [];
  for (const uid of challenge.participants) {
    const profile = await getUserProfile(uid);
    if (!profile) continue;
    // compute progress in period
    const days = await listDailySteps(uid, 370);
    const inRange = days.filter(d=>d.date>=challenge.startsAt && d.date<=challenge.endsAt);
    let progress = 0;
    if (challenge.metric==='steps') progress = inRange.reduce((s,d)=>s+d.steps,0);
    else if (challenge.metric==='distance') progress = inRange.reduce((s,d)=>s+d.steps,0) * ((profile.strideLengthCm||75)/100); // meters
    results.push({ uid, displayName: profile.displayName, photoURL: profile.photoURL, progress, percent: Math.min(100, Math.round(progress/challenge.target*100)) });
  }
  return results.sort((a,b)=>b.progress-a.progress);
}
export async function deleteFriendChallenge(uid: string, challengeId: string): Promise<void> {
  const ref = doc(db,'friendChallenges',challengeId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data() as FriendChallenge;
  if (data.creatorUid!==uid) throw new Error('Seul le créateur peut supprimer ce défi.');
  await deleteDoc(ref);
}

// ============ Partage de sorties (visibilité) ============
export async function setActivityVisibility(uid: string, sessionId: string, visibility: 'private'|'friends'|'link', sharedWith?: string[]): Promise<void> {
  const ref = doc(db,'activitySessions',sessionId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Sortie introuvable');
  const data = snap.data() as ActivitySession;
  if (data.uid!==uid) throw new Error('Non autorisé');
  await updateDoc(ref, { visibility, sharedWith: sharedWith||[] } as unknown as Record<string,unknown>);
}
export async function listSharedActivitiesForFriends(uid: string, friendUid: string): Promise<ActivitySession[]> {
  // friend's activities visible to friends
  const snaps = await getDocs(query(collection(db,'activitySessions'), where('uid','==',friendUid), where('visibility','==','friends'), limit(20)));
  // also check that they are friends
  const friendships = await getDocs(query(collection(db,'friendships'), where('members','array-contains',uid)));
  const isFriend = friendships.docs.some(d=>(d.data() as Friendship).members.includes(friendUid));
  if (!isFriend) return [];
  return snaps.docs.map(d=>({id:d.id,...(d.data() as ActivitySession)}));
}
export async function listMySharedActivities(uid: string): Promise<ActivitySession[]> {
  const snaps = await getDocs(query(collection(db,'activitySessions'), where('uid','==',uid)));
  return snaps.docs.map(d=>({id:d.id,...(d.data() as ActivitySession)}));
}

// ============ Parrainage dashboard ============
export interface ReferralDashboardItem {
  uid: string;
  displayName: string;
  photoURL?: string|null;
  claimed: boolean;
  rejected?: boolean;
  createdAt: number;
  totalSteps?: number;
  active?: boolean;
}
export async function getReferralDashboard(uid: string): Promise<{ total: number; active: number; earned: number; items: ReferralDashboardItem[] }> {
  const claims = await getDocs(query(collection(db,'referralClaims'), where('sponsorUid','==',uid)));
  const items: ReferralDashboardItem[] = [];
  let earned = 0;
  for (const c of claims.docs) {
    const data = c.data() as ReferralClaim;
    const prof = await getUserProfile(data.referredUid);
    const rejected = prof?.referralRejected || false;
    const active = (prof?.totalSteps||0) > 1000;
    if (data.claimed) earned+=10;
    items.push({ uid: data.referredUid, displayName: data.referredName, photoURL: prof?.photoURL||null, claimed: data.claimed, rejected, createdAt: data.createdAt, totalSteps: prof?.totalSteps||0, active });
  }
  // also pending referralCodes usage? Already covered
  // Sort by createdAt desc
  items.sort((a,b)=>b.createdAt-a.createdAt);
  return { total: items.length, active: items.filter(i=>i.active).length, earned, items };
}

// ============ QR / partage stylé ============
// helper is in components, but db helper for code
export function getFriendCodeShareUrl(code: string): string {
  return `${typeof location!=='undefined' ? location.origin : ''}/?ref=${code}`;
}

// ============ Messagerie légère ============
export async function sendDirectMessage(from: UserProfile, toUid: string, text: string, activityId?: string): Promise<void> {
  const t = text.trim().slice(0,500);
  if (!t) throw new Error('Message vide');
  if (t.length<1) throw new Error('Message trop court');
  // vérifie amitié
  const friendships = await getDocs(query(collection(db,'friendships'), where('members','array-contains',from.uid)));
  const isFriend = friendships.docs.some(d=>(d.data() as Friendship).members.includes(toUid));
  if (!isFriend) throw new Error('Vous devez être amis pour envoyer un message.');
  const target = await getUserProfile(toUid);
  await addDoc(collection(db,'directMessages'), {
    from: from.uid,
    fromName: from.displayName,
    to: toUid,
    toName: target?.displayName||toUid,
    text: t,
    createdAt: Date.now(),
    activityId: activityId||null,
    read: false,
  } satisfies DirectMessage);
}
export function watchDirectMessages(uid: string, friendUid: string, cb: (msgs: DirectMessage[])=>void): Unsubscribe {
  // Watch messages where (from==uid && to==friendUid) OR vice versa — need two queries, merge client side
  // Simplified: watch all messages where from==uid or to==uid and filter
  const q1 = query(collection(db,'directMessages'), where('from','==',uid), where('to','==',friendUid), limit(100));
  const q2 = query(collection(db,'directMessages'), where('from','==',friendUid), where('to','==',uid), limit(100));
  let m1: DirectMessage[]=[]; let m2: DirectMessage[]=[];
  const emit=()=>cb([...m1,...m2].sort((a,b)=>a.createdAt-b.createdAt));
  const u1=onSnapshot(q1, s=>{ m1=s.docs.map(d=>({id:d.id,...(d.data() as DirectMessage)})); emit(); });
  const u2=onSnapshot(q2, s=>{ m2=s.docs.map(d=>({id:d.id,...(d.data() as DirectMessage)})); emit(); });
  return ()=>{u1();u2();};
}
export async function listRecentMessages(uid: string, limitCount=20): Promise<DirectMessage[]> {
  const q1 = query(collection(db,'directMessages'), where('from','==',uid), limit(limitCount));
  const q2 = query(collection(db,'directMessages'), where('to','==',uid), limit(limitCount));
  const [s1,s2]=await Promise.all([getDocs(q1), getDocs(q2)]);
  const all=[...s1.docs,...s2.docs].map(d=>({id:d.id,...(d.data() as DirectMessage)})).sort((a,b)=>b.createdAt-a.createdAt).slice(0,limitCount);
  return all;
}
export function watchRecentMessages(uid:string, cb:(msgs:DirectMessage[])=>void):Unsubscribe{
  // merge both directions
  let a:DirectMessage[]=[]; let b:DirectMessage[]=[];
  const emit=()=>cb([...a,...b].sort((x,y)=>y.createdAt-x.createdAt).slice(0,20));
  const u1=onSnapshot(query(collection(db,'directMessages'), where('from','==',uid), limit(10)), s=>{a=s.docs.map(d=>({id:d.id,...(d.data() as DirectMessage)}));emit();});
  const u2=onSnapshot(query(collection(db,'directMessages'), where('to','==',uid), limit(10)), s=>{b=s.docs.map(d=>({id:d.id,...(d.data() as DirectMessage)}));emit();});
  return ()=>{u1();u2();};
}

// ============ Événements communautaires ============
export async function createCommunityEvent(creator: UserProfile, data: { title:string; description:string; establishmentId?:string; establishmentName?:string; location?:string; lat?:number; lng?:number; date:string; time?:string; maxParticipants?:number }): Promise<string> {
  const ref = await addDoc(collection(db,'communityEvents'), {
    title: data.title.slice(0,80),
    description: data.description.slice(0,600),
    establishmentId: data.establishmentId||null,
    establishmentName: data.establishmentName||null,
    location: data.location||null,
    lat: data.lat||null,
    lng: data.lng||null,
    date: data.date,
    time: data.time||null,
    creatorUid: creator.uid,
    creatorName: creator.displayName,
    participants: [creator.uid],
    maxParticipants: data.maxParticipants||null,
    createdAt: Date.now(),
  } as unknown as CommunityEvent);
  await createFeedItem(creator,'friend',`a créé l’événement « ${data.title} »`, { eventId: ref.id }).catch(()=>undefined);
  return ref.id;
}
export async function listCommunityEvents(limitCount=20): Promise<CommunityEvent[]> {
  const snaps = await getDocs(query(collection(db,'communityEvents'), orderBy('date','asc'), limit(limitCount)));
  return snaps.docs.map(d=>({id:d.id,...(d.data() as CommunityEvent)}));
}
export function watchCommunityEvents(cb:(items:CommunityEvent[])=>void):Unsubscribe{
  return onSnapshot(query(collection(db,'communityEvents'), orderBy('date','asc'), limit(20)), snap=>cb(snap.docs.map(d=>({id:d.id,...(d.data() as CommunityEvent)}))));
}
export async function joinCommunityEvent(uid:string, eventId:string):Promise<void>{
  const ref=doc(db,'communityEvents',eventId);
  const snap=await getDoc(ref);
  if(!snap.exists()) throw new Error('Événement introuvable');
  const ev=snap.data() as CommunityEvent;
  if(ev.participants.includes(uid)) return;
  if(ev.maxParticipants && ev.participants.length>=ev.maxParticipants) throw new Error('Complet');
  await updateDoc(ref,{ participants: [...ev.participants, uid] });
}
export async function leaveCommunityEvent(uid:string, eventId:string):Promise<void>{
  const ref=doc(db,'communityEvents',eventId);
  const snap=await getDoc(ref);
  if(!snap.exists()) return;
  const ev=snap.data() as CommunityEvent;
  await updateDoc(ref,{ participants: ev.participants.filter(p=>p!==uid) });
}

// ============ Activité privacy settings ============
export async function updateActivityPrivacy(uid:string, settings: ActivityPrivacySettings): Promise<void> {
  await updateDoc(doc(db,'users',uid), { activityPrivacy: settings } as unknown as Record<string,unknown>);
}

