/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `1` pour construire un paquet avec les annonces de test Google. */
  readonly VITE_TEST_ADS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
