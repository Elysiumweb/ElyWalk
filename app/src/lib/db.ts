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
  deleteField,
  writeBatch,
  startAfter,
  startAt,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { assertNotBlocked } from './safety';
import { db } from './firebase';
import { exportAccountComplete, purgeAccountData } from './account';
import { registerSyncHandler } from './syncQueue';
import {
  isPresidentUid,
  PRESIDENT_UID,
  REFERRAL_BONUS,
  AD_REWARD_COINS,
  COINS_PER_EURO,
  BADGE_DEFINITIONS,
} from './constants';
import { dateStr, yesterdayStr } from './coins';
import { bestStreakFromDates as computeBestStreak } from './streak';
import { planStepValidation } from './stepValidation';
import { bestWeekFromDays, mergeRecords, sessionSplits, type PersonalRecords } from './records';
import type { ImportedActivity } from './gpx';
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
  ActivityWeather,
  UserBadge,
  BadgeId,
  ActivityFeedItem,
  ActivityFeedType,
  FriendChallenge,
  FriendChallengeProgress,
  DirectMessage,
  CommunityEvent,
  ActivityPrivacySettings,
  ShareLink,
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
    // F01/F07/F12 — listes de blocage portées par le profil. Les règles de liste
    // n'effectuent aucun appel de document : le coût ne dépend plus du nombre de
    // résultats, donc classement et liste d'amis ne sont plus refusés au 6e
    // document. Vides à l'inscription, maintenues par `blockAccount`.
    blockedUsers: [],
    blockedBy: [],
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

/**
 * Profil public d'un compte.
 *
 * `blockedUsers` et `blockedBy` ne quittent jamais la base : ce sont des listes
 * d'identifiants lues par les règles Firestore, sans intérêt pour l'interface,
 * et leur exposer n'apporte qu'un risque de fuite. Les écrans qui ont besoin de
 * savoir *qui* est bloqué utilisent `watchBlockedAccounts` (noms compris).
 */
export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return null;
  const { blockedUsers: _blockedUsers, blockedBy: _blockedBy, ...publicProfile } = snap.data() as UserProfile;
  return publicProfile as UserProfile;
}

/**
 * Objectif hebdomadaire (A9).
 *
 * Borné côté client **et** dans les règles Firestore (7 000 à 210 000 pas) :
 * la valeur est lue par le cron du worker pour le récapitulatif du dimanche.
 */
export async function updateWeeklyStepGoal(uid: string, goal: number): Promise<number> {
  const clean = Math.min(210_000, Math.max(7_000, Math.round(goal)));
  await updateDoc(doc(db, 'users', uid), { weeklyStepGoal: clean });
  return clean;
}

export async function updateDailyStepGoal(uid: string, goal: number): Promise<number> {
  const clean = Math.min(60_000, Math.max(1_000, Math.round(goal)));
  await updateDoc(doc(db, 'users', uid), { dailyStepGoal: clean });
  return clean;
}

export async function updateUserFields(uid: string, fields: Partial<UserProfile>): Promise<void> {
  await updateDoc(doc(db, 'users', uid), fields as Record<string, unknown>);
}

/**
 * Synchronise les préférences d'alerte et la dernière position connue.
 *
 * Le worker (cron) et l'application partagent ces champs :
 *  - `alerts`           : préférences (messages, rencontres proches + rayon,
 *                         rappels d'inscription) ;
 *  - `lastLat`/`lastLng` : position approximative, utilisée pour le rayon des
 *                         rencontres proches quand l'application est fermée.
 *
 * Seul le titulaire du compte écrit ces champs (règle Firestore : mise à jour
 * de son propre document uniquement).
 */
export async function syncAlertSettings(
  uid: string,
  alerts: {
    messages: boolean;
    friendRequests: boolean;
    nearbyEvents: boolean;
    nearbyRadiusKm: number;
    eventReminders: boolean;
    eventReminderMinutes: number;
    weeklyRecap?: boolean;
    eveningReminder?: boolean;
  },
  position: { lat: number; lng: number } | null,
): Promise<void> {
  const payload: Record<string, unknown> = {
    alerts: {
      messages: !!alerts.messages,
      friendRequests: !!alerts.friendRequests,
      nearbyEvents: !!alerts.nearbyEvents,
      nearbyRadiusKm: Math.min(100, Math.max(1, Math.round(alerts.nearbyRadiusKm))),
      eventReminders: !!alerts.eventReminders,
      eventReminderMinutes: Math.min(1440, Math.max(5, Math.round(alerts.eventReminderMinutes))),
      // A9 / A12.6 — consommés par le cron du worker (récapitulatif du
      // dimanche) et par le rappel de fin de journée.
      weeklyRecap: alerts.weeklyRecap !== false,
      eveningReminder: alerts.eveningReminder !== false,
      updatedAt: Date.now(),
    },
  };
  if (position && Number.isFinite(position.lat) && Number.isFinite(position.lng)) {
    payload.lastLat = position.lat;
    payload.lastLng = position.lng;
  }
  await updateDoc(doc(db, 'users', uid), payload);
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
  /** ElyCoins crédités **par cette validation** (delta de la journée). */
  coins: number;
  streak: number;
  freezeUsed: boolean;
  /** Pas ajoutés au total par cette validation. */
  addedSteps: number;
  /** Cumul de pas validé pour la journée, après cette validation. */
  daySteps: number;
  /** `true` si c'était la première validation de la journée. */
  firstOfDay: boolean;
}

/** `true` pour un refus de règle Firestore (`permission-denied`). */
function isPermissionDenied(error: unknown): boolean {
  const code = (error as { code?: string })?.code || '';
  const message = (error as Error)?.message || '';
  return code === 'permission-denied' || /insufficient permissions|permission denied/i.test(message);
}

/**
 * Message actionnable pour un échec de validation.
 *
 * L'utilisateur ne doit plus lire « Missing or insufficient permissions » : ce
 * texte ne dit ni quoi faire ni si son compte est en cause.
 */
function friendlyStepError(error: unknown): Error {
  if (isPermissionDenied(error)) {
    // ⚠️ Ne plus parler d'e-mail : la validation des pas n'exige **aucune**
    // confirmation d'adresse (règle `validStepCredit`, sans `verified()`). Le
    // message précédent envoyait les utilisateurs vérifier un e-mail qui
    // n'était pas en cause.
    return new Error(
      'Validation refusée par le serveur. Vérifiez votre connexion, puis réessayez dans un instant.',
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}

/** Renouvelle le jeton d'authentification (best effort). */
async function refreshAuthToken(): Promise<void> {
  try {
    const { auth } = await import('./firebase');
    const user = auth.currentUser;
    if (!user) return;
    await user.reload();
    await user.getIdToken(true);
  } catch {
    /* hors ligne : le second essai échouera proprement */
  }
}

/**
 * Crédite les pas **du jour** — autant de fois que l'utilisateur le souhaite.
 *
 * Avant la 2.2.5, une seule validation par jour était possible : le bouton
 * restait désactivé jusqu'au lendemain, et l'utilisateur qui marchait après
 * avoir validé à 14 h ne pouvait plus rien créditer avant 20 h le lendemain.
 * Désormais :
 *
 *  • `users/{uid}/dailySteps/{today}` porte le **cumul** de la journée (pas,
 *    ElyCoins, calories) et n'est jamais remis à zéro dans la journée ;
 *  • le profil ne reçoit que le **delta** (pas, calories, ElyCoins) depuis la
 *    validation précédente, calculé par `planStepValidation` — la même
 *    arithmétique que la règle `validStepCredit` ;
 *  • la série (et l'éventuel gel) n'avance qu'à la première validation du jour.
 *
 * `runTransaction` relit le cumul dans la transaction : deux validations
 * concurrentes ne peuvent pas créditer deux fois les mêmes pas (la seconde voit
 * le cumul déjà écrit et ne crédite que son delta, ou échoue proprement).
 * On réessaie **une fois** après rafraîchissement du jeton : un jeton expiré
 * produisait un « Missing or insufficient permissions » brut à l'utilisateur.
 */
export async function validateSteps(uid: string, steps: number): Promise<ValidationResult> {
  const today = dateStr();

  const attempt = () => runTransaction(db, async (tx) => {
    const userRef = doc(db, 'users', uid);
    const dayRef = doc(db, 'users', uid, 'dailySteps', today);
    const snap = await tx.get(userRef);
    if (!snap.exists()) throw new Error('Profil introuvable.');
    const profile = snap.data() as UserProfile;
    const daySnap = await tx.get(dayRef);
    const previous = daySnap.exists()
      ? (() => {
          const data = daySnap.data() as Partial<DailySteps>;
          return { steps: Number(data.steps) || 0, coins: Number(data.coins) || 0, calories: Number(data.calories) || 0 };
        })()
      : null;

    const plan = planStepValidation({
      stepsToday: steps,
      previous,
      profile: {
        lastValidatedDate: profile.lastValidatedDate,
        streak: profile.streak ?? 0,
        streakFreezes: profile.streakFreezes,
      },
      health: profile.health,
      strideLengthCm: profile.strideLengthCm || 75,
      today,
    });

    tx.update(userRef, {
      elycoins: increment(plan.addedCoins),
      totalSteps: increment(plan.addedSteps),
      totalCalories: increment(plan.addedCalories),
      streak: plan.streak,
      streakFreezes: plan.streakFreezes,
      lastValidatedDate: today,
      todaySteps: plan.steps,
      todayDate: today,
    });
    tx.set(dayRef, {
      steps: plan.steps,
      coins: plan.coins,
      calories: plan.calories,
      validatedAt: Date.now(),
      // Compteur de validations du jour : informatif (historique, support).
      // Borné à 200, comme la règle : au-delà, la borne serait refusée.
      validations: Math.min(
        200,
        (daySnap.exists() ? Number((daySnap.data() as { validations?: number }).validations) || 0 : 0) + 1,
      ),
    });
    // Une ligne de registre par crédit réel : revalider sans nouveau palier
    // (delta d'ElyCoins nul) n'en crée pas.
    if (plan.addedCoins > 0) {
      const txRef = doc(collection(db, 'users', uid, 'transactions'));
      tx.set(txRef, {
        type: 'steps',
        coins: plan.addedCoins,
        note: plan.firstOfDay
          ? `${plan.addedSteps.toLocaleString('fr-FR')} pas validés`
          : `${plan.addedSteps.toLocaleString('fr-FR')} pas supplémentaires (journée à ${plan.steps.toLocaleString('fr-FR')} pas)`,
        createdAt: Date.now(),
      } satisfies CoinTransaction);
    }
    return {
      ...plan,
      previousDaySteps: previous?.steps ?? 0,
      prevTotalSteps: profile.totalSteps,
      newTotal: profile.totalSteps + plan.addedSteps,
    };
  });

  let result: Awaited<ReturnType<typeof attempt>>;
  try {
    result = await attempt();
  } catch (error) {
    if (!isPermissionDenied(error)) throw friendlyStepError(error);
    // Jeton probablement obsolète : on le renouvelle puis on rejoue.
    try {
      await refreshAuthToken();
      result = await attempt();
    } catch (retryError) {
      throw friendlyStepError(retryError);
    }
  }
  // Post-validation side-effects (badges, feed) — best effort, don't block
  try {
    const fresh = await getUserProfile(uid);
    if (fresh) {
      await checkAndUnlockBadges(
        { ...fresh, streak: result.streak, totalSteps: result.newTotal } as UserProfile,
        { stepsToday: result.steps, totalSteps: result.newTotal },
      ).catch(() => undefined);
      const goal = fresh.dailyStepGoal || 10000;
      // Le fil ne reçoit l'objectif qu'une fois : à la validation qui le franchit.
      if (result.steps >= goal && result.previousDaySteps < goal) {
        await createFeedItem(fresh, 'goal', `a atteint son objectif de ${result.steps.toLocaleString('fr-FR')} pas ! 🎯`, { steps: result.steps }).catch(() => undefined);
      }
      if (result.streak >= 7 && result.firstOfDay) {
        await createFeedItem(fresh, 'streak', `enchaîne ${result.streak} jours consécutifs ! 🔥`, { streak: result.streak }).catch(() => undefined);
      }
    }
  } catch {}
  return {
    coins: result.addedCoins,
    streak: result.streak,
    freezeUsed: result.freezeUsed,
    addedSteps: result.addedSteps,
    daySteps: result.steps,
    firstOfDay: result.firstOfDay,
  };
}

/**
 * Pas **déjà validés** aujourd'hui (`dailySteps/{date}`), pour que l'accueil
 * affiche la récompense encore disponible au lieu d'un bouton désactivé toute
 * la journée. Renvoie 0 quand la journée n'a pas encore été validée.
 */
export async function getTodayValidatedSteps(uid: string, day = dateStr()): Promise<number> {
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'dailySteps', day));
    if (!snap.exists()) return 0;
    const steps = Number((snap.data() as Partial<DailySteps>).steps) || 0;
    return Math.max(0, Math.floor(steps));
  } catch {
    return 0;
  }
}

