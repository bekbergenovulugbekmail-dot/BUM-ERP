/**
 * Yetkazuvchi (dostavka agenti) ish joyi — HAQIQIY BRAUZERDA (Chrome).
 *
 * Qamrov: menyu (5 bo'lim), ish sessiyasi, yetkazma zanjiri
 * ASSIGNED → ACCEPTED → OUT_FOR_DELIVERY → ARRIVED → DELIVERING → DELIVERED,
 * mijoz/buyurtma/mahsulot/summa ko'rinishi, navigatsiya havolasi, yetib kelish geofence'i,
 * naqd yig'ish va tasdiqlash; alohida testda "Yetkazib bo'lmadi" (FAILED).
 * Har ikkalasida ASL BUYURTMA noto'g'ri o'zgarmasligi tekshiriladi.
 *
 * GPS brauzer ruxsati bilan qo'yiladi — HAQIQIY QURILMA GPS'i EMAS.
 */
import { expect, test, type Page } from "@playwright/test";
import { appPath, login } from "./_lib/accounts.ts";

/** Demo do'kon (koordinatali) — yetkazma manzili. */
const SHOP = { name: "Baraka do'koni", latitude: 41.311081, longitude: 69.240562 };

type Fixture = { taskId: string; orderId: string; orderNumber: string; total: string; status: string };

/**
 * Egasi sifatida: siyosat (dalilsiz tasdiqlash), yetkazma talab qiladigan buyurtma,
 * tasdiqlash va demo yetkazuvchiga biriktirish. Hammasi brauzer sessiyasi orqali.
 */
async function makeTask(page: Page): Promise<Fixture> {
  const result = await page.evaluate(async (shopName) => {
    const get = async (path: string) => (await fetch(path)).json();
    const send = async (method: string, path: string, body?: unknown) => {
      const res = await fetch(path, {
        method,
        ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      });
      return { status: res.status, text: await res.text() };
    };

    // 1) Siyosat: OTP/imzo/rasm talab qilinmasin (SMS sozlanmagan), geofence keng
    const policy = (await get("/api/delivery/policy")).policy;
    const saved = await send("PUT", "/api/delivery/policy", {
      ...policy,
      geofenceRadiusMeters: 500,
      confirmation: { otp: false, signature: false, photo: false },
    });
    if (saved.status !== 200) return { error: `siyosat: ${saved.status} ${saved.text}` };

    // 2) Buyurtma uchun kerakli ma'lumotlar
    const customers = (await get("/api/sales/customers?limit=200")).customers as { id: string; name: string }[];
    const customer = customers.find((row) => row.name === shopName);
    const warehouses = (await get("/api/inventory/warehouses")).warehouses as { id: string; name: string }[];
    const products = (await get("/api/catalog/products?limit=50")).products as { id: string; name: string }[];
    const product = products.find((row) => /Nestle suv/.test(row.name)) ?? products[0];
    if (!customer || !warehouses[0] || !product) return { error: "mijoz/ombor/mahsulot topilmadi" };

    // 3) Yetkazish kerak bo'lgan buyurtma → tasdiqlash (yetkazma avtomatik yaratiladi)
    const created = await send("POST", "/api/sales/orders", {
      customerId: customer.id,
      warehouseId: warehouses[0].id,
      orderDate: new Date().toISOString().slice(0, 10),
      deliveryRequired: true,
      items: [{ productId: product.id, quantity: "2" }],
    });
    if (created.status !== 201) return { error: `buyurtma: ${created.status} ${created.text}` };
    const order = JSON.parse(created.text).order as { id: string; number: string; totalAmount: string; status: string };
    const confirmed = await send("POST", `/api/sales/orders/${order.id}/confirm`, {});
    if (confirmed.status !== 200) return { error: `tasdiqlash: ${confirmed.status} ${confirmed.text}` };

    // 4) Yetkazmani demo yetkazuvchiga biriktirish
    const tasks = (await get("/api/delivery/tasks?limit=200")).tasks as { id: string; orderId: string }[];
    const task = tasks.find((row) => row.orderId === order.id);
    if (!task) return { error: "yetkazma topilmadi" };
    const agents = (await get("/api/delivery/agents")).agents as { id: string; name: string }[];
    const agent = agents.find((row) => /Demo Dostavchi/i.test(row.name)) ?? agents[0];
    if (!agent) return { error: "yetkazuvchi topilmadi" };
    const assigned = await send("POST", `/api/delivery/tasks/${task.id}/assign`, { deliveryAgentId: agent.id });
    if (assigned.status !== 200) return { error: `biriktirish: ${assigned.status} ${assigned.text}` };

    const after = JSON.parse((await send("GET", `/api/sales/orders/${order.id}`)).text).order;
    return { taskId: task.id, orderId: order.id, orderNumber: order.number, total: after.totalAmount, status: after.status };
  }, SHOP.name);
  expect((result as { error?: string }).error ?? "", JSON.stringify(result)).toBe("");
  return result as Fixture;
}

