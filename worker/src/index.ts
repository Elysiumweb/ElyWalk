/**
 * ElyWalk — Backend de confiance (Cloudflare Workers, 100 % gratuit)
 * ===================================================================
 * Remplace les Cloud Functions Firebase (plan payant Blaze) par un Worker
 * Cloudflare, gratuit à cette échelle.
 *
 * Endpoints :
 *   POST /verify-integrity         — vérifie un jeton Play Integrity (F05)
 *   GET  /ssv                      — callback AdMob Server-Side Verification (F05)
 *   POST /fcm/send                 — envoi de push FCM (protégé par API_SECRET)
 *   GET  /cron/process-notifications — consomme friendRequests/withdrawals → FCM (F11)
 *   GET  /cron/process-payouts       — traite la file de retraits (F06)
 *   GET  /                          — état de santé
 *
 * L'Admin SDK Firebase contourne les règles Firestore : le Worker est donc le
 * seul composant de confiance capable de créditer un solde sur preuve externe
 * (intégrité Play ou callback SSV signé).
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging, type MulticastMessage } from 'firebase-admin/messaging';
import { GoogleAuth } from 'google-auth-library';

export interface Env {
  GOOGLE_APPLICATION_CREDENTIALS: string; // JSON du compte de service (secret)
  API_SECRET: string; // secret partagé pour /fcm/send
  PACKAGE_NAME: string; // com.elysium.elywalk
  SSV_KEYS?: string; // JSON des clés publiques AdMob SSV : [{ keyId, pem }]
}

// ---------------------------------------------------------------------------
// Initialisation Firebase Admin (idempotent, cache entre requêtes)
// ---------------------------------------------------------------------------
let inited = false;
function initFirebase(env: Env) {
  if (inited) return;
  const sa = JSON.parse(env.GOOGLE_APPLICATION_CREDENTIALS);
  if (getApps().length === 0) {
    initializeApp({ credential: cert(sa), projectId: sa.project_id });
  }
  inited = true;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

// ---------------------------------------------------------------------------
// F05 — Play Integrity
// ---------------------------------------------------------------------------
interface IntegrityVerdict {
  ok: boolean;
  reason?: string;
  packageName?: string;
  requestHash?: string;
}

/** Appelle l'API Google Play Integrity pour décoder/vérifier un jeton. */
async function verifyPlayIntegrity(
  token: string,
  sa: Record<string, unknown>,
  packageName: string
): Promise<IntegrityVerdict> {
  const auth = new GoogleAuth({
    credentials: sa,
    scopes: ['https://www.googleapis.com/auth/playintegrity'],
  });
  const client = await auth.getClient();
  const { token: accessToken } = await client.getAccessToken();

  const res = await fetch(
    `https://playintegrity.googleapis.com/v1/${packageName}:decodeIntegrityToken`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ integrityToken: token }),
    }
  );
  if (!res.ok) {
    return { ok: false, reason: `decodeIntegrityToken HTTP ${res.status}` };
  }
  const data = (await res.json()) as {
    tokenPayloadExternal?: {
      requestDetails?: { requestPackageName?: string; nonce?: string };
      appIntegrity?: { appRecognitionVerdict?: string; packageName?: string };
      deviceIntegrity?: { deviceRecognitionVerdict?: string[] };
      accountDetails?: { appLicensingVerdict?: string };
    };
  };
  const p = data.tokenPayloadExternal;
  if (!p) return { ok: false, reason: 'empty payload' };

  const app = p.appIntegrity || {};
  const device = p.deviceIntegrity || {};
  const account = p.accountDetails || {};

  const recognized = app.appRecognitionVerdict === 'PLAY_RECOGNIZED';
  const deviceOk =
    Array.isArray(device.deviceRecognitionVerdict) &&
    device.deviceRecognitionVerdict.includes('MEETS_DEVICE_INTEGRITY');
  const licensed = account.appLicensingVerdict === 'LICENSED';
  const packageOk = app.packageName === packageName;

  if (!recognized) return { ok: false, reason: 'app not PLAY_RECOGNIZED' };
  if (!deviceOk) return { ok: false, reason: 'device integrity failed' };
  if (!licensed) return { ok: false, reason: 'app not LICENSED' };
  if (!packageOk) return { ok: false, reason: 'package mismatch' };

  return {
    ok: true,
    packageName: app.packageName,
    requestHash: p.requestDetails?.nonce,
  };
}

// ---------------------------------------------------------------------------
// F05 — AdMob Server-Side Verification (SSV)
// ---------------------------------------------------------------------------
interface SsvKey {
  keyId: string | number;
  pem: string;
}

