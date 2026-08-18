/// <reference types="@capacitor-firebase/authentication" />

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.example.elywalk',
  appName: 'ElyWalk',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
  plugins: {
    FirebaseAuthentication: {
      // Le SDK JS (firebase/auth) porte la session utilisée par Firestore.
      // On saute donc l'authentification native : le natif ne sert qu'à
      // produire les credentials (Google, vérification du téléphone via
      // Play Integrity). Sinon le code SMS serait consommé deux fois.
      skipNativeAuth: true,
      providers: ['google.com', 'phone'],
    },
  },
};

export default config;
