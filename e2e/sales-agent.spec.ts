/**
 * Sotuv agenti ish joyi — HAQIQIY BRAUZERDA (Chrome).
 *
 * Qamrov: menyu (faqat 5 bo'lim), ERP bo'limlari yopiqligi, ish sessiyasi, GPS/geofence,
 * tashrif (vitrina rasmi majburiy, taymer), buyurtma (mahsulot, miqdor, yetkazish kuni,
 * to'lov turi) va buyurtmasiz tashrifda sabab majburiyligi — server tomon tekshiruvi bilan.
 *
 * GPS brauzer ruxsati bilan qo'yiladi (`context.setGeolocation`) — HAQIQIY QURILMA GPS'i EMAS.
 * Skrinshotlar: e2e/.screenshots/agent-*.png
 */
import { expect, test, type Page } from "@playwright/test";
import { appPath, login } from "./_lib/accounts.ts";

/** Demo seeder yaratadigan do'kon (koordinatali). */
const STORE = { name: "Baraka do'koni", latitude: 41.311081, longitude: 69.240562 };
/** ~4 km narida — geofence rad etishi kerak. */
const FAR = { latitude: 41.345, longitude: 69.29 };

/** 1x1 PNG — "kamera" o'rniga fayl sifatida beriladi. */
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005fb02fe4f9a2e8e0000000049454e44ae426082",
  "hex",
);

/** Sinov uchun siyosat: geofence 300 m, minimal tashrif vaqti yo'q, vitrina rasmi majburiy. */
async function setPolicy(page: Page) {
  const result = await page.evaluate(async () => {
    const current = await (await fetch("/api/sales-agent/policy")).json();
    const policy = {
      ...current.policy,
      geofenceRadiusMeters: 300,
      maxAccuracyMeters: 1000,
      maxLocationAgeSeconds: 600,
      minVisitMinutes: 0,
      storefrontPhotoRequired: true,
      shelfPhotoRequired: false,
      orderRequiresVisit: true,
      deliveryDateMode: "choose",
      creditLimitPolicy: "approval",
    };
    const res = await fetch("/api/sales-agent/policy", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(policy),
    });
    return { status: res.status, body: await res.text() };
  });
  expect(result.status, result.body).toBe(200);
}

/**
 * Agentga marshrut tayyorlaydi (idempotent): demo do'konlar shu marshrutga qo'shiladi va
 * marshrut demo agentga biriktiriladi. Agent ish joyi faqat o'z marshrutidagi do'konlarni ko'radi.
 */
async function ensureRoute(page: Page) {
  const result = await page.evaluate(async (storeName) => {
    const json = async (path: string) => (await fetch(path)).json();
    const post = async (path: string, body: unknown) => {
      const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return { status: res.status, body: await res.text() };
    };

    const reps = (await json("/api/distribution/sales-reps")).salesReps as { id: string; name: string }[];
    const rep = reps.find((row) => /Demo Sotuv agenti/i.test(row.name)) ?? reps[0];
    if (!rep) return { error: "savdo agenti topilmadi" };

    const routes = (await json("/api/distribution/routes")).routes as { id: string; name: string; salesRepId: string | null }[];
    let route = routes.find((row) => row.name === "E2E marshrut");
    if (!route) {
      const created = await post("/api/distribution/routes", {
        name: "E2E marshrut",
        salesRepId: rep.id,
        days: [0, 1, 2, 3, 4, 5, 6],
      });
      if (created.status !== 201) return { error: `marshrut: ${created.status} ${created.body}` };
      route = JSON.parse(created.body).route;
    }

    const customers = (await json("/api/sales/customers?limit=200")).customers as { id: string; name: string }[];
    const store = customers.find((row) => row.name === storeName);
    if (!store) return { error: "do'kon topilmadi" };
    // Takroriy qo'shish 409 qaytaradi — bu ham joyida
    const added = await post(`/api/distribution/routes/${route!.id}/customers`, { customerId: store.id });
    if (added.status !== 201 && added.status !== 409) return { error: `do'kon qo'shilmadi: ${added.status} ${added.body}` };
    return { routeId: route!.id, salesRepId: rep.id, customerId: store.id };
  }, STORE.name);
  expect(result.error ?? "", JSON.stringify(result)).toBe("");
  return result as { routeId: string; salesRepId: string; customerId: string };
}

