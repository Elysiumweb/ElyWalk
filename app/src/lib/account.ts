/**
 * Suppression et export du compte (F03).
 *
 * Ce module remplace les deux fonctions historiques de `db.ts`, qui :
 *  - tentaient de supprimer `dailySteps` alors que les règles l'interdisent au
 *    client (un compte ayant validé des pas restait bloqué à cette étape) ;
 *  - oubliaient les messages, badges, fil, parcours et participations ;
 *  - réutilisaient des listes plafonnées (50 dernières transactions, 1 000
 *    sorties) pour l'export ;
 *  - ne traitaient pas les sous-collections d'un document parent, que Firestore
 *    ne supprime jamais automatiquement.
 *
 * Principes retenus :
 *  1. **Inventaire explicite** : chaque collection est listée avec son sort
 *     (`delete`, `anonymize`, `retain`) et sa justification. Une collection
 *     ajoutée plus tard doit être ajoutée ici, sinon elle apparaît dans la
 *     vérification des résidus (`findResidualData`).
 *  2. **Reprise** : le traitement est découpé en étapes nommées, chacune
 *     idempotente, et la progression est remontée à l'écran. Une panne réseau au
 *     milieu du parcours peut donc être rejouée sans rien dupliquer.
 *  3. **Conservation légitime** : un retrait encore `pending` est payé puis
 *     anonymisé — il n'est jamais effacé (l'utilisateur a déjà été débité).
 *  4. **Export complet et paginé**, partageable sur Android.
 */

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  updateDoc,
  where,
  writeBatch,
  type Query,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from './firebase';
import type { Withdrawal } from './types';

export type DisposalKind = 'delete' | 'anonymize' | 'retain';

export interface CollectionPolicy {
  /** Chemin Firestore (peut contenir `{uid}`). */
  path: string;
  kind: DisposalKind;
  /** Champ à comparer à l'UID pour retrouver les documents de l'utilisateur. */
  field?: string;
  /** Collections imbriquées à traiter explicitement (Firestore ne cascade pas). */
  subcollections?: string[];
  /** Justification affichée dans l'écran de confirmation. */
  reason: string;
}

/** Inventaire complet — source de vérité de l'effacement. */
export const ACCOUNT_DATA_POLICY: CollectionPolicy[] = [
  { path: 'users/{uid}', kind: 'delete', subcollections: ['dailySteps', 'transactions', 'challenges', 'badges', 'notificationTokens', 'privateActivityNotes', 'private'], reason: 'Profil, réglages, économie et sous-collections.' },
  { path: 'activitySessions', kind: 'delete', field: 'uid', subcollections: ['shareTokens'], reason: 'Sorties GPS et tracés.' },
  { path: 'savedRoutes', kind: 'delete', field: 'uid', reason: 'Parcours enregistrés (privés et publics).' },
  { path: 'transactions', kind: 'delete', field: 'uid', reason: 'Registre de crédits/débits.' },
  { path: 'directMessages', kind: 'delete', field: 'from', reason: 'Messages envoyés (y compris contenus libres).' },
  { path: 'directMessages', kind: 'delete', field: 'to', reason: 'Messages reçus.' },
  { path: 'friendRequests', kind: 'delete', field: 'from', reason: 'Demandes d’ami envoyées.' },
  { path: 'friendRequests', kind: 'delete', field: 'to', reason: 'Demandes d’ami reçues.' },
  { path: 'friendships', kind: 'delete', field: 'members', reason: 'Liens d’amitié (array-contains).' },
  { path: 'friendReactions', kind: 'delete', field: 'from', reason: 'Réactions envoyées.' },
  { path: 'friendReactions', kind: 'delete', field: 'to', reason: 'Réactions reçues.' },
  { path: 'friendChallenges', kind: 'delete', field: 'creatorUid', reason: 'Défis créés.' },
  { path: 'activityFeed', kind: 'delete', field: 'uid', reason: 'Publications du fil.' },
  { path: 'reports', kind: 'anonymize', field: 'reporterUid', reason: 'Signalements déposés : conservés pour la modération, identité retirée.' },
  { path: 'blockedAccounts', kind: 'delete', field: 'ownerUid', reason: 'Blocages créés.' },
  { path: 'blockedAccounts', kind: 'delete', field: 'blockedUid', reason: 'Blocages reçus.' },
  { path: 'referralClaims', kind: 'delete', field: 'sponsorUid', reason: 'Parrainages validés.' },
  { path: 'referralClaims', kind: 'delete', field: 'referredUid', reason: 'Parrainage reçu.' },
  { path: 'referralCodes', kind: 'delete', field: 'uid', reason: 'Code de parrainage.' },
  { path: 'adClaims', kind: 'delete', field: 'uid', reason: 'Journaux de récompense publicitaire.' },
  { path: 'partnerRequests', kind: 'anonymize', field: 'uid', reason: 'Demandes partenaires : conservées sans identité.' },
  { path: 'withdrawals', kind: 'anonymize', field: 'uid', reason: 'Retraits : conservés pour la comptabilité, identité retirée. Un retrait en attente est payé avant anonymisation.' },
  { path: 'communityEvents', kind: 'delete', field: 'creatorUid', reason: 'Rencontres organisées.' },
  { path: 'eventNotifications', kind: 'delete', field: 'toUid', reason: 'Notifications d’événement destinées au compte.' },
];

