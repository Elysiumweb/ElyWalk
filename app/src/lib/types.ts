export type Role = 'president' | 'copresident' | 'member';

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string | null;
  phoneNumber: string | null;
  phoneVerified: boolean;
  elycoins: number;
  totalSteps: number;
  totalCalories: number;
  streak: number; // jours d'affilée d'activité validée
  lastValidatedDate: string | null; // YYYY-MM-DD
  todaySteps: number;
  todayDate: string; // YYYY-MM-DD
  referralCode: string;
  referredBy: string | null; // uid du parrain
  paypalEmail: string | null;
  role: Role;
  createdAt: number;
}

export interface CoinTransaction {
  id?: string;
  type: 'steps' | 'ad' | 'referral' | 'paypal' | 'donation' | 'partner';
  coins: number; // positif = gain, négatif = dépense
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
}

export interface Friendship {
  id?: string;
  members: string[]; // [uidA, uidB]
  createdAt: number;
}

export interface ReferralClaim {
  sponsorUid: string;
  referredUid: string;
  referredName: string;
  claimed: boolean;
  createdAt: number;
}
