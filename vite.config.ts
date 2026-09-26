import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig, type Plugin } from "vite";
import { uzCyrl } from "./vite-plugin-uz-cyrl.ts";

/**
 * Har build o'z belgisini oladi va u `build.json` da ham chiqadi.
 *
 * Android ilovasi production saytini ochadi, shuning uchun "deploy = darhol hamma telefonda" faqat
 * sahifa QAYTA YUKLANGANDA to'g'ri. Agent ilovani yopmaydi (ish sessiyasi va fondagi GPS ochiq
 * turadi), shuning uchun WebView eski JS bilan kunlab ishlashi mumkin edi. Ilova shu belgini
 * server bilan solishtirib, yangi build chiqqanini o'zi biladi.
 *
 * `build.json` `/assets/` dan tashqarida, ya'ni nginx unga `Cache-Control: no-cache` beradi.
 */
const BUILD_ID = new Date().toISOString();

function buildStamp(): Plugin {
  return {
    name: "bum-build-stamp",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "build.json", source: JSON.stringify({ build: BUILD_ID }) });
    },
  };
}

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
      // ws: true — dostavka real-time (/api/delivery/ws)
      "/api": { target: process.env.API_PROXY_TARGET ?? "http://localhost:3000", ws: true },
    },
  },
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  // uzCyrl — SWC dan oldin: interfeys matni "Ўзбекча (кирилл)" tili uchun belgilanadi
  plugins: [uzCyrl(), react(), tailwindcss(), buildStamp()],
  resolve: {
    alias: {
      // API bilan umumiy: ruxsatlar katalogi, telefon formati, xato kodlari
      "@bum/shared": path.resolve(import.meta.dirname, "./packages/shared/src/index.ts"),
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
