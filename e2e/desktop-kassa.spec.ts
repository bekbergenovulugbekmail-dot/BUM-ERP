/**
 * BUM POS KASSA (Electron) — HAQIQIY ELECTRON RUNTIME'da, Windows'da.
 *
 * Qamrov: qurilmani ulash (server manzili + egasining logini -> kompaniya va ombor),
 * kassir birinchi kirishi (PIN o'rnatish), smena ochish, mahsulot qo'shish, naqd sotuv,
 * chek tarixi, smenani yopish, ilovani QAYTA ISHGA TUSHIRISH va PIN bilan qayta kirish.
 *
 * MUHIM: bu **paketlanmagan (dev) build** — `apps/desktop/out`. O'RNATILGAN `.exe` ni tashqaridan
 * boshqarib bo'lmaydi, chunki `electronFuses.runAsNode: false` (ataylab qo'yilgan himoya)
 * Playwright'ning Electron drayverini bloklaydi. O'rnatish va ishga tushish alohida qo'lda
 * tekshirilgan (FINAL-SALE-READINESS-AUDIT-v2.md, Blocker 7).
 *
 * Har yugurishda TOZA kassa bazasi ishlatiladi (KASSA_USER_DATA — vaqtinchalik papka).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { ACCOUNTS, PASSWORD } from "./_lib/accounts.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DESKTOP = path.join(ROOT, "apps", "desktop");
const API = process.env.E2E_API_URL ?? "http://localhost:3000";
const PIN = "4417";

let userData: string;
let app: ElectronApplication;
let win: Page;

/** Kassa oynasini ochadi (kerak bo'lsa avval `out/` ni yig'adi). */
async function launch(dataDir: string) {
  if (!existsSync(path.join(DESKTOP, "out", "main", "index.js"))) {
    execFileSync("pnpm", ["run", "build"], { cwd: DESKTOP, stdio: "ignore", shell: process.platform === "win32" });
  }
  const instance = await electron.launch({
    args: ["."],
    cwd: DESKTOP,
    env: { ...process.env, KASSA_USER_DATA: dataDir, NODE_ENV: "development" },
    timeout: 90_000,
  });
  const page = await instance.firstWindow({ timeout: 90_000 });
  await page.waitForLoadState("domcontentloaded");
  return { instance, page };
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  userData = mkdtempSync(path.join(tmpdir(), "bum-kassa-e2e-"));
  ({ instance: app, page: win } = await launch(userData));
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  if (userData) rmSync(userData, { recursive: true, force: true });
});

