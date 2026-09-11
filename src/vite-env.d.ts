/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API manzili; bo'sh — shu domen (dev'da Vite proxy `/api` → localhost:3000). */
  readonly VITE_API_URL?: string;
  /** PHASE 16 tugaguncha — Convex'dan hali ko'chirilmagan sahifalar uchun. */
  readonly VITE_CONVEX_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
