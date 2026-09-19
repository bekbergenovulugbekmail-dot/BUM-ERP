/**
 * Dostavchi mijozdan ilgari sotilgan tovarni QAYTARIB OLADI — haqiqiy brauzerda.
 *
 * Oqim: egasi sotuvni yakunlaydi (tovar mijozda) → dostavchi "Mijozlar" dan mijozni ochib,
 * oldingi xaridlardan qaytariladiganini belgilaydi → so'rov omborda qabul kutadi →
 * egasi Dostavka → Nazorat bo'limida qabul qiladi → zaxira qaytadi.
 */
import { expect, test, type Page } from "@playwright/test";
import { appPath, login } from "./_lib/accounts.ts";

/** Demo do'kon koordinatasi — dostavchi ilovasi GPS talab qiladi. */
const PLACE = { latitude: 41.311081, longitude: 69.240562 };

type Shop = { id: string; name: string };
type Fixture = { orderId: string; orderNumber: string; productId: string; stockBefore: number };

/**
 * Dostavchi ro'yxatidagi BIRINCHI mijoz: demo bazada bir xil nomli mijozlar uchraydi, shuning uchun
 * nom bo'yicha emas, ro'yxatdagi o'rni bo'yicha olinadi (UI ham shu tartibda chizadi).
 */
async function agentShop(page: Page): Promise<Shop> {
  const shop = await page.evaluate(async () => {
    const customers = (await (await fetch("/api/delivery/agent/customers")).json()).customers as { id: string; name: string }[];
    return customers[0] ?? null;
  });
  expect(shop, "dostavchida kamida bitta mijoz bo'lishi kerak").toBeTruthy();
  return shop as Shop;
}

/** Egasi: dostavchiga biriktirilgan yetkazma + yakunlangan sotuv (mijozda tovar bor). */
async function soldOrder(page: Page, shopId: string): Promise<Fixture> {
  const result = await page.evaluate(async (customerId) => {
    const get = async (path: string) => (await fetch(path)).json();
    const send = async (method: string, path: string, body?: unknown) => {
      const res = await fetch(path, {
        method,
        ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      });
      return { status: res.status, text: await res.text() };
    };

    const warehouses = (await get("/api/inventory/warehouses")).warehouses as { id: string }[];
    const products = (await get("/api/catalog/products?limit=50")).products as { id: string; name: string }[];
    const product = products.find((row) => /Nestle suv/.test(row.name)) ?? products[0];
    if (!warehouses[0] || !product) return { error: "ombor/mahsulot topilmadi" };

    const created = await send("POST", "/api/sales/orders", {
      customerId,
      warehouseId: warehouses[0].id,
      orderDate: new Date().toISOString().slice(0, 10),
      deliveryRequired: true,
      items: [{ productId: product.id, quantity: "6" }],
    });
    if (created.status !== 201) return { error: `buyurtma: ${created.status} ${created.text}` };
    const order = JSON.parse(created.text).order as { id: string; number: string };

    const confirmed = await send("POST", `/api/sales/orders/${order.id}/confirm`, {});
    if (confirmed.status !== 200) return { error: `tasdiqlash: ${confirmed.status} ${confirmed.text}` };

    // Yetkazmani demo dostavchiga biriktiramiz — mijoz uning ro'yxatida ko'rinsin
    const tasks = (await get("/api/delivery/tasks?limit=200")).tasks as { id: string; orderId: string }[];
    const task = tasks.find((row) => row.orderId === order.id);
    const agents = (await get("/api/delivery/agents")).agents as { id: string; name: string }[];
    const agent = agents.find((row) => /Demo Dostavchi/i.test(row.name)) ?? agents[0];
    if (!task || !agent) return { error: "yetkazma yoki dostavchi topilmadi" };
    const assigned = await send("POST", `/api/delivery/tasks/${task.id}/assign`, { deliveryAgentId: agent.id });
    if (assigned.status !== 200) return { error: `biriktirish: ${assigned.status} ${assigned.text}` };

    // Sotuvni yakunlaymiz — tovar mijozda, endi uni qaytarib olish mumkin
    const shipped = await send("POST", `/api/sales/orders/${order.id}/ship`, {});
    if (shipped.status !== 200) return { error: `jo'natish: ${shipped.status} ${shipped.text}` };

    const rows = (await get(`/api/inventory/stock/products/${product.id}`)).stock as { quantity: string }[];
    return {
      orderId: order.id,
      orderNumber: order.number,
      productId: product.id,
      stockBefore: rows.reduce((sum, row) => sum + Number(row.quantity), 0),
    };
  }, shopId);
  expect((result as { error?: string }).error ?? "", JSON.stringify(result)).toBe("");
  return result as Fixture;
}

