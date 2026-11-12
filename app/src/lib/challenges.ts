/**
 * Défis : barème, identifiants et synchronisation du catalogue (F02).
 *
 * Deux notions à ne pas confondre :
 *
 *  • la **définition** d'un défi (titre, description, icône, dates, cible) est
 *    une constante de l'application (`getChallengeDefinitions`), datée par
 *    rapport au jour courant ;
 *  • le **barème** (montant versé, ouverture, fenêtre de validité) est une
 *    donnée d'administration, stockée dans `challengeCatalog/{challengeId}`.
 *
 * Firestore ne peut pas inventer un document : tant qu'une ligne de catalogue
 * n'existe pas, le défi s'affiche comme objectif mais **ne rémunère pas**. Ce
 * module fournit les identifiants exacts, les valeurs recommandées et
 * l'écriture (réservée aux présidents par la règle `allow write: if president()`),
 * pour que l'administration n'ait pas à deviner les clés.
 */

import { collection, deleteDoc, doc, getDocs, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { getChallengeDefinitions, isPresidentUid } from './constants';
import type { ChallengeDefinition } from './types';

/** Ligne de catalogue : le strict nécessaire au versement d'une récompense. */
export interface ChallengeCatalogEntry {
  active: boolean;
  reward: number;
  target: number;
  startsAt: string;
  endsAt: string;
  /** Memorandum lisible (facultatif) : titre du défi au moment de l'écriture. */
  title?: string;
  updatedAt: number;
  updatedBy?: string;
}

/**
 * Lignes à écrire pour les défis **du jour**.
 *
 * Les identifiants sont calculés de la même façon que `getChallengeDefinitions`
 * (lundi de la semaine, mois en cours, etc.) : recopier un identifiant à la main
 * une semaine plus tard créerait une ligne orpheline qui ne rémunère rien.
 */
export function catalogEntriesForToday(now = new Date()): Array<{ id: string; entry: ChallengeCatalogEntry }> {
  return getChallengeDefinitions(now).map((challenge) => ({
    id: challenge.id,
    entry: {
      active: true,
      reward: challenge.reward,
      target: challenge.target,
      startsAt: challenge.startsAt,
      endsAt: challenge.endsAt,
      title: challenge.title,
      updatedAt: Date.now(),
    },
  }));
}

export interface CatalogSyncResult {
  written: string[];
  skipped: string[];
}

/**
 * Écrit (ou réécrit) les lignes de catalogue des défis du jour.
 *
 * Réservé aux présidents — la règle Firestore refuse toute autre écriture. Une
 * ligne existante est **conservée** si son montant est déjà valide : écraser un
 * barème ajusté à la main par une valeur par défaut serait une régression
 * silencieuse.
 */
export async function publishChallengeCatalog(uid: string, now = new Date()): Promise<CatalogSyncResult> {
  if (!isPresidentUid(uid)) throw new Error('Action réservée à l’administration.');
  const written: string[] = [];
  const skipped: string[] = [];
  const rows = catalogEntriesForToday(now);
  const existing = new Map<string, ChallengeCatalogEntry>();
  try {
    const snaps = await getDocs(collection(db, 'challengeCatalog'));
    snaps.docs.forEach((d) => existing.set(d.id, d.data() as ChallengeCatalogEntry));
  } catch {
    /* catalogue vide ou illisible : on écrit tout */
  }
  for (const { id, entry } of rows) {
    const current = existing.get(id);
    const alreadyValid =
      current &&
      current.active === true &&
      Number.isFinite(Number(current.reward)) &&
      Number(current.reward) > 0 &&
      Number(current.reward) <= 50;
    if (alreadyValid) {
      skipped.push(id);
      continue;
    }
    await setDoc(doc(db, 'challengeCatalog', id), { ...entry, updatedBy: uid });
    written.push(id);
  }
  return { written, skipped };
}

/**
 * Règle le montant d'un défi (ou le ferme) depuis l'espace d'administration.
 *
 * Bornes alignées sur la règle Firestore : `reward` entre 1 et 50, `target`
 * positive, dates AAAA-MM-JJ cohérentes. Un montant hors bornes serait refusé
 * par la règle ; on l'empêche ici pour donner un message clair plutôt qu'un
 * `permission-denied`.
 */
export async function setChallengeCatalogEntry(
  uid: string,
  challengeId: string,
  patch: { reward?: number; target?: number; active?: boolean; startsAt?: string; endsAt?: string; title?: string }
): Promise<void> {
  if (!isPresidentUid(uid)) throw new Error('Action réservée à l’administration.');
  if (patch.reward != null && (!Number.isFinite(patch.reward) || patch.reward < 1 || patch.reward > 50)) {
    throw new Error('Le montant doit être compris entre 1 et 50 EC.');
  }
  if (patch.target != null && (!Number.isFinite(patch.target) || patch.target <= 0)) {
    throw new Error('L’objectif doit être supérieur à zéro.');
  }
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (patch.startsAt && !iso.test(patch.startsAt)) throw new Error('Date de début invalide (AAAA-MM-JJ).');
  if (patch.endsAt && !iso.test(patch.endsAt)) throw new Error('Date de fin invalide (AAAA-MM-JJ).');
  const row = catalogEntriesForToday().find((r) => r.id === challengeId);
  const base: ChallengeCatalogEntry = row?.entry || {
    active: true, reward: 1, target: 1, startsAt: '', endsAt: '', updatedAt: Date.now(),
  };
  await setDoc(doc(db, 'challengeCatalog', challengeId), {
    ...base,
    ...patch,
    updatedAt: Date.now(),
    updatedBy: uid,
  });
}

/** Retire une ligne de catalogue : le défi cesse immédiatement de rémunérer. */
export async function closeChallengeCatalogEntry(uid: string, challengeId: string): Promise<void> {
  if (!isPresidentUid(uid)) throw new Error('Action réservée à l’administration.');
  await deleteDoc(doc(db, 'challengeCatalog', challengeId));
}

/**
 * Ce que l'écran d'administration affiche : quels défis du jour sont ouverts au
 * versement, et lesquels restent de simples objectifs.
 */
export function describeCatalogState(
  definitions: ChallengeDefinition[],
  catalog: Map<string, ChallengeCatalogEntry>
): Array<{ challenge: ChallengeDefinition; state: 'paid' | 'closed' | 'missing'; reward: number }> {
  return definitions.map((challenge) => {
    const row = catalog.get(challenge.id);
    if (!row) return { challenge, state: 'missing' as const, reward: challenge.reward };
    const expired = typeof row.endsAt === 'string' && row.endsAt < new Date().toISOString().slice(0, 10);
    const paid = row.active === true && !expired && Number(row.reward) > 0;
    return { challenge, state: paid ? ('paid' as const) : ('closed' as const), reward: Number(row.reward) || challenge.reward };
  });
}