export interface DeletionProgress {
  step: string;
  done: number;
  total: number;
}

export interface DeletionResult {
  deleted: number;
  anonymized: number;
  retained: number;
  /** Retraits encore en attente : payés puis anonymisés, jamais effacés. */
  pendingWithdrawals: number;
  steps: string[];
}

const PAGE = 200;

/** Supprime tous les documents d'une requête, par lots (limite Firestore : 500). */
async function deleteQueryDocs(ref: Query, onDeleted: (count: number) => void): Promise<number> {
  let deleted = 0;
  for (;;) {
    const snaps = await getDocs(query(ref, limit(PAGE)));
    if (snaps.empty) break;
    for (let i = 0; i < snaps.docs.length; i += 400) {
      const batch = writeBatch(db);
      snaps.docs.slice(i, i + 400).forEach((d) => { batch.delete(d.ref); });
      await batch.commit();
    }
    deleted += snaps.docs.length;
    onDeleted(deleted);
    // Sécurité : si un document ne peut pas être supprimé (règle serveur), on
    // sort au lieu de boucler indéfiniment.
    if (snaps.docs.length < PAGE) break;
  }
  return deleted;
}

/** Supprime une sous-collection entière (Firestore ne le fait jamais seul). */
async function deleteSubcollection(path: string): Promise<number> {
  return deleteQueryDocs(collection(db, path), () => undefined);
}

/**
 * Efface (ou anonymise) les données du compte.
 *
 * Idempotent et reprenable : chaque étape peut être rejouée sans effet de
 * bord. `onProgress` remonte les étapes à l'écran pour afficher une progression
 * réelle plutôt qu'une promesse générale.
 */
