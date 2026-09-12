import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

// Renderer: web ilovaning UI komponentlari va Tailwind mavzusi qayta ishlatiladi ("@" — web src)
export default defineConfig({
  root: path.resolve(import.meta.dirname, "src/renderer"),
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@bum/shared": path.resolve(import.meta.dirname, "../../packages/shared/src/index.ts"),
      "@": path.resolve(import.meta.dirname, "../../src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "out/renderer"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
  server: { port: 5180, strictPort: true },
});
