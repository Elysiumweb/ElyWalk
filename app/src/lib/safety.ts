import {
  addDoc, arrayUnion, collection, deleteDoc, doc, getDoc, getDocs, onSnapshot,
  orderBy, query, setDoc, updateDoc, where, type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import type { BlockedAccount, ContentReport, ReportStatus, ReportTargetType, UserProfile } from './types';

export function blockId(ownerUid: string, blockedUid: string) {
  return `${ownerUid}_${blockedUid}`;
}

/** Blocage bilatéral : les deux comptes ne peuvent plus interagir. */
export async function blockAccount(owner: UserProfile, target: UserProfile): Promise<void> {
  if (owner.uid === target.uid) throw new Error('Vous ne pouvez pas vous bloquer vous-même.');
  await setDoc(doc(db, 'blockedAccounts', blockId(owner.uid, target.uid)), {
    ownerUid: owner.uid,
    blockedUid: target.uid,
    blockedName: target.displayName,
    createdAt: Date.now(),
  } satisfies BlockedAccount);
}

export async function unblockAccount(ownerUid: string, blockedUid: string): Promise<void> {
  await deleteDoc(doc(db, 'blockedAccounts', blockId(ownerUid, blockedUid)));
}

export function watchBlockedAccounts(uid: string, cb: (items: BlockedAccount[]) => void): Unsubscribe {
  return onSnapshot(query(collection(db, 'blockedAccounts'), where('ownerUid', '==', uid)), snap => {
    cb(snap.docs.map(d => ({ id: d.id, ...(d.data() as BlockedAccount) })).sort((a, b) => b.createdAt - a.createdAt));
  });
}

export async function isEitherBlocked(a: string, b: string): Promise<boolean> {
  const [own, reverse] = await Promise.all([
    getDoc(doc(db, 'blockedAccounts', blockId(a, b))),
    getDoc(doc(db, 'blockedAccounts', blockId(b, a))),
  ]);
  return own.exists() || reverse.exists();
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
