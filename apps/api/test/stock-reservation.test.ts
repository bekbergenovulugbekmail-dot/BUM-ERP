/**
 * Zaxirani band qilish: tasdiqlangan buyurtma omborda tovarni BAND qiladi.
 *
 * Misol: omborda 50 dona kola. Birinchi buyurtma 40 donani band qilsa, "mavjud" 10 dona bo'lib qoladi —
 * agentlar shu 10 donadan ortig'ini yoza olmaydi (`sales-agent-orders` testi). Qo'lda kiritilgan
 * buyurtmani tovar kelishidan oldin ham tasdiqlash mumkin: u holda "mavjud" manfiy bo'lib, omborda
 * yetishmovchilik ko'rinib turadi. Jo'natilganda yoki bekor qilinganda band bo'shaydi.
 */
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { stockLevels, warehouses } from "../src/db/schema/inventory.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { createCompany, resetDatabase, signedIn } from "./helpers.js";

let app: FastifyInstance;
let company: Awaited<ReturnType<typeof createCompany>>;
let piece: string;
let warehouseId: string;
let colaId: string;
let customerId: string;

const today = new Date().toISOString().slice(0, 10);

const call = (method: "GET" | "POST" | "PATCH", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie: company.ownerCookie }, ...(payload ? { payload } : {}) });

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

beforeEach(async () => {
  await resetDatabase();
  await db.delete(units);
  await seedDefaultUnits(db);
  piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Bron qilish" });
  warehouseId = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;

  const created = await call("POST", "/api/catalog/products", { name: "Cola 1L", sku: "COLA", baseUnitId: piece, salesPrice: "12000" });
  expect(created.statusCode, created.body).toBe(201);
  colaId = created.json().product.id as string;

  const received = await call("POST", "/api/inventory/stock/movements", {
    type: "receive",
    productId: colaId,
    warehouseId,
    quantity: "50",
    costPrice: "9000",
  });
  expect(received.statusCode, received.body).toBe(201);

  const shop = await call("POST", "/api/sales/customers", { name: "Do'kon", creditLimit: "100000000" });
  customerId = shop.json().customer.id as string;
});

const level = async () =>
  (
    await db
      .select({ quantity: stockLevels.quantity, reservedQty: stockLevels.reservedQty })
      .from(stockLevels)
      .where(and(eq(stockLevels.productId, colaId), eq(stockLevels.warehouseId, warehouseId)))
  )[0]!;

/** Buyurtma yaratadi (qoralama). */
async function order(quantity: string) {
  const res = await call("POST", "/api/sales/orders", {
    customerId,
    warehouseId,
    orderDate: today,
    items: [{ productId: colaId, quantity }],
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().order.id as string;
}

const confirm = (orderId: string) => call("POST", `/api/sales/orders/${orderId}/confirm`);

describe("Tasdiqlangan buyurtma zaxirani band qiladi", () => {
  it("40 dona band qilinsa, mavjud 10 dona qoladi", async () => {
    const first = await order("40");
    expect((await confirm(first)).statusCode).toBe(200);

    const after = await level();
    expect(after.quantity, "tovar hali omborda").toBe("50.0000");
    expect(after.reservedQty, "40 dona band").toBe("40.0000");

    // Qolgan 10 dona ham band qilinadi — mavjud 0 bo'ladi
    const second = await order("10");
    expect((await confirm(second)).statusCode).toBe(200);
    expect((await level()).reservedQty).toBe("50.0000");
  });

  it("tovar kelishidan oldin tasdiqlangan buyurtma yetishmovchilikni ko'rsatadi", async () => {
    const big = await order("80");
    expect((await confirm(big)).statusCode, "qoldiq yetmasa ham tasdiqlanadi (tovar keyin keladi)").toBe(200);

    const stock = await call("GET", `/api/inventory/stock?warehouseId=${warehouseId}`);
    const row = (stock.json().stock as { productId: string; availableQty: string }[]).find((item) => item.productId === colaId);
    expect(Number(row!.availableQty), "50 − 80 = −30: omborda 30 dona yetmaydi").toBe(-30);
  });

  it("jo'natilganda band bo'shaydi va tovar chiqadi", async () => {
    const id = await order("40");
    await confirm(id);
    const shipped = await call("POST", `/api/sales/orders/${id}/ship`);
    expect(shipped.statusCode, shipped.body).toBe(200);

    const after = await level();
    expect(after.quantity, "40 dona chiqdi").toBe("10.0000");
    expect(after.reservedQty, "band bo'shadi").toBe("0.0000");

    // Qolgan 10 dona endi sotiladi
    const next = await order("10");
    expect((await confirm(next)).statusCode).toBe(200);
  });

  it("bekor qilinganda band bo'shaydi", async () => {
    const id = await order("50");
    await confirm(id);
    expect((await level()).reservedQty).toBe("50.0000");

    const cancelled = await call("POST", `/api/sales/orders/${id}/cancel`, { reason: "Mijoz voz kechdi" });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect((await level()).reservedQty, "band bo'shadi").toBe("0.0000");

    const again = await order("50");
    expect((await confirm(again)).statusCode, "hammasi yana sotiladi").toBe(200);
  });

  it("takroriy tasdiqlash ikki marta band qilmaydi", async () => {
    const id = await order("20");
    expect((await confirm(id)).statusCode).toBe(200);
    expect((await confirm(id)).statusCode, "ikkinchi marta tasdiqlanmaydi").toBe(400);
    expect((await level()).reservedQty).toBe("20.0000");
  });

  it("qoldiqda mavjud miqdor ko'rinadi", async () => {
    const id = await order("30");
    await confirm(id);
    const stock = await call("GET", `/api/inventory/stock?warehouseId=${warehouseId}`);
    expect(stock.statusCode, stock.body).toBe(200);
    const row = (stock.json().stock as { productId: string; quantity: string; reservedQty: string; availableQty: string }[]).find(
      (item) => item.productId === colaId,
    );
    expect(row).toMatchObject({ quantity: "50.0000", reservedQty: "30.0000" });
    expect(Number(row!.availableQty)).toBe(20);
  });
});
