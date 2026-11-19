import { readFileSync } from 'node:fs';
import { afterAll as after, beforeAll as before, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, writeBatch, serverTimestamp } from 'firebase/firestore';

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

describe('version de l’application', () => {
  it('autorise la lecture publique des métadonnées de mise à jour, sans ouvrir les écritures', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'appRelease/current'), {
        latestVersion: '9.9.9', notes: 'Nouvelle version', enabled: true,
      });
    });
    const publicDb = env.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(publicDb, 'appRelease/current')));
    await assertFails(setDoc(doc(publicDb, 'appRelease/other'), { latestVersion: '10.0.0' }));
    await assertFails(setDoc(doc(as(BOB), 'appRelease/current'), { latestVersion: '10.0.0' }));
  });
});

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

// ---------------------------------------------------------------------------
// 2.2.4 — régressions signalées et nouveautés A8 / A9 / A10 / A12.1.
// ---------------------------------------------------------------------------

const profile = (uid: string) => ({
  uid, displayName: uid, photoURL: null, role: 'user', createdAt: 1,
  totalSteps: 0, totalCalories: 0, streak: 0, todaySteps: 0, todayDate: '2026-11-12',
  elycoins: 0, referralCode: uid.toUpperCase(), dailyStepGoal: 10000,
  unitSystem: 'metric', onboardingDone: true, lastValidatedDate: '2026-11-12',
});

describe('validation des pas — un compte non vérifié doit pouvoir valider', () => {
  // Le défaut « Missing or insufficient permissions » venait d'un `verified()`
  // dans la règle de crédit : un compte e-mail non confirmé était refusé alors
  // que le client écrivait correctement. La règle contrôle désormais les bornes.
  const unverified = (uid: string) =>
    env.authenticatedContext(uid, { email_verified: false }).firestore();

  const seed = async (withCaloriesOnProfile: boolean) => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const p: Record<string, unknown> = profile(ALICE);
      if (!withCaloriesOnProfile) delete p.totalCalories;
      await setDoc(doc(ctx.firestore(), 'users/alice'), p);
    });
  };

  /** Écriture atomique du profil **et** du cumul du jour, comme le client. */
  const validate = (
    db: ReturnType<typeof unverified>,
    payload: {
      steps: number; coins: number; calories: number;
      totalSteps: number; totalCalories: number; elycoins: number; freezes: number;
      day?: string;
    }
  ) => {
    const day = payload.day || '2026-11-13';
    const batch = writeBatch(db);
    batch.set(doc(db, `users/alice/dailySteps/${day}`), {
      // 8 000 pas = palier à 7 EC (barème `STEP_TIERS`).
      steps: payload.steps, coins: payload.coins, calories: payload.calories, validatedAt: Date.now(),
    });
    batch.update(doc(db, 'users/alice'), {
      lastValidatedDate: day,
      totalSteps: payload.totalSteps,
      totalCalories: payload.totalCalories,
      elycoins: payload.elycoins,
      todaySteps: payload.steps,
      streakFreezes: payload.freezes,
    });
    return batch.commit();
  };

  it('crédite les pas, y compris quand `totalCalories` est absent du profil', async () => {
    await seed(false);
    await assertSucceeds(validate(unverified(ALICE), {
      steps: 8000, coins: 7, calories: 300,
      totalSteps: 8000, totalCalories: 300, elycoins: 7, freezes: 2,
    }));
  });

  it('accepte jusqu’à trois gels de série', async () => {
    await seed(true);
    await assertSucceeds(validate(unverified(ALICE), {
      steps: 8000, coins: 7, calories: 300,
      totalSteps: 8000, totalCalories: 300, elycoins: 7, freezes: 3,
    }));
  });

  it('refuse un crédit incohérent malgré la levée de `verified()`', async () => {
    await seed(true);
    await assertFails(validate(unverified(ALICE), {
      // 40 EC pour 8 000 pas : très au-delà du barème (7 EC).
      steps: 8000, coins: 40, calories: 300,
      totalSteps: 8000, totalCalories: 300, elycoins: 40, freezes: 1,
    }));
    // Revenir sur une date déjà créditée, sans document `dailySteps` du jour.
    await assertFails(updateDoc(doc(unverified(ALICE), 'users/alice'), {
      lastValidatedDate: '2026-11-12', totalSteps: 8000, totalCalories: 300,
      elycoins: 7, todaySteps: 8000, streakFreezes: 1,
    }));
  });

  it('borne les pas du jour écrits par le propriétaire', async () => {
    await seed(true);
    await assertFails(setDoc(doc(unverified(ALICE), 'users/alice/dailySteps/2026-11-14'), {
      steps: 90000, coins: 7, calories: 300, validatedAt: Date.now(),
    }));
    await assertFails(setDoc(doc(unverified(ALICE), 'users/alice/dailySteps/2026-11-14'), {
      steps: 8000, coins: 500, calories: 300, validatedAt: Date.now(),
    }));
    // Barème non respecté : 8 000 pas valent 7 EC, pas 4.
    await assertFails(setDoc(doc(unverified(ALICE), 'users/alice/dailySteps/2026-11-14'), {
      steps: 8000, coins: 4, calories: 300, validatedAt: Date.now(),
    }));
    await assertSucceeds(setDoc(doc(unverified(ALICE), 'users/alice/dailySteps/2026-11-14'), {
      steps: 8000, coins: 7, calories: 300, validatedAt: Date.now(),
    }));
  });
});