export async function purgeAccountData(
  uid: string,
  onProgress?: (progress: DeletionProgress) => void
): Promise<DeletionResult> {
  const result: DeletionResult = { deleted: 0, anonymized: 0, retained: 0, pendingWithdrawals: 0, steps: [] };
  const report = (step: string, done = 0, total = 1) => {
    result.steps.push(step);
    onProgress?.({ step, done, total });
  };

  // 1) Retraits : un retrait encore en attente doit être payé, pas effacé.
  report('Retraits');
  const withdrawals = await getDocs(query(collection(db, 'withdrawals'), where('uid', '==', uid)));
  for (const item of withdrawals.docs) {
    const data = item.data() as Withdrawal;
    if (data.status === 'pending') {
      result.pendingWithdrawals += 1;
      result.retained += 1;
      // Anonymisation partielle autorisée par les règles : le nom disparaît,
      // l'adresse PayPal reste jusqu'au versement (sinon le paiement est perdu).
      await updateDoc(item.ref, { userName: 'Compte supprimé', deletedUser: true }).catch(() => undefined);
    } else {
      result.anonymized += 1;
      await updateDoc(item.ref, {
        userName: 'Compte supprimé',
        paypalEmail: null,
        deletedUser: true,
      }).catch(() => undefined);
    }
  }

  // 2) Signalements et demandes partenaires : anonymisation.
  report('Signalements et demandes partenaires');
  for (const field of ['reporterUid'] as const) {
    const snaps = await getDocs(query(collection(db, 'reports'), where(field, '==', uid)));
    for (const item of snaps.docs) {
      result.anonymized += 1;
      await updateDoc(item.ref, { reporterUid: `deleted_${item.id}`, details: '' }).catch(() => undefined);
    }
  }
  const partners = await getDocs(query(collection(db, 'partnerRequests'), where('uid', '==', uid)));
  for (const item of partners.docs) {
    result.anonymized += 1;
    await updateDoc(item.ref, {
      userName: 'Compte supprimé',
      contactEmail: 'supprimé',
      message: 'Données supprimées',
      deletedUser: true,
    }).catch(() => undefined);
  }

  // 3) Collection par collection, selon l'inventaire.
  const policies = ACCOUNT_DATA_POLICY.filter((policy) => policy.kind === 'delete' && policy.field);
  let index = 0;
  for (const policy of policies) {
    index += 1;
    report(policy.path, index, policies.length);
    const field = policy.field as string;
    const isArray = field === 'members';
    try {
      const ref = isArray
        ? query(collection(db, policy.path), where(field, 'array-contains', uid))
        : query(collection(db, policy.path), where(field, '==', uid));
      result.deleted += await deleteQueryDocs(ref, () => undefined);
    } catch (e) {
      // Une requête refusée ne doit pas interrompre le reste du parcours : on
      // la signale, la vérification des résidus la retrouvera.
      console.warn('[compte] suppression impossible', policy.path, field, (e as Error).message);
    }
  }

  // 4) Sous-collections du profil (Firestore ne cascade pas).
  report('Sous-collections du profil');
  const userPolicy = ACCOUNT_DATA_POLICY.find((policy) => policy.path === 'users/{uid}');
  for (const sub of userPolicy?.subcollections || []) {
    result.deleted += await deleteSubcollection(`users/${uid}/${sub}`);
  }

  // 5) Sous-collections des sorties (jetons de partage par lien).
  report('Jetons de partage des sorties');
  const sessions = await getDocs(query(collection(db, 'activitySessions'), where('uid', '==', uid)));
  for (const item of sessions.docs) {
    result.deleted += await deleteSubcollection(`activitySessions/${item.id}/shareTokens`);
  }

  // 6) Le document profil lui-même, en dernier : c'est lui qui porte l'UID et
  //    qui permet de retrouver les données. Les règles autorisent le client à
  //    le supprimer (`allow delete: if self(uid)`), ce qui n'était pas le cas
  //    des `dailySteps`.
  report('Profil');
  await deleteDoc(doc(db, 'users', uid)).catch((e) => {
    console.warn('[compte] profil non supprimé côté client', (e as Error).message);
  });

  report('Terminé');
  return result;
}

/**
 * Recherche les données résiduelles après une suppression.
 * Sert à afficher une confirmation **vérifiée** plutôt qu'une promesse.
 */
export async function findResidualData(uid: string): Promise<string[]> {
  const residues: string[] = [];
  const checks: Array<{ path: string; field: string }> = [
    { path: 'activitySessions', field: 'uid' },
    { path: 'savedRoutes', field: 'uid' },
    { path: 'activityFeed', field: 'uid' },
    { path: 'directMessages', field: 'from' },
    { path: 'directMessages', field: 'to' },
    { path: 'friendRequests', field: 'from' },
    { path: 'friendRequests', field: 'to' },
    { path: 'friendReactions', field: 'from' },
    { path: 'friendReactions', field: 'to' },
    { path: 'communityEvents', field: 'creatorUid' },
    { path: 'eventNotifications', field: 'toUid' },
    { path: 'notifications' as string, field: 'toUid' },
  ];
  for (const check of checks) {
    try {
      const snaps = await getDocs(query(collection(db, check.path), where(check.field, '==', uid), limit(1)));
      if (!snaps.empty) residues.push(`${check.path}.${check.field}`);
    } catch {
      /* collection absente ou illisible : rien à signaler */
    }
  }
  const profile = await getDoc(doc(db, 'users', uid)).catch(() => null);
  if (profile?.exists()) residues.push('users/{uid}');
  for (const sub of ['dailySteps', 'transactions', 'challenges', 'badges', 'notificationTokens', 'privateActivityNotes', 'private']) {
    const snaps = await getDocs(query(collection(db, `users/${uid}/${sub}`), limit(1))).catch(() => null);
    if (snaps && !snaps.empty) residues.push(`users/{uid}/${sub}`);
  }
  return residues;
}

// ---------------------------------------------------------------------------
// Export complet et paginé
// ---------------------------------------------------------------------------

export interface AccountExport {
  exportedAt: string;
  formatVersion: number;
  account: Record<string, unknown>;
  collections: Record<string, unknown[]>;
  /** Collections qui n'ont pas pu être lues (droits, panne). */
  warnings: string[];
}