// ============ Défis ============

function dayValue(date: string): number {
  return new Date(`${date}T00:00:00`).getTime();
}

function challengeIsActive(challenge: ChallengeDefinition, today = dateStr()): boolean {
  return dayValue(today) >= dayValue(challenge.startsAt) && dayValue(today) <= dayValue(challenge.endsAt);
}

/** Lit les défis actifs et la progression personnelle enregistrée. */
/**
 * État des défis d'un utilisateur (F02 / F09).
 *
 * Deux corrections par rapport à la version précédente :
 *  • la progression et la récompense ne sont plus écrites sur le document de
 *    suivi à chaque affichage : les règles n'autorisent plus à réécrire un
 *    montant, et l'écriture était de toute façon faite dans un contexte où elle
 *    pouvait échouer silencieusement ;
 *  • le défi collectif ne relisait plus les 370 derniers jours de **200
 *    utilisateurs** à chaque ouverture de l'écran (≈ 74 000 lectures DOM). La
 *    contribution de chaque membre est bornée à la fenêtre du défi (≤ 31 jours),
 *    mise en cache une minute, et seuls les 40 premiers marcheurs sont agrégés.
 */
const COLLECTIVE_WINDOW_DAYS = 31;
let collectiveCache: { at: number; total: number } | null = null;

async function collectiveProgress(challenge: ChallengeDefinition): Promise<number> {
  const now = Date.now();
  if (collectiveCache && now - collectiveCache.at < 60_000) return collectiveCache.total;
  const users = await getLeaderboard(40, 'steps');
  const perUser = await Promise.all(
    users.map(async (u) => {
      const days = await listDailySteps(u.uid, COLLECTIVE_WINDOW_DAYS).catch(() => []);
      return days
        .filter((d) => d.date >= challenge.startsAt && d.date <= challenge.endsAt)
        .reduce((sum, d) => sum + d.steps, 0);
    })
  );
  const total = perUser.reduce((sum, value) => sum + value, 0);
  collectiveCache = { at: now, total };
  return total;
}

export async function listMyChallenges(uid: string, challenges: ChallengeDefinition[]): Promise<UserChallenge[]> {
  const active = challenges.filter((c) => challengeIsActive(c));
  const [daily, profile] = await Promise.all([listMyDailySteps(uid, 370), getUserProfile(uid)]);
  const docs = await getDocs(collection(db, 'users', uid, 'challenges'));
  const saved = new Map(docs.docs.map((d) => [d.id, d.data() as UserChallenge]));
  const result: UserChallenge[] = [];
  for (const challenge of active) {
    const ownDays = daily.filter((d) => d.date >= challenge.startsAt && d.date <= challenge.endsAt);
    let progress = 0;
    if (challenge.metric === 'steps') progress = ownDays.reduce((sum, d) => sum + d.steps, 0);
    if (challenge.metric === 'activeDays') progress = ownDays.filter((d) => d.steps > 0).length;
    if (challenge.metric === 'streak') progress = profile?.streak || 0;
    if (challenge.kind === 'collective') progress = await collectiveProgress(challenge);
    const old = saved.get(challenge.id);
    result.push({
      challengeId: challenge.id,
      uid,
      // La progression n'est jamais tronquée côté client : c'est la règle qui
      // borne l'écriture (≤ 400 000), et l'affichage doit montrer le vrai chiffre.
      progress: Math.max(0, Math.round(progress)),
      completed: progress >= challenge.target,
      claimed: old?.claimed || false,
      updatedAt: Date.now(),
      claimedAt: old?.claimedAt,
      reward: old?.reward,
    });
  }
  return result;
}

/**
 * Réclame une récompense de défi — **une seule fois**, dans la même
 * transaction que le solde (F02).
 *
 * Le montant n'est plus celui transmis par l'écran : il est lu dans le
 * catalogue autoritaire `challengeCatalog/{id}` (écrit uniquement par
 * l'administration). Un défi inconnu, inactif, ou déjà réclamé ne crédite rien.
 * La règle Firestore applique le même contrôle : même en contournant ce code,
 * un client ne peut pas s'attribuer un montant arbitraire.
 */