describe('A8 — encouragements et commentaires du fil', () => {
  it('n’accepte un encouragement que sur l’identifiant `<item>_<uid>`', async () => {
    await assertSucceeds(setDoc(doc(as(BOB), 'feedReactions/item-1_bob'), {
      uid: BOB, itemId: 'item-1', createdAt: Date.now(),
    }));
    await assertFails(setDoc(doc(as(BOB), 'feedReactions/bob_item-1'), {
      uid: BOB, itemId: 'item-1', createdAt: Date.now(),
    }));
    await assertFails(setDoc(doc(as(BOB), 'feedReactions/item-1_alice'), {
      uid: ALICE, itemId: 'item-1', createdAt: Date.now(),
    }));
  });

  it('borne les commentaires à 200 caractères', async () => {
    await assertSucceeds(setDoc(doc(as(BOB), 'feedComments/c1'), {
      uid: BOB, itemId: 'item-1', text: 'x'.repeat(200), createdAt: Date.now(),
    }));
    await assertFails(setDoc(doc(as(BOB), 'feedComments/c2'), {
      uid: BOB, itemId: 'item-1', text: 'x'.repeat(201), createdAt: Date.now(),
    }));
    await assertFails(setDoc(doc(as(BOB), 'feedComments/c3'), {
      uid: ALICE, itemId: 'item-1', text: 'Bonjour', createdAt: Date.now(),
    }));
  });
});

describe('A10 — galerie photo d’une rencontre', () => {
  const event = (creator: string, participants: string[]) => ({
    creatorUid: creator, participants, title: 'Balade', description: '',
    centerLat: 48.85, centerLng: 2.35, startsAt: Date.now(), status: 'scheduled',
    createdAt: Date.now(),
  });
  const photo = (uid: string, slot: number) => ({
    uid, eventId: 'e1', slot, dataUrl: 'data:image/jpeg;base64,AAAA', createdAt: Date.now(),
  });

  const seedEvent = async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'communityEvents/e1'), event(ALICE, [ALICE, BOB]));
    });
  };

  it('autorise les trois emplacements aux participants', async () => {
    await seedEvent();
    await assertSucceeds(setDoc(doc(as(BOB), 'eventPhotos/e1_0'), photo(BOB, 0)));
    await assertSucceeds(setDoc(doc(as(ALICE), 'eventPhotos/e1_2'), photo(ALICE, 2)));
  });

  it('refuse un quatrième emplacement, un tiers et une image trop lourde', async () => {
    await seedEvent();
    await assertFails(setDoc(doc(as(BOB), 'eventPhotos/e1_3'), photo(BOB, 3)));
    await assertFails(setDoc(doc(as(BOB), 'eventPhotos/e1_0'), { ...photo(BOB, 0), uid: ALICE }));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'communityEvents/e2'), event(ALICE, [ALICE]));
    });
    await assertFails(setDoc(doc(as(BOB), 'eventPhotos/e2_0'), { ...photo(BOB, 0), eventId: 'e2' }));
    // 95 001 caractères : au-delà du plafond de 95 000 du champ `dataUrl`.
    await assertFails(setDoc(doc(as(ALICE), 'eventPhotos/e1_1'), {
      ...photo(ALICE, 1), dataUrl: 'x'.repeat(95001),
    }));
  });
});

