import '@fontsource/orbitron/500.css';
import '@fontsource/orbitron/700.css';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import './styles.css';
import './ux-polish.css';
import './profile-polish.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installStartupGuard, showStartupFallback } from './lib/startup-guard';

// Filet de sécurité : une erreur au lancement ne doit pas laisser un écran blanc.
installStartupGuard();

const root = document.getElementById('root');

try {
  if (!root) throw new Error('Élément #root introuvable');
  // Écran de secours si l'interface ne s'affiche pas (React n'a pas démarré).
  const bootTimer = window.setTimeout(() => {
    if (root.childElementCount === 0) showStartupFallback('React n’a pas démarré');
  }, 10000);
  window.addEventListener('load', () => window.clearTimeout(bootTimer), { once: true });

  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} catch (error) {
  showStartupFallback(error);
}
