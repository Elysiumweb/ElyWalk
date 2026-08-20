/**
 * ElyWalk — Backend de confiance (Cloudflare Workers, 100 % gratuit)
 * ===================================================================
 * AUCUNE dépendance runtime : utilise directement les API REST Google
 * (Firestore REST, FCM HTTP v1, Play Integrity, AdMob SSV) avec des jetons
 * OAuth2 signés via Web Crypto (natif dans Workers).
 *
 * `firebase-admin` (SDK Node) est volontairement exclu : il s'appuie sur gRPC
 * et des APIs Node natives incompatibles avec l'isolat Workers.
 *
 * Endpoints :
 *   POST /verify-integrity            — vérifie un jeton Play Integrity (F05)
 *   GET  /ssv                         — callback AdMob Server-Side Verification (F05)
 *   POST /fcm/send                    — envoi d'un push FCM (protégé par API_SECRET)
 *   GET  /cron/process-notifications  — consomme friendRequests/withdrawals → FCM (F11)
 *   GET  /cron/process-payouts        — traite la file de retraits (F06)
 *   GET  /                            — état de santé
 */
export interface Env {
  GOOGLE_APPLICATION_CREDENTIALS: string; // JSON du compte de service (secret)
  API_SECRET: string; // secret partagé pour /fcm/send
  PACKAGE_NAME: string; // com.elysium.elywalk
  SSV_KEYS?: string; // JSON des clés publiques AdMob SSV : [{ keyId, pem }]
}

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri: string;
}

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------
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

function b64url(input: string | ArrayBuffer): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToBytes(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN[^-]*-----/g, '')
    .replace(/-----END[^-]*-----/g, '')
    .replace(/\s+/g, '');
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function parseServiceAccount(env: Env): ServiceAccount {
  return JSON.parse(env.GOOGLE_APPLICATION_CREDENTIALS) as ServiceAccount;
}

// ---------------------------------------------------------------------------
// OAuth2 : jeton d'accès depuis le compte de service (signature RS256 native)
// ---------------------------------------------------------------------------
const tokenCache = new Map<string, { token: string; exp: number }>();

async function getAccessToken(sa: ServiceAccount, scope: string): Promise<string> {
  const cached = tokenCache.get(scope);
  if (cached && cached.exp > Date.now() / 1000 + 60) return cached.token;

  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: sa.client_email,
    scope,
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToBytes(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${b64url(sig)}`;

  const res = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  if (!res.ok) throw new Error(`OAuth token request failed: HTTP ${res.status}`);
  const data = (await res.json()) as { access_token: string };
  tokenCache.set(scope, { token: data.access_token, exp: now + 3600 });
  return data.access_token;
}

// ---------------------------------------------------------------------------
// Firestore REST
// ---------------------------------------------------------------------------
const FIRESTORE = (project: string) =>
  `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
const FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore';

/** Exécute une requête structurée et renvoie les documents. */
async function runQuery(
  sa: ServiceAccount,
  structuredQuery: unknown
): Promise<Array<{ name: string; fields: Record<string, unknown> }>> {
  const token = await getAccessToken(sa, FIRESTORE_SCOPE);
  const res = await fetch(`${FIRESTORE(sa.project_id)}:runQuery`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery }),
  });
  if (!res.ok) throw new Error(`runQuery failed: HTTP ${res.status}`);
  const results = (await res.json()) as Array<{ document?: { name: string; fields: Record<string, unknown> } }>;
  return results
    .filter((r) => r.document)
    .map((r) => r.document as { name: string; fields: Record<string, unknown> });
}