async function readState(page: Page, fixture: Fixture) {
  return page.evaluate(async ({ orderId, productId }) => {
    const order = (await (await fetch(`/api/sales/orders/${orderId}`)).json()).order as {
      items: { returnedQty: string }[];
    };
    const rows = (await (await fetch(`/api/inventory/stock/products/${productId}`)).json()).stock as { quantity: string }[];
    return {
      returnedQty: order.items.reduce((sum, item) => sum + Number(item.returnedQty), 0),
      stock: rows.reduce((sum, row) => sum + Number(row.quantity), 0),
    };
  }, fixture);
}

test("dostavchi qaytarib oladi → ombor qabul qiladi → zaxira qaytadi", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ ...PLACE, accuracy: 10 });
  await login(page, "dostavchi");
  await page.goto(appPath("delivery-agent/customers"));
  const shop = await agentShop(page);

  await login(page, "owner");
  await page.goto(appPath("dashboard"));
  const fixture = await soldOrder(page, shop.id);

  // ── Dostavchi: mijozning oldingi xarididan 2 donasini qaytarib oladi ──────
  await login(page, "dostavchi");
  await page.goto(appPath("delivery-agent/customers"));
  const first = page.locator("li button").first();
  await expect(first).toContainText(shop.name, { timeout: 30_000 });
  await first.click();

  const open = page.getByTestId("return-pickup-open");
  await expect(open, "mijoz kartochkasida «Tovarni qaytarib olish»").toBeVisible({ timeout: 30_000 });
  await open.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(fixture.orderNumber).first(), "qaysi xariddan olgani").toBeVisible({ timeout: 30_000 });
  // Qatorni belgilaymiz — narxi va qaytarish mumkin bo'lgan miqdori ko'rinib turadi
  await expect(dialog.getByText(/qaytarish mumkin/).first()).toBeVisible();
  await dialog.getByText(/Nestle suv/).first().click();

  const qty = dialog.getByLabel("Miqdor");
  await expect(qty).toBeVisible();
  await qty.fill("2");
  await dialog.getByRole("textbox", { name: "Sabab" }).fill("Muddati tugagan");
  await dialog.getByRole("button", { name: "Qaytarib oldim" }).click();

  await expect(page.getByText(/So'rov yuborildi/)).toBeVisible({ timeout: 30_000 });

  // Hali hech narsa o'zgarmaydi — tovar dostavchining mashinasida
  await login(page, "owner");
  await page.goto(appPath("dashboard"));
  const pending = await readState(page, fixture);
  expect(pending.returnedQty, "qabulgacha qaytarilgan miqdor 0").toBe(0);
  expect(pending.stock, "qabulgacha zaxira o'zgarmaydi").toBe(fixture.stockBefore);

  // ── Egasi: Dostavka → Nazorat → qabul qilish ─────────────────────────────
  await page.goto(appPath("delivery"));
  await page.getByRole("tab", { name: "Nazorat" }).click();
  const panel = page.getByTestId("return-pickups");
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await panel.getByText(fixture.orderNumber).first().click();

  const decision = page.getByRole("dialog");
  await expect(decision.getByText(/Nestle suv/).first()).toBeVisible();
  await decision.getByTestId("pickup-accept").click();
  await expect(page.getByText(/Qabul qilindi/)).toBeVisible({ timeout: 30_000 });

  // Zaxira qaytdi va chekda qaytarilgan miqdor yozildi
  await expect
    .poll(async () => (await readState(page, fixture)).stock, { timeout: 30_000 })
    .toBe(fixture.stockBefore + 2);
  expect((await readState(page, fixture)).returnedQty).toBe(2);
});