export async function claimChallengeReward(uid: string, challenge: ChallengeDefinition, progress: number): Promise<void> {
  if (progress < challenge.target) throw new Error('Défi pas encore terminé.');
  const catalogSnap = await getDoc(doc(db, 'challengeCatalog', challenge.id));
  if (!catalogSnap.exists()) {
    throw new Error('Ce défi n’est pas ouvert aux récompenses. Réessayez plus tard.');
  }
  const catalog = catalogSnap.data() as { active?: boolean; reward?: number; endsAt?: string };
  if (catalog.active !== true) throw new Error('Ce défi est terminé : plus aucune récompense n’est versée.');
  if (catalog.endsAt && dateStr() > catalog.endsAt) throw new Error('Ce défi est terminé : plus aucune récompense n’est versée.');
  const reward = Number(catalog.reward);
  if (!Number.isFinite(reward) || reward <= 0 || reward > 50) {
    throw new Error('Barème de récompense invalide pour ce défi.');
  }

  await runTransaction(db, async (tx) => {
    const userRef = doc(db, 'users', uid);
    const claimRef = doc(db, 'users', uid, 'challenges', challenge.id);
    const [userSnap, claimSnap] = await Promise.all([tx.get(userRef), tx.get(claimRef)]);
    if (!userSnap.exists()) throw new Error('Profil introuvable.');
    if (claimSnap.exists() && (claimSnap.data() as UserChallenge).claimed) throw new Error('Récompense déjà récupérée.');
    tx.update(userRef, { elycoins: increment(reward), lastChallengeClaim: challenge.id });
    tx.set(claimRef, {
      challengeId: challenge.id, uid, progress: Math.min(progress, challenge.target),
      completed: true, claimed: true, reward, updatedAt: Date.now(), claimedAt: Date.now(),
    } satisfies UserChallenge);
    tx.set(doc(collection(db, 'users', uid, 'transactions')), {
      type: 'challenge', coins: reward, note: `Défi : ${challenge.title}`, createdAt: Date.now(),
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

/**
 * Charge un défi depuis le catalogue autoritaire (montant et fenêtre de
 * validité fixés par l'administration) et le fusionne avec la définition locale
 * (titre, description, icône). Aucune récompense n'est lue depuis le client.
 *
 * Deux règles de cohérence, alignées sur la règle Firestore :
 *  • un défi **absent** du catalogue n'est pas rémunéré (`rewardAllowed: false`) ;
 *  • un défi revalorisé côté administration garde les dates de la définition
 *    locale : remplacer `endsAt` par une valeur distante ferait diverger la
 *    condition d'affichage (« se termine aujourd'hui ») de la condition de
 *    crédit. Seuls le montant et la cible suivent le catalogue.
 */
export async function loadChallengeCatalog(local: ChallengeDefinition[]): Promise<ChallengeDefinition[]> {
  const snaps = await getDocs(collection(db, 'challengeCatalog')).catch(() => null);
  if (!snaps) return local.map((challenge) => ({ ...challenge, rewardAllowed: false }));
  const catalog = new Map<string, Record<string, unknown>>();
  for (const d of snaps.docs) catalog.set(d.id, d.data() as Record<string, unknown>);
  return local.map((challenge) => {
    const remote = catalog.get(challenge.id);
    if (!remote) return { ...challenge, rewardAllowed: false };
    const reward = Number(remote.reward);
    const now = new Date().toISOString().slice(0, 10);
    const expired = typeof remote.endsAt === 'string' && remote.endsAt < now;
    return {
      ...challenge,
      reward: Number.isFinite(reward) && reward > 0 && reward <= 50 ? reward : challenge.reward,
      target: Number(remote.target) > 0 ? Number(remote.target) : challenge.target,
      rewardAllowed: remote.active === true && !expired && Number.isFinite(reward),
    };
  });
}

/**
 * Crée une sortie **idempotente** (F05).
 *
 * L'identifiant est désormais généré côté appareil : réémettre la même sortie
 * après une coupure réseau (file d'envoi persistante) met à jour le même
 * document au lieu d'en créer un second. `createdOffline` / `syncedAt`
 * traduisent l'état « enregistrée sur ce téléphone / synchronisation en
 * attente » affiché à l'utilisateur.
 */
export async function createActivitySession(
  uid: string,
  type: ActivitySession['type'],
  route?: { id: string; name: string },
  options: { sessionId?: string; startedAt?: number; createdOffline?: boolean } = {}
): Promise<string> {
  const ref = options.sessionId
    ? doc(db, 'activitySessions', options.sessionId)
    : doc(collection(db, 'activitySessions'));
  await setDoc(ref, {
    uid, type,
    startedAt: options.startedAt || Date.now(),
    durationSec: 0, distanceM: 0, calories: 0, points: [], status: 'active',
    routeId: route?.id || null, routeName: route?.name || null,
    createdOffline: !!options.createdOffline,
    syncedAt: null,
  } satisfies ActivitySession, { merge: true });
  return ref.id;
}

export async function updateActivitySession(uid: string, id: string, data: Partial<ActivitySession>): Promise<void> {
  await updateDoc(doc(db, 'activitySessions', id), data as Record<string, unknown>);
}

export async function appendActivityPoint(uid: string, id: string, point: ActivityPoint[], distanceM: number, durationSec: number, calories: number, pausedSec = 0): Promise<void> {
  await updateActivitySession(uid, id, { points: point, distanceM, durationSec, calories, pausedSec: Math.max(0, Math.round(pausedSec)) });
}

/** Enregistre une sortie terminée : durée active (pauses exclues) + temps de pause. */
export async function finishActivitySession(
  uid: string,
  id: string,
  data: Pick<ActivitySession, 'points' | 'distanceM' | 'durationSec' | 'calories' | 'steps'> & {
    pausedSec?: number;
    /** `false` pour un import : la sortie n'est pas annoncée dans le fil. */
    announce?: boolean;
  }
): Promise<void> {
  // A12.1 — records 1 km / 5 km calculés **ici**, une seule fois, puis stockés
  // avec la sortie : les écrans n'ont pas à recharger tous les tracés GPS pour
  // connaître une performance.
  const splits = sessionSplits({
    uid,
    type: 'walk',
    startedAt: 0,
    durationSec: data.durationSec,
    points: data.points,
    distanceM: data.distanceM,
    calories: data.calories,
    status: 'completed',
  } as ActivitySession);
  const payload: Record<string, unknown> = {
    ...data,
    pausedSec: Math.max(0, Math.round(data.pausedSec || 0)),
    endedAt: Date.now(),
    status: 'completed',
    // Par défaut la sortie reste privée : c'est l'utilisateur qui choisit son
    // audience (F01), et ce choix n'est jamais réinitialisé ensuite.
    visibility: 'private',
    syncedAt: Date.now(),
  };
  if (splits.best1kmSec != null) payload.best1kmSec = splits.best1kmSec;
  if (splits.best5kmSec != null) payload.best5kmSec = splits.best5kmSec;
  await updateActivitySession(uid, id, payload as Partial<ActivitySession>);
  await refreshPersonalRecords(uid, { ...splits, distanceM: data.distanceM }).catch(() => undefined);
  if (data.announce === false) return;
  try {
    const profile = await getUserProfile(uid);
    if (profile) {
      await checkAndUnlockBadges(profile, { hasGpsActivity: true, distanceM: data.distanceM }).catch(()=>undefined);
      await createFeedItem(profile, 'activity', `a terminé une sortie de ${(data.distanceM/1000).toFixed(2)} km en ${Math.floor(data.durationSec/60)} min ! 🏃`, { distanceM: data.distanceM, durationSec: data.durationSec, steps: data.steps }).catch(()=>undefined);
    }
  } catch {}
}

/**
 * A12.2 — Enregistre une trace GPX importée comme une sortie ElyWalk.
 *
 * Deux écritures : les règles Firestore n'autorisent la création d'une sortie
 * que dans l'état `active` (`communityEvents`-like invariant de F01), donc le
 * document est créé puis clos. L'import ne publie rien dans le fil d'activité :
 * importer un fichier vieux de trois ans ne doit pas apparaître comme une
 * sortie du jour.
 */
export async function importGpxSession(
  uid: string,
  imported: ImportedActivity,
  options: { title?: string } = {}
): Promise<string> {
  const id = await createActivitySession(uid, imported.type, undefined, { startedAt: imported.startedAt });
  await updateActivitySession(uid, id, {
    points: imported.points,
    distanceM: imported.distanceM,
    durationSec: imported.durationSec,
    calories: imported.calories,
    title: (options.title || imported.name).slice(0, 80),
  });
  await finishActivitySession(uid, id, {
    points: imported.points,
    distanceM: imported.distanceM,
    durationSec: imported.durationSec,
    calories: imported.calories,
    steps: imported.steps,
    announce: false,
  });
  return id;
}

/**
 * Met à jour les records personnels du profil (A12.1).
 *
 * Fusion incrémentale : seules les meilleures valeurs sont conservées, ce qui
 * évite de relire l'historique complet des tracés. La meilleure semaine est
 * recalculée à partir des pas déjà validés (lecture légère, sans GPS).
 */
export async function refreshPersonalRecords(
  uid: string,
  update: { best1kmSec?: number | null; best5kmSec?: number | null; distanceM?: number },
): Promise<PersonalRecords> {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return mergeRecords(null, update);
  const current = (snap.data() as UserProfile & { records?: Partial<PersonalRecords> }).records || null;
  const days = await listMyDailySteps(uid, 370).catch(() => [] as DailySteps[]);
  const bestWeek = bestWeekFromDays(days);
  const merged = mergeRecords(current, { ...update, bestWeek });
  await updateDoc(doc(db, 'users', uid), { records: merged } as unknown as Record<string, unknown>);
  return merged;
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

/**
 * Titre, note et météo ressentie d'une sortie.
 * Les champs vides sont supprimés du document (deleteField) pour rester
 * compatibles avec les règles Firestore qui bornent leur taille.
 */
export async function updateActivityMetadata(
  uid: string,
  id: string,
  metadata: {
    title?: string;
    /** @deprecated la note est privée : utiliser `setPrivateActivityNote`. */
    note?: string;
    /** Message partageable avec l'audience de la sortie (F01). */
    caption?: string;
    weather?: ActivityWeather | null;
  },
): Promise<void> {
  const ref = doc(db, 'activitySessions', id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Cette sortie n’existe plus.');
  if ((snap.data() as ActivitySession).uid !== uid) throw new Error('Cette sortie ne vous appartient pas.');
  const title = (metadata.title || '').trim().slice(0, 80);
  const caption = (metadata.caption || '').trim().slice(0, 500);
  const data: Record<string, unknown> = {
    title: title || deleteField(),
    caption: caption || deleteField(),
    weather: metadata.weather || deleteField(),
  };
  // La note privée ne doit JAMAIS être écrite dans le document partageable :
  // si un appelant utilise encore l'ancien paramètre, elle est redirigée vers
  // la sous-collection privée.
  if (metadata.note !== undefined) await setPrivateActivityNote(uid, id, metadata.note);
  await updateDoc(ref, data);
}

/** Curseur de pagination d'une liste de sorties (tri startedAt desc + id). */
export interface ActivityQueryCursor {
  startedAt: number;
  id: string;
}

export interface ActivityQueryFilters {
  type?: ActivitySession['type'];
  /** Timestamp epoch (ms) minimal du début de sortie. */
  from?: number;
  /** Timestamp epoch (ms) maximal, exclu. */
  to?: number;
  /** Distance minimale en mètres (filtre appliqué côté client). */
  minDistanceM?: number;
  pageSize?: number;
  cursor?: ActivityQueryCursor | null;
}

export interface ActivityPageResult {
  items: ActivitySession[];
  cursor: ActivityQueryCursor | null;
  hasMore: boolean;
}

/**
 * Liste paginée des sorties (« Mes sorties »).
 *
 * Pagination stable : `orderBy(startedAt desc)` + curseur `(startedAt, id)`,
 * sans saut ni doublon, y compris quand plusieurs sorties partagent le même
 * horodatage.
 *
 * **Index composites.** Firestore exige un index composite dès qu'on combine
 * une égalité (`uid`, `type`), une inégalité (`startedAt`) et un tri. Ces index
 * sont déclarés dans `firestore.indexes.json`, mais un déploiement partiel (ou
 * un projet qui n'a pas reçu `firebase deploy --only firestore:indexes`) fait
 * échouer la requête avec « The query requires an index » — l'écran « Sortie
 * GPS » restait alors vide. La requête est donc tentée avec les filtres
 * complets, puis **dégradée automatiquement** sur la seule contrainte
 * `uid` + tri (index mono-champ automatique) avec filtrage en mémoire : les
 * résultats restent corrects, seule la consommation de lecture augmente.
 */
export async function listActivitySessionsPage(uid: string, filters: ActivityQueryFilters = {}): Promise<ActivityPageResult> {
  const pageSize = Math.min(50, Math.max(1, Math.floor(filters.pageSize || 20)));

  const build = (full: boolean): QueryConstraint[] => {
    const constraints: QueryConstraint[] = [where('uid', '==', uid)];
    if (full && filters.type) constraints.push(where('type', '==', filters.type));
    if (full && typeof filters.from === 'number') constraints.push(where('startedAt', '>=', filters.from));
    if (full && typeof filters.to === 'number') constraints.push(where('startedAt', '<', filters.to));
    constraints.push(orderBy('startedAt', 'desc'));
    // Deux valeurs au curseur : Firestore ajoute automatiquement `__name__` au
    // tri, donc ce couple reste stable sans `documentId()` explicite.
    if (filters.cursor) constraints.push(startAfter(filters.cursor.startedAt, filters.cursor.id));
    constraints.push(limit(pageSize + 1));
    return constraints;
  };

  let usedFullQuery = true;
  let snaps;
  try {
    snaps = await getDocs(query(collection(db, 'activitySessions'), ...build(true)));
  } catch (error) {
    if (!filters.type && typeof filters.from !== 'number' && typeof filters.to !== 'number') throw error;
    console.warn('[activités] index composite indisponible, filtrage local', (error as Error).message);
    usedFullQuery = false;
    snaps = await getDocs(query(collection(db, 'activitySessions'), ...build(false)));
  }

  const remaining = (item: ActivitySession) => {
    if (filters.type && item.type !== filters.type) return false;
    const startedAt = item.startedAt || 0;
    if (typeof filters.from === 'number' && startedAt < filters.from) return false;
    if (typeof filters.to === 'number' && startedAt >= filters.to) return false;
    if (filters.minDistanceM && (item.distanceM || 0) < filters.minDistanceM) return false;
    return true;
  };

  const docs = usedFullQuery
    ? snaps.docs
    : // La fenêtre lue est plus large quand le filtrage est local, pour ne pas
      // renvoyer une page vide alors que des sorties correspondantes existent.
      snaps.docs.slice(0, (pageSize + 1) * 6);

  const page = docs
    .map((d) => ({ id: d.id, ...(d.data() as ActivitySession) }))
    .filter(remaining);
  const hasMore = page.length > pageSize;
  const items = hasMore ? page.slice(0, pageSize) : page;
  const last = items[items.length - 1];
  return {
    items,
    cursor: last ? { startedAt: last.startedAt, id: last.id || '' } : null,
    hasMore,
  };
}

/**
 * Recherche « Mes sorties » sur le texte (titre / note / parcours).
 *
 * Firestore n'indexe pas les sous-chaînes : un filtre `title` textuel combiné
 * aux filtres de type et de période exigerait un index composite par
 * combinaison, d'où les erreurs « The query requires an index ». On lit donc
 * les seules sorties de l'utilisateur (requête simple, sans inégalité ni tri :
 * aucun index composite requis) puis on filtre en mémoire. Les tracés GPS ne
 * sont pas chargés par cette requête : la recherche reste légère.
 */
export async function searchActivitySessions(
  uid: string,
  term: string,
  options: { type?: ActivitySession['type']; from?: number; max?: number } = {}
): Promise<ActivitySession[]> {
  const needle = term.trim().toLocaleLowerCase('fr');
  if (needle.length < 2) return [];
  const constraints: QueryConstraint[] = [where('uid', '==', uid)];
  if (options.type) constraints.push(where('type', '==', options.type));
  // Une seule inégalité par requête : la période est filtrée en mémoire pour
  // rester compatible avec un filtre de type simultané sans index composite.
  constraints.push(limit(Math.min(500, Math.max(1, options.max || 300))));
  const snaps = await getDocs(query(collection(db, 'activitySessions'), ...constraints));
  return snaps.docs
    .map((d) => ({ id: d.id, ...(d.data() as ActivitySession) }))
    .filter((session) => {
      if (typeof options.from === 'number' && (session.startedAt || 0) < options.from) return false;
      const haystack = `${session.title || ''} ${session.note || ''} ${session.routeName || ''} ${session.type === 'run' ? 'course' : 'marche'}`.toLocaleLowerCase('fr');
      return haystack.includes(needle);
    })
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

export async function listActivitySessions(uid: string, count = 20): Promise<ActivitySession[]> {
  const snaps = await getDocs(query(
    collection(db, 'activitySessions'),
    where('uid', '==', uid),
    orderBy('startedAt', 'desc'),
    limit(Math.max(1, count)),
  ));
  return snaps.docs.map((d) => ({ id: d.id, ...(d.data() as ActivitySession) }));
}

// ============ Récompense publicitaire ============

export async function creditAdReward(uid: string): Promise<void> {
  const now = new Date();
  const slot = `${uid}_${dateStr(now)}_${String(now.getHours()).padStart(2, '0')}`;
  // Aucune condition de confirmation d'e-mail : la règle Firestore borne
  // seulement le rythme (une récompense par heure et par compte).
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
  // Retraits et dons : aucune condition de confirmation d'e-mail (2.2.5). La
  // règle Firestore vérifie seulement que le solde est débité du montant exact.
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
  await assertNotBlocked(me.uid, target.uid);
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
    // F12 — figé à l'envoi : une demande d'un compte bloqué n'est jamais lisible
    // (coût nul côté règle, pas de `get` par ligne).
    fromBlocked: false,
  } satisfies FriendRequest);
}

export function watchIncomingRequests(
  uid: string,
  cb: (reqs: FriendRequest[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe {
  const q = query(
    collection(db, 'friendRequests'),
    where('to', '==', uid),
    where('status', '==', 'pending')
  );
  return onSnapshot(
    q,
    (snaps) => {
      cb(snaps.docs.map((d) => ({ id: d.id, ...(d.data() as FriendRequest) })));
    },
    (error) => onError?.(error),
  );
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
      // F12 — `hiddenFor` est obligatoire à la création (règle Firestore) et
      // toujours vide : une amitié naissante n'est masquée pour personne.
      hiddenFor: [],
    } satisfies Friendship);
  }
}

/**
 * Abonnement à la liste d'amis.
 *
 * `onError` est indispensable : sans gestionnaire d'erreur, une règle refusée
 * laisse l'abonnement muet. L'écran restait alors en « chargement » permanent
 * (le callback n'était jamais appelé) — c'était le « les amis chargent en
 * boucle ». Le `catch` protège aussi la lecture des profils : une promesse
 * rejetée dans un callback `async` d'`onSnapshot` devenait un rejet non géré.
 */
export function watchFriendships(
  uid: string,
  cb: (friendUids: string[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe {
  const q = query(collection(db, 'friendships'), where('members', 'array-contains', uid));
  return onSnapshot(
    q,
    (snaps) => {
      try {
        const uids = snaps.docs
          // Une amitié masquée (blocage) ne disparaît pas du document : elle est
          // simplement ignorée, pour ne pas perdre l'historique de la relation.
          .filter((d) => !((d.data() as Friendship).hiddenFor || []).includes(uid))
          .map((d) => (d.data() as Friendship).members.find((m) => m !== uid))
          .filter((m): m is string => !!m);
        cb(Array.from(new Set(uids)));
      } catch (e) {
        onError?.(e);
      }
    },
    (error) => onError?.(error),
  );
}

export async function getProfiles(uids: string[]): Promise<UserProfile[]> {
  const results = await Promise.all(uids.map((u) => getUserProfile(u)));
  return results.filter((p): p is UserProfile => !!p);
}

// ============ Classement ============

/**
 * Classement des marcheurs.
 *
 * F07 — l'ancienne version prenait systématiquement le **top 50 par solde
 * d'ElyCoins** : un excellent marcheur (ou un ami) absent de ce groupe
 * n'apparaissait dans aucun classement de pas, et dépenser son solde faisait
 * changer le classement des pas. On interroge maintenant le champ de la métrique
 * choisie, ce qui garantit que le rang affiché correspond bien à ce qui est
 * mesuré.
 *
 * - `coins` : solde disponible (l'ancien comportement, nommé explicitement) ;
 * - `today` : pas du jour **à la date du jour**, vérifiée côté client ;
 * - `steps` : pas cumulés.
 *
 * Les métriques calculées sur plusieurs jours (7 et 30 jours) restent agrégées
 * à partir des documents quotidiens : un agrégat serveur n'existe pas encore et
 * ne peut pas être inventé côté client.
 */
export type LeaderboardMetric = 'coins' | 'today' | 'steps';

/**
 * Classement public.
 *
 * Deux pièges rencontrés en production, tous deux silencieux :
 *
 *  1. **Le budget d'appels de document d'une requête.** Firestore n'autorise
 *     que 10 appels `exists()`/`get()` par requête, pas par ligne. Une règle de
 *     liste qui vérifie le blocage coûte 2 appels par document évalué : au-delà
 *     de 5 résultats, la requête entière est refusée. L'écran se rabattait alors
 *     sur l'utilisateur courant, seul — « je ne vois pas les autres ».
 *  2. **Un profil qui refuse la lecture.** Un document dont les règles refusent
 *     la lecture fait échouer `getDocs` pour toute la requête.
 *
 * D'où une lecture en cascade : chaque étage est plus permissif que le
 * précédent, et le classement s'affiche dès qu'un étage passe. On remonte aussi
 * l'erreur réelle pour que l'écran puisse la montrer au lieu d'une liste vide.
 */
export async function getLeaderboard(top = 50, metric: LeaderboardMetric = 'coins'): Promise<UserProfile[]> {
  const field = metric === 'coins' ? 'elycoins' : metric === 'steps' ? 'totalSteps' : 'todaySteps';
  // La règle `users` plafonne une requête de collection à 200 documents : on
  // borne donc la demande, sinon Firestore refuse l'ensemble (et non la seule
  // page). L'écran demande 100, la règle autorise 200 : marge conservée.
  const pageSize = Math.min(Math.max(top, 1), 200);
  const users = collection(db, 'users');
  const attempts: Array<() => Promise<{ docs: Array<{ data: () => unknown }> }>> = [
    // 1. Chemin nominal : trié côté serveur, sans appel de document dans la règle.
    () => getDocs(query(users, orderBy(field, 'desc'), limit(pageSize))),
    // 2. Règle encore stricte, ou index mono-champ absent : même volume, sans tri.
    () => getDocs(query(users, limit(pageSize))),
    // 3. Plafond de la règle dépassé (déploiement antérieur) : petite page.
    () => getDocs(query(users, orderBy(field, 'desc'), limit(5))),
    () => getDocs(query(users, limit(20))),
  ];

  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      const snaps = await attempt();
      const rows = snaps.docs.map((d) => d.data() as UserProfile);
      const today = dateStr();
      return rows
        .filter((row) => !!row?.uid)
        .filter((row) => (metric === 'today' ? (row.todayDate || today) === today : true))
        .sort((a, b) => scoreOf(b, metric) - scoreOf(a, metric))
        .slice(0, top);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Classement indisponible.');
}

/** Valeur comparée pour une métrique donnée. */
export function scoreOf(user: UserProfile, metric: LeaderboardMetric): number {
  if (metric === 'coins') return user.elycoins || 0;
  if (metric === 'steps') return user.totalSteps || 0;
  return user.todaySteps || 0;
}

/**
 * Pas quotidiens d'un utilisateur.
 *
 * `count` est plafonné à 31 pour un profil tiers : la règle de liste des
 * `dailySteps` n'autorise une fenêtre plus large qu'au propriétaire, aux amis
 * vérifiés et aux présidents. Demander 370 jours sur le profil d'un inconnu
 * faisait refuser **toute** la requête (et donc vider les colonnes 7/30 jours du
 * classement). Le plafond est appliqué ici pour que l'appelant n'ait pas à
 * connaître les règles ; les écrans qui ont besoin de l'historique complet
 * (le sien) demandent `listMyDailySteps`.
 */
export async function listDailySteps(uid: string, count = 30): Promise<DailySteps[]> {
  const pageSize = Math.min(Math.max(count, 1), 31);
  const snaps = await getDocs(query(collection(db, 'users', uid, 'dailySteps'), orderBy('validatedAt', 'desc'), limit(pageSize)));
  return snaps.docs.map(d => ({ date: d.id, ...(d.data() as Omit<DailySteps, 'date'>) })).reverse();
}

/** Historique complet **du propriétaire** (page d'historique, export, migration). */
export async function listMyDailySteps(uid: string, count = 370): Promise<DailySteps[]> {
  const snaps = await getDocs(query(collection(db, 'users', uid, 'dailySteps'), orderBy('validatedAt', 'desc'), limit(count)));
  return snaps.docs.map(d => ({ date: d.id, ...(d.data() as Omit<DailySteps, 'date'>) })).reverse();
}

/** Meilleure série **réellement** atteinte (F07) — calcul pur dans `streak.ts`. */
export async function getBestStreak(uid: string, days = 370): Promise<number> {
  // Historique du propriétaire : la règle autorise ici une fenêtre large.
  const history = await listMyDailySteps(uid, days).catch(() => [] as DailySteps[]);
  return computeBestStreak(history.map((d) => d.date));
}

export function watchOutgoingRequests(
  uid: string,
  cb: (reqs: FriendRequest[]) => void,
  onError?: (error: unknown) => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(db, 'friendRequests'), where('from', '==', uid), where('status', '==', 'pending')),
    (s) => cb(s.docs.map((d) => ({ id: d.id, ...(d.data() as FriendRequest) }))),
    (error) => onError?.(error),
  );
}

/**
 * Recherche par nom d'affichage.
 *
 * Firestore ne sait pas faire de recherche « contient ». L'ancienne version
 * lisait les 50 premiers profils triés par nom — donc un sous-ensemble presque
 * toujours vide de résultat et une lecture de collection complète. On balaye
 * désormais par pages de 200, en partant d'un curseur placé autour du préfixe
 * saisi (`startAt(term)`), avec un plafond explicite de pages : la requête reste
 * bornée et l'index `displayName` est utilisé.
 */
export async function searchUsersByName(name: string): Promise<UserProfile[]> {
  const term = name.trim();
  if (term.length < 2) return [];
  const lowered = term.toLocaleLowerCase('fr');
  const matches: UserProfile[] = [];
  let cursor: QueryDocumentSnapshot | null = null;
  for (let page = 0; page < 5 && matches.length < 10; page += 1) {
    const constraints: QueryConstraint[] = [orderBy('displayName')];
    if (page === 0) constraints.push(startAt(term));
    else if (cursor) constraints.push(startAfter(cursor));
    constraints.push(limit(200));
    const snaps = await getDocs(query(collection(db, 'users'), ...constraints));
    for (const d of snaps.docs) {
      const p = d.data() as UserProfile;
      if ((p.displayName || '').toLocaleLowerCase('fr').includes(lowered)) matches.push(p);
      if (matches.length >= 10) break;
    }
    if (snaps.docs.length < 200) break;
    cursor = snaps.docs[snaps.docs.length - 1];
  }
  return matches;
}

export async function sendFriendReaction(from: UserProfile, toUid: string, emoji: string, message = ''): Promise<void> {
  await assertNotBlocked(from.uid, toUid);
  if (!['👏','🔥','💛','👋'].includes(emoji)) throw new Error('Réaction invalide.');
  await addDoc(collection(db, 'friendReactions'), { from: from.uid, fromName: from.displayName, to: toUid, emoji, message: message.slice(0, 160), createdAt: Date.now() });
}

export interface ReceivedReaction {
  id: string;
  /** Auteur de l'encouragement — pour pouvoir lui répondre (A8). */
  from: string;
  fromName: string;
  emoji: string;
  message: string;
  createdAt?: number;
}

export function watchFriendReactions(
  uid: string,
  cb: (items: ReceivedReaction[]) => void,
  onError?: (error: unknown) => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(db, 'friendReactions'), where('to', '==', uid), limit(20)),
    (s) => cb(
      s.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<ReceivedReaction, 'id'>) }))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    ),
    (error) => onError?.(error),
  );
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

/**
 * F03 — export et suppression passent par `lib/account.ts`, qui porte
 * l'inventaire complet des collections, la pagination par curseur et la
 * reprise après panne. Les anciennes versions de ces fonctions (plafonnées à
 * 1 000 sorties / 50 transactions, oubliant messages, badges, fil, parcours)
 * sont supprimées : un seul chemin fait foi.
 */
export async function exportAccountData(uid: string): Promise<Record<string, unknown>> {
  return exportAccountComplete(uid) as unknown as Record<string, unknown>;
}

export async function deleteAccountData(uid: string, onProgress?: (label: string) => void): Promise<void> {
  await purgeAccountData(uid, (p) => onProgress?.(p.step));
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
    // F12 — audience portée par le document : la règle de liste ne peut pas
    // vérifier l'amitié ni le blocage ligne par ligne (10 appels de document au
    // total). Le fil est de fait réservé aux amis, et le client retire les
    // comptes bloqués de la liste d'amis qui l'alimente.
    audience: 'friends',
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
    // Gestionnaire d'erreur obligatoire : sans lui, un refus de règle laissait
    // le fil vide sans explication (et l'écran en chargement).
    feedUnsub = onSnapshot(q, snap=>{
      try {
        const items=snap.docs.map(d=>({id:d.id,...(d.data() as ActivityFeedItem)}));
        items.sort((a,b)=>b.createdAt-a.createdAt);
        cb(items);
      } catch { cb([]); }
    }, () => cb([]));
  }, () => cb([]));
  return ()=>{ unsubFriends(); if(feedUnsub) feedUnsub(); };
}

