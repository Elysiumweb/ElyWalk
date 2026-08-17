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
  },
});
