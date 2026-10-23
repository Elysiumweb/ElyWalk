import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.elysium.elywalk',
  appName: 'ElyWalk',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
  plugins: {
    // Affichage de bord à bord : les encarts Android (barre d'état, barre de
    // navigation, encoche) sont exposés au web via les variables CSS
    // `--safe-area-inset-*` (utilisées dans src/styles.css).
    // `style: 'DARK'` = icônes claires, cohérentes avec le thème noir ElyWalk.
    SystemBars: {
      insetsHandling: 'css',
      style: 'DARK',
      hidden: false,
    },
    FirebaseAuthentication: {
      skipNativeAuth: false,
      providers: ['google.com'],
    },
  },
};

export default config;
