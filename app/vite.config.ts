import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Version applicative : lue depuis package.json, injectée au build.
// `src/lib/version.ts` la consomme via `__APP_VERSION__` : plus aucune version
// écrite en dur dans les pages.
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8')
) as { version?: string };
const appVersion = pkg.version ?? '0.0.0';

// Identifiant de build : date de compilation + version. Sert à vérifier sur un
// appareil que la WebView embarque bien la dernière archive (cache Capacitor).
const buildStamp = `${appVersion}+${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}`;

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_STAMP__: JSON.stringify(buildStamp),
  },
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
