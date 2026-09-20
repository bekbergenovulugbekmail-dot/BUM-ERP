/**
 * BAND QILISH INVARIANTI: `reserved_qty <= quantity` — HAR DOIM.
 *
 * Auditdagi AUDIT-1 topilmasi shu yerda yopiladi: qoldiq 0 bo'lib, band 90 bo'lib qoladigan holat
 * endi yuzaga kelmaydi. Invariant ikki qavat bilan himoyalangan: qoldiq qatori `for update` bilan
 * qulflanadi va band qilish `reserved + take <= quantity` sharti bilan yoziladi.
 *
 * Ikki siyosat tekshiriladi:
 *   - agent (`strict`): qoldiq yetmasa buyurtma TASDIQLANMAYDI;
 *   - qo'lda (`best_effort`): buyurtma tasdiqlanadi, bor miqdor band qilinadi, yetmagani
 *     oldindan buyurtma bo'lib qoladi va band deb hisoblanmaydi.
 */
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { stockLevels, warehouses } from "../src/db/schema/inventory.js";
import { salesOrderItems } from "../src/db/schema/sales.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { createCompany, resetDatabase, signedIn } from "./helpers.js";

let app: FastifyInstance;
let company: Awaited<ReturnType<typeof createCompany>>;
let other: Awaited<ReturnType<typeof createCompany>>;
let piece: string;
let mainWh: string;
let secondWh: string;
let productId: string;
let customerId: string;

const today = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await closeDb();
});

const call = (method: "GET" | "POST" | "PATCH", url: string, payload?: object, cookie = company.ownerCookie) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

beforeEach(async () => {
  await resetDatabase();
  await db.delete(units);
  await seedDefaultUnits(db);
  piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Band qilish" });
  other = await createCompany(app, admin.cookie, { name: "Begona" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;

  const second = await call("POST", "/api/inventory/warehouses", { name: "Ikkinchi ombor", code: "W2" });
  expect(second.statusCode, second.body).toBe(201);
  secondWh = second.json().warehouse.id as string;

  const product = await call("POST", "/api/catalog/products", { name: "Cola 1L", sku: "COLA", baseUnitId: piece, salesPrice: "5000" });
  expect(product.statusCode, product.body).toBe(201);
  productId = product.json().product.id as string;

  const customer = await call("POST", "/api/sales/customers", { name: "Do'kon", creditLimit: "100000000" });
  expect(customer.statusCode, customer.body).toBe(201);
  customerId = customer.json().customer.id as string;
});

/** Omborga tovar kiritadi. */
async function receive(quantity: string, warehouseId = mainWh) {
  const res = await call("POST", "/api/inventory/stock/movements", {
    type: "receive",
    productId,
    warehouseId,
    quantity,
    costPrice: "3000",
  });
  expect(res.statusCode, res.body).toBe(201);
}

const levelOf = async (warehouseId = mainWh) =>
  (
    await db
      .select({ quantity: stockLevels.quantity, reservedQty: stockLevels.reservedQty })
      .from(stockLevels)
      .where(and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, warehouseId)))
  )[0] ?? { quantity: "0.0000", reservedQty: "0.0000" };

