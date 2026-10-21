// ===== ElyWalk — Constantes globales =====

// --- AdMob (production) ---
// Ces identifiants correspondent à l'application Android com.elysium.elywalk.
// Ne jamais remplacer par les IDs d'exemple Google dans une build Play Store.
export const ADMOB_APP_ID = 'ca-app-pub-5316598937383510~4963026878';
export const AD_UNIT_APP_OPEN = 'ca-app-pub-5316598937383510/6986554989';
export const AD_UNIT_INTERSTITIAL = 'ca-app-pub-5316598937383510/7972992736';
export const AD_UNIT_REWARDED = 'ca-app-pub-5316598937383510/9832210178';

// --- Documents légaux en ligne (exigence Play Store : URL publique) ---
// Page statique servie par Firebase Hosting (app/public/privacy.html).
// Doit rester accessible sans authentification et sans restriction géographique.
export const PRIVACY_POLICY_URL = 'https://elywalk-2f7ba.web.app/privacy.html';

// Procédure de suppression de compte (exigence Play Store : URL publique
// distincte, affichée sur la fiche de l'application).
export const ACCOUNT_DELETION_URL = 'https://elywalk-2f7ba.web.app/delete-account.html';

// Suppression d'une partie ou de la totalité des données SANS fermer le compte
// (exigence Play Store : URL distincte de la suppression de compte).
export const DATA_DELETION_URL = 'https://elywalk-2f7ba.web.app/delete-data.html';

// --- Attestation serveur (Play Integrity, F05) ---
// URL du Worker Cloudflare de confiance (voir /worker/README.md). À renseigner
// après déploiement du Worker. Vide => l'attestation est désactivée.
export const ATTESTATION_WORKER_URL = ''; // ex. 'https://elywalk-backend.<compte>.workers.dev'

// --- Rôles Elysium ---
export const PRESIDENT_UID = 'BZ333LlhuJMoD4rXIquGE0zzjX43';
export const CO_PRESIDENT_UID = '7XLpqYMKEMX5kLrQtts6NG3zRB32';
export const PRESIDENT_UIDS: string[] = [PRESIDENT_UID, CO_PRESIDENT_UID];

export function isPresidentUid(uid: string | null | undefined): boolean {
  return !!uid && PRESIDENT_UIDS.includes(uid);
}

// --- Économie ElyCoins ---
export const COINS_PER_EURO = 1000; // 1000 ElyCoins = 1 €
export const AD_REWARD_COINS = 0.1; // 1 pub récompensée = 0,1 ElyCoins
export const REFERRAL_BONUS = 10; // Parrainage = 10 ElyCoins
export const MIN_PAYPAL_COINS = 1000; // Retrait minimum : 1 €

// Barème pas quotidiens -> ElyCoins (bornes inclusives)
export const STEP_TIERS: { min: number; max: number; coins: number }[] = [
  { min: 0, max: 2499, coins: 1 },
  { min: 2500, max: 4999, coins: 2 },
  { min: 5000, max: 7499, coins: 5 },
  { min: 7500, max: 9999, coins: 7 },
  { min: 10000, max: 12499, coins: 10 },
  { min: 12500, max: 14999, coins: 12 },
  { min: 15000, max: 19999, coins: 15 },
  { min: 20000, max: 29999, coins: 20 },
  { min: 30000, max: 39999, coins: 30 },
  { min: 40000, max: 49999, coins: 40 },
  { min: 50000, max: Infinity, coins: 50 },
];

export const DAILY_STEP_GOAL = 10000;

// ========== Badges / Trophées ==========
export const BADGE_DEFINITIONS: import('./types').BadgeDefinition[] = [
  { id: 'first-10k', title: 'Premier 10K', description: 'Validez 10 000 pas en une journée', icon: '🎯', tier: 'bronze' },
  { id: 'streak-7', title: 'Semaine d’or', description: 'Série de 7 jours consécutifs', icon: '🔥', tier: 'bronze' },
  { id: 'streak-30', title: 'Mois de feu', description: 'Série de 30 jours consécutifs', icon: '⚡', tier: 'silver' },
  { id: 'streak-100', title: 'Légende', description: 'Série de 100 jours consécutifs', icon: '👑', tier: 'legend' },
  { id: 'first-gps', title: 'Explorateur', description: 'Première sortie GPS enregistrée', icon: '📍', tier: 'bronze' },
  { id: 'km-10', title: '10 km', description: '10 km cumulés', icon: '🥾', tier: 'bronze' },
  { id: 'km-100', title: '100 km', description: '100 km cumulés', icon: '🏅', tier: 'silver' },
  { id: 'km-500', title: '500 km', description: '500 km cumulés', icon: '🌍', tier: 'gold' },
  { id: 'steps-100k', title: '100K pas', description: '100 000 pas au total', icon: '👟', tier: 'silver' },
  { id: 'steps-1m', title: 'Millionnaire', description: '1 000 000 pas au total', icon: '💎', tier: 'platinum' },
  { id: 'referral-first', title: 'Parrain', description: 'Premier filleul éligible', icon: '🤝', tier: 'gold' },
  { id: 'challenge-first', title: 'Challenger', description: 'Premier défi remporté', icon: '🏆', tier: 'silver' },
];