test("qurilmani ulash: server manzili, egasining logini, kompaniya va ombor", async () => {
  await expect(win.locator("#setup-url")).toBeVisible({ timeout: 60_000 });
  await win.locator("#setup-url").fill(API);
  await win.locator("#setup-phone").fill(ACCOUNTS.owner.phone);
  await win.locator("#setup-password").fill(PASSWORD);
  await win.getByRole("button", { name: /Davom|Keyingi|Tekshir/i }).first().click();

  // Kompaniya va ombor ro'yxati serverdan keladi
  await expect(win.locator("#setup-warehouse")).toBeVisible({ timeout: 60_000 });
  const warehouse = await win.locator("#setup-warehouse option").first().getAttribute("value");
  await win.locator("#setup-warehouse").selectOption(warehouse!);
  await win.locator("#setup-name").fill("E2E Kassa");
  await win.getByRole("button", { name: /Ulash|Saqlash|Ro'yxatdan/i }).last().click();

  // Ulangach kassir ekrani ochiladi
  await expect(win.locator("#first-phone, #cashier-pin")).toBeVisible({ timeout: 60_000 });
});

test("kassir birinchi kirishi: parol bilan kiradi va PIN o'rnatadi", async () => {
  await win.locator("#first-phone").fill(ACCOUNTS.kassir.phone);
  await win.locator("#first-password").fill(PASSWORD);
  await win.locator("#first-pin").fill(PIN);
  await win.locator("#first-pin-confirm").fill(PIN);
  await win.getByRole("button", { name: /Kirish|Saqlash/i }).last().click();
  await expect(win.locator("#first-phone")).toBeHidden({ timeout: 60_000 });
});

test("smena ochish, naqd sotuv va chek tarixi", async () => {
  // ── Smenani ochish (bosh ekran) ───────────────────────────────────────
  await expect(win.getByRole("heading", { name: "Smena" })).toBeVisible({ timeout: 60_000 });
  const openShift = win.getByRole("button", { name: "Smenani ochish" });
  if (await openShift.isVisible().catch(() => false)) {
    await win.getByRole("textbox", { name: /Boshlang'ich naqd/ }).fill("100000");
    await expect(openShift).toBeEnabled();
    await openShift.click();
    await expect(win.getByRole("button", { name: "Smenani yopish" })).toBeVisible({ timeout: 30_000 });
  }

  // ── Kassa (POS) ekrani ────────────────────────────────────────────────
  await win.getByRole("button", { name: /^Kassa \(POS\)/ }).click();
  const search = win.getByPlaceholder(/Nomi, SKU yoki shtrix-kod/);
  await expect(search).toBeVisible({ timeout: 60_000 });

  // ── Mahsulot savatga ──────────────────────────────────────────────────
  await search.fill("Nestle");
  const product = win.getByRole("button", { name: /Nestle/i }).first();
  await expect(product).toBeVisible({ timeout: 30_000 });
  await product.click();
  const cart = win.getByRole("complementary", { name: "Savat" });
  await expect(cart.getByRole("textbox", { name: "Miqdor" }).first()).toHaveValue("1", { timeout: 30_000 });
  await expect(cart.getByText(/1 ta mahsulot/)).toBeVisible();

  // ── Naqd to'lov: usul tugmasi -> summa oynasi -> Yakunlash ────────────
  // (aralash to'lov desktop birliklar testlarida: apps/desktop/test/sale-calc.test.ts)
  await win.getByRole("button", { name: /Naqd to'lovi/ }).click();
  const dialog = win.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole("button", { name: /Yakunlash/ }).click();

  // Chek yopilgach savat bo'shaydi
  await expect(cart.getByRole("textbox", { name: "Miqdor" })).toHaveCount(0, { timeout: 60_000 });
});

test("ilova qayta ishga tushganda qurilma ulangan qoladi va PIN bilan kiriladi", async () => {
  await app.close();
  ({ instance: app, page: win } = await launch(userData));

  // Qayta ulash so'ralmaydi — qurilma va kassa nomi saqlanadi
  await expect(win.locator("#setup-url")).toBeHidden({ timeout: 60_000 });
  await expect(win.getByText(/E2E Kassa/)).toBeVisible({ timeout: 60_000 });

  // Kassir PIN bilan kiradi (parol qayta so'ralmaydi)
  await win.getByRole("button", { name: /Demo Kassir/ }).click();
  const pinField = win.locator("#cashier-pin");
  await expect(pinField).toBeVisible({ timeout: 30_000 });
  await pinField.fill(PIN);
  await pinField.press("Enter");
  await expect(win.getByRole("heading", { name: "Smena" })).toBeVisible({ timeout: 60_000 });

  // Oldingi smena ochiq qolgan — sotuv tarixida chek ko'rinadi
  await expect(win.getByRole("button", { name: "Smenani yopish" })).toBeVisible({ timeout: 30_000 });
});

test("chek tarixi va smenani yopish (Z-hisobot)", async () => {
  // Kassa (POS) dan chiqib bosh ekranga qaytamiz
  await expect(win.getByRole("heading", { name: "Smena" })).toBeVisible({ timeout: 60_000 });

  // ── Sotuv tarixi: yuqoridagi chek ko'rinadi ───────────────────────────
  await win.getByRole("button", { name: /^Sotuv tarixi/ }).click();
  await expect(win.getByRole("heading", { name: "Sotuv tarixi" })).toBeVisible({ timeout: 60_000 });
  // Ro'yxatda shu kassaning cheki bor (K01-000001 ko'rinishidagi raqam)
  await expect(win.getByText(/K\d{2}-\d+/).first()).toBeVisible({ timeout: 30_000 });
  await win.getByRole("button", { name: /Bosh sahifa/ }).first().click();

  // ── Smenani yopish ────────────────────────────────────────────────────
  // Sanalgan naqd kiritilmaguncha yopish tugmasi o'chiq turadi
  const closeShift = win.getByRole("button", { name: "Smenani yopish" });
  await expect(closeShift).toBeVisible({ timeout: 30_000 });
  await expect(closeShift).toBeDisabled();
  await win.locator("#shift-cash").fill("101000");
  await expect(closeShift).toBeEnabled();
  await closeShift.click();
  await expect(win.getByRole("button", { name: "Smenani ochish" })).toBeVisible({ timeout: 60_000 });
});