/** Liste les jetons FCM d'un utilisateur. */
async function listTokens(sa: ServiceAccount, uid: string): Promise<string[]> {
  const token = await getAccessToken(sa, FIRESTORE_SCOPE);
  const res = await fetch(
    `${FIRESTORE(sa.project_id)}/users/${encodeURIComponent(uid)}/notificationTokens`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return [];
  const data = (await res.json()) as {
    documents?: Array<{ fields?: { token?: { stringValue?: string } } }>;
  };
  return (data.documents || [])
    .map((d) => d.fields?.token?.stringValue)
    .filter((t): t is string => !!t);
}

/** Nom de ressource complet Firestore à partir d'un chemin relatif. */
function docName(sa: ServiceAccount, relPath: string): string {
  return `projects/${sa.project_id}/databases/(default)/documents/${relPath}`;
}

/** Met à jour des champs d'un document existant (PATCH). */
async function patchFields(
  sa: ServiceAccount,
  fullName: string, // nom de ressource complet (projects/…/documents/…)
  fields: Record<string, unknown>
): Promise<void> {
  const token = await getAccessToken(sa, FIRESTORE_SCOPE);
  const mask = Object.keys(fields)
    .map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`)
    .join('&');
  const res = await fetch(`https://firestore.googleapis.com/v1/${fullName}?${mask}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`patch ${fullName} failed: HTTP ${res.status}`);
}

/** Champ booléen Firestore. */
const fBool = (v: boolean) => ({ booleanValue: v });
/** Champ chaîne Firestore. */
const fString = (v: string) => ({ stringValue: v });
/** Champ numérique (entier, en millisecondes ou montants entiers). */
const fInt = (v: number) => ({ integerValue: String(Math.round(v)) });
/** Champ numérique (flottant, pour les fractions d'ElyCoins). */
const fDouble = (v: number) => ({ doubleValue: v });

// ---------------------------------------------------------------------------
// F05 — Play Integrity
// ---------------------------------------------------------------------------
interface IntegrityVerdict {
  ok: boolean;
  reason?: string;
  packageName?: string;
}

async function verifyPlayIntegrity(
  token: string,
  sa: ServiceAccount,
  packageName: string
): Promise<IntegrityVerdict> {
  const accessToken = await getAccessToken(sa, 'https://www.googleapis.com/auth/playintegrity');
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
  if (!res.ok) return { ok: false, reason: `decodeIntegrityToken HTTP ${res.status}` };
  const data = (await res.json()) as {
    tokenPayloadExternal?: {
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

  return { ok: true, packageName: app.packageName };
}

// ---------------------------------------------------------------------------
// F05 — AdMob Server-Side Verification (SSV)
// ---------------------------------------------------------------------------
interface SsvKey {
  keyId: string | number;
  pem: string;
}

function canonicalSsvString(url: URL): string {
  const params = new URLSearchParams(url.search);
  params.delete('signature');
  params.delete('key_id');
  const entries = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([k, v]) => `${k}=${v}`).join('&');
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
  const sig = pemToBytes(signature.replace(/-/g, '+').replace(/_/g, '/'));

  try {
    const cryptoKey = await crypto.subtle.importKey(
      'spki',
      pemToBytes(key.pem),
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

/** Crédite (atomique + idempotent) un gain de pub récompensée via commit. */
async function creditAdReward(
  sa: ServiceAccount,
  uid: string,
  coins: number,
  transactionId: string
): Promise<boolean> {
  const txId = transactionId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
  const base = `projects/${sa.project_id}/databases/(default)/documents`;
  const body = {
    writes: [
      {
        create: {
          name: `${base}/ssvCredits/${txId}`,
          fields: {
            creditedAt: fInt(Date.now()),
            uid: fString(uid),
            coins: fDouble(coins),
          },
        },
      },
      {
        create: {
          name: `${base}/users/${uid}/transactions/ad_ssv_${txId}`,
          fields: {
            type: fString('ad'),
            coins: fDouble(coins),
            note: fString('Publicité récompensée (vérifiée serveur SSV)'),
            createdAt: fInt(Date.now()),
          },
        },
      },
      {
        update: {
          name: `${base}/users/${uid}`,
          updateTransforms: [{ fieldPath: 'elycoins', increment: { doubleValue: coins } }],
        },
      },
    ],
  };
  const token = await getAccessToken(sa, FIRESTORE_SCOPE);
  const res = await fetch(`https://firestore.googleapis.com/v1/${base}:commit`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  // Le commit est atomique : si ssvCredits/{txId} existe déjà, ALREADY_EXISTS
  // est renvoyé et RIEN n'est crédité une seconde fois.
  return res.ok;
}

// ---------------------------------------------------------------------------
// F11 — Envoi FCM (HTTP v1)
// ---------------------------------------------------------------------------
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

async function sendToUser(
  sa: ServiceAccount,
  uid: string,
  title: string,
  bodyText: string,
  data: Record<string, string>
): Promise<{ sent: number; failures: number }> {
  const tokens = await listTokens(sa, uid);
  if (tokens.length === 0) return { sent: 0, failures: 0 };

  const accessToken = await getAccessToken(sa, FCM_SCOPE);
  const projectId = sa.project_id;
  let sent = 0;
  let failures = 0;

  for (const token of tokens) {
    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            notification: { title, body: bodyText },
            data,
            android: { priority: 'HIGH' },
          },
        }),
      }
    );
    if (res.ok) sent++;
    else failures++;
  }
  return { sent, failures };
}

// ---------------------------------------------------------------------------
// F11 — Consommateur de notifications (cron)
// ---------------------------------------------------------------------------
async function processNotifications(sa: ServiceAccount): Promise<{ processed: number; sent: number }> {
  let processed = 0;
  let sent = 0;

  // 1) Demandes d'amis en attente non notifiées
  const reqs = await runQuery(sa, {
    from: [{ collectionId: 'friendRequests' }],
    where: {
      compositeFilter: {
        op: 'AND',
        filters: [
          { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'pending' } } },
          { fieldFilter: { field: { fieldPath: 'notified' }, op: 'EQUAL', value: { booleanValue: false } } },
        ],
      },
    },
  });
  for (const doc of reqs) {
    const to = (doc.fields.to as { stringValue?: string })?.stringValue;
    const fromName = (doc.fields.fromName as { stringValue?: string })?.stringValue;
    if (to) {
      const r = await sendToUser(sa, to, 'Nouvelle demande d’ami', `${fromName || 'Quelqu’un'} souhaite vous ajouter.`, {
        type: 'friend_request',
      });
      sent += r.sent;
    }
    await patchFields(sa, doc.name, { notified: fBool(true) });
    processed++;
  }

  // 2) Retraits traités non notifiés (payé / refusé)
  const withdrawals = await runQuery(sa, {
    from: [{ collectionId: 'withdrawals' }],
    where: {
      compositeFilter: {
        op: 'AND',
        filters: [
          {
            fieldFilter: {
              field: { fieldPath: 'status' },
              op: 'IN',
              value: { arrayValue: { values: [{ stringValue: 'paid' }, { stringValue: 'rejected' }] } },
            },
          },
          { fieldFilter: { field: { fieldPath: 'notified' }, op: 'EQUAL', value: { booleanValue: false } } },
        ],
      },
    },
  });
  for (const doc of withdrawals) {
    const uid = (doc.fields.uid as { stringValue?: string })?.stringValue;
    const status = (doc.fields.status as { stringValue?: string })?.stringValue;
    const euros = (doc.fields.euros as { doubleValue?: number; integerValue?: string })?.doubleValue
      ?? Number((doc.fields.euros as { integerValue?: string })?.integerValue ?? 0);
    if (uid) {
      const bodyText =
        status === 'paid'
          ? `Votre retrait de ${euros} € a été effectué.`
          : 'Votre demande de retrait a été refusée (montant recrédité).';
      const r = await sendToUser(sa, uid, 'Retrait ElyWalk', bodyText, { type: 'withdrawal', status: status || '' });
      sent += r.sent;
    }
    await patchFields(sa, doc.name, { notified: fBool(true) });
    processed++;
  }
  return { processed, sent };
}

