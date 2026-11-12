import '@fontsource/orbitron/500.css';
import '@fontsource/orbitron/700.css';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import './styles.css';
import './ux-polish.css';
import './profile-polish.css';
import './appearance.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { applyAppearance, readAppearance } from './lib/appearance';
import { installDiagnostics } from './lib/diagnostics';

// Applique le thème enregistré avant le premier rendu : évite un flash de la
// charte sombre quand l'utilisateur a choisi « Système » sur un téléphone clair.
applyAppearance(readAppearance());

// F06 — capture des erreurs dès le chargement du module, avant même React :
// une panne d'amorçage (Firebase, police, stockage) laisse sinon un écran vide
// sans aucune trace.
installDiagnostics();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
