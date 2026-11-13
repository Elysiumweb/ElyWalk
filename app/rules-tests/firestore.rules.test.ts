import { readFileSync } from 'node:fs';
import { afterAll as after, beforeAll as before, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

const PROJECT = 'elywalk-security-tests';
const ALICE = 'alice'; const BOB = 'bob'; const ADMIN = 'BZ333LlhuJMoD4rXIquGE0zzjX43';
let env: RulesTestEnvironment;
const as = (uid: string) => env.authenticatedContext(uid, { email_verified: true }).firestore();
// `fromBlocked: false` est obligatoire : le champ figé à l'envoi est ce qui
// permet aux règles de liste de filtrer sans `get()` par ligne (F12).
const request = (from: string, to: string) => ({ from, fromName: from, to, toName: to, status: 'pending', createdAt: Date.now(), notified: false, fromBlocked: false });
const message = (from: string, to: string) => ({ from, fromName: from, to, toName: to, text: 'Bonjour', createdAt: Date.now(), read: false, fromBlocked: false });
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
    await assertFails(setDoc(doc(as(ALICE), 'friendReactions/alice_bob'), { from: ALICE, to: BOB, emoji: '👏', message: '', fromBlocked: false }));
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
const friendship = (a: string, b: string) => ({ members: [a, b].sort(), createdAt: 1, hiddenFor: [] });

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


// F07 — régression « je ne vois pas les autres au classement ».
// Firestore n'accorde que 10 appels de document par requête (pas par ligne) :
// une règle de liste qui vérifie le blocage coûtait 2 appels par profil évalué,
// donc toute requête de plus de 5 résultats était refusée. Le classement ne
// montrait plus que l'utilisateur courant.
describe('F07 — lisibilité du classement', () => {
  const profile = (uid: string, coins: number) => ({
    uid, displayName: uid, photoURL: null, role: 'user', createdAt: 1,
    totalSteps: coins, totalCalories: 0, streak: 0, todaySteps: 0, todayDate: '2026-11-12',
    elycoins: coins, referralCode: uid.toUpperCase(), dailyStepGoal: 10000, unitSystem: 'metric',
    onboardingDone: true, lastValidatedDate: '2026-11-12', email: `${uid}@example.com`,
  });

  it('autorise une requête de 60 profils triés', async () => {
    const { setDoc: write, collection: col, getDocs, query, orderBy, limit: lim } = await import('firebase/firestore');
    await env.withSecurityRulesDisabled(async (ctx) => {
      for (let i = 0; i < 60; i += 1) {
        await write(doc(ctx.firestore(), `users/player${i}`), profile(`player${i}`, i));
      }
    });
    const snaps = await assertSucceeds(
      getDocs(query(col(as(BOB), 'users'), orderBy('elycoins', 'desc'), lim(60)))
    );
    expect(snaps.docs.length).toBe(60);
  });

  it('refuse une requête au-delà du plafond de 200 profils', async () => {
    const { collection: col, getDocs, query, limit: lim } = await import('firebase/firestore');
    await assertFails(getDocs(query(col(as(BOB), 'users'), lim(500))));
  });

  it('autorise 30 jours de pas quotidiens pour un tiers (colonnes 7/30 jours)', async () => {
    const { collection: col, getDocs, query, orderBy, limit: lim } = await import('firebase/firestore');
    await assertSucceeds(setDoc(doc(as(ALICE), 'activitySessions/x'), session(ALICE, 'private')));
    await env.withSecurityRulesDisabled(async (ctx) => {
      for (let d = 1; d <= 30; d += 1) {
        const day = `2026-11-${String(d).padStart(2, '0')}`;
        await setDoc(doc(ctx.firestore(), `users/alice/dailySteps/${day}`), { steps: 100, coins: 1, calories: 10, validatedAt: d });
      }
    });
    const snaps = await assertSucceeds(
      getDocs(query(col(as(BOB), 'users/alice/dailySteps'), orderBy('validatedAt', 'desc'), lim(30)))
    );
    expect(snaps.docs.length).toBe(30);
  });
});

// « Les amis chargent en boucle » : la même limite de 10 accès document
// s'appliquait aux lectures de `friendships`, `friendRequests`,
// `friendReactions`, `directMessages` et du fil. Vérifier le blocage par
// `exists()` coûtait 2 appels par document : la requête était refusée dès le 6e
// ami, `onSnapshot` échouait et l'écran restait en chargement.
//
// Le blocage est désormais répliqué dans les documents lus (`blockedBy`,
// `hiddenFor`, `fromBlocked`) : les règles de liste n'ont plus aucun appel de
// document, donc leur coût ne dépend plus du nombre de résultats.
describe('F12 — lectures d’amis sans dépassement de budget', () => {
  const profile = (uid: string, extra: Record<string, unknown> = {}) => ({
    uid, displayName: uid, photoURL: null, role: 'user', createdAt: 1,
    totalSteps: 0, totalCalories: 0, streak: 0, todaySteps: 0, todayDate: '2026-11-12',
    elycoins: 0, referralCode: uid.toUpperCase(), dailyStepGoal: 10000, unitSystem: 'metric',
    onboardingDone: true, lastValidatedDate: '2026-11-12', email: `${uid}@example.com`,
    blockedUsers: [] as string[], blockedBy: [] as string[], ...extra,
  });

  it('autorise la liste des 20 amis d’un utilisateur', async () => {
    const { collection: col, getDocs, query, where, limit: lim } = await import('firebase/firestore');
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/alice'), profile(ALICE));
      for (let i = 0; i < 20; i += 1) {
        await setDoc(doc(ctx.firestore(), `users/friend${i}`), profile(`friend${i}`));
        await setDoc(doc(ctx.firestore(), `friendships/alice_friend${i}`), {
          members: [ALICE, `friend${i}`], createdAt: Date.now(), hiddenFor: [],
        });
      }
    });
    const snaps = await assertSucceeds(
      getDocs(query(col(as(ALICE), 'friendships'), where('members', 'array-contains', ALICE), lim(20)))
    );
    expect(snaps.docs.length).toBe(20);
  });

  it('autorise 25 messages, encouragements et demandes reçues', async () => {
    const { collection: col, getDocs, query, where, limit: lim } = await import('firebase/firestore');
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/alice'), profile(ALICE));
      await setDoc(doc(ctx.firestore(), 'users/bob'), profile(BOB));
      for (let i = 0; i < 25; i += 1) {
        await setDoc(doc(ctx.firestore(), `directMessages/m${i}`), message(BOB, ALICE));
        await setDoc(doc(ctx.firestore(), `friendReactions/r${i}`), { from: BOB, to: ALICE, emoji: '👏', message: '', fromBlocked: false });
        await setDoc(doc(ctx.firestore(), `friendRequests/q${i}`), request(BOB, ALICE));
      }
    });
    const dm = await assertSucceeds(getDocs(query(col(as(ALICE), 'directMessages'), where('to', '==', ALICE), lim(25))));
    expect(dm.docs.length).toBe(25);
    const reactions = await assertSucceeds(getDocs(query(col(as(ALICE), 'friendReactions'), where('to', '==', ALICE), lim(25))));
    expect(reactions.docs.length).toBe(25);
    const reqs = await assertSucceeds(getDocs(query(col(as(ALICE), 'friendRequests'), where('to', '==', ALICE), lim(25))));
    expect(reqs.docs.length).toBe(25);
  });

  it('retire un profil bloqué du classement via `blockedBy`, sans casser la requête', async () => {
    const { collection: col, getDocs, query, orderBy, limit: lim } = await import('firebase/firestore');
    await env.withSecurityRulesDisabled(async (ctx) => {
      // Alice a bloqué Bob : `blockedBy` est écrit sur le profil de Bob.
      await setDoc(doc(ctx.firestore(), 'users/bob'), profile(BOB, { blockedBy: [ALICE] }));
      for (let i = 0; i < 40; i += 1) {
        await setDoc(doc(ctx.firestore(), `users/player${i}`), profile(`player${i}`, { elycoins: i }));
      }
    });
    const snaps = await assertSucceeds(
      getDocs(query(col(as(ALICE), 'users'), orderBy('elycoins', 'desc'), lim(60)))
    );
    // 40 résultats lisibles, aucun refus : le coût de la règle ne dépend plus du
    // nombre de documents examinés.
    expect(snaps.docs.length).toBe(40);
    expect(snaps.docs.some((d) => d.id === 'bob')).toBe(false);
  });

  it('masque une amitié bloquée via `hiddenFor`', async () => {
    const { collection: col, getDocs, query, where, limit: lim } = await import('firebase/firestore');
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/alice'), profile(ALICE));
      await setDoc(doc(ctx.firestore(), 'users/bob'), profile(BOB));
      await setDoc(doc(ctx.firestore(), 'friendships/alice_bob'), {
        members: [ALICE, BOB], createdAt: Date.now(), hiddenFor: [ALICE],
      });
    });
    const snaps = await assertSucceeds(
      getDocs(query(col(as(ALICE), 'friendships'), where('members', 'array-contains', ALICE), lim(20)))
    );
    expect(snaps.docs.length).toBe(0);
    // L'autre membre conserve sa ligne tant qu'il n'a pas bloqué à son tour.
    const other = await assertSucceeds(
      getDocs(query(col(as(BOB), 'friendships'), where('members', 'array-contains', BOB), lim(20)))
    );
    expect(other.docs.length).toBe(1);
  });

  it('`blockedBy` n’accepte que l’identifiant de celui qui écrit', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/alice'), profile(ALICE));
      await setDoc(doc(ctx.firestore(), 'users/bob'), profile(BOB));
    });
    // Bob déclare son propre blocage sur le profil d'Alice : autorisé.
    await assertSucceeds(updateDoc(doc(as(BOB), 'users/alice'), { blockedBy: [BOB] }));
    // Bob ne peut pas accuser un tiers…
    await assertFails(updateDoc(doc(as(BOB), 'users/alice'), { blockedBy: [BOB, 'carol'] }));
    // …ni retirer un blocage qui n'est pas le sien.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'users/bob'), { blockedBy: [ADMIN] });
    });
    await assertFails(updateDoc(doc(as(ALICE), 'users/bob'), { blockedBy: [] }));
    // Personne n'écrit sa propre liste `blockedBy` (on ne se déclare pas bloqué).
    await assertFails(updateDoc(doc(as(BOB), 'users/bob'), { blockedBy: [] }));
  });

  it('autorise la mise à jour de blockedUsers, un ajout à la fois', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/alice'), profile(ALICE));
      await setDoc(doc(ctx.firestore(), 'users/bob'), profile(BOB));
      await setDoc(doc(ctx.firestore(), 'users/carol'), profile('carol'));
    });
    await assertSucceeds(updateDoc(doc(as(ALICE), 'users/alice'), { blockedUsers: [BOB] }));
    await assertSucceeds(updateDoc(doc(as(ALICE), 'users/alice'), { blockedUsers: [BOB, 'carol'] }));
    // Deux retraits d'un coup : refusé (impossible de vider la liste).
    await assertFails(updateDoc(doc(as(ALICE), 'users/alice'), { blockedUsers: [] }));
    // Écrire dans la liste d'un autre : refusé.
    await assertFails(updateDoc(doc(as(ALICE), 'users/bob'), { blockedUsers: [ALICE] }));
    // La liste peut accompagner une modification de profil (lot atomique du
    // client), mais uniquement avec un delta d'une entrée.
    await assertSucceeds(updateDoc(doc(as(ALICE), 'users/alice'), { blockedUsers: ['carol'], bio: 'coucou' }));
    await assertSucceeds(updateDoc(doc(as(ALICE), 'users/alice'), { blockedUsers: [], bio: 'encore' }));
    // `blockedBy` ne peut pas être glissé dans une modification de profil.
    await assertFails(updateDoc(doc(as(ALICE), 'users/alice'), { bio: 'x', blockedBy: [BOB] }));
  });
});

