/**
 * Real brauzer (Chrome) orqali web UI testlari. API regressiyasidan ALOHIDA:
 * bu yerda faqat `e2e/` papkasi, vitest to'plamlariga tegmaydi.
 *
 *   pnpm test:e2e            — barcha brauzer testlari
 *   pnpm test:e2e --headed   — brauzer ko'rinadigan rejimda
 *
 * Talab: lokal baza ko'tarilgan va `pnpm --filter @bum/api db:seed-demo` bajarilgan.
 * Parol kodda emas — `.env` dagi DEMO_PASSWORD.
 */
import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

if (existsSync(".env")) process.loadEnvFile(".env");

const WEB = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const API = process.env.E2E_API_URL ?? "http://localhost:3000";
const LIGHT = process.env.E2E_LIGHT === "1";

export default defineConfig({
  testDir: "./e2e",
  // Demo ma'lumot va qoldiqni tayyorlaydi (idempotent, hech narsa o'chirilmaydi)
  globalSetup: "./e2e/_lib/global-setup.ts",
  outputDir: "./e2e/.artifacts",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // Bitta demo kompaniya — testlar ketma-ket, holat aralashmasin
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "e2e/.report", open: "never" }]],
  use: {
    baseURL: WEB,
    // Haqiqiy o'rnatilgan Chrome (Chromium yuklab olinmaydi)
    channel: "chrome",
    headless: true,
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
    // Kam xotirali mashinada: E2E_LIGHT=1 bilan video va trace yozilmaydi
    video: LIGHT ? "off" : "retain-on-failure",
    trace: LIGHT ? "off" : "retain-on-failure",
    actionTimeout: 15_000,
  },
  webServer: [
    {
      command: "pnpm --filter @bum/api dev",
      url: `${API}/health`,
      reuseExistingServer: true,
      timeout: 180_000,
    },
    {
      command: "pnpm dev",
      url: WEB,
      reuseExistingServer: true,
      timeout: 180_000,
    },
  ],
});
