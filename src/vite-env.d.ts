/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API manzili; bo'sh — shu domen (dev'da Vite proxy `/api` → localhost:3000, prod'da nginx). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
