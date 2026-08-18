import '@fontsource/orbitron/500.css';
import '@fontsource/orbitron/700.css';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import './styles.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initAppCheck } from './lib/app-check';

// App Check doit être prêt avant la première requête Firestore/Auth,
// sinon les requêtes partent sans jeton et sont rejetées lorsque
// l'application forcée est activée dans la console Firebase.
initAppCheck().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