/**
 * Reconstruit la chaîne signée : paramètres triés par clé (hors `signature`
 * et `key_id`), au format `clé=valeur` joint par `&`.
 * NB : à valider avec l'outil de test SSV AdMob en production (les callbacks
 * SSV ne sont déclenchés que sur les annonces de production).
 */
function canonicalSsvString(url: URL): string {
  const params = new URLSearchParams(url.search);
  params.delete('signature');
  params.delete('key_id');
  const entries = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([k, v]) => `${k}=${v}`).join('&');
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s+/g, '');
  const raw = atob(b64);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

async function verifySsvSignature(
  url: URL,
  keys: SsvKey[]
): Promise<{ ok: boolean; reason?: string }> {
  const keyId = url.searchParams.get('key_id');
  const signature = url.searchParams.get('signature');
  if (!keyId || !signature) return { ok: false, reason: 'missing key_id/signature' };
  const key = keys.find((k) => String(k.keyId) === keyId);
  if (!key) return { ok: false, reason: 'unknown key_id' };

  const message = new TextEncoder().encode(canonicalSsvString(url));
  const sigRaw = atob(signature.replace(/-/g, '+').replace(/_/g, '/'));
  const sig = new Uint8Array(sigRaw.length);
  for (let i = 0; i < sigRaw.length; i++) sig[i] = sigRaw.charCodeAt(i);

  try {
    const cryptoKey = await crypto.subtle.importKey(
      'spki',
      pemToArrayBuffer(key.pem),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sig, message);
    return { ok };
  } catch (e) {
    return { ok: false, reason: `verify error: ${(e as Error).message}` };
  }
}

/** Crédite (idempotent, par transaction_id) un gain de pub récompensée. */
async function creditAdReward(
  uid: string,
  coins: number,
  transactionId: string
): Promise<boolean> {
  const db = getFirestore();
  const idempotency = db.collection('ssvCredits').doc(transactionId);
  const rewardDoc = db.doc(`users/${uid}/transactions/ad_ssv_${transactionId}`);

  return db.runTransaction(async (tx) => {
    const done = await tx.get(idempotency);
    if (done.exists) return false;
    tx.set(idempotency, { creditedAt: Date.now(), uid, coins });
    tx.set(rewardDoc, {
      type: 'ad',
      coins,
      note: 'Publicité récompensée (vérifiée serveur SSV)',
      createdAt: Date.now(),
    });
    tx.update(db.doc(`users/${uid}`), { elycoins: FieldValue.increment(coins) });
    return true;
  });
}

// ---------------------------------------------------------------------------
// F11 — Envoi FCM
// ---------------------------------------------------------------------------
async function sendToUser(uid: string, title: string, body: string, data: Record<string, string>) {
  const db = getFirestore();
  const snap = await db.collection(`users/${uid}/notificationTokens`).get();
  const tokens = snap.docs.map((d) => (d.data() as { token: string }).token);
  if (tokens.length === 0) return { sent: 0, reason: 'no tokens' };

  const msg: MulticastMessage = {
    tokens,
    notification: { title, body },
    data: { ...data, click_action: 'FLUTTER_NOTIFICATION_CLICK' },
    android: { priority: 'high' },
  };
  const res = await getMessaging().sendEachForMulticast(msg);
  return { sent: res.successCount, failures: res.failureCount };
}

// ---------------------------------------------------------------------------
// F11 — Consommateur de notifications (cron)
// ---------------------------------------------------------------------------
async function processNotifications(): Promise<{ processed: number; sent: number }> {
  const db = getFirestore();
  let processed = 0;
  let sent = 0;

  // 1) Demandes d'amis en attente non notifiées
  const reqs = await db
    .collection('friendRequests')
    .where('status', '==', 'pending')
    .where('notified', '==', false)
    .get();
  for (const doc of reqs.docs) {
    const r = doc.data() as { to: string; fromName: string };
    const r1 = await sendToUser(r.to, 'Nouvelle demande d’ami', `${r.fromName} souhaite vous ajouter.`, { type: 'friend_request' });
    sent += r1.sent || 0;
    await doc.ref.update({ notified: true });
    processed++;
  }

  // 2) Retraits traités non notifiés (payé / refusé)
  const withdrawals = await db
    .collection('withdrawals')
    .where('status', 'in', ['paid', 'rejected'])
    .where('notified', '==', false)
    .get();
  for (const doc of withdrawals.docs) {
    const w = doc.data() as { uid: string; status: string; euros?: number };
    const body =
      w.status === 'paid'
        ? `Votre retrait de ${w.euros ?? 0} € a été effectué.`
        : 'Votre demande de retrait a été refusée (montant recrédité).';
    const r1 = await sendToUser(w.uid, 'Retrait ElyWalk', body, { type: 'withdrawal', status: w.status });
    sent += r1.sent || 0;
    await doc.ref.update({ notified: true });
    processed++;
  }
  return { processed, sent };
}