describe('A7 — liens de partage publics', () => {
  const link = (extra: Record<string, unknown> = {}) => ({
    ownerUid: ALICE, sessionId: 's1', token: 'abcdefghijklmnop1234', scope: 'summary',
    distanceM: 1200, createdAt: 1, updatedAt: 1, ...extra,
  });

  const seedSession = async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'activitySessions/s1'), session(ALICE, 'link'));
    });
  };

  it('accepte l’identifiant `<sessionId>` et le format historique', async () => {
    await seedSession();
    await assertSucceeds(setDoc(doc(as(ALICE), 'shareLinks/s1'), link({ centerLat: 48.85, centerLng: 2.35, radiusM: 2000 })));
    await assertSucceeds(setDoc(doc(as(ALICE), 'shareLinks/s1_alice'), link({ centerLng: 2.35 })));
  });

  it('refuse un identifiant arbitraire et la mise à jour par un tiers', async () => {
    await seedSession();
    await assertFails(setDoc(doc(as(ALICE), 'shareLinks/autre'), link()));
    await setDoc(doc(as(ALICE), 'shareLinks/s1'), link());
    await assertFails(updateDoc(doc(as(BOB), 'shareLinks/s1'), { caption: 'détourné', updatedAt: 2 }));
    await assertSucceeds(updateDoc(doc(as(ALICE), 'shareLinks/s1'), { caption: 'Boucle au parc', updatedAt: 2 }));
  });

  it('refuse un rayon d’aperçu hors bornes', async () => {
    await seedSession();
    await assertFails(setDoc(doc(as(ALICE), 'shareLinks/s1'), link({ radiusM: 900000 })));
  });
});

describe('A9 / A12.1 — objectifs et records du profil', () => {
  const seedProfile = async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/alice'), profile(ALICE));
    });
  };

  it('accepte un objectif quotidien et hebdomadaire dans les bornes', async () => {
    await seedProfile();
    await assertSucceeds(updateDoc(doc(as(ALICE), 'users/alice'), { dailyStepGoal: 8000 }));
    await assertSucceeds(updateDoc(doc(as(ALICE), 'users/alice'), { weeklyStepGoal: 50000 }));
  });

  it('refuse un objectif absurde', async () => {
    await seedProfile();
    await assertFails(updateDoc(doc(as(ALICE), 'users/alice'), { weeklyStepGoal: 1000 }));
    await assertFails(updateDoc(doc(as(ALICE), 'users/alice'), { weeklyStepGoal: 400000 }));
    await assertFails(updateDoc(doc(as(ALICE), 'users/alice'), { dailyStepGoal: 200 }));
  });

  it('accepte des records cohérents et refuse les valeurs gonflées', async () => {
    await seedProfile();
    await assertSucceeds(updateDoc(doc(as(ALICE), 'users/alice'), {
      records: {
        best1kmSec: 330, best5kmSec: 1500, longestDistanceM: 12500,
        bestWeekSteps: 62000, bestWeekStart: '2026-11-09', updatedAt: 1,
      },
    }));
    await assertFails(updateDoc(doc(as(ALICE), 'users/alice'), {
      records: { best1kmSec: 5, longestDistanceM: 1, bestWeekSteps: 1, bestWeekStart: null, updatedAt: 2, best5kmSec: null },
    }));
    await assertFails(updateDoc(doc(as(ALICE), 'users/alice'), {
      records: { best1kmSec: 330, longestDistanceM: 12500, bestWeekSteps: 62000, bestWeekStart: null, updatedAt: 3, best5kmSec: null, elycoins: 99999 },
    }));
  });
});


