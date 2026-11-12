/**
 * Journal de diagnostic local (F06).
 *
 * Constat : l'application n'avait **aucun** rapport de panne. Une erreur
 * survenue sur l'appareil d'un utilisateur (écran blanc, échec de
 * synchronisation, permission refusée) ne laissait aucune trace
 * exploitable : ni côté utilisateur, ni côté développement. Les captures
 * d'écran envoyées par e-mail ne disaient jamais *quelle* erreur, *où*, ni
 * *quand*.
 *
 * Ce module ajoute une boucle d'observation fermée, sans service tiers :
 *  1. capture des erreurs non rattrapées (fenêtre + promesses) et des échecs
 *     réseau,
 *  2. journal circulant borné (200 entrées, dédoublonné par signature),
 *  3. écran « Diagnostic » qui affiche l'appareil, la version, les permissions,
 *     l'état du réseau, de la file de synchronisation et du consentement,
 *  4. export d'un rapport texte que l'utilisateur choisit d'envoyer — ses
 *     données personnelles ne sont **jamais** transmises automatiquement. Seuls
 *     des libellés d'erreur et des compteurs sont conservés : les valeurs
 *     saisies et les coordonnées GPS ne sont pas journalisées.
 */

import { Capacitor } from '@capacitor/core';
import { APP_VERSION, APP_VERSION_LABEL } from './version';

export type LogLevel = 'error' | 'warn' | 'info';

export interface LogEntry {
  at: number;
  level: LogLevel;
  /** Domaine applicatif : 'network', 'gps', 'firestore', 'auth', 'ads'… */
  scope: string;
  message: string;
  /** Signature stable pour dédoublonner les erreurs répétitives. */
  signature: string;
  count: number;
}

const MAX_ENTRIES = 200;
const MAX_MESSAGE = 300;

let entries: LogEntry[] = [];
let installed = false;
const listeners = new Set<(entries: LogEntry[]) => void>();

/** Retire ce qui pourrait identifier une personne ou un lieu avant journalisation. */
export function scrubMessage(input: string): string {
  return input
    // E-mails
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
    // Coordonnées (les erreurs de géolocalisation incluent parfois lat/lng)
    .replace(/-?\d{1,3}\.\d{4,}/g, '<nombre>')
    // JWT / jetons de partage
    .replace(/eyJ[\w-]{10,}\.?[\w-]*/g, '<jeton>')
    .replace(/\b[a-f0-9]{32,}\b/gi, '<jeton>')
    // UID Firebase
    .replace(/\b[A-Za-z0-9]{28}\b/g, '<uid>')
    .slice(0, MAX_MESSAGE);
}

function signatureOf(scope: string, message: string): string {
  // Les chiffres et identifiants variables ne doivent pas créer une nouvelle
  // entrée à chaque occurrence : on ne garde que la forme du message.
  return `${scope}:${message.replace(/\d+/g, '#').slice(0, 120)}`;
}

function emit(): void {
  listeners.forEach((listener) => listener(entries));
}

/** Ajoute une entrée (exporté : les modules peuvent consigner un échec géré). */
export function logDiagnostic(level: LogLevel, scope: string, error: unknown): void {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? 'Erreur inconnue');
  const message = scrubMessage(raw);
  const signature = signatureOf(scope, message);
  const existing = entries.find((entry) => entry.signature === signature);
  if (existing) {
    existing.count += 1;
    existing.at = Date.now();
    entries = [...entries];
    emit();
    return;
  }
  entries = [
    ...entries,
    { at: Date.now(), level, scope, message, signature, count: 1 },
  ].slice(-MAX_ENTRIES);
  emit();
}

export function subscribeDiagnostics(listener: (entries: LogEntry[]) => void): () => void {
  listeners.add(listener);
  listener(entries);
  return () => listeners.delete(listener);
}

export function readDiagnostics(): LogEntry[] {
  return entries;
}

export function clearDiagnostics(): void {
  entries = [];
  emit();
}

