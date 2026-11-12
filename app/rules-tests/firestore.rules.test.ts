import { readFileSync } from 'node:fs';
import { afterAll as after, beforeAll as before, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

const PROJECT = 'elywalk-security-tests';
const ALICE = 'alice'; const BOB = 'bob'; const ADMIN = 'BZ333LlhuJMoD4rXIquGE0zzjX43';
let env: RulesTestEnvironment;
const as = (uid: string) => env.authenticatedContext(uid, { email_verified: true }).firestore();
const request = (from: string, to: string) => ({ from, fromName: from, to, toName: to, status: 'pending', createdAt: Date.now(), notified: false });
const message = (from: string, to: string) => ({ from, fromName: from, to, toName: to, text: 'Bonjour', createdAt: Date.now(), read: false });
const block = (ownerUid: string, blockedUid: string) => ({ ownerUid, blockedUid, blockedName: blockedUid, createdAt: Date.now() });

before(async () => { env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: readFileSync('../firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 } }); });
beforeEach(() => env.clearFirestore());
after(() => env.cleanup());

describe('blocage bilatéral', () => {
  it('refuse demandes, messages et encouragements après un blocage', async () => {
    await setDoc(doc(as(ALICE), 'blockedAccounts/alice_bob'), block(ALICE, BOB));
    await assertFails(setDoc(doc(as(BOB), 'friendRequests/bob_alice'), request(BOB, ALICE)));
    await assertFails(setDoc(doc(as(ALICE), 'friendRequests/alice_bob'), request(ALICE, BOB)));
    await assertFails(setDoc(doc(as(BOB), 'directMessages/bob_alice'), message(BOB, ALICE)));
    await assertFails(setDoc(doc(as(ALICE), 'friendReactions/alice_bob'), { from: ALICE, to: BOB, emoji: '👏', message: '' }));
  });
  it('autorise les interactions sans blocage et seul le propriétaire débloque', async () => {
    await assertSucceeds(setDoc(doc(as(BOB), 'friendRequests/bob_alice'), request(BOB, ALICE)));
    await setDoc(doc(as(ALICE), 'blockedAccounts/alice_bob'), block(ALICE, BOB));
    const { deleteDoc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(as(BOB), 'blockedAccounts/alice_bob')));
    await assertSucceeds(deleteDoc(doc(as(ALICE), 'blockedAccounts/alice_bob')));
  });
});

describe('signalements et modération', () => {
  const report = { reporterUid: ALICE, targetUid: BOB, targetType: 'message', targetId: 'message-1', reason: 'harassment', details: 'Message intimidant', status: 'open', history: [], createdAt: 1, updatedAt: 1 };
  it('autorise le dépôt mais interdit sa modification par le déclarant', async () => {
    await assertSucceeds(setDoc(doc(as(ALICE), 'reports/report-1'), report));
    await assertFails(updateDoc(doc(as(ALICE), 'reports/report-1'), { status: 'resolved' }));
    await assertFails(getDoc(doc(as(BOB), 'reports/report-1')));
  });
  it('autorise uniquement un administrateur à inscrire une action', async () => {
    await setDoc(doc(as(ALICE), 'reports/report-1'), report);
    await assertSucceeds(updateDoc(doc(as(ADMIN), 'reports/report-1'), { status: 'resolved', updatedAt: 2, history: [{ status: 'resolved', actorUid: ADMIN, note: 'Traité', createdAt: 2 }] }));
  });
});

describe('parcours privés', () => {
  const route = { uid: ALICE, ownerName: 'Alice', name: 'Boucle', description: '', points: [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }], distanceM: 1, elevationGainM: 0, elevationLossM: 0, visibility: 'private', createdAt: 1, updatedAt: 1 };
  it('reste lisible par son propriétaire uniquement', async () => {
    await setDoc(doc(as(ALICE), 'savedRoutes/route-1'), route);
    await assertSucceeds(getDoc(doc(as(ALICE), 'savedRoutes/route-1')));
    await assertFails(getDoc(doc(as(BOB), 'savedRoutes/route-1')));
  });
});

// F01 — audiences vérifiées côté serveur et données privées séparées.
const session = (uid: string, visibility: 'private' | 'friends' | 'link') => ({
  uid, type: 'walk', startedAt: 1, durationSec: 60, distanceM: 100, calories: 5,
  points: [{ lat: 1, lng: 1, recordedAt: 1 }], status: 'completed', visibility,
});
const friendship = (a: string, b: string) => ({ members: [a, b].sort(), createdAt: 1 });

describe('F01 — audiences des sorties', () => {
  it('refuse une sortie « amis » à un tiers non ami', async () => {
    await setDoc(doc(as(ALICE), 'activitySessions/s1'), session(ALICE, 'friends'));
    await assertFails(getDoc(doc(as(BOB), 'activitySessions/s1')));
  });

  it('autorise une sortie « amis » à une amitié enregistrée', async () => {
    await setDoc(doc(as(ALICE), 'activitySessions/s1'), session(ALICE, 'friends'));
    await setDoc(doc(as(ALICE), 'friendships/alice_bob'), friendship(ALICE, BOB));
    await assertSucceeds(getDoc(doc(as(BOB), 'activitySessions/s1')));
  });

  it('refuse la sortie « lien » sans document de partage, puis après révocation', async () => {
    await setDoc(doc(as(ALICE), 'activitySessions/s1'), session(ALICE, 'link'));
    await assertFails(getDoc(doc(as(BOB), 'activitySessions/s1')));
    await assertSucceeds(setDoc(doc(as(ALICE), 'shareLinks/s1_alice'), {
      sessionId: 's1', ownerUid: ALICE, token: 'jeton-aleatoire-de-24-car', scope: 'summary',
      revoked: false, createdAt: 1, expiresAt: null, distanceM: 100, title: 'Sortie', caption: '',
    }));
    await assertSucceeds(getDoc(doc(as(BOB), 'activitySessions/s1')));
    // Le résumé partagé est lisible sans compte, et ne contient pas le tracé.
    const { getDoc: read } = await import('firebase/firestore');
    const shared = await read(doc(env.unauthenticatedContext().firestore(), 'shareLinks/s1_alice'));
    expect(shared.data()?.caption).toBe('');
    const { deleteDoc } = await import('firebase/firestore');
    await assertSucceeds(deleteDoc(doc(as(ALICE), 'shareLinks/s1_alice')));
    await assertFails(getDoc(doc(as(BOB), 'activitySessions/s1')));
  });

  it('n’autorise pas un tiers à révoquer le lien d’un autre', async () => {
    await assertSucceeds(setDoc(doc(as(ALICE), 'shareLinks/s1_alice'), {
      sessionId: 's1', ownerUid: ALICE, token: 'jeton-aleatoire-de-24-car', scope: 'summary',
      createdAt: 1, distanceM: 100,
    }));
    const { deleteDoc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(as(BOB), 'shareLinks/s1_alice')));
  });

  it('applique le blocage aux lectures comme aux interactions', async () => {
    await setDoc(doc(as(ALICE), 'activitySessions/s1'), session(ALICE, 'friends'));
    await setDoc(doc(as(ALICE), 'friendships/alice_bob'), friendship(ALICE, BOB));
    await assertSucceeds(getDoc(doc(as(BOB), 'activitySessions/s1')));
    await setDoc(doc(as(ALICE), 'blockedAccounts/alice_bob'), block(ALICE, BOB));
    await assertFails(getDoc(doc(as(BOB), 'activitySessions/s1')));
  });

  it('interdit de réintroduire la note privée dans la sortie partagée', async () => {
    await setDoc(doc(as(ALICE), 'activitySessions/s1'), session(ALICE, 'friends'));
    await assertFails(updateDoc(doc(as(ALICE), 'activitySessions/s1'), {
      note: 'Note que je croyais privée', points: session(ALICE, 'friends').points,
      distanceM: 100, durationSec: 60, status: 'completed',
    }));
  });

  it('protège les notes privées de toute lecture par un tiers', async () => {
    await assertSucceeds(setDoc(doc(as(ALICE), 'users/alice/privateActivityNotes/s1'), { note: 'Privé', sessionId: 's1', updatedAt: 1 }));
    await assertSucceeds(getDoc(doc(as(ALICE), 'users/alice/privateActivityNotes/s1')));
    await assertFails(getDoc(doc(as(BOB), 'users/alice/privateActivityNotes/s1')));
  });

  it('protège les signaux antifraude', async () => {
    await assertSucceeds(setDoc(doc(as(ALICE), 'users/alice/private/signals'), { lastIp: '1.2.3.4' }));
    await assertFails(getDoc(doc(as(BOB), 'users/alice/private/signals')));
    await assertSucceeds(getDoc(doc(as(ADMIN), 'users/alice/private/signals')));
  });

  it('borne la lecture des pas quotidiens d’un tiers non ami', async () => {
    await assertSucceeds(setDoc(doc(as(ALICE), 'users/alice/dailySteps/2026-11-12'), { steps: 100, coins: 1, calories: 10, validatedAt: 1 }));
    // Fenêtre bornée (≤ 31 jours) : nécessaire au classement 7 / 30 jours.
    await assertSucceeds(getDoc(doc(as(BOB), 'users/alice/dailySteps/2026-11-12')));
    const { getDocs, query, collection: col, limit: lim } = await import('firebase/firestore');
    // Balayage de la sous-collection (1 an d’historique) : refusé.
    await assertFails(getDocs(query(col(as(BOB), 'users/alice/dailySteps'), lim(365))));
    // Ami vérifié : historique complet autorisé.
    await setDoc(doc(as(ALICE), 'friendships/alice_bob'), friendship(ALICE, BOB));
    await assertSucceeds(getDocs(query(col(as(BOB), 'users/alice/dailySteps'), lim(365))));
  });
});