// ============ Défis entre amis ============
export async function createFriendChallenge(creator: UserProfile, opts: { title: string; target: number; metric?: 'steps'|'distance'; participantUids: string[]; days?: number }): Promise<string> {
  const days = opts.days || 7;
  const start = dateStr(new Date());
  const endDate = new Date(); endDate.setDate(endDate.getDate()+days);
  const end = dateStr(endDate);
  const allParticipants = Array.from(new Set([creator.uid, ...opts.participantUids]));
  for (const participant of opts.participantUids) await assertNotBlocked(creator.uid, participant);
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
    // Fenêtre bornée à 31 jours (plafond de lecture pour le profil d'un tiers) :
    // un défi entre amis dure au plus quelques semaines.
    const days = await listDailySteps(uid, 31);
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

// ============ Notes privées (F01) ============
//
// La note libre était enregistrée dans le document `activitySessions`, donc
// renvoyée à tout lecteur autorisé de la sortie (amis, lien). Elle est
// désormais stockée dans une sous-collection lisible par le seul propriétaire :
// `users/{uid}/privateActivityNotes/{sessionId}`. Le champ `note` n'est plus
// écrit dans la sortie ; il n'est lu que pour migrer les documents existants.
//
// Rappel : Firestore ne supprime pas les sous-collections avec le document
// parent — la suppression de compte les efface explicitement (voir
// `deleteAccountData`).

/** Lit la note privée d'une sortie, avec repli sur l'ancien champ `note`. */
export async function getPrivateActivityNote(uid: string, sessionId: string, legacyNote?: string): Promise<string> {
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'privateActivityNotes', sessionId));
    if (snap.exists()) return String((snap.data() as { note?: string }).note || '');
  } catch {
    /* repli ci-dessous */
  }
  return legacyNote || '';
}