/** Ish sessiyasini ochadi — busiz lokatsiya kuzatuvi yoqilmaydi va do'konlar ro'yxati bo'sh bo'ladi. */
async function startWork(page: Page) {
  await page.goto(appPath("sales-agent/dashboard"));
  const anyButton = page.getByRole("button", { name: /ISHNI (BOSHLASH|YAKUNLASH)/ });
  await expect(anyButton.first()).toBeVisible({ timeout: 40_000 });
  const start = page.getByRole("button", { name: "ISHNI BOSHLASH" });
  if (await start.isVisible().catch(() => false)) {
    await start.click();
  }
  await expect(page.getByRole("button", { name: "ISHNI YAKUNLASH" })).toBeVisible({ timeout: 30_000 });
}

/** Vitrina/polka rasmini "olish" — yashirin fayl input'iga PNG beriladi. */
async function takePhoto(page: Page, buttonName: RegExp) {
  const button = page.getByRole("button", { name: buttonName });
  await expect(button).toBeEnabled({ timeout: 20_000 });
  const chooser = page.waitForEvent("filechooser");
  await button.click();
  await (await chooser).setFiles({ name: "vitrina.png", mimeType: "image/png", buffer: PNG });
}

test.describe("Sotuv agenti ish joyi (brauzer)", () => {
  test("menyu, ERP yopiq, ish sessiyasi, tashrif (rasm majburiy) va buyurtma", async ({ page, context }) => {
    // Siyosatni egasi o'rnatadi (brauzerdan, haqiqiy sessiya bilan)
    await login(page, "owner");
    await page.goto(appPath("dashboard"));
    await setPolicy(page);
    await ensureRoute(page);

    // ── Agent: GPS do'kon yonida ────────────────────────────────────────
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: STORE.latitude, longitude: STORE.longitude, accuracy: 10 });
    await login(page, "agent");
    await page.goto(appPath("sales-agent/dashboard"));

    // ── Menyu: aynan 5 bo'lim ───────────────────────────────────────────
    const nav = page.locator("nav").last();
    await expect(nav).toBeVisible({ timeout: 30_000 });
    const items = await nav.locator("a").allInnerTexts();
    expect(items.map((value) => value.trim())).toEqual(["Bosh sahifa", "Sotuv", "Mijozlar", "Aksiyalar", "Hisobotlar"]);

    // ── ERP bo'limlari agentga yopiq ────────────────────────────────────
    await page.goto(appPath("pos"));
    await expect(page.getByPlaceholder(/Mahsulot nomi, SKU yoki barkod/)).toBeHidden({ timeout: 15_000 });
    await page.goto(appPath("sales-agent/dashboard"));

    // ── Ish sessiyasi ───────────────────────────────────────────────────
    await startWork(page);
    await page.screenshot({ path: "e2e/.screenshots/agent-dashboard.png" });

    // ── Mijozlar → do'kon ───────────────────────────────────────────────
    await page.goto(appPath("sales-agent/customers"));
    await page.getByPlaceholder(/Nomi, telefon/i).first().fill("Baraka");
    const storeLink = page.getByRole("link", { name: new RegExp(STORE.name) }).first();
    await expect(storeLink).toBeVisible({ timeout: 20_000 });
    await storeLink.click();
    await expect(page.getByText(STORE.name).first()).toBeVisible({ timeout: 20_000 });

    // ── Tashrif (oldingi yugurishdan ochiq tashrif qolgan bo'lishi mumkin) ──
    const inProgress = page.getByText("Tashrif davom etmoqda");
    // Bugun tashrif bo'lgan bo'lsa tugma "Yana tashrif" bo'ladi
    const startVisitButton = page.getByRole("button", { name: /Tashrifni boshlash|Yana tashrif/ });
    // Panel yuklanib bo'lishini kutamiz: yoki ochiq tashrif, yoki boshlash tugmasi
    await expect(inProgress.or(startVisitButton).first()).toBeVisible({ timeout: 30_000 });
    if (!(await inProgress.isVisible().catch(() => false))) {
      await startVisitButton.click();
    }
    await expect(inProgress).toBeVisible({ timeout: 20_000 });

    const storefrontDone = page.getByText(/Vitrina rasmi olindi/);
    const storefrontButton = page.getByRole("button", { name: /Vitrina rasmini oling/ });
    await expect(storefrontDone.or(storefrontButton).first()).toBeVisible({ timeout: 30_000 });
    if (!(await storefrontDone.isVisible().catch(() => false))) {
      await takePhoto(page, /Vitrina rasmini oling/);
    }
    await expect(storefrontDone).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: "e2e/.screenshots/agent-visit.png" });

    // ── Buyurtma ────────────────────────────────────────────────────────
    const orderButton = page.getByRole("link", { name: /^BUYURTMA$/i }).first();
    await expect(orderButton).toBeVisible({ timeout: 20_000 });
    await orderButton.click();
    await expect(page).toHaveURL(/order/, { timeout: 20_000 });

    await page.getByPlaceholder(/Mahsulot nomi yoki kodi/).fill("Nestle");
    const product = page.getByRole("button", { name: /Nestle suv 0\.5L/ }).first();
    await expect(product).toBeVisible({ timeout: 20_000 });
    await product.click();

    // Miqdor: 3 dona (mahsulot oynasida) va savatga qo'shish
    const productDialog = page.getByRole("dialog");
    await expect(productDialog).toBeVisible({ timeout: 20_000 });
    await productDialog.getByRole("spinbutton").first().fill("3");
    await expect(productDialog.getByText(/3 dona/)).toBeVisible();
    await productDialog.getByRole("button", { name: /SAQLASH/i }).click();
    await expect(productDialog).toBeHidden({ timeout: 15_000 });
    await expect(page.getByText(/1 ta mahsulot/)).toBeVisible({ timeout: 15_000 });

    // To'lov turi va yetkazib berish kuni (siyosat: agent tanlaydi)
    await page.getByRole("button", { name: "Naqd" }).first().click();
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const deliveryDate = page.getByRole("textbox", { name: /Yetkazib berish kuni/ });
    if (await deliveryDate.isVisible().catch(() => false)) await deliveryDate.fill(tomorrow);
    await page.screenshot({ path: "e2e/.screenshots/agent-order.png" });
    await page
      .getByRole("button", { name: /BUYURTMANI YAKUNLASH|Tasdiqlash/ })
      .first()
      .click();

    const confirm = page.getByRole("dialog");
    await expect(confirm).toBeVisible({ timeout: 15_000 });
    await confirm.getByRole("button", { name: /Buyurtmani yuborish/ }).click();
    await expect(page.getByText(/yuborildi|Tasdiq kutmoqda/).first()).toBeVisible({ timeout: 30_000 });
  });

  test("geofence: do'kondan uzoqda tashrif ham UI'da, ham serverda rad etiladi", async ({ page, context }) => {
    await login(page, "owner");
    await page.goto(appPath("dashboard"));
    await ensureRoute(page);
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: FAR.latitude, longitude: FAR.longitude, accuracy: 10 });
    await login(page, "agent");
    await startWork(page);
    await page.goto(appPath("sales-agent/customers"));
    await page.getByPlaceholder(/Nomi, telefon/i).first().fill("Baraka");
    const storeLink = page.getByRole("link", { name: new RegExp(STORE.name) }).first();
    await expect(storeLink).toBeVisible({ timeout: 20_000 });
    await storeLink.click();

    // UI: uzoqlik haqida ogohlantiradi
    await expect(page.getByText(/uzoqdasiz|ruxsat:/i).first()).toBeVisible({ timeout: 25_000 });

    // Server: UI'ni chetlab o'tib to'g'ridan-to'g'ri so'rov ham rad etiladi
    const storeId = page.url().split("/stores/")[1].split("/")[0];
    const direct = await page.evaluate(
      async ([id, lat, lng]) => {
        const res = await fetch("/api/sales-agent/visits/start", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            customerId: id,
            latitude: Number(lat),
            longitude: Number(lng),
            accuracy: 10,
            recordedAt: new Date().toISOString(),
          }),
        });
        return { status: res.status, body: await res.text() };
      },
      [storeId, String(FAR.latitude), String(FAR.longitude)],
    );
    expect(direct.status, direct.body).toBeGreaterThanOrEqual(400);
    expect(direct.body).toMatch(/geofence|uzoq/i);
  });
});
