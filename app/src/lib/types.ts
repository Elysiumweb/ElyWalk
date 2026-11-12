export type Role = 'president' | 'copresident' | 'member';
export type UnitSystem = 'metric' | 'imperial';
export type ActivityType = 'walk' | 'run';

export interface HealthProfile {
  weightKg?: number;
  heightCm?: number;
  age?: number;
  unitSystem?: UnitSystem;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  photoURL?: string | null;
  email: string | null;
  // --- Anti-fraude parrainage (IP + HWID) ---
  signupIp?: string | null;
  lastIp?: string | null;
  hwid?: string | null;
  hwids?: string[];
  referralRejected?: boolean;
  elycoins: number;
  totalSteps: number;
  totalCalories: number;
  streak: number;
  lastValidatedDate: string | null;
  todaySteps: number;
  todayDate: string;
  referralCode: string;
  referredBy: string | null;
  paypalEmail: string | null;
  role: Role;
  createdAt: number;
  dailyStepGoal?: number;
  strideLengthCm?: number;
  bio?: string;
  onboardingDone?: boolean;
  lastAdSlot?: string;
  lastAdRewardAt?: unknown;
  lastReferralClaim?: string;
  lastChallengeClaim?: string;
  /** Une journée manquée peut être rattrapée automatiquement avec un gel. */
  streakFreezes?: number;
  health?: HealthProfile;
  unitSystem?: UnitSystem;
  /** Préférences de vie privée pour le fil d'activité */
  activityPrivacy?: ActivityPrivacySettings;
}

export interface ActivityPrivacySettings {
  shareGoals?: boolean;
  shareActivities?: boolean;
  shareBadges?: boolean;
  shareChallenges?: boolean;
  /**
   * F01 — un changement de confidentialité s'applique-t-il aux publications
   * déjà créées ? `true` (défaut) : les sorties partagées repassent en privé,
   * les éléments de fil déjà publiés sont retirés. `false` : seules les
   * publications futures sont concernées.
   */
  applyToExisting?: boolean;
}

/**
 * Audience d'une publication, formalisée côté données (F01).
 *
 * - `private`  : propriétaire uniquement ;
 * - `friends`  : amitiés vérifiées **côté serveur** (`friendships`) ;
 * - `link`     : partage par lien révocable, avec périmètre explicite.
 */
export type Audience = 'private' | 'friends' | 'link';

export interface ShareLink {
  id?: string;
  /** Sortie concernée. */
  sessionId: string;
  ownerUid: string;
  /** Jeton aléatoire : le lien ne doit pas être devinable. */
  token: string;
  /** Périmètre exact de ce que le lien expose. */
  scope: 'summary' | 'track';
  revoked: boolean;
  createdAt: number;
  revokedAt?: number | null;
  /** Date d'expiration (epoch ms), `null` = sans expiration. */
  expiresAt?: number | null;
}

export interface DailySteps {
  date: string;
  steps: number;
  coins: number;
  calories: number;
  validatedAt: number;
}

export type ChallengeKind = 'personal' | 'collective' | 'seasonal' | 'friend';
export type ChallengeMetric = 'steps' | 'streak' | 'activeDays' | 'distance';

export interface ChallengeDefinition {
  id: string;
  title: string;
  description: string;
  kind: ChallengeKind;
  metric: ChallengeMetric;
  target: number;
  reward: number;
  startsAt: string;
  endsAt: string;
  icon: string;
  /** For collective challenges, progress is the community total. */
  participantLabel?: string;
  /**
   * F02 — le défi est-il ouvert et rémunéré ? Fixé par le catalogue
   * `challengeCatalog` (administration). `false` ou absent : le défi reste un
   * objectif personnel mais **aucune récompense n'est versée**, et l'écran le dit
   * au lieu de laisser un bouton « Récupérer » qui échouerait.
   */
  rewardAllowed?: boolean;
}

export interface UserChallenge {
  challengeId: string;
  uid: string;
  progress: number;
  completed: boolean;
  claimed: boolean;
  reward?: number;
  updatedAt: number;
  claimedAt?: number;
}

