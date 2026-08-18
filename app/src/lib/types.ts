export type Role = 'president' | 'copresident' | 'member';

export interface UserProfile {
  uid: string;
  displayName: string;
  photoURL?: string | null;
  email: string | null;
  // --- Anti-fraude parrainage (IP + HWID) ---
  signupIp?: string | null; // IP publique à la création du compte
  lastIp?: string | null; // Dernière IP connue
  hwid?: string | null; // Identifiant matériel à la création du compte
  hwids?: string[]; // Tous les HWID utilisés par ce compte
  referralRejected?: boolean; // Parrainage refusé (même IP ou même HWID)
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
  referredIp?: string | null; // IP du filleul au moment de la réclamation
  referredHwid?: string | null; // HWID du filleul au moment de la réclamation
  claimed: boolean;
  createdAt: number;
}
