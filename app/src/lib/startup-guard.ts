/**
 * Filet de sécurité autonome du démarrage.
 * Ce module ne charge ni Firebase ni plugin natif : il reste utilisable même
 * si l'initialisation principale échoue et évite un écran blanc sans explication.
 */

const FALLBACK_ID = 'elywalk-startup-fallback';

/** Affiche un écran de récupération si aucune interface n'est déjà visible. */
export function showStartupFallback(details?: unknown): void {
  if (typeof document === 'undefined') return;
  const root = document.getElementById('root');
  if (!root) return;
  if (root.childElementCount > 0 && !root.querySelector('.startup-fallback')) return;
  if (document.getElementById(FALLBACK_ID)) return;

  if (details) console.error('[ElyWalk] démarrage impossible', details);

  const container = document.createElement('div');
  container.id = FALLBACK_ID;
  container.className = 'startup-fallback';
  container.setAttribute('role', 'alert');

  const emblem = document.createElement('img');
  emblem.src = '/elywalk-logo.png';
  emblem.alt = 'ElyWalk';
  emblem.className = 'startup-fallback-logo';

  const title = document.createElement('h1');
  title.className = 'startup-fallback-title';
  title.textContent = 'ElyWalk n’a pas pu démarrer';

  const body = document.createElement('p');
  body.className = 'startup-fallback-body';
  body.textContent = 'Une erreur est survenue au lancement. Vos données enregistrées sont intactes.';

  const reload = document.createElement('button');
  reload.type = 'button';
  reload.className = 'btn btn-gold';
  reload.textContent = 'Réessayer';
  reload.addEventListener('click', () => window.location.reload());

  container.append(emblem, title, body, reload);
  root.replaceChildren(container);
}

export function isStartupFallbackVisible(): boolean {
  return typeof document !== 'undefined' && document.getElementById(FALLBACK_ID) !== null;
}

/** Branche les erreurs globales et retourne une fonction de nettoyage. */
export function installStartupGuard(): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const onError = (event: ErrorEvent) => {
    showStartupFallback(event.error ?? event.message);
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    if (document.getElementById('root')?.childElementCount === 0) {
      showStartupFallback(event.reason);
    }
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onUnhandledRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onUnhandledRejection);
  };
}