export function getBadgeDef(id: string) {
  return BADGE_DEFINITIONS.find(b => b.id === id);
}

// ========== Niveaux / Rangs ==========
export const WALKER_LEVELS: import('./types').WalkerLevel[] = [
  { level: 1, title: 'Marcheur Bronze', icon: '🥉', minSteps: 0, maxSteps: 50000, color: '#cd7f32', nextAt: 50000 },
  { level: 2, title: 'Marcheur Argent', icon: '🥈', minSteps: 50000, maxSteps: 150000, color: '#c0c0c0', nextAt: 150000 },
  { level: 3, title: 'Marcheur Or', icon: '🥇', minSteps: 150000, maxSteps: 500000, color: '#d8ca82', nextAt: 500000 },
  { level: 4, title: 'Marcheur Platine', icon: '💠', minSteps: 500000, maxSteps: 1000000, color: '#a8d8f0', nextAt: 1000000 },
  { level: 5, title: 'Marcheur Diamant', icon: '💎', minSteps: 1000000, maxSteps: 3000000, color: '#b9f2ff', nextAt: 3000000 },
  { level: 6, title: 'Légende ElyWalk', icon: '👑', minSteps: 3000000, maxSteps: null, color: '#ffd700', nextAt: null },
];

export function getWalkerLevel(totalSteps: number): import('./types').WalkerLevel {
  const steps = Math.max(0, totalSteps || 0);
  for (let i = WALKER_LEVELS.length - 1; i >= 0; i--) {
    if (steps >= WALKER_LEVELS[i].minSteps) return WALKER_LEVELS[i];
  }
  return WALKER_LEVELS[0];
}
export function getNextLevel(totalSteps: number) {
  const current = getWalkerLevel(totalSteps);
  const idx = WALKER_LEVELS.findIndex(l => l.level === current.level);
  return idx >= 0 && idx < WALKER_LEVELS.length - 1 ? WALKER_LEVELS[idx + 1] : null;
}

// Défis visibles sans attendre une campagne distante. Les dates sont recalculées
// à chaque ouverture : une vraie campagne peut ensuite être remplacée par le back-office.
export function getChallengeDefinitions(now = new Date()): import('./types').ChallengeDefinition[] {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const iso = (d: Date) => {
    const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const monday = new Date(day);
  const offset = (day.getDay() + 6) % 7;
  monday.setDate(day.getDate() - offset);
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  const seasonStart = new Date(day.getFullYear(), day.getMonth(), 1);
  const seasonEnd = new Date(day.getFullYear(), day.getMonth() + 1, 0);
  const challengeStart = new Date(day); challengeStart.setDate(day.getDate() - 6);
  const challengeEnd = new Date(day); challengeEnd.setDate(day.getDate() + 7);
  return [
    {
      id: `week-steps-${iso(monday)}`, title: 'Sprint collectif',
      description: 'La communauté marche ensemble cette semaine.', kind: 'collective',
      metric: 'steps', target: 250000, reward: 25, startsAt: iso(monday), endsAt: iso(sunday), icon: '🌍', participantLabel: 'pas de la communauté',
    },
    {
      id: `dated-active-${iso(challengeStart)}`, title: '7 jours en mouvement',
      description: 'Validez au moins cinq journées avant la fin du défi.', kind: 'personal',
      metric: 'activeDays', target: 5, reward: 12, startsAt: iso(challengeStart), endsAt: iso(challengeEnd), icon: '⚡',
    },
    {
      id: `season-${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}`, title: 'Saison des foulées',
      description: 'Accumulez des pas pendant la saison en cours.', kind: 'seasonal',
      metric: 'steps', target: 100000, reward: 40, startsAt: iso(seasonStart), endsAt: iso(seasonEnd), icon: '🏆',
    },
    {
      id: `streak-${iso(day)}`, title: 'Feu sacré',
      description: 'Atteignez une série de sept jours.', kind: 'personal',
      metric: 'streak', target: 7, reward: 15, startsAt: iso(day), endsAt: iso(new Date(day.getFullYear(), day.getMonth(), day.getDate() + 30)), icon: '🔥',
    },
  ];
}
