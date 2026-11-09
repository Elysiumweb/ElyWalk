import { initializeApp } from 'firebase/app';
import {
  getAuth,
  initializeAuth,
  indexedDBLocalPersistence,
  type Auth,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { Capacitor } from '@capacitor/core';

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

export const db = getFirestore(firebaseApp);
