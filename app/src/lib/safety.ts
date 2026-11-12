import {
  addDoc, arrayUnion, collection, deleteDoc, doc, getDoc, getDocs, onSnapshot,
  orderBy, query, setDoc, updateDoc, where, writeBatch, type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import { isPresidentUid } from './constants';
import type { BlockedAccount, ContentReport, Friendship, ReportStatus, ReportTargetType, UserProfile } from './types';

export function blockId(ownerUid: string, blockedUid: string) {
  return `${ownerUid}_${blockedUid}`;
}

/** Ajoute ou retire un identifiant sans réécrire toute la liste. */
function blockedUsersValue(current: unknown, otherUid: string, action: 'add' | 'remove'): string[] {
  const list = Array.isArray(current) ? current.filter((v): v is string => typeof v === 'string' && v.length > 0) : [];
  const unique = Array.from(new Set(list));
  return action === 'add' ? Array.from(new Set([...unique, otherUid])) : unique.filter((uid) => uid !== otherUid);
}

/** Lit une liste d'identifiants stockée dans un document, sans doublon. */
function idList(value: unknown): string[] {
  return Array.isArray(value) ? Array.from(new Set(value.filter((v): v is string => typeof v === 'string' && v.length > 0))) : [];
}

/** Les deux amitiés possibles entre deux comptes (l'identifiant est trié). */
function friendshipCollection() {
  return collection(db, 'friendships');
}

/**
 * Blocage bilatéral : les deux comptes ne peuvent plus interagir.
 *
 * Trois écritures, **dans un seul lot atomique** :
 *  • `blockedAccounts/{owner}_{target}` — source de vérité, avec le nom ;
 *  • `users/{owner}.blockedUsers` — ce que j'ai bloqué. Sert aux contrôles
 *    d'écriture (`canInteract`, 2 `get` au plus) ;
 *  • `users/{target}.blockedBy` — qui m'a bloqué, écrit **chez l'autre**. C'est
 *    ce champ qui permet à une règle de **liste** de filtrer un profil bloqué
 *    sans aucun `get()` : Firestore plafonne une requête à 10 appels de
 *    document au total, un `get()` par ligne refusait donc la requête au 11e
 *    résultat (classement vide en 2.2.0, amis qui bouclaient en 2.2.1).
 *  • `friendships/{id}.hiddenFor` — retire l'amitié des deux listes sans
 *    supprimer l'historique.
 *
 * Le lot évite l'état intermédiaire où le blocage existe sans être visible des
 * listes (l'utilisateur bloqué réapparaîtrait au rafraîchissement suivant).
 */
export async function blockAccount(owner: UserProfile, target: UserProfile): Promise<void> {
  if (owner.uid === target.uid) throw new Error('Vous ne pouvez pas vous bloquer vous-même.');
  const ownerRef = doc(db, 'users', owner.uid);
  const targetRef = doc(db, 'users', target.uid);
  const [ownerSnap, targetSnap] = await Promise.all([getDoc(ownerRef), getDoc(targetRef)]);
  if (!ownerSnap.exists()) throw new Error('Profil introuvable : impossible d’enregistrer le blocage.');

  const batch = writeBatch(db);
  batch.set(doc(db, 'blockedAccounts', blockId(owner.uid, target.uid)), {
    ownerUid: owner.uid,
    blockedUid: target.uid,
    blockedName: target.displayName,
    createdAt: Date.now(),
  } satisfies BlockedAccount);
  batch.update(ownerRef, {
    blockedUsers: blockedUsersValue((ownerSnap.data() as UserProfile).blockedUsers, target.uid, 'add'),
  });
  // Le profil de la cible peut ne pas être lisible (compte supprimé) : la règle
  // du blocage reste la référence, on ne bloque pas l'opération pour autant.
  if (targetSnap.exists()) {
    batch.update(targetRef, {
      blockedBy: blockedUsersValue((targetSnap.data() as UserProfile).blockedBy, owner.uid, 'add'),
    });
  }
  // Plusieurs documents d'amitié peuvent exister pour la même paire (créés par
  // `addDoc`) : on les masque tous pour l'auteur du blocage.
  const friendships = await getDocs(
    query(friendshipCollection(), where('members', 'array-contains', owner.uid)),
  );
  friendships.docs
    .filter((d) => idList((d.data() as Friendship).members).includes(target.uid))
    .forEach((d) => batch.update(d.ref, {
      hiddenFor: idList((d.data() as Friendship).hiddenFor).concat(owner.uid),
    }));
  await batch.commit();
}

/** Déblocage : les quatre représentations repartent ensemble. */
export async function unblockAccount(ownerUid: string, blockedUid: string): Promise<void> {
  const ownerRef = doc(db, 'users', ownerUid);
  const targetRef = doc(db, 'users', blockedUid);
  const [ownerSnap, targetSnap] = await Promise.all([getDoc(ownerRef), getDoc(targetRef)]);
  const batch = writeBatch(db);
  batch.delete(doc(db, 'blockedAccounts', blockId(ownerUid, blockedUid)));
  if (ownerSnap.exists()) {
    batch.update(ownerRef, {
      blockedUsers: blockedUsersValue((ownerSnap.data() as UserProfile).blockedUsers, blockedUid, 'remove'),
    });
  }
  if (targetSnap.exists()) {
    batch.update(targetRef, {
      blockedBy: blockedUsersValue((targetSnap.data() as UserProfile).blockedBy, ownerUid, 'remove'),
    });
  }
  // On interroge les deux membres : l'identifiant de l'amitié n'est pas garanti
  // (`addDoc` historique), donc aucune supposition sur l'ordre des participants.
  const [asOwner, asTarget] = await Promise.all([
    getDocs(query(friendshipCollection(), where('members', 'array-contains', ownerUid))),
    getDocs(query(friendshipCollection(), where('members', 'array-contains', blockedUid))),
  ]);
  const seen = new Set<string>();
  [...asOwner.docs, ...asTarget.docs]
    .filter((d) => {
      if (seen.has(d.id)) return false;
      seen.add(d.id);
      return idList((d.data() as Friendship).members).includes(blockedUid)
        && idList((d.data() as Friendship).members).includes(ownerUid);
    })
    .forEach((d) => batch.update(d.ref, {
      hiddenFor: idList((d.data() as Friendship).hiddenFor).filter((uid) => uid !== ownerUid),
    }));
  await batch.commit();
}

/**
 * Renseigne `users.blockedUsers` pour les comptes créés avant la 2.2.2, à
 * partir de la table `blockedAccounts` (source de vérité, avec les noms).
 *
 * Réservé au président : relire la table complète des blocages n'est pas une
 * opération d'utilisateur. Idempotent — un profil qui possède déjà la clé n'est
 * jamais touché, pour ne pas écraser une liste écrite par une version plus
 * récente de l'application.
 *
 * `uid` est l'administrateur qui lance l'opération ; il est vérifié ici pour
 * donner un message clair avant que les règles ne refusent la lecture.
 */
export async function backfillBlockedUsers(uid: string): Promise<{ updated: number; skipped: number }> {
  if (!isPresidentUid(uid)) throw new Error('Migration réservée au Président et au Co-Président.');
  const profils = await getDocs(collection(db, 'users'));
  const blocked = await getDocs(collection(db, 'blockedAccounts'));
  const byOwner = new Map<string, string[]>();
  blocked.docs.forEach((d) => {
    const data = d.data() as BlockedAccount;
    if (!data?.ownerUid || !data?.blockedUid) return;
    byOwner.set(data.ownerUid, [...(byOwner.get(data.ownerUid) || []), data.blockedUid]);
  });
  // Relation inverse : qui a bloqué ce compte. Sans elle, un profil ancien
  // n'apparaît pas comme bloquant dans les listes.
  const byTarget = new Map<string, string[]>();
  blocked.docs.forEach((d) => {
    const data = d.data() as BlockedAccount;
    if (!data?.ownerUid || !data?.blockedUid) return;
    byTarget.set(data.blockedUid, [...(byTarget.get(data.blockedUid) || []), data.ownerUid]);
  });
  let updated = 0;
  let skipped = 0;
  for (const profile of profils.docs) {
    const data = profile.data() as UserProfile;
    const hasBlob = Array.isArray(data.blockedUsers) && Array.isArray(data.blockedBy);
    if (hasBlob) { skipped += 1; continue; }
    const patch: { blockedUsers?: string[]; blockedBy?: string[] } = {};
    if (!Array.isArray(data.blockedUsers)) patch.blockedUsers = idList(byOwner.get(data.uid)).slice(0, 200);
    if (!Array.isArray(data.blockedBy)) patch.blockedBy = idList(byTarget.get(data.uid)).slice(0, 200);
    await updateDoc(profile.ref, patch).catch(() => undefined);
    updated += 1;
  }
  return { updated, skipped };
}

export function watchBlockedAccounts(uid: string, cb: (items: BlockedAccount[]) => void): Unsubscribe {
  return onSnapshot(query(collection(db, 'blockedAccounts'), where('ownerUid', '==', uid)), snap => {
    cb(snap.docs.map(d => ({ id: d.id, ...(d.data() as BlockedAccount) })).sort((a, b) => b.createdAt - a.createdAt));
  });
}

/**
 * Blocage effectif entre deux comptes, au choix le moins coûteux.
 *
 * Le profil local porte `blockedUsers` (ce que j'ai bloqué) et `blockedBy` (qui
 * m'a bloqué), tous deux écrits par `blockAccount` : deux lectures de documents
 * connus d'avance suffisent, et elles sont mises en cache si l'appelant vient
 * déjà de charger ces profils. La table `blockedAccounts` reste la source de
 * vérité et sert de repli quand un champ manque (profil antérieur à la 2.2.2 ou
 * liste non encore migrée).
 */
export async function isEitherBlocked(a: string, b: string): Promise<boolean> {
  if (a === b) return false;
  const [ownSnap, reverseSnap] = await Promise.all([
    getDoc(doc(db, 'users', a)),
    getDoc(doc(db, 'users', b)),
  ]);
  const own = ownSnap.exists() ? (ownSnap.data() as UserProfile) : null;
  const reverse = reverseSnap.exists() ? (reverseSnap.data() as UserProfile) : null;
  if (own && idList(own.blockedUsers).includes(b)) return true;
  if (reverse && idList(reverse.blockedUsers).includes(a)) return true;
  if (reverse && idList(reverse.blockedBy).includes(a)) return true;
  if (own && idList(own.blockedBy).includes(a)) return true;
  // Repli : migration incomplète, on interroge la table de référence.
  const [direct, mirrored] = await Promise.all([
    getDoc(doc(db, 'blockedAccounts', blockId(a, b))),
    getDoc(doc(db, 'blockedAccounts', blockId(b, a))),
  ]);
  return direct.exists() || mirrored.exists();
}

export async function assertNotBlocked(a: string, b: string): Promise<void> {
  if (await isEitherBlocked(a, b)) throw new Error('Cette interaction est indisponible.');
}

export async function reportContent(reporter: UserProfile, input: {
  targetUid: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: ContentReport['reason'];
  details?: string;
}): Promise<void> {
  if (reporter.uid === input.targetUid) throw new Error('Vous ne pouvez pas signaler votre propre contenu.');
  const details = (input.details || '').trim();
  if (input.reason === 'other' && details.length < 10) throw new Error('Précisez le motif en au moins 10 caractères.');
  await addDoc(collection(db, 'reports'), {
    reporterUid: reporter.uid,
    targetUid: input.targetUid,
    targetType: input.targetType,
    targetId: input.targetId,
    reason: input.reason,
    details: details.slice(0, 1000),
    status: 'open',
    history: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } satisfies ContentReport);
}

export function watchReports(cb: (items: ContentReport[]) => void): Unsubscribe {
  return onSnapshot(query(collection(db, 'reports'), orderBy('createdAt', 'desc')), snap => {
    cb(snap.docs.map(d => ({ id: d.id, ...(d.data() as ContentReport) })));
  });
}

export async function reviewReport(id: string, adminUid: string, status: ReportStatus, note: string): Promise<void> {
  await updateDoc(doc(db, 'reports', id), {
    status,
    updatedAt: Date.now(),
    history: arrayUnion({ status, actorUid: adminUid, note: note.trim().slice(0, 500), createdAt: Date.now() }),
  });
}