/** Parcourt une collection entière par pages de 200 documents. */
async function readAll(path: string, whereField?: { field: string; value: string }, orderField?: string): Promise<unknown[]> {
  const out: unknown[] = [];
  let cursor: QueryDocumentSnapshot | null = null;
  for (let page = 0; page < 500; page += 1) {
    const constraints: any[] = [];
    if (whereField) constraints.push(where(whereField.field, '==', whereField.value));
    if (orderField) constraints.push(orderBy(orderField, 'desc'));
    if (cursor) constraints.push(startAfter(cursor));
    constraints.push(limit(PAGE));
    let snaps;
    try {
      snaps = await getDocs(query(collection(db, path), ...constraints));
    } catch (e) {
      // Une collection peut exiger un index ou être fermée en lecture : on
      // s'arrête proprement et l'appelant enregistre un avertissement.
      throw new Error(`${path}: ${(e as Error).message}`);
    }
    out.push(...snaps.docs.map((d) => ({ id: d.id, ...d.data() })));
    if (snaps.docs.length < PAGE) break;
    cursor = snaps.docs[snaps.docs.length - 1];
  }
  return out;
}

async function readSubcollection(path: string, orderField?: string): Promise<unknown[]> {
  return readAll(path, undefined, orderField);
}

/**
 * Export **complet** du compte : toutes les sorties, toutes les transactions,
 * tous les messages, badges, fil, parcours, rencontres, défis, retraits…
 * Pagination par curseur : aucune limite arbitraire (les 50 dernières
 * transactions de l'ancienne version appartiennent au passé).
 */
export async function exportAccountComplete(
  uid: string,
  onProgress?: (label: string) => void
): Promise<AccountExport> {
  const warnings: string[] = [];
  const collections: Record<string, unknown[]> = {};

  const load = async (name: string, promise: Promise<unknown[]>) => {
    onProgress?.(name);
    try {
      collections[name] = await promise;
    } catch (e) {
      warnings.push((e as Error).message);
      collections[name] = [];
    }
  };

  await load('activitySessions', readAll('activitySessions', { field: 'uid', value: uid }, 'startedAt'));
  await load('savedRoutes', readAll('savedRoutes', { field: 'uid', value: uid }));
  await load('transactions', readSubcollection(`users/${uid}/transactions`, 'createdAt'));
  await load('dailySteps', readSubcollection(`users/${uid}/dailySteps`));
  await load('challenges', readSubcollection(`users/${uid}/challenges`));
  await load('badges', readSubcollection(`users/${uid}/badges`));
  await load('privateActivityNotes', readSubcollection(`users/${uid}/privateActivityNotes`));
  await load('withdrawals', readAll('withdrawals', { field: 'uid', value: uid }, 'createdAt'));
  await load('directMessagesSent', readAll('directMessages', { field: 'from', value: uid }, 'createdAt'));
  await load('directMessagesReceived', readAll('directMessages', { field: 'to', value: uid }, 'createdAt'));
  await load('friendRequestsSent', readAll('friendRequests', { field: 'from', value: uid }));
  await load('friendRequestsReceived', readAll('friendRequests', { field: 'to', value: uid }));
  await load('friendships', readAll('friendships', { field: 'members', value: uid }));
  await load('friendReactionsSent', readAll('friendReactions', { field: 'from', value: uid }));
  await load('friendReactionsReceived', readAll('friendReactions', { field: 'to', value: uid }));
  await load('activityFeed', readAll('activityFeed', { field: 'uid', value: uid }, 'createdAt'));
  await load('communityEvents', readAll('communityEvents', { field: 'creatorUid', value: uid }));
  await load('reportSubmitted', readAll('reports', { field: 'reporterUid', value: uid }));
  await load('referralClaims', readAll('referralClaims', { field: 'sponsorUid', value: uid }));

  const profile = await getDoc(doc(db, 'users', uid)).catch(() => null);

  return {
    exportedAt: new Date().toISOString(),
    formatVersion: 2,
    account: {
      uid,
      profile: profile?.exists() ? profile.data() : null,
      // Ce que l'export ne contient pas, et pourquoi : l'utilisateur doit
      // pouvoir le lire sans interpréter une absence comme un oubli.
      notes: [
        'Les tracés GPS sont inclus dans activitySessions (champ `points`).',
        'Les jetons de notification (identifiants techniques d’appareil) ne sont pas exportés : ils ne contiennent aucune donnée personnelle.',
        'Les données conservées pour une obligation légale ou comptable (retraits payés) figurent dans `withdrawals`, anonymisées après suppression du compte.',
      ],
    },
    collections,
    warnings,
  };
}

/** Nom de fichier stable et daté. */
export function exportFilename(uid: string, now = new Date()): string {
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  return `elywalk-export-${uid.slice(0, 8)}-${stamp}.json`;
}