// Alertes de rencontre : le rayon « rencontres proches » et la dernière
// position approximative sont écrits par le client et lus par le cron. Sans
// ces champs autorisés, l'ajustement du rayon restait une préférence locale et
// aucune alerte ne pouvait partir quand l'application était fermée.
describe('alertes — préférences et position approximative', () => {
  const base = (uid: string) => ({
    uid, displayName: uid, photoURL: null, role: 'user', createdAt: 1,
    totalSteps: 0, totalCalories: 0, streak: 0, todaySteps: 0, todayDate: '2026-11-12',
    elycoins: 0, referralCode: uid.toUpperCase(), dailyStepGoal: 10000,
    unitSystem: 'metric', onboardingDone: true, lastValidatedDate: '2026-11-12',
  });
  const alerts = (extra: Record<string, unknown> = {}) => ({
    messages: true, friendRequests: true, nearbyEvents: true, nearbyRadiusKm: 10,
    eventReminders: true, eventReminderMinutes: 60, updatedAt: Date.now(), ...extra,
  });

  it('accepte un rayon dans les bornes et une position valide', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/alice'), base(ALICE));
    });
    await assertSucceeds(updateDoc(doc(as(ALICE), 'users/alice'), { alerts: alerts({ nearbyRadiusKm: 25 }) }));
    await assertSucceeds(updateDoc(doc(as(ALICE), 'users/alice'), { alerts: alerts(), lastLat: 48.85, lastLng: 2.35 }));
  });

  it('refuse un rayon hors bornes ou une position impossible', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/alice'), base(ALICE));
    });
    await assertFails(updateDoc(doc(as(ALICE), 'users/alice'), { alerts: alerts({ nearbyRadiusKm: 500 }) }));
    await assertFails(updateDoc(doc(as(ALICE), 'users/alice'), { alerts: alerts({ eventReminderMinutes: 99999 }) }));
    await assertFails(updateDoc(doc(as(ALICE), 'users/alice'), { lastLat: 120 }));
    await assertFails(updateDoc(doc(as(ALICE), 'users/alice'), { alerts: alerts({ unknownKey: true }) }));
  });

  it('interdit d’écrire les alertes d’un autre compte', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/bob'), base(BOB));
    });
    await assertFails(updateDoc(doc(as(ALICE), 'users/bob'), { alerts: alerts() }));
  });
});