/** Classe une erreur générique pour lui donner un domaine lisible. */
function scopeFor(message: string, fallback: string): string {
  if (/firestore|firebase|index|permission-denied|unavailable/i.test(message)) return 'firestore';
  if (/geolocation|gps|location|permission/i.test(message)) return 'gps';
  if (/fetch|network|offline|timeout|abort/i.test(message)) return 'network';
  if (/auth|token|credential|sign.?in/i.test(message)) return 'auth';
  return fallback;
}

/**
 * Installe les écouteurs globaux. Idempotent ; appelé une fois au démarrage.
 * Les erreurs sont journalisées puis **laissées remonter** : ce module observe,
 * il n'avale jamais une erreur.
 */
export function installDiagnostics(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (event) => {
    const message = event.error instanceof Error
      ? `${event.error.name}: ${event.error.message}`
      : event.message || 'Erreur script';
    logDiagnostic('error', scopeFor(message, 'runtime'), message);
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
    logDiagnostic('error', scopeFor(message, 'promise'), message);
  });

  // Événements natifs utiles au diagnostic (état de l'app, réseau).
  window.addEventListener('offline', () => logDiagnostic('warn', 'network', 'Appareil hors connexion'));
  window.addEventListener('online', () => logDiagnostic('info', 'network', 'Connexion rétablie'));
}

export interface DeviceInfo {
  platform: string;
  native: boolean;
  userAgent: string;
  language: string;
  screen: string;
  pixelRatio: number;
  online: boolean;
  version: string;
  timezone: string;
  memoryGb?: number;
}

/** Photographie de l'environnement — sans aucune donnée personnelle. */
export function deviceInfo(): DeviceInfo {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const screenInfo = typeof window !== 'undefined' ? window.screen : undefined;
  const memory = (nav as Navigator & { deviceMemory?: number } | undefined)?.deviceMemory;
  return {
    platform: typeof Capacitor.getPlatform === 'function' ? Capacitor.getPlatform() : 'web',
    native: Capacitor.isNativePlatform(),
    userAgent: nav?.userAgent || 'inconnu',
    language: nav?.language || 'inconnu',
    screen: screenInfo ? `${screenInfo.width}×${screenInfo.height}` : 'inconnu',
    pixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio : 1,
    online: nav ? nav.onLine !== false : true,
    version: APP_VERSION,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'inconnu',
    memoryGb: typeof memory === 'number' ? memory : undefined,
  };
}

/** Rapport texte, lisible et copiable. */
export function buildDiagnosticsReport(extra: {
  pendingSync?: number;
  adConsent?: string;
  uid?: string;
  notifications?: string;
} = {}): string {
  const info = deviceInfo();
  const now = new Date();
  const lines: string[] = [
    'ElyWalk — rapport de diagnostic',
    `Généré : ${now.toISOString()}`,
    `Version : ${APP_VERSION_LABEL}`,
    `Plateforme : ${info.platform}${info.native ? ' (natif)' : ' (web)'}`,
    `Écran : ${info.screen} @${info.pixelRatio}x`,
    `Langue : ${info.language} · Fuseau : ${info.timezone}`,
    `Réseau : ${info.online ? 'en ligne' : 'hors connexion'}`,
    info.memoryGb ? `Mémoire appareil : ${info.memoryGb} Go` : '',
    typeof extra.pendingSync === 'number' ? `Synchronisation en attente : ${extra.pendingSync}` : '',
    extra.adConsent ? `Consentement publicitaire : ${extra.adConsent}` : '',
    extra.notifications ? `Notifications : ${extra.notifications}` : '',
    extra.uid ? `Compte : ${extra.uid.slice(0, 8)}…` : '',
    '',
    `Journal (${entries.length} entrée(s), ${entries.reduce((sum, e) => sum + e.count, 0)} occurrence(s)) :`,
    ...entries
      .slice()
      .sort((a, b) => b.at - a.at)
      .map((e) => {
        const repeat = e.count > 1 ? ` ×${e.count}` : '';
        return `[${new Date(e.at).toLocaleTimeString()}] ${e.level.toUpperCase()} ${e.scope}${repeat} — ${e.message}`;
      }),
    '',
    'Aucune coordonnée GPS, adresse e-mail ni contenu de message n’est inclus dans ce rapport.',
  ];
  return lines.filter((line) => line !== '').join('\n');
}