export interface ActivityPoint {
  lat: number;
  lng: number;
  recordedAt: number;
  altitude?: number;
  /** Précision horizontale du point en mètres (qualité du signal GPS). */
  accuracy?: number;
}

export type ActivityVisibility = 'private' | 'friends' | 'link';

/** Météo ressentie pendant la sortie (annotation libre, choisie par l'utilisateur). */
export type ActivityWeather = 'sunny' | 'cloudy' | 'rain' | 'cold' | 'wind' | 'night';

export interface ActivitySession {
  id?: string;
  uid: string;
  type: ActivityType;
  startedAt: number;
  endedAt?: number;
  /** Durée active en secondes : les pauses sont exclues. */
  durationSec: number;
  /** Temps total passé en pause (secondes), exclu de durationSec et de l'allure. */
  pausedSec?: number;
  distanceM: number;
  calories: number;
  /** Pas comptés pendant la sortie (delta du podomètre), si disponible. */
  steps?: number;
  points: ActivityPoint[];
  status: 'active' | 'completed';
  /** Visibilité de la sortie dans l'app */
  visibility?: ActivityVisibility;
  sharedWith?: string[];
  /** Titre personnalisé (« Balade au bord de l'Authie »). */
  title?: string;
  /**
   * Note libre de l'utilisateur (500 caractères max) — **privée**.
   *
   * F01 : la note était stockée dans le document de la sortie et donc renvoyée
   * à tout lecteur autorisé (amis, lien). Elle vit désormais dans
   * `users/{uid}/privateActivityNotes/{sessionId}` (lisible par le seul
   * propriétaire) et n'est plus écrite ici. Les champs restent déclarés pour
   * lire les documents anciens et les migrer (voir `migratePrivateNotes`).
   */
  note?: string;
  /**
   * Message libre **partageable** avec l'audience de la sortie (500 caractères).
   * Remplace `note` pour tout ce qui doit être visible par les amis.
   */
  caption?: string;
  /** Météo ressentie pendant la sortie. */
  weather?: ActivityWeather;
  /** Parcours préparé suivi pendant cette sortie. */
  routeId?: string | null;
  routeName?: string | null;
  /**
   * F05 — la sortie a été finalisée hors connexion : elle existe d'abord sur
   * le téléphone, dans la file d'envoi persistante, puis sur le serveur.
   */
  createdOffline?: boolean;
  /** Dernier acquittement serveur de la sortie (epoch ms). */
  syncedAt?: number | null;
}

export interface PartnerOffer {
  id?: string;
  establishmentId?: string | null;
  title: string;
  description: string;
  partnerName: string;
  coins: number;
  active: boolean;
  website?: string | null;
  createdAt: number;
}

export interface CoinTransaction {
  id?: string;
  type: 'steps' | 'ad' | 'referral' | 'paypal' | 'donation' | 'partner' | 'challenge';
  coins: number;
  note: string;
  createdAt: number;
}

export interface Withdrawal {
  id?: string;
  uid: string;
  userName: string;
  type: 'paypal' | 'donation' | 'partner';
  coins: number;
  euros: number;
  paypalEmail: string | null;
  status: 'pending' | 'paid' | 'rejected' | 'received';
  createdAt: number;
  notified?: boolean;
}

export interface PartnerRequest {
  id?: string;
  uid: string;
  userName: string;
  organization: string;
  contactEmail: string;
  message: string;
  status: 'pending' | 'read' | 'accepted' | 'rejected';
  createdAt: number;
}

export interface FriendRequest {
  id?: string;
  from: string;
  fromName: string;
  to: string;
  toName: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: number;
  notified?: boolean;
}

export interface Friendship {
  id?: string;
  members: string[];
  createdAt: number;
}

export interface ReferralClaim {
  sponsorUid: string;
  referredUid: string;
  referredName: string;
  referredIp?: string | null;
  referredHwid?: string | null;
  claimed: boolean;
  createdAt: number;
}