/** Enregistre la note privée et **retire** `note` du document partageable. */
export async function setPrivateActivityNote(uid: string, sessionId: string, note: string): Promise<void> {
  const clean = note.trim().slice(0, 500);
  await setDoc(
    doc(db, 'users', uid, 'privateActivityNotes', sessionId),
    { note: clean, sessionId, updatedAt: Date.now() },
    { merge: true }
  );
  // Les clients anciens relisaient `note` : on le supprime du document partagé.
  await updateDoc(doc(db, 'activitySessions', sessionId), { note: deleteField() } as unknown as Record<string, unknown>).catch(
    () => undefined
  );
}

/**
 * Migration des documents existants : déplace les notes présentes dans les
 * sorties vers la sous-collection privée. Idempotent — une note déjà migrée
 * n'est pas réécrite. À lancer une fois après déploiement (bouton du profil,
 * ou script d'administration).
 */
/**
 * Migre les notes héritées (`activitySessions.note`) vers les notes privées.
 *
 * Le nettoyage du champ hérité passe par `deleteField()` : il fait partie de la
 * requête de mise à jour, mais les règles n'autorisent pas la suppression du
 * champ par le client. L'opération est donc « au mieux », et la fonction
 * retourne explicitement le nombre de sorties dont le champ n'a pas pu être
 * retiré (`residual`), pour que l'administration sache qu'un nettoyage serveur
 * reste nécessaire — plutôt que d'afficher un succès trompeur.
 */