// ---------------------------------------------------------------------------
// F06 — File de retraits (cron)
// ---------------------------------------------------------------------------
async function processPayouts(): Promise<{ processed: number }> {
  const db = getFirestore();
  let processed = 0;
  const queue = await db
    .collection('withdrawals')
    .where('status', '==', 'pending')
    .get();
  for (const doc of queue.docs) {
    // Placeholder : brancher ici un prestataire de paiement (PayPal Payouts API)
    // et n'exécuter que les retraits attestés (Play Integrity / SSV). Sans
    // prestataire, le statut reste `pending` et l'admin (Président) décide.
    // On marque simplement `readyForReview` pour le back-office.
    await doc.ref.update({ readyForReview: true, reviewedAt: Date.now() });
    processed++;
  }
  return { processed };
}

// ---------------------------------------------------------------------------
// Routeur
// ---------------------------------------------------------------------------
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (request.method === 'GET' && path === '/') {
        initFirebase(env);
        return json({ ok: true, service: 'elywalk-backend' });
      }

      // F05 — Play Integrity
      if (request.method === 'POST' && path === '/verify-integrity') {
        initFirebase(env);
        const body = (await request.json()) as { token?: string; uid?: string };
        if (!body.token) return json({ ok: false, reason: 'missing token' }, 400);
        const sa = JSON.parse(env.GOOGLE_APPLICATION_CREDENTIALS);
        const verdict = await verifyPlayIntegrity(body.token, sa, env.PACKAGE_NAME);
        if (verdict.ok && body.uid) {
          // Trace d'attestation (consultable par les règles Firestore si besoin).
          await getFirestore().doc(`users/${body.uid}/attestations/playIntegrity`).set({
            verifiedAt: Date.now(),
            packageName: verdict.packageName,
          });
        }
        return json(verdict);
      }

      // F05 — AdMob SSV (appelé par Google, pas d'auth applicative)
      if (request.method === 'GET' && path === '/ssv') {
        initFirebase(env);
        const keys: SsvKey[] = env.SSV_KEYS ? JSON.parse(env.SSV_KEYS) : [];
        if (keys.length === 0) return json({ ok: false, reason: 'SSV not configured' }, 503);
        const check = await verifySsvSignature(url, keys);
        if (!check.ok) return json(check, 400);

        const uid = url.searchParams.get('custom_data') || '';
        const tx = url.searchParams.get('transaction_id') || '';
        const amount = Number(url.searchParams.get('reward_amount') || '0');
        // AD_REWARD_COINS = 0.1 EC ; ajuster selon votre barème.
        const coins = Math.round(amount * 10) / 10 || 0.1;
        if (!uid || !tx) return json({ ok: false, reason: 'missing custom_data/transaction_id' }, 400);
        const credited = await creditAdReward(uid, coins, tx);
        return json({ ok: true, credited });
      }

      // F11 — Envoi de push protégé
      if (request.method === 'POST' && path === '/fcm/send') {
        const auth = request.headers.get('Authorization') || '';
        if (auth !== `Bearer ${env.API_SECRET}`) return json({ ok: false, reason: 'unauthorized' }, 401);
        initFirebase(env);
        const body = (await request.json()) as {
          uid: string;
          title: string;
          body: string;
          data?: Record<string, string>;
        };
        if (!body.uid || !body.title || !body.body) {
          return json({ ok: false, reason: 'missing fields' }, 400);
        }
        const res = await sendToUser(body.uid, body.title, body.body, body.data || {});
        return json({ ok: true, ...res });
      }

      // F11 — Consommateur de notifications (cron)
      if (request.method === 'GET' && path === '/cron/process-notifications') {
        initFirebase(env);
        const res = await processNotifications();
        return json({ ok: true, ...res });
      }

      // F06 — File de retraits (cron)
      if (request.method === 'GET' && path === '/cron/process-payouts') {
        initFirebase(env);
        const res = await processPayouts();
        return json({ ok: true, ...res });
      }

      return json({ ok: false, reason: 'not found' }, 404);
    } catch (e) {
      return json({ ok: false, reason: (e as Error).message }, 500);
    }
  },
};