/** Buyurtmaning holati va summasi (egasi sifatida o'qiladi). */
async function readOrder(page: Page, orderId: string) {
  return page.evaluate(async (id) => {
    const res = await fetch(`/api/sales/orders/${id}`);
    const order = (await res.json()).order;
    return { status: order.status as string, total: order.totalAmount as string, paymentStatus: order.paymentStatus as string };
  }, orderId);
}

/** Demo mahsulotning umumiy qoldig'i (qaytish tekshiruvi uchun). */
async function readStock(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const products = (await (await fetch("/api/catalog/products?limit=50")).json()).products as { id: string; name: string }[];
    const product = products.find((row) => /Nestle suv/.test(row.name)) ?? products[0];
    const rows = (await (await fetch(`/api/inventory/stock/products/${product.id}`)).json()).stock as { quantity: string }[];
    return rows.reduce((sum, row) => sum + Number(row.quantity), 0);
  });
}

/** Yetkazuvchi ish sessiyasini ochadi. */
async function startWork(page: Page) {
  await page.goto(appPath("delivery-agent/dashboard"));
  const any = page.getByRole("button", { name: /ISHNI (BOSHLASH|YAKUNLASH)/ });
  await expect(any.first()).toBeVisible({ timeout: 40_000 });
  const start = page.getByRole("button", { name: "ISHNI BOSHLASH" });
  if (await start.isVisible().catch(() => false)) await start.click();
  await expect(page.getByRole("button", { name: "ISHNI YAKUNLASH" })).toBeVisible({ timeout: 30_000 });
}