/** Qoralama buyurtma (qo'lda kiritilgan — `best_effort`). */
async function draft(quantity: string, warehouseId = mainWh) {
  const res = await call("POST", "/api/sales/orders", {
    customerId,
    warehouseId,
    orderDate: today,
    items: [{ productId, quantity }],
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().order.id as string;
}

const confirm = (orderId: string) => call("POST", `/api/sales/orders/${orderId}/confirm`);

/** INVARIANT: hech bir qatorda band qoldiqdan oshmaydi va manfiy qoldiq yo'q. */
async function assertInvariant() {
  const rows = await db.select().from(stockLevels).where(eq(stockLevels.companyId, company.companyId));
  for (const row of rows) {
    expect(Number(row.quantity), `manfiy qoldiq: ${row.productId}`).toBeGreaterThanOrEqual(0);
    expect(Number(row.reservedQty), `band > qoldiq: ${row.productId}`).toBeLessThanOrEqual(Number(row.quantity));
  }
}

describe("1–4. Band qilish qoldiqdan oshmaydi", () => {
  it("1) qoldiq 100, 50 band qilinadi — o'tadi", async () => {
    await receive("100");
    expect((await confirm(await draft("50"))).statusCode).toBe(200);
    expect((await levelOf()).reservedQty).toBe("50.0000");
    await assertInvariant();
  });

  it("2) qoldiq 100, 100 band qilinadi — o'tadi, mavjud 0", async () => {
    await receive("100");
    expect((await confirm(await draft("100"))).statusCode).toBe(200);
    expect(await levelOf()).toMatchObject({ quantity: "100.0000", reservedQty: "100.0000" });

    const stock = await call("GET", `/api/inventory/stock?warehouseId=${mainWh}`);
    const row = (stock.json().stock as { productId: string; availableQty: string }[]).find((item) => item.productId === productId);
    expect(Number(row!.availableQty), "mavjud aynan 0").toBe(0);
    await assertInvariant();
  });

  it("3) qoldiq 100, 101 so'raladi — band 100 da to'xtaydi, 1 dona oldindan buyurtma", async () => {
    await receive("100");
    const id = await draft("101");
    expect((await confirm(id)).statusCode, "qo'lda buyurtma tasdiqlanadi (tovar keyin keladi)").toBe(200);

    expect((await levelOf()).reservedQty, "band qoldiqdan oshmaydi").toBe("100.0000");
    const [item] = await db.select({ reservedQty: salesOrderItems.reservedQty }).from(salesOrderItems).where(eq(salesOrderItems.orderId, id));
    expect(item!.reservedQty, "qatorda aynan band qilingani yozilgan").toBe("100.0000");

    const stock = await call("GET", `/api/inventory/stock?warehouseId=${mainWh}`);
    const row = (stock.json().stock as { productId: string; availableQty: string }[]).find((item2) => item2.productId === productId);
    expect(Number(row!.availableQty), "mavjud MANFIY emas").toBe(0);
    await assertInvariant();
  });

  it("4) qoldiq 0, 1 dona — hech narsa band qilinmaydi", async () => {
    const id = await draft("1");
    expect((await confirm(id)).statusCode).toBe(200);
    expect((await levelOf()).reservedQty).toBe("0.0000");
    await assertInvariant();
  });

  it("3a/4a) AGENT buyurtmasi: qoldiq yetmasa TASDIQLANMAYDI", async () => {
    await receive("100");
    const id = await draft("101");
    // Agent kanalini taqlid qilamiz — qat'iy siyosat aynan shu manbaga bog'langan
    await db.execute(sql`update "sales_orders" set "source" = 'sales_agent' where "id" = ${id}::uuid`);
    const res = await confirm(id);
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().details?.reason).toBe("out_of_stock");
    expect((await levelOf()).reservedQty, "hech narsa band qilinmadi").toBe("0.0000");
    await assertInvariant();
  });
});

describe("5–6. Parallel va takroriy so'rovlar", () => {
  it("5) qoldiq 100, parallel 60 + 60 — jami band 100 dan oshmaydi", async () => {
    await receive("100");
    const [a, b] = [await draft("60"), await draft("60")];
    const results = await Promise.all([confirm(a), confirm(b)]);
    expect(results.every((res) => res.statusCode === 200), results.map((r) => r.body).join(" | ")).toBe(true);

    const level = await levelOf();
    expect(Number(level.reservedQty), "jami band 100 dan oshmaydi").toBeLessThanOrEqual(100);
    await assertInvariant();
  });

  it("5a) AGENT: parallel 60 + 60 — biri o'tadi, biri rad etiladi", async () => {
    await receive("100");
    const ids = [await draft("60"), await draft("60")];
    for (const id of ids) await db.execute(sql`update "sales_orders" set "source" = 'sales_agent' where "id" = ${id}::uuid`);

    const results = await Promise.all(ids.map(confirm));
    const codes = results.map((res) => res.statusCode).sort();
    expect(codes, "biri o'tadi, biri rad etiladi").toEqual([200, 400]);
    expect((await levelOf()).reservedQty).toBe("60.0000");
    await assertInvariant();
  });

  it("6) takroriy tasdiqlash ikki marta band qilmaydi", async () => {
    await receive("100");
    const id = await draft("20");
    expect((await confirm(id)).statusCode).toBe(200);
    expect((await confirm(id)).statusCode, "ikkinchi marta tasdiqlanmaydi").toBe(400);
    expect((await levelOf()).reservedQty).toBe("20.0000");
    await assertInvariant();
  });
});

describe("7–9. Bekor qilish, jo'natish va qaytarish", () => {
  it("7) bekor qilinganda band bo'shaydi va tovar yana sotiladi", async () => {
    await receive("100");
    const id = await draft("100");
    await confirm(id);
    expect((await call("POST", `/api/sales/orders/${id}/cancel`, { reason: "Mijoz voz kechdi" })).statusCode).toBe(200);
    expect((await levelOf()).reservedQty).toBe("0.0000");

    expect((await confirm(await draft("100"))).statusCode, "hammasi yana band qilinadi").toBe(200);
    await assertInvariant();
  });

  it("8) jo'natishda band chiqimga aylanadi — ikki marta hisoblanmaydi", async () => {
    await receive("100");
    const id = await draft("40");
    await confirm(id);
    expect((await call("POST", `/api/sales/orders/${id}/ship`)).statusCode).toBe(200);

    expect(await levelOf()).toMatchObject({ quantity: "60.0000", reservedQty: "0.0000" });
    const [item] = await db.select({ reservedQty: salesOrderItems.reservedQty }).from(salesOrderItems).where(eq(salesOrderItems.orderId, id));
    expect(item!.reservedQty, "qatordagi band tozalandi").toBe("0.0000");
    await assertInvariant();
  });

  it("8a) BAND qilingan tovarni boshqa buyurtma jo'nata olmaydi (parallel jo'natish)", async () => {
    await receive("90");
    const held = await draft("90");
    expect((await confirm(held)).statusCode).toBe(200); // 90 dona band

    const rival = await draft("90");
    expect((await confirm(rival)).statusCode, "oldindan buyurtma sifatida tasdiqlanadi").toBe(200);
    expect((await levelOf()).reservedQty, "band faqat birinchisida").toBe("90.0000");

    const results = await Promise.all([held, rival].map((id) => call("POST", `/api/sales/orders/${id}/ship`)));
    const codes = results.map((res) => res.statusCode).sort();
    expect(codes, results.map((res) => `${res.statusCode}: ${res.body}`).join(" | ")).toEqual([200, 400]);

    expect(await levelOf()).toMatchObject({ quantity: "0.0000", reservedQty: "0.0000" });
    await assertInvariant();
  });

  it("9) qaytarishda tovar omborga qaytadi, band o'zgarmaydi", async () => {
    await receive("100");
    const id = await draft("40");
    await confirm(id);
    await call("POST", `/api/sales/orders/${id}/ship`);
    expect((await call("POST", `/api/sales/orders/${id}/return`, { reason: "Mijoz qaytardi" })).statusCode).toBe(200);

    expect(await levelOf()).toMatchObject({ quantity: "100.0000", reservedQty: "0.0000" });
    await assertInvariant();
  });

  it("qisman band qilingan buyurtma bekor qilinsa, BOSHQA buyurtmaning bandi kamaymaydi", async () => {
    await receive("100");
    const held = await draft("70");
    expect((await confirm(held)).statusCode).toBe(200);

    const preOrder = await draft("50"); // faqat 30 dona band qilinadi
    expect((await confirm(preOrder)).statusCode).toBe(200);
    expect((await levelOf()).reservedQty).toBe("100.0000");

    expect((await call("POST", `/api/sales/orders/${preOrder}/cancel`, { reason: "bekor" })).statusCode).toBe(200);
    expect((await levelOf()).reservedQty, "faqat o'z bandi (30) bo'shaydi").toBe("70.0000");
    await assertInvariant();
  });
});

describe("10–11. Ombor va kompaniya chegarasi", () => {
  it("10) ikkinchi ombordagi qoldiq birinchi ombor bandiga ta'sir qilmaydi", async () => {
    await receive("100", mainWh);
    await receive("100", secondWh);
    expect((await confirm(await draft("100", mainWh))).statusCode).toBe(200);

    expect((await levelOf(mainWh)).reservedQty).toBe("100.0000");
    expect((await levelOf(secondWh)).reservedQty, "ikkinchi ombor tegilmaydi").toBe("0.0000");
    await assertInvariant();
  });

  it("11) begona kompaniya buyurtmani tasdiqlay olmaydi", async () => {
    await receive("100");
    const id = await draft("10");
    const foreign = await call("POST", `/api/sales/orders/${id}/confirm`, undefined, other.ownerCookie);
    expect(foreign.statusCode).toBe(404);
    expect((await levelOf()).reservedQty).toBe("0.0000");
    await assertInvariant();
  });
});