// ---------------------------------------------------------------------------
// 2.2.5 — validations multiples dans la journée (défaut signalé : « je ne peux
// valider mes pas qu'une fois par jour »), et levée des blocages dus à
// l'e-mail non confirmé (pas, amis, défis).
// ---------------------------------------------------------------------------
describe('2.2.5 — validations de pas multiples dans la même journée', () => {
  const unverified = (uid: string) => env.authenticatedContext(uid, { email_verified: false }).firestore();
  const dayDoc = (steps: number, coins: number, calories: number) => ({
    steps, coins, calories, validatedAt: Date.now(),
  });

  const seed = async (profileFields: Record<string, unknown>, day?: { steps: number; coins: number; calories: number }) => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/alice'), { ...profile(ALICE), ...profileFields });
      if (day) await setDoc(doc(ctx.firestore(), 'users/alice/dailySteps/2026-11-13'), dayDoc(day.steps, day.coins, day.calories));
    });
  };

  it('accepte une seconde validation le même jour et ne crédite que le delta', async () => {
    await seed(
      { lastValidatedDate: '2026-11-13', totalSteps: 8000, totalCalories: 320, elycoins: 7, todaySteps: 8000, streakFreezes: 1 },
      { steps: 8000, coins: 7, calories: 320 }
    );
    const db = unverified(ALICE);
    const batch = writeBatch(db);
    batch.set(doc(db, 'users/alice/dailySteps/2026-11-13'), dayDoc(12000, 10, 480));
    batch.update(doc(db, 'users/alice'), {
      totalSteps: 12000, totalCalories: 480, elycoins: 10, todaySteps: 12000,
      lastValidatedDate: '2026-11-13', streakFreezes: 1,
    });
    await assertSucceeds(batch.commit());
  });

  it('accepte trois validations successives dans la même journée', async () => {
    await seed(
      { lastValidatedDate: '2026-11-13', totalSteps: 1500, totalCalories: 60, elycoins: 1, todaySteps: 1500, streakFreezes: 1 },
      { steps: 1500, coins: 1, calories: 60 }
    );
    const steps = [
      { steps: 5600, coins: 5, calories: 224 },
      { steps: 15200, coins: 15, calories: 608 },
    ];
    let total = 1500;
    let coins = 1;
    let calories = 60;
    for (const next of steps) {
      const db = unverified(ALICE);
      const batch = writeBatch(db);
      batch.set(doc(db, 'users/alice/dailySteps/2026-11-13'), dayDoc(next.steps, next.coins, next.calories));
      batch.update(doc(db, 'users/alice'), {
        totalSteps: next.steps,
        totalCalories: calories + (next.calories - calories),
        elycoins: coins + (next.coins - coins),
        todaySteps: next.steps,
        lastValidatedDate: '2026-11-13',
        streakFreezes: 1,
      });
      await assertSucceeds(batch.commit());
      total = next.steps;
      coins = next.coins;
      calories = next.calories;
    }
  });

  it('refuse de créditer deux fois les mêmes pas', async () => {
    await seed(
      { lastValidatedDate: '2026-11-13', totalSteps: 8000, totalCalories: 320, elycoins: 7, todaySteps: 8000, streakFreezes: 1 },
      { steps: 8000, coins: 7, calories: 320 }
    );
    const db = unverified(ALICE);
    const batch = writeBatch(db);
    // Même cumul réécrit, mais profil crédité une seconde fois.
    batch.set(doc(db, 'users/alice/dailySteps/2026-11-13'), dayDoc(8000, 7, 320));
    batch.update(doc(db, 'users/alice'), {
      totalSteps: 16000, totalCalories: 640, elycoins: 14, todaySteps: 8000, streakFreezes: 1,
    });
    await assertFails(batch.commit());
  });

  it('refuse un crédit hors barème (ElyCoins non conformes au palier)', async () => {
    await seed({ lastValidatedDate: '2026-11-12', totalSteps: 0, totalCalories: 0, elycoins: 0, todaySteps: 0, streakFreezes: 1 });
    const db = unverified(ALICE);
    const batch = writeBatch(db);
    // 8 000 pas valent 7 EC, pas 40.
    batch.set(doc(db, 'users/alice/dailySteps/2026-11-13'), dayDoc(8000, 40, 320));
    batch.update(doc(db, 'users/alice'), {
      totalSteps: 8000, totalCalories: 320, elycoins: 40, todaySteps: 8000,
      lastValidatedDate: '2026-11-13', streakFreezes: 1,
    });
    await assertFails(batch.commit());
  });

  it('refuse de réécrire un jour déjà crédité en changeant la date', async () => {
    await seed(
      { lastValidatedDate: '2026-11-14', totalSteps: 8000, totalCalories: 320, elycoins: 7, todaySteps: 8000, streakFreezes: 1 },
      { steps: 8000, coins: 7, calories: 320 }
    );
    const db = unverified(ALICE);
    const batch = writeBatch(db);
    batch.set(doc(db, 'users/alice/dailySteps/2026-11-13'), dayDoc(16000, 15, 640));
    batch.update(doc(db, 'users/alice'), {
      totalSteps: 16000, totalCalories: 640, elycoins: 15, todaySteps: 16000,
      lastValidatedDate: '2026-11-13', streakFreezes: 1,
    });
    await assertFails(batch.commit());
  });
});