// ========== Badges / Trophées ==========

export type BadgeId =
  | 'first-10k'
  | 'streak-7'
  | 'streak-30'
  | 'streak-100'
  | 'first-gps'
  | 'km-10'
  | 'km-100'
  | 'km-500'
  | 'steps-100k'
  | 'steps-1m'
  | 'referral-first'
  | 'challenge-first';

export interface BadgeDefinition {
  id: BadgeId;
  title: string;
  description: string;
  icon: string;
  tier: 'bronze' | 'silver' | 'gold' | 'platinum' | 'legend';
}

export interface UserBadge {
  id?: string;
  badgeId: BadgeId;
  unlockedAt: number;
  seen?: boolean;
}

// ========== Niveaux / Rangs ==========

export interface WalkerLevel {
  level: number;
  title: string;
  icon: string;
  minSteps: number;
  maxSteps: number | null;
  color: string;
  nextAt: number | null;
}

// ========== Défis entre amis ==========

export interface FriendChallenge {
  id?: string;
  creatorUid: string;
  creatorName: string;
  title: string;
  target: number;
  metric: 'steps' | 'distance';
  participants: string[];
  participantNames: Record<string, string>;
  invitedUids?: string[];
  startsAt: string;
  endsAt: string;
  status: 'active' | 'completed';
  createdAt: number;
  reward?: number;
}

export interface FriendChallengeProgress {
  uid: string;
  displayName: string;
  photoURL?: string | null;
  progress: number;
  percent: number;
}

// ========== Fil d'activité ==========

export type ActivityFeedType = 'goal' | 'activity' | 'challenge' | 'badge' | 'streak' | 'friend';

export interface ActivityFeedItem {
  id?: string;
  uid: string;
  displayName: string;
  photoURL?: string | null;
  type: ActivityFeedType;
  message: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

// ========== Messagerie légère ==========

export interface DirectMessage {
  id?: string;
  from: string;
  fromName: string;
  to: string;
  toName: string;
  text: string;
  createdAt: number;
  activityId?: string | null;
  read?: boolean;
}

// ========== Événements communautaires ==========

export type BlockedAccount = {
  id?: string;
  ownerUid: string;
  blockedUid: string;
  blockedName: string;
  createdAt: number;
};

export type ReportStatus = 'open' | 'reviewing' | 'resolved' | 'dismissed';
export type ReportTargetType = 'profile' | 'message' | 'activity' | 'event';
export interface ModerationAction {
  status: ReportStatus;
  actorUid: string;
  note: string;
  createdAt: number;
}
export interface ContentReport {
  id?: string;
  reporterUid: string;
  targetUid: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: 'harassment' | 'spam' | 'inappropriate' | 'safety' | 'other';
  details: string;
  status: ReportStatus;
  history: ModerationAction[];
  createdAt: number;
  updatedAt: number;
}

export interface SavedRoute {
  id?: string;
  uid: string;
  ownerName: string;
  name: string;
  description: string;
  points: ActivityPoint[];
  distanceM: number;
  elevationGainM: number;
  elevationLossM: number;
  visibility: 'private' | 'public';
  createdAt: number;
  updatedAt: number;
}

export type EventStatus = 'scheduled' | 'cancelled';
export interface EventChange {
  type: 'updated' | 'cancelled';
  message: string;
  createdAt: number;
}

export interface CommunityEvent {
  id?: string;
  title: string;
  description: string;
  establishmentId?: string | null;
  establishmentName?: string | null;
  location?: string | null;
  lat?: number | null;
  lng?: number | null;
  date: string;
  time?: string | null;
  creatorUid: string;
  creatorName: string;
  participants: string[];
  maxParticipants?: number | null;
  waitlist?: string[];
  status?: EventStatus;
  updatedAt?: number;
  lastChange?: EventChange;
  createdAt: number;
}

export interface EventNotification {
  id?: string;
  eventId: string;
  toUid: string;
  type: 'updated' | 'cancelled';
  title: string;
  body: string;
  createdAt: number;
  notified: boolean;
}
