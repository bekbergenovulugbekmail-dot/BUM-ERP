/**
 * TENANT IZOLYATSIYASI — haqiqiy brauzerda (Chrome).
 *
 * Qoida: kirish FAQAT biznes manzilidan (`app.bum-erp.uz/<biznes>`), universal kirish sahifasi yo'q.
 * Har bir foydalanuvchi faqat o'z biznesiga kiradi; manzilni, `x-bum-company` kontekstini yoki so'rov
 * tanasidagi `companyId` ni o'zgartirib begona biznesga o'tib bo'lmaydi.
 *
 * Ikkinchi biznes shu testning o'zida (vaqtinchalik platforma admini bilan) ochiladi — parol faqat
 * `DEMO_PASSWORD` muhit o'zgaruvchisidan olinadi, kodda saqlanmaydi.
 */
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { ACCOUNTS, PASSWORD, SLUG, appPath, login } from "./_lib/accounts.ts";

/** Ikkinchi biznes — barqaror nom va telefon (qayta yugurishda mavjudi ishlatiladi). */
const SECOND = { name: "Anor Market E2E", slug: "anor-market-e2e", phone: "+998900000199", device: "e2eanordevice0001" };
/** Demo egasining ishonchli qurilmasi — `_lib/accounts.ts` dagi bilan bir xil. */
const OWNER_DEVICE = "e2eownerdevice0001";

/** Lokal, vaqtinchalik platforma admini (test oxirida qaytariladi). */
function platformAdmin(action: "grant" | "revoke") {
  execFileSync("pnpm", ["--filter", "@bum/api", "test:platform-admin", action, ACCOUNTS.direktor.phone], {
    stdio: ["ignore", "ignore", "inherit"],
    shell: process.platform === "win32",
  });
}

/** Qurilma identifikatori — yangi brauzerda "yangi qurilma" to'sig'iga tushmaslik uchun. */
async function seedDevice(page: Page, key: string) {
  await page.context().addInitScript((value) => {
    try {
      localStorage.setItem("bum:device-id", value);
    } catch {
      /* xususiy rejim */
    }
  }, key);
}

/** Biznes manzilidan kirish; natijada xato matni (kirsa — null). */
async function loginAt(page: Page, slug: string, phone: string, device: string, password = PASSWORD) {
  await page.context().clearCookies();
  // Har foydalanuvchi O'Z ishonchli qurilmasidan kiradi — aks holda qurilma to'sig'i tenant tekshiruvini yashiradi
  await seedDevice(page, device);
  await page.goto(`/${slug}`);
  await expect(page.locator("#phone")).toBeVisible({ timeout: 30_000 });
  await page.locator("#phone").fill(phone);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /kirish/i }).click();

  const alert = page.getByRole("alert");
  const outcome = await Promise.race([
    alert.waitFor({ state: "visible", timeout: 30_000 }).then(() => "error" as const),
    page.locator("#password").waitFor({ state: "hidden", timeout: 30_000 }).then(() => "ok" as const),
  ]);
  return outcome === "error" ? await alert.innerText() : null;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  // Ikkinchi biznes bir marta ochiladi (mavjud bo'lsa — qayta ishlatiladi)
  const page = await browser.newPage();
  try {
    platformAdmin("grant");
    await login(page, "direktor");
    const result = await page.evaluate(
      async ({ name, phone, password }) => {
        const existing = await fetch(`/api/public/companies/anor-market-e2e`);
        if (existing.ok) return { reused: true, slug: (await existing.json()).company.slug as string };
        const res = await fetch("/api/platform/companies", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, owner: { phone, password, name: "Anor Egasi" } }),
        });
        const text = await res.text();
        return { reused: false, status: res.status, slug: res.ok ? (JSON.parse(text).company.slug as string) : null, text };
      },
      { name: SECOND.name, phone: SECOND.phone, password: PASSWORD },
    );
    expect(result.slug, `ikkinchi biznes ochilmadi: ${JSON.stringify(result)}`).toBe(SECOND.slug);
  } finally {
    platformAdmin("revoke");
    await page.close();
  }
});