describe('2.2.5 — un compte non vérifié a exactement les mêmes droits', () => {
  // Décision produit : `email_verified` n'est **plus** une condition d'accès
  // nulle part. Ces tests couvrent les anciennes barrières (pas, amis, défis,
  // publicité, parrainage, dépenses, retraits) avec un contexte non vérifié.
  const unverified = (uid: string) => env.authenticatedContext(uid, { email_verified: false }).firestore();

  const seed = async (fields: Record<string, unknown> = {}) => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/alice'), { ...profile(ALICE), ...fields });
      await setDoc(doc(ctx.firestore(), 'users/bob'), profile(BOB));
    });
  };

  it('envoie puis accepte une demande d’ami', async () => {
    await seed();
    await assertSucceeds(setDoc(doc(unverified(BOB), 'friendRequests/bob_alice'), request(BOB, ALICE)));
    await assertSucceeds(updateDoc(doc(unverified(ALICE), 'friendRequests/bob_alice'), { status: 'accepted' }));
    await assertSucceeds(setDoc(doc(unverified(ALICE), 'friendships/alice_bob'), {
      members: [ALICE, BOB], createdAt: Date.now(), hiddenFor: [],
    }));
  });

  it('suit la progression d’un défi', async () => {
    await seed();
    await assertSucceeds(setDoc(doc(unverified(ALICE), 'users/alice/challenges/c1'), {
      uid: ALICE, progress: 12000, claimed: false, reward: 5, updatedAt: Date.now(),
    }));
  });

  it('encaisse une récompense publicitaire (une par heure)', async () => {
    await seed({ elycoins: 0 });
    const db = unverified(ALICE);
    const slot = 'alice_2026-11-13_10';
    const batch = writeBatch(db);
    batch.set(doc(db, `adClaims/${slot}`), { uid: ALICE, slot, coins: 0.1, createdAt: Date.now() });
    batch.update(doc(db, 'users/alice'), {
      elycoins: 0.1, lastAdSlot: slot, lastAdRewardAt: serverTimestamp(),
    });
    await assertSucceeds(batch.commit());
  });

  it('réclame la récompense d’un défi du catalogue', async () => {
    await seed({ lastValidatedDate: '2026-11-13', streak: 0 });
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'challengeCatalog/c1'), { active: true, reward: 5, goal: 10000 });
      await setDoc(doc(ctx.firestore(), 'users/alice/challenges/c1'), {
        uid: ALICE, progress: 12000, claimed: false, reward: 5, updatedAt: 1,
      });
    });
    const db = unverified(ALICE);
    const batch = writeBatch(db);
    batch.update(doc(db, 'users/alice/challenges/c1'), { claimed: true, updatedAt: Date.now() });
    batch.update(doc(db, 'users/alice'), { elycoins: 5, lastChallengeClaim: 'c1' });
    await assertSucceeds(batch.commit());
  });

  it('réclame un bonus de parrainage', async () => {
    await seed({ elycoins: 0 });
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'referralClaims/referee'), {
        referredUid: 'referee', referredName: 'Filleul', sponsorUid: ALICE, claimed: false, createdAt: 1,
      });
    });
    const db = unverified(ALICE);
    const batch = writeBatch(db);
    batch.update(doc(db, 'referralClaims/referee'), { claimed: true });
    batch.update(doc(db, 'users/alice'), { elycoins: 10, lastReferralClaim: 'referee' });
    await assertSucceeds(batch.commit());
  });

  it('demande un retrait PayPal (solde débité dans la même écriture)', async () => {
    await seed({ elycoins: 100 });
    const db = unverified(ALICE);
    const batch = writeBatch(db);
    batch.update(doc(db, 'users/alice'), { elycoins: 90 });
    batch.set(doc(db, 'withdrawals/w1'), {
      uid: ALICE, userName: ALICE, type: 'paypal', coins: 10, euros: 1, paypalEmail: 'alice@example.com',
      status: 'pending', createdAt: Date.now(), notified: false,
    });
    await assertSucceeds(batch.commit());
  });

  it('dépense son solde sans confirmation d’e-mail', async () => {
    await seed({ elycoins: 100 });
    await assertSucceeds(updateDoc(doc(unverified(ALICE), 'users/alice'), { elycoins: 95 }));
  });

  it('reste borné : pas de solde négatif ni de crédit arbitraire', async () => {
    await seed({ elycoins: 5 });
    // Aucune écriture ne peut rendre le solde négatif…
    await assertFails(updateDoc(doc(unverified(ALICE), 'users/alice'), { elycoins: -1 }));
    // …ni l'augmenter sans justificatif (pas, pub, parrainage, défi).
    await assertFails(updateDoc(doc(unverified(ALICE), 'users/alice'), { elycoins: 500 }));
  });
});
