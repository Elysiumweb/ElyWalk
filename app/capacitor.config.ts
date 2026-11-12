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
    LocalNotifications: {
      // Petite icône de la barre d'état et couleur d'accent : sans elles,
      // Android affiche un carré blanc et la notification passe inaperçue.
      smallIcon: 'ic_stat_elywalk',
      iconColor: '#D8CA82',
    },
  },
};

export default config;
