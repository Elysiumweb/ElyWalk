/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `package.json` est la source unique de la version : elle est injectée dans le
// bundle (src/lib/version.ts) et sert aussi de base au `versionCode` Android
// (android/app/build.gradle lit le même fichier).
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string;
};

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
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
  test: {
    exclude: ['node_modules/**', 'dist/**', 'rules-tests/**'],
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