export async function migratePrivateNotes(uid: string): Promise<{ migrated: number; scanned: number; residual: number }> {
  const snaps = await getDocs(query(collection(db, 'activitySessions'), where('uid', '==', uid), limit(300)));
  let migrated = 0;
  let residual = 0;
  for (const session of snaps.docs) {
    const data = session.data() as ActivitySession;
    const legacy = ((data as unknown as { note?: string }).note || '').trim();
    if (!legacy) continue;
    const noteRef = doc(db, 'users', uid, 'privateActivityNotes', session.id);
    const existing = await getDoc(noteRef).catch(() => null);
    if (!existing?.exists()) {
      await setDoc(noteRef, { note: legacy.slice(0, 500), sessionId: session.id, updatedAt: Date.now(), migratedFrom: 'activitySessions' });
      migrated += 1;
    }
    try {
      await updateDoc(session.ref, { note: deleteField() } as unknown as Record<string, unknown>);
    } catch {
      residual += 1;
    }
  }
  return { migrated, scanned: snaps.docs.length, residual };
}

// ============ Partage par lien révocable (F01) ============
//
// L'audience « Lien » n'avait aucun secret de partage : la sortie devenait
// lisible par tout utilisateur authentifié. Un lien est désormais matérialisé
// par un document `shareLinks/<sessionId>_<uid>` — identifiant déterministe,
// donc vérifiable par une règle sans requête sur un champ :
//   • le document ne contient qu'un **résumé** (titre, date, distance, durée,
//     légende) : jamais le tracé GPS ;
//   • il est lisible publiquement (un lien partagé doit s'ouvrir, même pour
//     quelqu'un sans compte) ;
//   • sa suppression révoque l'accès immédiatement, y compris pour l'API ;
//   • le tracé complet n'est servi qu'aux audiences `private` / `friends`, dont
//     l'amitié est vérifiée côté serveur.
//
// Le jeton aléatoire reste présent : il rend l'URL non devinable côté client.

function randomToken(length = 24): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes).map((b) => alphabet[b % alphabet.length]).join('');
}

/** Identifiant déterministe du document de partage d'une sortie. */
export function shareLinkDocId(sessionId: string, uid: string): string {
  return `${sessionId}_${uid}`;
}

/**
 * Crée (ou renvoie) le lien révocable d'une sortie.
 *
 * Le document de partage ne publie qu'un résumé : c'est le prix d'un lien
 * ouvrable sans compte. Le tracé reste couvert par l'audience déclarée de la
 * sortie, elle-même vérifiée côté serveur.
 */
/**
 * Identifiant de lien **adressable par la seule sortie**.
 *
 * Avant, le document s'appelait `<sessionId>_<uid>` : impossible de le lire à
 * partir de l'URL publique `/s/<sessionId>?t=<token>`, puisque l'UID du
 * propriétaire n'y figure pas. Le document porte maintenant l'identifiant de la
 * sortie, ce qui rend la page publique possible **sans** exposer d'UID. Un
 * second document au format historique reste écrit pour ne rien casser.
 */
export function publicShareLinkDocId(sessionId: string): string {
  return sessionId;
}

/** Centre approximatif + rayon : aperçu de carte d'un lien public. */
function previewArea(session: ActivitySession): { centerLat?: number; centerLng?: number; radiusM?: number } {
  const points = (session.points || []).filter(
    (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng),
  );
  if (!points.length) return {};
  const lat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  const lng = points.reduce((sum, p) => sum + p.lng, 0) / points.length;
  const spread = points.reduce((max, p) => Math.max(max, Math.abs(p.lat - lat) + Math.abs(p.lng - lng)), 0);
  // Précision volontairement grossière : le lien ne permet pas de reconstituer
  // le tracé, seulement de situer la balade.
  return {
    centerLat: Math.round(lat * 1000) / 1000,
    centerLng: Math.round(lng * 1000) / 1000,
    radiusM: Math.max(300, Math.round(((spread * 111_000) + 0.5 * (session.distanceM || 0)) / 100) * 100),
  };
}

export async function createActivityShareLink(
  uid: string,
  sessionId: string,
  scope: ShareLink['scope'] = 'summary'
): Promise<ShareLink> {
  const sessionRef = doc(db, 'activitySessions', sessionId);
  const sessionSnap = await getDoc(sessionRef);
  if (!sessionSnap.exists()) throw new Error('Sortie introuvable.');
  const session = sessionSnap.data() as ActivitySession;
  if (session.uid !== uid) throw new Error('Non autorisé.');

  // Lien public (identifiant = sortie) : c'est lui que l'écran partage.
  const publicRef = doc(db, 'shareLinks', publicShareLinkDocId(sessionId));
  const legacyRef = doc(db, 'shareLinks', shareLinkDocId(sessionId, uid));
  const existing = await getDoc(publicRef).catch(() => null);
  const legacyExisting = await getDoc(legacyRef).catch(() => null);

  if (existing?.exists()) {
    const data = existing.data() as ShareLink;
    if (!data.expiresAt || data.expiresAt > Date.now()) {
      return { ...data, id: publicRef.id, revoked: false };
    }
  }

  const link: Omit<ShareLink, 'id'> = {
    sessionId,
    ownerUid: uid,
    // Jeton réutilisé s'il existe (un lien déjà envoyé continue de fonctionner).
    token: (existing?.data() as ShareLink | undefined)?.token
      || (legacyExisting?.data() as ShareLink | undefined)?.token
      || randomToken(),
    scope,
    revoked: false,
    createdAt: Date.now(),
    expiresAt: null,
  };
  const owner = await getUserProfile(uid).catch(() => null);
  const summary: Record<string, unknown> = {
    sessionId,
    ownerUid: uid,
    token: link.token,
    scope: link.scope,
    revoked: false,
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    // Résumé partageable — aucun tracé GPS, seulement un aperçu de zone.
    title: session.title || session.routeName || 'Sortie ElyWalk',
    caption: session.caption || '',
    type: session.type,
    startedAt: session.startedAt,
    durationSec: session.durationSec,
    distanceM: session.distanceM,
    calories: session.calories,
    steps: session.steps || 0,
    ownerName: owner?.displayName || '',
    ...previewArea(session),
  };
  await setDoc(publicRef, summary);
  // Compatibilité : les liens émis avant la 2.2.4 pointent encore sur cet id.
  await setDoc(legacyRef, summary).catch(() => undefined);
  await updateDoc(sessionRef, { visibility: 'link' });
  return { id: publicRef.id, ...link };
}

/** Révoque un lien : il cesse immédiatement de fonctionner (règle serveur incluse). */
export async function revokeActivityShareLink(uid: string, sessionId: string): Promise<void> {
  const sessionSnap = await getDoc(doc(db, 'activitySessions', sessionId));
  if (!sessionSnap.exists()) return;
  if ((sessionSnap.data() as ActivitySession).uid !== uid) throw new Error('Non autorisé.');
  // Suppression des deux représentations : le lien cesse immédiatement de
  // fonctionner, y compris pour une page publique déjà ouverte.
  await deleteDoc(doc(db, 'shareLinks', publicShareLinkDocId(sessionId))).catch(() => undefined);
  await deleteDoc(doc(db, 'shareLinks', shareLinkDocId(sessionId, uid))).catch(() => undefined);
  await updateDoc(doc(db, 'activitySessions', sessionId), { visibility: 'private' });
}

/** Lien actif d'une sortie (ou `null`). */
export async function listActivityShareLinks(uid: string, sessionId: string): Promise<ShareLink[]> {
  const snap = await getDoc(doc(db, 'shareLinks', publicShareLinkDocId(sessionId))).catch(() => null);
  if (snap?.exists()) return [{ ...(snap.data() as ShareLink), id: snap.id }];
  const legacy = await getDoc(doc(db, 'shareLinks', shareLinkDocId(sessionId, uid))).catch(() => null);
  if (!legacy?.exists()) return [];
  return [{ ...(legacy.data() as ShareLink), id: legacy.id }];
}

/** Résumé public d'une sortie partagée (page `/s/:sessionId`, sans compte). */
export interface SharedActivitySummary {
  sessionId: string;
  ownerUid: string;
  ownerName: string;
  token: string;
  title: string;
  caption?: string;
  type: ActivitySession['type'];
  startedAt: number;
  durationSec: number;
  distanceM: number;
  calories?: number;
  steps?: number;
  centerLat?: number;
  centerLng?: number;
  radiusM?: number;
  expiresAt?: number | null;
  revoked?: boolean;
}

/**
 * Lit un lien public **sans connaître le propriétaire** (A7).
 *
 * Aucune authentification n'est nécessaire : la règle Firestore autorise la
 * lecture par identifiant de `shareLinks/{sessionId}`. Le jeton de l'URL est
 * comparé ici : un identifiant de sortie seul ne suffit pas à ouvrir le
 * résumé. Renvoie `null` pour un lien révoqué, expiré ou inconnu, afin que la
 * page affiche « lien expiré » plutôt qu'une erreur de permission brute.
 */
export async function getSharedActivityBySession(
  sessionId: string,
  token?: string | null,
): Promise<SharedActivitySummary | null> {
  if (!sessionId) return null;
  const snap = await getDoc(doc(db, 'shareLinks', publicShareLinkDocId(sessionId))).catch(() => null);
  if (!snap?.exists()) return null;
  const data = snap.data() as SharedActivitySummary & { expiresAt?: number | null };
  if (data.expiresAt && data.expiresAt < Date.now()) return null;
  if (token && data.token && token !== data.token) return null;
  return { ...data, sessionId: data.sessionId || sessionId };
}

/**
 * Lit un lien partagé (public, sans compte). Retourne `null` si le lien a été
 * révoqué ou s'il a expiré — l'écran affiche alors « lien révoqué » plutôt
 * qu'une erreur de permission brute.
 */
export async function getSharedActivity(sessionId: string, ownerUid: string): Promise<Record<string, unknown> | null> {
  const snap = await getDoc(doc(db, 'shareLinks', shareLinkDocId(sessionId, ownerUid))).catch(() => null);
  if (!snap?.exists()) return null;
  const data = snap.data() as ShareLink & { expiresAt?: number | null };
  if (data.expiresAt && data.expiresAt < Date.now()) return null;
  return { id: snap.id, ...data };
}

/**
 * Vérifie qu'une audience est réellement satisfaite avant de renvoyer un
 * contenu partagé — la règle Firestore fait de même, ce contrôle évite une
 * lecture inutile et un message d'erreur brut côté écran.
 */
