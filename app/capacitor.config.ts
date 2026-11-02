import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.elysium.elywalk',
  appName: 'ElyWalk',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
  plugins: {
    FirebaseAuthentication: {
      skipNativeAuth: false,
      providers: ['google.com'],
    },
    // Affichage de bord à bord (Android 15+) : Capacitor transmet les encarts
    // système au CSS (`env(safe-area-inset-*)` / `--safe-area-inset-*`).
    // Interface sombre => icônes claires dans les barres système.
    SystemBars: {
      style: 'DARK',
      insetsHandling: 'css',
    },
  },
};

export default config;
