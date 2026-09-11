import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: true,
    hmr: {
      overlay: false,
    },
    // API bir domenda ko'rinadi — sessiya cookie'si telefondan (LAN IP) ochilganda ham ishlaydi
    proxy: {
      "/api": { target: process.env.API_PROXY_TARGET ?? "http://localhost:3000" },
    },
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // API bilan umumiy: ruxsatlar katalogi, telefon formati, xato kodlari
      "@bum/shared": path.resolve(import.meta.dirname, "./packages/shared/src/index.ts"),
      "@/convex": path.resolve(import.meta.dirname, "./convex"),
      "@": path.resolve(import.meta.dirname, "./src"),
    },
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ],
  },
  build: {
    chunkSizeWarningLimit: 1000,
  },
});