export async function assertAudienceAllows(requesterUid: string, ownerUid: string, audience: string): Promise<void> {
  if (requesterUid === ownerUid) return;
  if (audience === 'friends') {
    const friendships = await getDocs(query(collection(db, 'friendships'), where('members', 'array-contains', requesterUid)));
    const isFriend = friendships.docs.some((d) => ((d.data() as Friendship).members || []).includes(ownerUid));
    if (!isFriend) throw new Error('Cette sortie est réservée aux amis de son auteur.');
    return;
  }
  if (audience === 'link') return; // le lien est vérifié côté règles
  throw new Error('Cette sortie est privée.');
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
// ============ Réactions et commentaires du fil (A8) ============
//
// Constat : le fil d'activité affichait des lignes passives, sans aucune action
// (0 occurrence de kudos / commentaire). Ces deux collections ajoutent
// l'interaction minimale attendue dans un fil social :
//   • `feedReactions/<itemId>_<uid>` — un 👏 par personne et par élément
//     (identifiant déterministe : impossible de voter deux fois) ;
//   • `feedComments/<auto>` — commentaires de 200 caractères maximum, modérés
//     comme les messages (bouton « Signaler » déjà branché).

export interface FeedReaction {
  id?: string;
  itemId: string;
  uid: string;
  name: string;
  createdAt: number;
}

export interface FeedComment {
  id?: string;
  itemId: string;
  uid: string;
  name: string;
  text: string;
  createdAt: number;
}

/** Ajoute ou retire mon 👏 sur un élément du fil. Renvoie l'état final. */
export async function toggleFeedKudos(itemId: string, me: UserProfile): Promise<boolean> {
  if (!itemId) throw new Error('Élément inconnu.');
  const ref = doc(db, 'feedReactions', `${itemId}_${me.uid}`);
  const snap = await getDoc(ref).catch(() => null);
  if (snap?.exists()) {
    await deleteDoc(ref);
    return false;
  }
  await setDoc(ref, {
    itemId,
    uid: me.uid,
    name: me.displayName,
    createdAt: Date.now(),
  } satisfies FeedReaction);
  return true;
}

/** Réactions des éléments affichés (groupées par identifiant d'élément). */
export function watchFeedReactions(
  itemIds: string[],
  cb: (byItem: Record<string, FeedReaction[]>) => void,
  onError?: (error: unknown) => void,
): Unsubscribe {
  const ids = [...new Set(itemIds.filter(Boolean))].slice(0, 10);
  if (!ids.length) {
    cb({});
    return () => undefined;
  }
  return onSnapshot(
    query(collection(db, 'feedReactions'), where('itemId', 'in', ids), limit(300)),
    (snap) => {
      const grouped: Record<string, FeedReaction[]> = {};
      for (const d of snap.docs) {
        const reaction = { id: d.id, ...(d.data() as FeedReaction) };
        (grouped[reaction.itemId] = grouped[reaction.itemId] || []).push(reaction);
      }
      cb(grouped);
    },
    (error) => onError?.(error),
  );
}

/** Commentaire court (≤ 200 caractères), borné côté client et côté règles. */
export async function addFeedComment(
  item: Pick<ActivityFeedItem, 'id' | 'uid' | 'displayName'>,
  me: UserProfile,
  text: string,
): Promise<void> {
  const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!clean) throw new Error('Écrivez un commentaire.');
  if (!item.id) throw new Error('Élément inconnu.');
  await assertNotBlocked(me.uid, item.uid);
  await addDoc(collection(db, 'feedComments'), {
    itemId: item.id,
    uid: me.uid,
    name: me.displayName,
    text: clean,
    createdAt: Date.now(),
  } satisfies FeedComment);
}

export async function deleteFeedComment(comment: FeedComment): Promise<void> {
  if (!comment.id) return;
  await deleteDoc(doc(db, 'feedComments', comment.id));
}

/** Commentaires des éléments affichés (groupés par élément). */
export function watchFeedComments(
  itemIds: string[],
  cb: (byItem: Record<string, FeedComment[]>) => void,
  onError?: (error: unknown) => void,
): Unsubscribe {
  const ids = [...new Set(itemIds.filter(Boolean))].slice(0, 10);
  if (!ids.length) {
    cb({});
    return () => undefined;
  }
  return onSnapshot(
    query(collection(db, 'feedComments'), where('itemId', 'in', ids), limit(300)),
    (snap) => {
      const grouped: Record<string, FeedComment[]> = {};
      for (const d of snap.docs) {
        const comment = { id: d.id, ...(d.data() as FeedComment) };
        (grouped[comment.itemId] = grouped[comment.itemId] || []).push(comment);
      }
      for (const key of Object.keys(grouped)) grouped[key].sort((a, b) => a.createdAt - b.createdAt);
      cb(grouped);
    },
    (error) => onError?.(error),
  );
}

/**
 * Accusé de lecture d'une conversation (A8) : seuls les messages **reçus** non
 * lus passent à `read: true`, par lots de 400 (limite Firestore : 500
 * écritures par batch).
 */
export async function markConversationRead(uid: string, friendUid: string): Promise<number> {
  const snaps = await getDocs(
    query(
      collection(db, 'directMessages'),
      where('from', '==', friendUid),
      where('to', '==', uid),
      orderBy('createdAt', 'desc'),
      limit(200),
    ),
  );
  const unread = snaps.docs.filter((d) => !(d.data() as DirectMessage).read);
  if (!unread.length) return 0;
  for (let index = 0; index < unread.length; index += 400) {
    const batch = writeBatch(db);
    for (const document of unread.slice(index, index + 400)) {
      batch.update(document.ref, { read: true });
    }
    await batch.commit();
  }
  return unread.length;
}

export function getFriendCodeShareUrl(code: string): string {
  // Domaine public : dans la WebView Capacitor, `location.origin` vaut
  // `https://localhost`, lien inutilisable une fois partagé (F11).
  return `https://elywalk-2f7ba.web.app/?ref=${encodeURIComponent(String(code).toUpperCase())}`;
}

// ============ Messagerie légère ============
export async function sendDirectMessage(from: UserProfile, toUid: string, text: string, activityId?: string): Promise<void> {
  const t = text.trim().slice(0,500);
  if (!t) throw new Error('Message vide');
  await assertNotBlocked(from.uid, toUid);
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
    // F12 — figé à l'envoi (voir `FriendRequest.fromBlocked`).
    fromBlocked: false,
  } satisfies DirectMessage);
}
export function watchDirectMessages(uid: string, friendUid: string, cb: (msgs: DirectMessage[])=>void): Unsubscribe {
  // Deux requêtes (sens A→B et B→A), triées par le serveur sur `createdAt` :
  // une limite sans ordre temporel renvoyait des documents arbitraires, dont
  // les plus récents pouvaient être absents (F08).
  const q1 = query(collection(db,'directMessages'), where('from','==',uid), where('to','==',friendUid), orderBy('createdAt','asc'), limit(100));
  const q2 = query(collection(db,'directMessages'), where('from','==',friendUid), where('to','==',uid), orderBy('createdAt','asc'), limit(100));
  let m1: DirectMessage[]=[]; let m2: DirectMessage[]=[];
  const emit=()=>cb([...m1,...m2].sort((a,b)=>a.createdAt-b.createdAt));
  const u1=onSnapshot(q1, s=>{ m1=s.docs.map(d=>({id:d.id,...(d.data() as DirectMessage)})); emit(); }, () => undefined);
  const u2=onSnapshot(q2, s=>{ m2=s.docs.map(d=>({id:d.id,...(d.data() as DirectMessage)})); emit(); }, () => undefined);
  return ()=>{u1();u2();};
}
/**
 * Derniers messages reçus/émis, **triés par le serveur**.
 *
 * Avant : `limit(100)` sans `orderBy`, puis tri en mémoire — les messages
 * au-delà des 100 premiers documents (ordre arbitraire de Firestore) étaient
 * donc perdus, et la liste affichée n'était pas chronologique (F08).
 */
export async function listRecentMessages(uid: string, limitCount = 20): Promise<DirectMessage[]> {
  const perBox = Math.max(1, Math.min(100, limitCount));
  const [sent, received] = await Promise.all([
    getDocs(query(collection(db, 'directMessages'), where('from', '==', uid), orderBy('createdAt', 'desc'), limit(perBox))),
    getDocs(query(collection(db, 'directMessages'), where('to', '==', uid), orderBy('createdAt', 'desc'), limit(perBox))),
  ]);
  const merged = new Map<string, DirectMessage>();
  for (const d of [...sent.docs, ...received.docs]) merged.set(d.id, { id: d.id, ...(d.data() as DirectMessage) });
  return [...merged.values()].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).slice(-perBox);
}

/**
 * Écoute de la boîte de réception, sans limite arbitraire de 10 documents.
 * Le tri est fait par le serveur sur `createdAt` (index `to + createdAt`).
 */
export function watchRecentMessages(uid:string, cb:(msgs:DirectMessage[])=>void):Unsubscribe{
  const emit = (a: DirectMessage[], b: DirectMessage[]) => {
    const merged = new Map<string, DirectMessage>();
    for (const m of [...a, ...b]) merged.set(m.id!, m);
    cb([...merged.values()].sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0)));
  };
  let sent: DirectMessage[] = [];
  let received: DirectMessage[] = [];
  const u1 = onSnapshot(
    query(collection(db,'directMessages'), where('from','==',uid), orderBy('createdAt','desc'), limit(50)),
    (s) => { sent = s.docs.map(d=>({id:d.id,...(d.data() as DirectMessage)})); emit(sent, received); },
    () => undefined,
  );
  const u2 = onSnapshot(
    query(collection(db,'directMessages'), where('to','==',uid), orderBy('createdAt','desc'), limit(50)),
    (s) => { received = s.docs.map(d=>({id:d.id,...(d.data() as DirectMessage)})); emit(sent, received); },
    () => undefined,
  );
  return () => { u1(); u2(); };
}

/**
 * Conversation avec un ami : **une seule** écoute active à la fois.
 *
 * L'ouverture d'une conversation empilait un abonnement sans jamais le
 * fermer : en alternant rapidement entre deux amis, plusieurs écoutes restaient
 * actives et la feuille affichait les messages du mauvais interlocuteur (F08).
 * `openDirectConversation` renvoie une fonction de désabonnement que l'écran
 * appelle avant d'ouvrir la conversation suivante.
 */
