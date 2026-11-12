import type { ReactNode } from 'react';

/**
 * États de chargement, vide et erreur — un seul composant (F10).
 *
 * Constat de l'audit : plusieurs écrans affichaient un écran vide pendant le
 * chargement (indistinguable d'un « aucune donnée »), et les erreurs de lecture
 * étaient avalées par `.catch(() => undefined)` : l'utilisateur voyait une liste
 * vide sans savoir si c'était normal, s'il était hors connexion ou si Firestore
 * avait refusé la requête.
 */

export type AsyncPhase = 'idle' | 'loading' | 'ready' | 'error';

export function Skeleton({ rows = 3, label = 'Chargement' }: { rows?: number; label?: string }) {
  return (
    <div className="skeleton-stack" role="status" aria-live="polite" aria-label={label} data-testid="skeleton">
      {Array.from({ length: rows }).map((_, index) => (
        <div className="skeleton-row" key={index}>
          <span className="skeleton-dot" />
          <span className="skeleton-line" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  icon = '·',
  title,
  hint,
  action,
}: {
  icon?: string;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="state-block" role="status" data-testid="empty-state">
      <span className="state-icon" aria-hidden="true">{icon}</span>
      <strong>{title}</strong>
      {hint ? <p className="muted-xs">{hint}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({
  title = 'Impossible de charger ces données',
  error,
  onRetry,
}: {
  title?: string;
  error?: unknown;
  onRetry?: () => void;
}) {
  const message = friendlyError(error);
  return (
    <div className="state-block is-error" role="alert" data-testid="error-state">
      <span className="state-icon" aria-hidden="true">!</span>
      <strong>{title}</strong>
      <p className="muted-xs">{message}</p>
      {onRetry ? <button type="button" className="btn btn-outline" onClick={onRetry}>Réessayer</button> : null}
    </div>
  );
}

/**
 * Traduit une erreur technique en message actionnable.
 * Les trois cas qui comptent vraiment pour l'utilisateur : pas de réseau,
 * requête refusée (droits/index), ou panne inconnue.
 */
export function friendlyError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || '');
  if (/offline|network|unavailable|failed to fetch|timeout/i.test(raw)) {
    return 'Connexion indisponible. Vérifiez votre réseau, puis réessayez.';
  }
  if (/index/i.test(raw)) {
    return 'Cette vue nécessite une mise à jour de la base. Réessayez dans un instant.';
  }
  if (/permission|insufficient|denied/i.test(raw)) {
    return 'Accès refusé pour ce compte.';
  }
  return raw ? raw.slice(0, 160) : 'Une erreur inattendue est survenue.';
}
