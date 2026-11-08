/**
 * Garde-fou de démarrage.
 *
 * Si la construction de l'interface échoue (erreur JavaScript, mémoire
 * insuffisante dans la WebView, stockage indisponible…), l'écran restait
 * blanc : pour l'utilisateur, l'application semblait plantée. On affiche à la
 * place un écran de secours lisible, avec un bouton de rechargement.
 *
 * ⚠️ Ce module ne démarre AUCUNE connexion (pas de Firebase, pas de plugin) :
 * il doit pouvoir s'exécuter même quand le reste de l'application échoue.
 */

const FALLBACK_ID = 'elywalk-startup-fallback';

const MESSAGES = {
  fr: {
    title: 'ElyWalk n’a pas pu démarrer',
    body: 'Une erreur est survenue au lancement. Vos données enregistrées sont intactes.',
    action: 'Réessayer',
  },
  en: {
    title: 'ElyWalk could not start',
    body: 'Something went wrong during startup. Your saved data is intact.',
    action: 'Try again',
  },
};

function currentLanguage(): 'fr' | 'en' {
  const lang = (typeof navigator !== 'undefined' && navigator.language) || 'fr';
  return lang.toLowerCase().startsWith('en') ? 'en' : 'fr';
}

/** Affiche l'écran de secours (une seule fois). */
export function showStartupFallback(details?: unknown): void {
  if (typeof document === 'undefined') return;
  const root = document.getElementById('root');
  if (!root) return;
  // Ne remplace jamais une interface qui a fini par s'afficher.
  if (root.childElementCount > 0 && !root.querySelector('.startup-fallback')) return;
  if (document.getElementById(FALLBACK_ID)) return;

  if (details) console.error('[ElyWalk] démarrage impossible', details);
  const text = MESSAGES[currentLanguage()];

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
  title.textContent = text.title;

  const body = document.createElement('p');
  body.className = 'startup-fallback-body';
  body.textContent = text.body;

  const reload = document.createElement('button');
  reload.type = 'button';
  reload.className = 'btn btn-gold';
  reload.textContent = text.action;
  reload.addEventListener('click', () => window.location.reload());

  container.append(emblem, title, body, reload);
  root.replaceChildren(container);
}

/** `true` si l'écran de secours est déjà affiché. */
export function isStartupFallbackVisible(): boolean {
  return typeof document !== 'undefined' && document.getElementById(FALLBACK_ID) !== null;
}

/** Branche les filets de sécurité (erreurs synchrones, promesses, React). */
export function installStartupGuard(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('error', (event) => {
    showStartupFallback(event.error ?? event.message);
  });

  window.addEventListener('unhandledrejection', (event) => {
    // Une promesse rejetée n'empêche pas l'interface de fonctionner : on la
    // journalise sans afficher l'écran de secours, sauf si la page est vide.
    if (document.getElementById('root')?.childElementCount === 0) {
      showStartupFallback(event.reason);
    }
  });
}
