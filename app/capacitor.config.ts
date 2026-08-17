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
      skipNativeAuth: false,
      providers: ['google.com', 'phone'],
    },
  },
};

export default config;
