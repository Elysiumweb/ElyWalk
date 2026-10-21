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
}

export type ActivityVisibility = 'private' | 'friends' | 'link';

export interface ActivitySession {
  id?: string;
  uid: string;
  type: ActivityType;
  startedAt: number;
  endedAt?: number;
  durationSec: number;
  distanceM: number;
  calories: number;
  /** Pas comptés pendant la sortie (delta du podomètre), si disponible. */
  steps?: number;
  points: ActivityPoint[];
  status: 'active' | 'completed';
  /** Visibilité de la sortie dans l'app */
  visibility?: ActivityVisibility;
  sharedWith?: string[];
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
  createdAt: number;
}
