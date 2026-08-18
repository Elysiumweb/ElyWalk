import { initializeApp, getApp, type FirebaseOptions } from 'firebase/app';
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
// par nature (config client), la sécurité est assurée par les règles Firestore
// + App Check.
//
// IMPORTANT : `appId` doit correspondre à l'application enregistrée dans la
// console Firebase pour la plateforme courante :
//  - dans la WebView Capacitor (Android), on utilise l'App ID Android, car
//    c'est lui qui est attesté par Play Integrity (App Check).
//  - dans un navigateur, il faut l'App ID de l'application *Web* (sinon
//    App Check reCAPTCHA et Analytics échouent). Renseignez-le via
//    `VITE_FIREBASE_WEB_APP_ID` (voir .env.example).
const ANDROID_APP_ID = '1:260136634782:android:791d77945d9cd98b306e8f';

const env = import.meta.env as Record<string, string | undefined>;

const isNative = Capacitor.isNativePlatform();

const firebaseConfig: FirebaseOptions = {
  apiKey: env.VITE_FIREBASE_API_KEY || 'AIzaSyAeAsfLWZejW5pKInlPBvYgXiQQxO59x9Q',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'elywalk-2f7ba.firebaseapp.com',
  projectId: env.VITE_FIREBASE_PROJECT_ID || 'elywalk-2f7ba',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || 'elywalk-2f7ba.firebasestorage.app',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '260136634782',
  appId: isNative
    ? env.VITE_FIREBASE_ANDROID_APP_ID || ANDROID_APP_ID
    : env.VITE_FIREBASE_WEB_APP_ID || ANDROID_APP_ID,
};

export const firebaseApp = initializeApp(firebaseConfig);

export const getFirebaseApp = () => getApp();

// Sur Android (webview Capacitor), utiliser la persistance indexedDB.
export const auth: Auth = isNative
  ? initializeAuth(firebaseApp, { persistence: indexedDBLocalPersistence })
  : getAuth(firebaseApp);

auth.languageCode = 'fr';

export const db = getFirestore(firebaseApp);
