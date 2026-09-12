import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Renderer testlari (`*.test.tsx`, jsdom) web UI komponentlarini ishlatadi — alias renderer vite konfiguratsiyasi bilan bir xil
  resolve: {
    alias: {
      "@bum/shared": path.resolve(import.meta.dirname, "../../packages/shared/src/index.ts"),
      "@": path.resolve(import.meta.dirname, "../../src"),
    },
    dedupe: ["react", "react-dom"],
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
  },
});