// ---------------------------------------------------------------------------
// F06 — File de retraits (cron)
// ---------------------------------------------------------------------------
async function processPayouts(sa: ServiceAccount): Promise<{ processed: number }> {
  let processed = 0;
  const queue = await runQuery(sa, {
    from: [{ collectionId: 'withdrawals' }],
    where: {
      fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'pending' } },
    },
  });
  for (const doc of queue) {
    await patchFields(sa, doc.name, {
      readyForReview: fBool(true),
      reviewedAt: fInt(Date.now()),
    });
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
      const sa = parseServiceAccount(env);
      if (request.method === 'GET' && path === '/') {
        return json({ ok: true, service: 'elywalk-backend', package: env.PACKAGE_NAME });
      }

      // F05 — Play Integrity
      if (request.method === 'POST' && path === '/verify-integrity') {
        const body = (await request.json()) as { token?: string; uid?: string };
        if (!body.token) return json({ ok: false, reason: 'missing token' }, 400);
        const verdict = await verifyPlayIntegrity(body.token, sa, env.PACKAGE_NAME);
        if (verdict.ok && body.uid) {
          // Trace d'attestation (consultable via les règles Firestore si besoin).
          await patchFields(sa, docName(sa, `users/${body.uid}`), {
            lastIntegrityCheck: fInt(Date.now()),
          }).catch(() => undefined);
        }
        return json(verdict);
      }

      // F05 — AdMob SSV (appelé par Google, pas d'auth applicative)
      if (request.method === 'GET' && path === '/ssv') {
        const keys: SsvKey[] = env.SSV_KEYS ? JSON.parse(env.SSV_KEYS) : [];
        if (keys.length === 0) return json({ ok: false, reason: 'SSV not configured' }, 503);
        const check = await verifySsvSignature(url, keys);
        if (!check.ok) return json(check, 400);

        const uid = url.searchParams.get('custom_data') || '';
        const tx = url.searchParams.get('transaction_id') || '';
        const amount = Number(url.searchParams.get('reward_amount') || '0');
        const coins = Math.round(amount * 10) / 10 || 0.1;
        if (!uid || !tx) return json({ ok: false, reason: 'missing custom_data/transaction_id' }, 400);
        const credited = await creditAdReward(sa, uid, coins, tx);
        return json({ ok: true, credited });
      }

      // F11 — Envoi de push protégé
      if (request.method === 'POST' && path === '/fcm/send') {
        const auth = request.headers.get('Authorization') || '';
        if (auth !== `Bearer ${env.API_SECRET}`) return json({ ok: false, reason: 'unauthorized' }, 401);
        const body = (await request.json()) as {
          uid: string;
          title: string;
          body: string;
          data?: Record<string, string>;
        };
        if (!body.uid || !body.title || !body.body) {
          return json({ ok: false, reason: 'missing fields' }, 400);
        }
        const res = await sendToUser(sa, body.uid, body.title, body.body, body.data || {});
        return json({ ok: true, ...res });
      }

      // F11 — Consommateur de notifications (cron)
      if (request.method === 'GET' && path === '/cron/process-notifications') {
        const res = await processNotifications(sa);
        return json({ ok: true, ...res });
      }

      // F06 — File de retraits (cron)
      if (request.method === 'GET' && path === '/cron/process-payouts') {
        const res = await processPayouts(sa);
        return json({ ok: true, ...res });
      }

      return json({ ok: false, reason: 'not found' }, 404);
    } catch (e) {
      return json({ ok: false, reason: (e as Error).message }, 500);
    }
  },
};
