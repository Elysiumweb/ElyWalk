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
 *   GET  /ssv                         — [LEGACY] callback AdMob SSV (F05), inutilisé
 *                                       depuis le passage à Meta Audience Network
 *   POST /fcm/send                    — envoi d'un push FCM (protégé par API_SECRET)
 *   GET  /cron/process-notifications  — consomme friendRequests/withdrawals → FCM (F11)
 *   GET  /cron/process-payouts        — traite la file de retraits (F06)
 *   GET  /                            — état de santé
 */
export interface Env {
  GOOGLE_APPLICATION_CREDENTIALS: string; // JSON du compte de service (secret)
  API_SECRET: string; // secret partagé pour /fcm/send
  PACKAGE_NAME: string; // com.elysium.elywalk
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
//
// ⚠️ LEGACY : depuis la 1.9.0, la régie est Meta Audience Network, qui ne propose
// pas de callback serveur signé. Cet endpoint est conservé pour compatibilité et
// pourra être supprimé. Le crédit ElyCoins est désormais borné par la transaction
// Firestore `adClaims` (une récompense par heure et par compte).
// ---------------------------------------------------------------------------
// La signature SSV de Google est une signature **ECDSA P-256 (SHA-256)** au
// format DER. Les clés publiques sont servies par Google (rotation automatique)
// — inutile de les configurer manuellement dans un secret.
const SSV_KEYS_URL = 'https://gstatic.com/admob/reward/verifier-keys.json';
const AD_REWARD_COINS = 0.1; // récompense fixe en ElyCoins (voir constants.ts)

let ssvKeysCache: { fetchedAt: number; keys: Map<number, string> } | null = null;

/** Récupère (avec cache 1 h) les clés publiques AdMob : keyId -> base64 (SPKI). */
async function fetchSsvKeys(): Promise<Map<number, string>> {
  if (ssvKeysCache && Date.now() - ssvKeysCache.fetchedAt < 3600_000) {
    return ssvKeysCache.keys;
  }
  const res = await fetch(SSV_KEYS_URL);
  if (!res.ok) throw new Error(`SSV keys fetch failed: HTTP ${res.status}`);
  const data = (await res.json()) as { keys?: Array<{ keyId: number; base64?: string }> };
  const map = new Map<number, string>();
  for (const k of data.keys || []) {
    if (k.base64) map.set(k.keyId, k.base64);
  }
  ssvKeysCache = { fetchedAt: Date.now(), keys: map };
  return map;
}

/** Décode du base64 (standard) vers des octets. */
function b64decode(b64: string): Uint8Array {
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * Contenu signé : la query string **brute** (dans l'ordre reçu, encore encodée),
 * sans les deux derniers paramètres `&signature=...&key_id=...`.
 */
function ssvContentToVerify(url: URL): Uint8Array {
  const raw = url.search.startsWith('?') ? url.search.slice(1) : url.search;
  const i = raw.indexOf('signature=');
  if (i === -1) throw new Error('missing signature parameter');
  return new TextEncoder().encode(raw.slice(0, i - 1)); // -1 pour retirer le '&'
}

/** Extrait la signature (base64url) et la décode en octets. */
function ssvSignatureBytes(url: URL): Uint8Array {
  const raw = url.search.startsWith('?') ? url.search.slice(1) : url.search;
  const i = raw.indexOf('signature=');
  if (i === -1) throw new Error('missing signature parameter');
  const after = raw.slice(i + 'signature='.length);
  const j = after.indexOf('&key_id=');
  const sigStr = j === -1 ? after : after.slice(0, j);
  const b64 = sigStr.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return b64decode(padded);
}

/** Convertit une signature ECDSA DER en format brut r||s (64 octets) pour Web Crypto. */
function derToRaw(der: Uint8Array): Uint8Array {
  if (der[0] !== 0x30) throw new Error('not a DER sequence');
  let pos = 2;
  if (der[1] & 0x80) pos += der[1] & 0x7f; // longueur longue (rare)
  if (der[pos] !== 0x02) throw new Error('bad DER r');
  const rLen = der[pos + 1];
  const r = der.slice(pos + 2, pos + 2 + rLen);
  pos += 2 + rLen;
  if (der[pos] !== 0x02) throw new Error('bad DER s');
  const sLen = der[pos + 1];
  const s = der.slice(pos + 2, pos + 2 + sLen);

  const to32 = (v: Uint8Array): Uint8Array => {
    let start = 0;
    while (start < v.length - 32 && v[start] === 0) start++;
    const out = new Uint8Array(32);
    out.set(v.slice(start), 32 - (v.length - start));
    return out;
  };
  const raw = new Uint8Array(64);
  raw.set(to32(r), 0);
  raw.set(to32(s), 32);
  return raw;
}

/** Vérifie la signature ECDSA P-256 d'un callback SSV. */
async function verifySsv(url: URL): Promise<{ ok: boolean; reason?: string }> {
  const keyId = Number(url.searchParams.get('key_id'));
  if (!Number.isInteger(keyId)) return { ok: false, reason: 'missing key_id' };
  const keys = await fetchSsvKeys();
  const spkiB64 = keys.get(keyId);
  if (!spkiB64) return { ok: false, reason: 'unknown key_id' };

  try {
    const key = await crypto.subtle.importKey(
      'spki',
      b64decode(spkiB64),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
    const sig = derToRaw(ssvSignatureBytes(url));
    const content = ssvContentToVerify(url);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig, content);
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
// Alertes sociales : rencontres proches (rayon choisi) et rappels d'inscription
// ---------------------------------------------------------------------------

/** Distance à vol d'oiseau en mètres (haversine). */
function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Préférences d'alerte relues depuis le profil (`users.alerts`), synchronisées
 * par l'application (Profil → Notifications). Valeurs par défaut alignées sur
 * `DEFAULT_ALERT_PREFERENCES` côté app : 10 km de rayon, rappel 1 h avant.
 */
function readAlertPreferences(fields: Record<string, unknown>): {
  nearbyEvents: boolean;
  nearbyRadiusKm: number;
  eventReminders: boolean;
  eventReminderMinutes: number;
} {
  const raw = (fields.alerts as { mapValue?: { fields?: Record<string, any> } })?.mapValue?.fields || {};
  const bool = (key: string, fallback: boolean) => {
    const value = raw[key]?.booleanValue;
    return typeof value === 'boolean' ? value : fallback;
  };
  const num = (key: string, fallback: number) => {
    const value = raw[key];
    const n = value?.integerValue != null ? Number(value.integerValue) : value?.doubleValue;
    return Number.isFinite(n) ? Number(n) : fallback;
  };
  return {
    nearbyEvents: bool('nearbyEvents', true),
    nearbyRadiusKm: Math.min(100, Math.max(1, num('nearbyRadiusKm', 10))),
    eventReminders: bool('eventReminders', true),
    eventReminderMinutes: Math.min(1440, Math.max(5, num('eventReminderMinutes', 60))),
  };
}

/** `users.alertsNotified` : empreintes des alertes déjà envoyées. */
function readNotifiedKeys(fields: Record<string, unknown>): string[] {
  const values = (fields.alertsNotified as { arrayValue?: { values?: Array<{ stringValue?: string }> } })
    ?.arrayValue?.values || [];
  return values.map((v) => v.stringValue || '').filter(Boolean);
}

/** Garde une liste courte et récente (les 80 dernières alertes). */
function trimNotifiedKeys(keys: string[]): string[] {
  return [...new Set(keys)].slice(-80);
}

/** `YYYY-MM-DD` + `HH:MM` en heure de Paris → horodatage (ms). */
function eventTimestamp(date?: string, time?: string): number | null {
  if (!date) return null;
  const clock = /^\d{2}:\d{2}$/.test(String(time || '')) ? time : '09:00';
  const parsed = Date.parse(`${date}T${clock}:00+01:00`);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Envoie les alertes de rencontre : une sortie proposée dans le rayon choisi,
 * et le rappel d'une rencontre à laquelle l'utilisateur est inscrit.
 *
 * Ces alertes n'existaient pas : la première passait totalement inaperçue, la
 * seconde n'était que facultative et locale (appareil unique).
 */
async function processEventAlerts(sa: ServiceAccount): Promise<{ processed: number; sent: number }> {
  let processed = 0;
  let sent = 0;

  const events = await runQuery(sa, {
    from: [{ collectionId: 'communityEvents' }],
    where: {
      fieldFilter: { field: { fieldPath: 'status' }, op: 'NOT_EQUAL', value: { stringValue: 'cancelled' } },
    },
    limit: 200,
  });
  if (events.length === 0) return { processed, sent };

  const now = Date.now();
  const parsed = events
    .map((doc) => {
      const f = doc.fields;
      const date = (f.date as { stringValue?: string })?.stringValue || '';
      const time = (f.time as { stringValue?: string })?.stringValue || '';
      return {
        id: doc.name.split('/').pop() || '',
        name: doc.name,
        title: (f.title as { stringValue?: string })?.stringValue || 'Rencontre ElyWalk',
        location:
          (f.location as { stringValue?: string })?.stringValue
          || (f.establishmentName as { stringValue?: string })?.stringValue
          || '',
        lat: Number((f.lat as { doubleValue?: number })?.doubleValue ?? NaN),
        lng: Number((f.lng as { doubleValue?: number })?.doubleValue ?? NaN),
        participants: ((f.participants as { arrayValue?: { values?: Array<{ stringValue?: string }> } })
          ?.arrayValue?.values || []).map((v) => v.stringValue || '').filter(Boolean),
        waitlist: ((f.waitlist as { arrayValue?: { values?: Array<{ stringValue?: string }> } })
          ?.arrayValue?.values || []).map((v) => v.stringValue || '').filter(Boolean),
        creatorUid: (f.creatorUid as { stringValue?: string })?.stringValue || '',
        startAt: eventTimestamp(date, time),
      };
    })
    .filter((e) => e.startAt != null && (e.startAt as number) > now - 60 * 60 * 1000);

  if (parsed.length === 0) return { processed, sent };

  // Candidats : les inscrits (rappel) et tous ceux qui ont des coordonnées
  // (rencontre proche). Le rayon dépend de chaque profil, donc on lit les
  // préférences du compte concerné et non une valeur globale.
  const candidateUids = new Set<string>();
  for (const event of parsed) {
    for (const uid of [...event.participants, ...event.waitlist]) candidateUids.add(uid);
  }

  for (const uid of candidateUids) {
    const profileSnap = await runQuery(sa, {
      from: [{ collectionId: 'users' }],
      where: { fieldFilter: { field: { fieldPath: '__name__' }, op: 'EQUAL', value: { referenceValue: docName(sa, `users/${uid}`) } } },
      limit: 1,
    }).catch(() => []);
    const fields = profileSnap[0]?.fields || {};
    const prefs = readAlertPreferences(fields);
    const origin = {
      lat: Number((fields.lastLat as { doubleValue?: number })?.doubleValue ?? NaN),
      lng: Number((fields.lastLng as { doubleValue?: number })?.doubleValue ?? NaN),
    };
    let notified = readNotifiedKeys(fields);
    const added: string[] = [];

    for (const event of parsed) {
      const start = event.startAt as number;
      const joined = event.participants.includes(uid) || event.waitlist.includes(uid);

      // 1) Rappel avant le départ, pour les inscrits.
      if (joined && prefs.eventReminders) {
        const lead = prefs.eventReminderMinutes * 60_000;
        if (start - now <= lead && start > now) {
          const key = `reminder:${event.id}:${start}`;
          if (!notified.includes(key)) {
            const when = new Date(start).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' });
            const res = await sendToUser(sa, uid, 'Votre rencontre commence bientôt', `${event.title} · ${when}${event.location ? ` · ${event.location}` : ''}`, {
              type: 'event',
              eventId: event.id,
            });
            sent += res.sent;
            notified.push(key);
            added.push(key);
            processed++;
          }
        }
      }

      // 2) Rencontre proposée dans le rayon choisi.
      if (!joined && prefs.nearbyEvents && event.creatorUid !== uid
          && Number.isFinite(origin.lat) && Number.isFinite(origin.lng)
          && Number.isFinite(event.lat) && Number.isFinite(event.lng)) {
        const distance = haversineM(origin, { lat: event.lat, lng: event.lng });
        if (distance <= prefs.nearbyRadiusKm * 1000) {
          const key = `nearby:${event.id}:${start}`;
          if (!notified.includes(key)) {
            const km = Math.round(distance / 100) / 10;
            const res = await sendToUser(sa, uid, 'Rencontre près de vous', `${event.title} · à ${km} km${event.location ? ` · ${event.location}` : ''}`, {
              type: 'event',
              eventId: event.id,
            });
            sent += res.sent;
            notified.push(key);
            added.push(key);
            processed++;
          }
        }
      }
    }

    if (added.length > 0) {
      // Le tableau est réécrit en entier (pas d'`increment` possible sur une
      // liste) : la valeur reste bornée pour ne pas faire grossir le document.
      await patchFields(sa, docName(sa, `users/${uid}`), {
        alertsNotified: { arrayValue: { values: trimNotifiedKeys(notified).map((k) => ({ stringValue: k })) } },
      }).catch(() => undefined);
    }
  }

  return { processed, sent };
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
  // 3) Modifications / annulations d'événements créées par l'organisateur.
  // Les documents sont en écriture restreinte par les règles Firestore et ne
  // contiennent aucun jeton : seul ce worker peut lire les jetons et marquer notified.
  const eventNotifications = await runQuery(sa, {
    from: [{ collectionId: 'eventNotifications' }],
    where: { fieldFilter: { field: { fieldPath: 'notified' }, op: 'EQUAL', value: { booleanValue: false } } },
    limit: 100,
  });
  for (const doc of eventNotifications) {
    const uid = (doc.fields.toUid as { stringValue?: string })?.stringValue;
    const title = (doc.fields.title as { stringValue?: string })?.stringValue || 'Sortie ElyWalk';
    const bodyText = (doc.fields.body as { stringValue?: string })?.stringValue || 'Une sortie a été modifiée.';
    const eventId = (doc.fields.eventId as { stringValue?: string })?.stringValue || '';
    const type = (doc.fields.type as { stringValue?: string })?.stringValue || 'updated';
    if (uid) {
      const result = await sendToUser(sa, uid, title, bodyText, { type: 'event', eventId, change: type });
      sent += result.sent;
    }
    await patchFields(sa, doc.name, { notified: fBool(true) });
    processed++;
  }
  // 4) Alertes de rencontre : sortie proposée dans le rayon choisi et rappel
  //    avant une rencontre où l'utilisateur est inscrit.
  const eventAlerts = await processEventAlerts(sa).catch((e) => {
    console.error('[cron] event alerts', e);
    return { processed: 0, sent: 0 };
  });
  processed += eventAlerts.processed;
  sent += eventAlerts.sent;
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
// Version publiée sur le Play Store (écran de mise à jour au démarrage)
// ---------------------------------------------------------------------------
//
// L'application compare sa version installée à `appRelease/current.latestVersion`
// et affiche un écran de mise à jour si elle est en retard. Ce document est
// normalement entretenu par l'administration, mais il peut prendre du retard sur
// une publication Play : ce cron relit la version **réellement publiée** via
// l'API Android Publisher et corrige le document, sans intervention.
async function syncPublishedRelease(sa: ServiceAccount, env: Env): Promise<{ version: string } | { version: null }> {
  const packageName = env.PACKAGE_NAME || 'com.elysium.elywalk';
  const token = await getAccessToken(sa, 'https://www.googleapis.com/auth/androidpublisher');
  const res = await fetch(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/tracks/production/releases`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`play releases failed: HTTP ${res.status}`);
  const data = (await res.json()) as {
    releases?: Array<{ versionCodes?: string[]; status?: string }>;
  };
  const codes = (data.releases || [])
    .flatMap((release) => release.versionCodes || [])
    .map((code) => Number.parseInt(code, 10))
    .filter((code) => Number.isFinite(code));
  if (codes.length === 0) return { version: null };

  // Convention du build (android/app/build.gradle) : versionCode = MAJEUR*10000
  // + MINEUR*100 + CORRECTIF. On retrouve donc `versionName` sans le stocker.
  const code = Math.max(...codes);
  const major = Math.floor(code / 10000);
  const minor = Math.floor((code % 10000) / 100);
  const patch = code % 100;
  const version = `${major}.${minor}.${patch}`;

  // Le document est le même que celui édité à la main par le président : on ne
  // touche qu'à `latestVersion` et `publishedAt`, jamais à `notes`,
  // `minSupportedVersion` ni `enabled` (choix produit, pas technique).
  await patchFields(sa, docName(sa, 'appRelease/current'), {
    latestVersion: fString(version),
    publishedAt: fInt(Date.now()),
  }).catch(async () => {
    // Document absent : création via PATCH sans masque (upsert Firestore REST).
    const token2 = await getAccessToken(sa, FIRESTORE_SCOPE);
    await fetch(`${FIRESTORE(sa.project_id)}/appRelease/current`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token2}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          latestVersion: fString(version),
          publishedAt: fInt(Date.now()),
          enabled: fBool(true),
        },
      }),
    }).catch(() => undefined);
  });

  return { version };
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
        const check = await verifySsv(url);
        if (!check.ok) return json(check, 400);

        // L'identifiant utilisateur est transmis par l'app via `ssv.userId`
        // (paramètre `user_id` du callback), avec repli sur `custom_data`.
        const uid = url.searchParams.get('user_id') || url.searchParams.get('custom_data') || '';
        const tx = url.searchParams.get('transaction_id') || '';
        if (!uid || !tx) return json({ ok: false, reason: 'missing user_id/transaction_id' }, 400);
        const credited = await creditAdReward(sa, uid, AD_REWARD_COINS, tx);
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

      // Version publiée sur le Play Store → `appRelease/current` (cron).
      if (request.method === 'GET' && path === '/cron/sync-release') {
        const result = await syncPublishedRelease(sa, env);
        return json({ ok: true, ...result });
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

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const sa = parseServiceAccount(env);
    // Chaque déclencheur a un rôle unique et identifiable par son expression,
    // sinon la version publiée ne serait jamais relue.
    const job =
      event.cron === '0 * * * *'
        ? processPayouts(sa)
        : event.cron === '15 */6 * * *'
          ? syncPublishedRelease(sa, env).then(() => undefined)
          : processNotifications(sa);
    ctx.waitUntil(job.catch(error => console.error('[cron]', event.cron, error)));
  },
};