test.describe("Yetkazuvchi ish joyi (brauzer)", () => {
  test("menyu va to'liq zanjir: qabul → yo'lda → yetdim → topshirish → naqd → YETKAZILDI", async ({ page, context }) => {
    await login(page, "owner");
    await page.goto(appPath("dashboard"));
    const fixture = await makeTask(page);

    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: SHOP.latitude, longitude: SHOP.longitude, accuracy: 10 });
    await login(page, "dostavchi");
    await startWork(page);

    // ── Menyu: 5 bo'lim ─────────────────────────────────────────────────
    const nav = page.locator("nav").last();
    await expect(nav).toBeVisible({ timeout: 30_000 });
    const items = (await nav.locator("a").allInnerTexts()).map((value) => value.trim());
    expect(items).toEqual(["Bosh sahifa", "Yetkazmalar", "Mijozlar", "Qarz/To'lov", "Hisobotlar"]);

    // ── Yetkazma kartochkasi: mijoz, buyurtma, summa ────────────────────
    await page.goto(appPath(`delivery-agent/tasks/${fixture.taskId}`));
    await expect(page.getByText(SHOP.name).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Biriktirilgan").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Xaritada|XARITADA OCHISH/i }).first()).toBeVisible();
    await expect(page.getByText(/Buyurtma SO-/).first()).toBeVisible();
    await expect(page.getByText(/Yig'iladigan summa/).first()).toBeVisible();

    // ── Zanjir ──────────────────────────────────────────────────────────
    const step = async (button: RegExp, nextStatus: string) => {
      await page.getByRole("button", { name: button }).first().click();
      await expect(page.getByText(nextStatus).first()).toBeVisible({ timeout: 30_000 });
    };
    await step(/QABUL QILISH/, "Qabul qilingan");
    await step(/YO'LGA CHIQISH/, "Yo'lda");
    await step(/MIJOZGA YETDIM/, "Mijozda");
    await step(/TOPSHIRISHNI BOSHLASH/, "Topshirilmoqda");
    await page.screenshot({ path: "e2e/.screenshots/delivery-delivering.png" });

    // ── Naqd yig'ish ────────────────────────────────────────────────────
    const payButton = page.getByRole("button", { name: /^To'lov$/ }).first();
    if (await payButton.isVisible().catch(() => false)) {
      await payButton.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      const fill = dialog.getByRole("button", { name: /Qoldiqni to'liq kiritish|\+Qoldiq/ }).first();
      if (await fill.isVisible().catch(() => false)) await fill.click();
      await dialog.getByRole("button", { name: /Qabul qilish/ }).click();
      await expect(dialog).toBeHidden({ timeout: 20_000 });
    }

    // ── Tasdiqlash ──────────────────────────────────────────────────────
    await page.getByRole("button", { name: /YETKAZILDI — TASDIQLASH/ }).first().click();
    const confirmDialog = page.getByRole("dialog");
    if (await confirmDialog.isVisible().catch(() => false)) {
      await confirmDialog.getByRole("button", { name: /YETKAZILDI|Tasdiqlash|Saqlash/ }).first().click();
    }
    await expect(page.getByText("Yetkazildi").first()).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: "e2e/.screenshots/delivery-delivered.png" });

    // ── Asl buyurtma noto'g'ri o'zgarmagan ──────────────────────────────
    await login(page, "owner");
    await page.goto(appPath("dashboard"));
    const order = await readOrder(page, fixture.orderId);
    expect(order.total, "yetkazish buyurtma summasini o'zgartirmasligi kerak").toBe(fixture.total);
    expect(["confirmed", "completed", "delivered"]).toContain(order.status);
  });

  test("yetkazib bo'lmadi: sabab bilan FAILED, asl buyurtma o'zgarmaydi", async ({ page, context }) => {
    await login(page, "owner");
    await page.goto(appPath("dashboard"));
    const fixture = await makeTask(page);

    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: SHOP.latitude, longitude: SHOP.longitude, accuracy: 10 });
    await login(page, "dostavchi");
    await startWork(page);
    await page.goto(appPath(`delivery-agent/tasks/${fixture.taskId}`));

    // "Yetkazib bo'lmadi" yo'lga chiqqandan keyin ochiladi
    const step = async (button: RegExp, nextStatus: string) => {
      await page.getByRole("button", { name: button }).first().click();
      await expect(page.getByText(nextStatus).first()).toBeVisible({ timeout: 30_000 });
    };
    await step(/QABUL QILISH/, "Qabul qilingan");
    await step(/YO'LGA CHIQISH/, "Yo'lda");

    await page.getByRole("button", { name: /Yetkazib bo'lmadi/ }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    // Sabab tanlanmaguncha "Tasdiqlash" o'chiq turadi
    const submit = dialog.getByRole("button", { name: "Tasdiqlash" });
    await expect(submit).toBeDisabled();
    await dialog.getByRole("radio", { name: "Mijoz joyida yo'q" }).click();
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByText("Yetkazilmadi").first()).toBeVisible({ timeout: 30_000 });

    await login(page, "owner");
    await page.goto(appPath("dashboard"));
    const order = await readOrder(page, fixture.orderId);
    expect(order.total).toBe(fixture.total);
  });

  test("qisman yetkazish: 2 dan 1 dona — QISMAN YETKAZILDI, qolgani supervayzer qabulidan keyin omborga qaytadi", async ({ page, context }) => {
    await login(page, "owner");
    await page.goto(appPath("dashboard"));
    const fixture = await makeTask(page);
    const stockBefore = await readStock(page);

    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: SHOP.latitude, longitude: SHOP.longitude, accuracy: 10 });
    await login(page, "dostavchi");
    await startWork(page);
    await page.goto(appPath(`delivery-agent/tasks/${fixture.taskId}`));

    const step = async (button: RegExp, nextStatus: string) => {
      await page.getByRole("button", { name: button }).first().click();
      await expect(page.getByText(nextStatus).first()).toBeVisible({ timeout: 30_000 });
    };
    await step(/QABUL QILISH/, "Qabul qilingan");
    await step(/YO'LGA CHIQISH/, "Yo'lda");
    await step(/MIJOZGA YETDIM/, "Mijozda");
    await step(/TOPSHIRISHNI BOSHLASH/, "Topshirilmoqda");

    await page.getByRole("button", { name: /YETKAZILDI — TASDIQLASH/ }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    // Rejada 2 dona edi — mijoz 1 donani oldi
    const qty = dialog.getByRole("textbox", { name: /Yetkazilgan miqdor/ }).first();
    await qty.fill("1");
    await expect(dialog.getByText("Qisman", { exact: true })).toBeVisible();
    // Kutilgan to'lov ham kamayadi, kam yig'ilgan farq supervayzerga boradi
    await expect(dialog.getByText(/To'lov kam yig'ilgan/)).toBeVisible();
    // Miqdor kam bo'lgani uchun tugma "Qisman yetkazildi" ga o'zgaradi
    await dialog.getByRole("button", { name: "Qisman yetkazildi" }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(page.getByText("Qisman yetkazildi").first()).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: "e2e/.screenshots/delivery-partial.png" });

    // ── Asl buyurtma o'zgarmaydi; tovar hali yetkazuvchida (avtomatik qaytmaydi) ──
    await login(page, "owner");
    await page.goto(appPath("dashboard"));
    const order = await readOrder(page, fixture.orderId);
    expect(order.total, "qisman yetkazish buyurtma summasini o'zgartirmasligi kerak").toBe(fixture.total);
    // Tovar yetkazish jarayonida ombordan chiqadi (rejadagi 2 dona)
    const stockMid = await readStock(page);
    expect(stockMid, `zaxira: oldin=${stockBefore} qisman yetkazishdan keyin=${stockMid}`).toBe(stockBefore - 2);

    // ── Supervayzer qaytgan tovarni omborga qabul qiladi (RETURNED oqimi) ──
    const returned = await page.evaluate(async (taskId) => {
      const res = await fetch(`/api/delivery/tasks/${taskId}/return`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refundMethod: "balance", reason: "E2E: qolgan tovar omborga" }),
      });
      return { status: res.status, body: (await res.text()).slice(0, 200) };
    }, fixture.taskId);
    expect(returned.status, returned.body).toBe(200);
    // Faqat yetkazilgan 1 dona sotilgan bo'lib qoladi — qolgan 1 dona omborga qaytadi
    const stockAfterReturn = await readStock(page);
    expect(stockAfterReturn, `qaytarishdan keyin: ${stockAfterReturn} (kutilgan ${stockBefore - 1})`).toBe(stockBefore - 1);

    // Ikkinchi marta qaytarib bo'lmaydi
    const again = await page.evaluate(async (taskId) => {
      const res = await fetch(`/api/delivery/tasks/${taskId}/return`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refundMethod: "balance" }),
      });
      return res.status;
    }, fixture.taskId);
    expect(again, "takroriy qaytarish rad etilishi kerak").toBeGreaterThanOrEqual(400);
  });
});