export function openDirectConversation(
  uid: string,
  friendUid: string,
  cb: (msgs: DirectMessage[]) => void
): Unsubscribe {
  return watchDirectMessages(uid, friendUid, cb);
}

export async function createCommunityEvent(creator: UserProfile, data: { title:string; description:string; establishmentId?:string; establishmentName?:string; location?:string; lat?:number; lng?:number; date:string; time?:string; maxParticipants?:number | null }): Promise<string> {
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
    waitlist: [],
    maxParticipants: data.maxParticipants ?? null,
    status: 'scheduled',
    createdAt: Date.now(),
  } as unknown as CommunityEvent);
  await createFeedItem(creator,'friend',`a créé l’événement « ${data.title} »`, { eventId: ref.id }).catch(()=>undefined);
  return ref.id;
}
/**
 * Rencontres à venir, triées par date croissante.
 *
 * F09 — l'ancienne requête prenait les vingt premières dates **sans filtre
 * futur** : après quelques mois d'utilisation, des sorties passées occupaient
 * toute la fenêtre et les événements à venir n'apparaissaient plus. On borne
 * désormais la requête à la date du jour (`date` est un `YYYY-MM-DD`, donc
 * comparable lexicalement) et on pagine par curseur.
 */
export interface CommunityEventsPage {
  items: CommunityEvent[];
  cursor: string | null;
  hasMore: boolean;
  /** Les événements passés sont demandés explicitement, jamais par défaut. */
  scope: 'upcoming' | 'past';
}

export async function listCommunityEventsPage(options: {
  scope?: 'upcoming' | 'past';
  pageSize?: number;
  cursor?: string | null;
  today?: string;
} = {}): Promise<CommunityEventsPage> {
  const scope = options.scope || 'upcoming';
  const pageSize = Math.min(50, Math.max(1, Math.floor(options.pageSize || 20)));
  const today = options.today || dateStr();
  const constraints: QueryConstraint[] = [];
  if (scope === 'upcoming') {
    constraints.push(where('date', '>=', today), orderBy('date', 'asc'), orderBy('__name__', 'asc'));
  } else {
    constraints.push(where('date', '<', today), orderBy('date', 'desc'), orderBy('__name__', 'desc'));
  }
  if (options.cursor) constraints.push(startAfter(options.cursor));
  constraints.push(limit(pageSize + 1));
  const snaps = await getDocs(query(collection(db, 'communityEvents'), ...constraints));
  const hasMore = snaps.docs.length > pageSize;
  const docs = hasMore ? snaps.docs.slice(0, pageSize) : snaps.docs;
  return {
    items: docs.map((d) => ({ id: d.id, ...(d.data() as CommunityEvent) })),
    cursor: docs.length ? docs[docs.length - 1].id : null,
    hasMore,
    scope,
  };
}

/** Liste simple (compatibilité) : les prochaines rencontres. */
export async function listCommunityEvents(limitCount=20): Promise<CommunityEvent[]> {
  const page = await listCommunityEventsPage({ pageSize: limitCount });
  return page.items;
}

/**
 * Écoute les rencontres **à venir**. La borne `date >= aujourd'hui` évite de
 * charger l'historique complet, et la limite reste large : le filtrage par vue
 * (à venir / mes inscriptions / passées) se fait côté écran sur ces documents.
 */
export function watchCommunityEvents(cb:(items:CommunityEvent[])=>void):Unsubscribe{
  const today = dateStr();
  return onSnapshot(
    query(collection(db,'communityEvents'), where('date','>=', today), orderBy('date','asc'), limit(200)),
    snap=>cb(snap.docs.map(d=>({id:d.id,...(d.data() as CommunityEvent)}))),
    (error) => {
      // Repli sans index composite : on écoute les 200 documents triés par date
      // et on filtre la date côté client plutôt que de laisser un écran vide.
      console.warn('[events] écoute bornée impossible, repli local', error?.message);
      onSnapshot(query(collection(db,'communityEvents'), orderBy('date','asc'), limit(200)), (all) => {
        const items = all.docs
          .map(d=>({id:d.id,...(d.data() as CommunityEvent)}))
          .filter(ev => !ev.date || ev.date >= today);
        cb(items);
      });
    },
  );
}
export async function joinCommunityEvent(uid:string, eventId:string):Promise<'joined'|'waitlisted'>{
  const ref=doc(db,'communityEvents',eventId);
  return runTransaction(db, async tx => {
    const snap=await tx.get(ref);
    if(!snap.exists()) throw new Error('Événement introuvable');
    const ev=snap.data() as CommunityEvent;
    if(ev.status === 'cancelled') throw new Error('Cet événement est annulé.');
    // L'organisateur participe toujours à sa propre sortie (règle Firestore) :
    // une nouvelle inscription ne doit pas le mettre en liste d'attente.
    if(ev.creatorUid === uid) return 'joined' as const;
    await assertNotBlocked(uid, ev.creatorUid);
    if(ev.participants.includes(uid)) return 'joined' as const;
    if((ev.waitlist || []).includes(uid)) return 'waitlisted' as const;
    const full=!!ev.maxParticipants && ev.participants.length>=ev.maxParticipants;
    if(full) tx.update(ref,{ waitlist: [...(ev.waitlist || []), uid] });
    else tx.update(ref,{ participants: [...ev.participants, uid] });
    return full ? 'waitlisted' as const : 'joined' as const;
  });
}
export async function leaveCommunityEvent(uid:string, eventId:string):Promise<void>{
  const ref=doc(db,'communityEvents',eventId);
  await runTransaction(db, async tx => {
    const snap=await tx.get(ref);
    if(!snap.exists()) return;
    const ev=snap.data() as CommunityEvent;
    // L'organisateur ne peut pas quitter sa propre sortie (il en est le
    // premier participant) : l'interface ne lui propose d'ailleurs pas.
    if (ev.creatorUid === uid) return;
    let waitlist=(ev.waitlist || []).filter(p=>p!==uid);
    let participants=ev.participants.filter(p=>p!==uid);
    // La première personne en attente est promue atomiquement dès qu'une place se libère.
    if(ev.participants.includes(uid) && ev.participants.length===ev.maxParticipants && waitlist.length>0) {
      participants=[...participants, waitlist[0]];
      waitlist=waitlist.slice(1);
    }
    tx.update(ref,{ participants, waitlist });
  });
}

export async function updateCommunityEvent(uid:string, eventId:string, changes:{title?:string;description?:string;location?:string;lat?:number;lng?:number;date?:string;time?:string;status?:'scheduled'|'cancelled';message?:string}):Promise<void>{
  const ref=doc(db,'communityEvents',eventId);
  const recipients=await runTransaction(db, async tx => {
    const snap=await tx.get(ref);
    if(!snap.exists()) throw new Error('Événement introuvable');
    const ev=snap.data() as CommunityEvent;
    if(ev.creatorUid!==uid) throw new Error('Seul l’organisateur peut modifier cet événement.');
    const cancelled=changes.status==='cancelled';
    const { message: _message, ...fields } = changes;
    tx.update(ref,{...fields,lastChange:{type:cancelled?'cancelled':'updated',message:(changes.message||'Les informations de la sortie ont changé.').slice(0,300),createdAt:Date.now()},updatedAt:Date.now()});
    return ev.participants.filter(p=>p!==uid);
  });
  // Documents consommés par le worker FCM ; aucun accès aux jetons depuis le client.
  for(const toUid of recipients) await addDoc(collection(db,'eventNotifications'),{eventId,toUid,type:changes.status==='cancelled'?'cancelled':'updated',title:changes.status==='cancelled'?'Sortie annulée':'Sortie modifiée',body:changes.message||'Consultez les nouvelles informations de la sortie.',createdAt:Date.now(),notified:false});
}

// ============ Activité privacy settings ============
export async function updateActivityPrivacy(uid:string, settings: ActivityPrivacySettings): Promise<void> {
  await updateDoc(doc(db,'users',uid), { activityPrivacy: settings } as unknown as Record<string,unknown>);
}


// ============ F04 — synchronisation différée des écritures de sortie ============
// Les trois écritures du parcours GPS (création, points intermédiaires, fin de
// sortie) passent par la file persistante : une sortie vécue hors connexion est
// rejouée telle quelle au retour du réseau, avec un identifiant généré sur
// l'appareil (aucun doublon). Les points intermédiaires sont « dernière valeur
// gagnée » par sortie : seul le tracé le plus récent est renvoyé.
registerSyncHandler('activity.create', async (task) => {
  const { uid, type, sessionId, startedAt, route } = task.payload as {
    uid: string; type: ActivitySession['type']; sessionId: string; startedAt?: number;
    route?: { id: string; name: string } | null;
  };
  await createActivitySession(uid, type, route || undefined, { sessionId, startedAt, createdOffline: true });
});

registerSyncHandler('activity.finish', async (task) => {
  const { uid, sessionId, data } = task.payload as {
    uid: string; sessionId: string;
    data: Pick<ActivitySession, 'points' | 'distanceM' | 'durationSec' | 'calories' | 'steps'> & { pausedSec?: number };
  };
  await finishActivitySession(uid, sessionId, data);
});

// ---------------------------------------------------------------------------
// Version publiée sur le Play Store (écran de mise à jour)
// ---------------------------------------------------------------------------

/**
 * Déclare la version publiée — réservé au président (règle `appRelease`).
 *
 * Le worker Cloudflare tient ce document à jour automatiquement depuis l'API
 * Play (`/cron/sync-release`) ; cette écriture sert à corriger à la main, ou à
 * suspendre les notifications de mise à jour (`enabled: false`) sans publier
 * de nouvelle version de l'application.
 */
export async function setPublishedRelease(release: {
  latestVersion: string;
  minSupportedVersion?: string;
  notes?: string;
  enabled?: boolean;
}): Promise<void> {
  const payload: Record<string, unknown> = {
    latestVersion: release.latestVersion.trim(),
    publishedAt: Date.now(),
    updatedAt: Date.now(),
    enabled: release.enabled !== false,
  };
  const min = (release.minSupportedVersion || '').trim();
  const notes = (release.notes || '').trim();
  if (min) payload.minSupportedVersion = min;
  if (notes) payload.notes = notes.slice(0, 600);
  if (release.enabled === false) payload.enabled = false;
  await setDoc(doc(db, 'appRelease', 'current'), payload, { merge: true });
}
