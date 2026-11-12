import { initializeApp } from 'firebase/app';
import {
  getAuth,
  initializeAuth,
  indexedDBLocalPersistence,
  type Auth,
} from 'firebase/auth';
import { getFirestore, setLogLevel } from 'firebase/firestore';
import { Capacitor } from '@capacitor/core';
import { doc, getDoc } from 'firebase/firestore';
import { logDiagnostic } from './diagnostics';

// Configuration Firebase du projet ElyWalk (elywalk-2f7ba).
// Ces valeurs proviennent de google-services.json — elles sont publiques
// par nature (config client), la sécurité est assurée par les règles Firestore.
const firebaseConfig = {
  apiKey: 'AIzaSyAeAsfLWZejW5pKInlPBvYgXiQQxO59x9Q',
  authDomain: 'elywalk-2f7ba.firebaseapp.com',
  projectId: 'elywalk-2f7ba',
  storageBucket: 'elywalk-2f7ba.firebasestorage.app',
  messagingSenderId: '260136634782',
  appId: '1:260136634782:android:791d77945d9cd98b306e8f',
};

export const firebaseApp = initializeApp(firebaseConfig);

// Sur Android (webview Capacitor), utiliser la persistance indexedDB.
export const auth: Auth = Capacitor.isNativePlatform()
  ? initializeAuth(firebaseApp, { persistence: indexedDBLocalPersistence })
  : getAuth(firebaseApp);

auth.languageCode = 'fr';

// F06 — les erreurs Firestore (`permission-denied`, `failed-precondition : an
// index is required`, `unavailable`) étaient jusqu'ici muettes ou seulement
// visibles dans une console que personne n'ouvre sur un téléphone. On les fait
// remonter au journal de diagnostic, qui les rend consultables depuis l'écran
// Profil → Diagnostic, sans transmettre quoi que ce soit automatiquement.
setLogLevel('warn');

export const db = getFirestore(firebaseApp);

if (Capacitor.isNativePlatform()) {
  // Sonde volontairement silencieuse : une lecture refusée sur un document
  // inexistant ne casse rien, mais son échec typé est consigné.
  void getDoc(doc(db, 'diagnostics', 'ping'))
    .then(() => logDiagnostic('info', 'firestore', 'Connexion Firestore établie'))
    .catch((e) => logDiagnostic('warn', 'firestore', e));
}