test("1) o'z biznesi manzilidan kirish — ikkala biznes ham ishlaydi", async ({ page }) => {
  expect(await loginAt(page, SLUG, ACCOUNTS.owner.phone, OWNER_DEVICE), "demo egasi o'z manzilidan").toBeNull();
  await expect(page).toHaveURL(new RegExp(`/${SLUG}/`), { timeout: 30_000 });

  expect(await loginAt(page, SECOND.slug, SECOND.phone, SECOND.device), "anor egasi o'z manzilidan").toBeNull();
  await expect(page).toHaveURL(new RegExp(`/${SECOND.slug}/`), { timeout: 30_000 });
});

test("2) begona biznes manzilidan kirish bloklanadi (ikki tomonlama)", async ({ page }) => {
  const anorAtDemo = await loginAt(page, SLUG, SECOND.phone, SECOND.device);
  expect(anorAtDemo, "anor foydalanuvchisi demo manzilida").toMatch(/xodimi emassiz/i);
  expect(await page.evaluate(async () => (await fetch("/api/auth/me")).status), "sessiya ochilmasligi kerak").toBe(401);

  const demoAtAnor = await loginAt(page, SECOND.slug, ACCOUNTS.owner.phone, OWNER_DEVICE);
  expect(demoAtAnor, "demo egasi anor manzilida").toMatch(/xodimi emassiz/i);
  expect(await page.evaluate(async () => (await fetch("/api/auth/me")).status)).toBe(401);
});

test("3) kirgandan keyin URL'ni begona biznesga almashtirish bloklanadi", async ({ page }) => {
  await login(page, "owner");
  await page.goto(`/${SECOND.slug}/dashboard`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(/kirishingiz yo'q/i), "begona biznes sahifasi berilmaydi").toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: /Bosh sahifa|Dashboard/i })).toHaveCount(0);
});

test("4) kontekst (tenantId) va tanadagi companyId manipulyatsiyasi bloklanadi", async ({ page }) => {
  await login(page, "owner");

  // `x-bum-company` — begona biznes slug va id bilan
  const bySlug = await page.evaluate(
    async (slug) => (await fetch("/api/sales/customers", { headers: { "x-bum-company": slug } })).status,
    SECOND.slug,
  );
  expect(bySlug, "begona slug konteksti").toBe(403);

  const foreignId = await page.evaluate(async () => (await (await fetch("/api/public/companies/anor-market-e2e")).json()).company.id as string);
  const byId = await page.evaluate(
    async (id) => (await fetch("/api/sales/customers", { headers: { "x-bum-company": id } })).status,
    foreignId,
  );
  expect(byId, "begona id konteksti").toBe(403);

  // So'rov tanasidagi companyId — server qabul qilmaydi
  const injected = await page.evaluate(async (id) => {
    const res = await fetch("/api/sales/customers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Manipulyatsiya", companyId: id }),
    });
    return res.status;
  }, foreignId);
  expect(injected, "tanadagi companyId rad etiladi").toBe(400);
});

test("5) chiqqandan keyin orqaga qaytish ma'lumot bermaydi", async ({ page }) => {
  await login(page, "owner");
  await page.goto(appPath("products"));
  await expect(page.getByPlaceholder(/Nomi, SKU, barcode/i).first()).toBeVisible({ timeout: 30_000 });

  await page.evaluate(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
  });
  await page.goto(appPath("products"));
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#password"), "kirish formasi ko'rinadi").toBeVisible({ timeout: 30_000 });

  await page.goBack();
  await page.waitForLoadState("networkidle");
  const status = await page.evaluate(async () => (await fetch("/api/catalog/products?limit=1")).status);
  expect(status, "chiqqandan keyin API yopiq").toBe(401);
});

test("6) universal kirish sahifasi yo'q: root va /uz/login biznes manzilini so'raydi", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/");
  await expect(page.getByText("Biznes manzili")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#password"), "root'da parol maydoni yo'q").toHaveCount(0);

  await page.goto("/uz/login");
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Biznes manzili"), "/uz/login biznes manziliga yo'naltiradi").toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#password")).toHaveCount(0);
});
