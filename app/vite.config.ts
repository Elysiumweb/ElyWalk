import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 3000,
    strictPort: true,
    allowedHosts: true,
    hmr: process.env.EXPO_PACKAGER_PROXY_URL
      ? { clientPort: 443, protocol: 'wss' }
      : undefined,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Découpage des dépendances : la WebView n'analyse plus un unique bundle de
    // 1,3 Mo au démarrage (pic de mémoire et démarrage plus rapide sur les
    // appareils d'entrée de gamme).
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('firebase')) return 'firebase';
          if (id.includes('leaflet')) return 'leaflet';
          if (id.includes('@capacitor')) return 'capacitor';
          if (id.includes('react')) return 'react';
          return 'vendor';
        },
      },
    },
  },
});
