/**
 * Mises à jour de l'application (exigence produit).
 *
 * L'application est distribuée par le Play Store : une version installée peut
 * donc être en retard sur la version publiée. Aujourd'hui rien ne le signalait —
 * un utilisateur pouvait rester des mois sur une version où un défaut était
 * déjà corrigé, sans jamais le savoir.
 *
 * Ce module ne contient que de la **logique pure** (comparaison de versions,
 * politique de report, lien Play Store) : il est testable sans WebView, sans
 * Play Store et sans réseau. La détection elle-même vit dans `lib/appUpdate`.
 *
 * Deux niveaux de mise à jour, comme sur le Play Store :
 *  - **recommandée** — l'utilisateur peut continuer et ne plus être relancé
 *    pendant un délai de report (24 h par défaut) ;
 *  - **obligatoire** — l'écran de mise à jour ne peut pas être fermé (version
 *    minimale supportée, ex. changement de contrat d'API ou faille de sécurité).
 */

export type UpdateSeverity = 'recommended' | 'required';

export interface ReleaseInfo {
  /** Dernière version publiée sur le Play Store, ex. `2.3.0`. */
  latestVersion: string;
  /** Version minimale supportée : en dessous, la mise à jour est obligatoire. */
  minSupportedVersion?: string;
  /** Notes de version affichées sur l'écran de mise à jour (texte brut, court). */
  notes?: string;
  /** Date de publication (ms) — sert à ordonner et à dater l'écran. */
  publishedAt?: number;
  /** `false` pour suspendre le contrôle sans redéployer l'application. */
  enabled?: boolean;
}

/** Identifiant Play Store : `com.elysium.elywalk` (voir `android/app/build.gradle`). */
export const PLAY_STORE_PACKAGE = 'com.elysium.elywalk';

/**
 * Lien de la fiche Play Store.
 *
 * `market://` ouvre directement l'application Play Store installée, sans passer
 * par le navigateur ; le lien `https://` est le repli quand l'application Play
 * Store n'est pas disponible (émulateur, appareil sans Play Services).
 */
export function playStoreUrl(packageName: string = PLAY_STORE_PACKAGE): string {
  return `https://play.google.com/store/apps/details?id=${encodeURIComponent(packageName)}`;
}
export function playStoreMarketUrl(packageName: string = PLAY_STORE_PACKAGE): string {
  return `market://details?id=${encodeURIComponent(packageName)}`;
}

/** Découpe `2.2.3` / `2.2.3-beta.1` / `2.2` en nombres comparables. */
export function parseVersion(raw: string | null | undefined): number[] {
  if (!raw) return [];
  const cleaned = String(raw).trim().replace(/^v/i, '');
  const core = cleaned.split(/[-+]/)[0];
  return core
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .map((value) => (Number.isFinite(value) && value >= 0 ? value : 0));
}

/**
 * Compare deux versions : `-1` si `a < b`, `1` si `a > b`, `0` si égales.
 *
 * Les segments manquants valent zéro (`2.2` === `2.2.0`), ce qui évite qu'une
 * version publiée sans correctif de patch soit considérée comme plus récente.
 * Un suffixe de pré-version (`-beta`) est ignoré : le canal de distribution est
 * le Play Store, où seules les versions stables sont publiées.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    if (l < r) return -1;
    if (l > r) return 1;
  }
  return 0;
}

/** `true` si `installed` est strictement plus ancienne que `latest`. */
export function isOutdated(installed: string, latest: string): boolean {
  return compareVersions(installed, latest) < 0;
}

export interface UpdateDecision {
  /** Une mise à jour est disponible pour la version installée. */
  available: boolean;
  /** Gravité : `required` bloque l'accès, `recommended` peut être reporté. */
  severity: UpdateSeverity;
  /** Version publiée, si une mise à jour existe. */
  latestVersion?: string;
  /** Notes de version, nettoyées et bornées. */
  notes?: string;
  /**
   * `true` si l'utilisateur a déjà reporté cette version précise et que le
   * délai de report n'est pas écoulé (l'écran ne s'affiche pas).
   */
  dismissed: boolean;
}

/** Report par défaut d'une mise à jour recommandée : une fois par jour. */
export const SNOOZE_MS = 24 * 60 * 60 * 1000;

export interface SnoozeState {
  version: string;
  until: number;
}

/**
 * Décide ce que l'application doit faire, à partir de la version installée et
 * de la dernière version publiée.
 *
 * Règles (toutes testables) :
 *  - contrôle désactivé (`enabled === false`) ou version publiée inconnue → rien ;
 *  - version publiée ≤ version installée (build de test, déploiement en avance)
 *    → rien : on ne propose jamais « d'installer » une version plus ancienne ;
 *  - version installée < `minSupportedVersion` → **obligatoire**, sans report
 *    possible, même si l'utilisateur avait reporté une version précédente ;
 *  - sinon **recommandée**, sauf si cette version est reportée et que le délai
 *    court encore.
 */
export function decideUpdate(
  installedVersion: string,
  release: ReleaseInfo | null | undefined,
  snooze: SnoozeState | null | undefined,
  now: number = Date.now(),
): UpdateDecision {
  if (!release || release.enabled === false) return { available: false, severity: 'recommended', dismissed: false };
  const latest = (release.latestVersion || '').trim();
  if (!latest || !installedVersion) return { available: false, severity: 'recommended', dismissed: false };
  if (!isOutdated(installedVersion, latest)) {
    return { available: false, severity: 'recommended', dismissed: false };
  }

  const min = (release.minSupportedVersion || '').trim();
  const required = !!min && compareVersions(installedVersion, min) < 0;
  const notes = (release.notes || '').trim().slice(0, 600) || undefined;

  if (required) {
    return { available: true, severity: 'required', latestVersion: latest, notes, dismissed: false };
  }

  const snoozed = !!snooze && snooze.version === latest && snooze.until > now;
  return {
    available: true,
    severity: 'recommended',
    latestVersion: latest,
    notes,
    dismissed: snoozed,
  };
}

/** Valide l'état de report lu depuis le stockage (tolérant aux données sales). */
export function parseSnooze(raw: string | null | undefined): SnoozeState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { version?: unknown; until?: unknown };
    if (typeof value.version !== 'string' || typeof value.until !== 'number') return null;
    if (!Number.isFinite(value.until)) return null;
    return { version: value.version, until: value.until };
  } catch {
    return null;
  }
}

/**
 * Normalise le document `appRelease/current` (ou tout JSON distant) : champs
 * inconnus ignorés, valeurs bornées, dates acceptées en nombre ou en chaîne.
 */
export function normalizeRelease(raw: unknown): ReleaseInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const latestVersion = typeof value.latestVersion === 'string' ? value.latestVersion.trim() : '';
  if (!latestVersion) return null;
  const minRaw = typeof value.minSupportedVersion === 'string' ? value.minSupportedVersion.trim() : '';
  const publishedAtRaw = value.publishedAt;
  const publishedAt =
    typeof publishedAtRaw === 'number'
      ? publishedAtRaw
      : typeof publishedAtRaw === 'string' && Number.isFinite(Date.parse(publishedAtRaw))
        ? Date.parse(publishedAtRaw)
        : undefined;
  return {
    latestVersion,
    minSupportedVersion: minRaw || undefined,
    notes: typeof value.notes === 'string' ? value.notes.slice(0, 600) : undefined,
    publishedAt,
    enabled: value.enabled === false ? false : true,
  };
}
