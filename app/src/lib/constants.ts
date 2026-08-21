// ===== ElyWalk — Constantes globales =====

// --- AdMob (production) ---
export const ADMOB_APP_ID = 'ca-app-pub-6906841385343667~6481018527';
export const AD_UNIT_REWARDED = 'ca-app-pub-6906841385343667/3683414466';
export const AD_UNIT_APP_OPEN = 'ca-app-pub-6906841385343667/6616749893';
export const AD_UNIT_INTERSTITIAL = 'ca-app-pub-6906841385343667/3494240028';

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
