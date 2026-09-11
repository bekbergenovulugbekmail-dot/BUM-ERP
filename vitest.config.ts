import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Frontend unit testlari: jsdom + Testing Library. API testlari `apps/api` da (o'z konfiguratsiyasi,
// PostgreSQL test bazasi bilan) — `pnpm --filter @bum/api test`.
//
// Testlar germetik: tarmoq o'rniga `fetch` mock qilinadi.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@bum/shared": path.resolve(import.meta.dirname, "./packages/shared/src/index.ts"),
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    name: "frontend",
    passWithNoTests: true,
    // Restore Vitest mocks before each test to reduce state leakage.
    restoreMocks: true,
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/vitest.setup.ts"],
  },
});
