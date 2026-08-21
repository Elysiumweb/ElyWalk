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
}

export interface DailySteps {
  date: string;
  steps: number;
  coins: number;
  calories: number;
  validatedAt: number;
}

export type ChallengeKind = 'personal' | 'collective' | 'seasonal';
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
