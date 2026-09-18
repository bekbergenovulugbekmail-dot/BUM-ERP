/**
 * "Soliqni avtomatik hisoblash" o'chirilganda QQS HAMMA YERDA 0 bo'ladi:
 * sotuv hujjati, kassa cheki, xarid hujjati va kassa qurilmasiga ketadigan ma'lumot.
 *
 * Eski hujjatlar o'zgarmaydi — ular o'sha paytdagi stavka bilan qoladi.
 */
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;
type Method = "GET" | "POST" | "PUT" | "PATCH";

let app: FastifyInstance;
let company: Company;
let productId: string;
let warehouseId: string;
let pieceUnitId: string;

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

const call = (method: Method, url: string, payload?: object, cookie = company.ownerCookie) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

const setTax = (enabled: boolean) =>
  call("PUT", "/api/company/settings/tax.auto", { value: enabled ? "true" : "false", group: "finance" });

beforeEach(async () => {
  await resetDatabase();
  await db.delete(units);
  await seedDefaultUnits(db);
  const piece = (await db.select().from(units)).find((unit) => unit.shortName === "d")!.id;
  pieceUnitId = piece;
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Soliq sinovi" });
  warehouseId = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;

  const product = await call("POST", "/api/catalog/products", {
    name: "Soliqli mahsulot",
    sku: "TAX-1",
    baseUnitId: piece,
    salesPrice: "100000",
    purchasePrice: "80000",
    taxRate: "12",
    taxIncluded: false,
  });
  expect(product.statusCode, product.body).toBe(201);
  productId = product.json().product.id as string;

  await call("POST", "/api/inventory/stock/movements", {
    type: "receive",
    productId,
    warehouseId,
    quantity: "100",
    costPrice: "80000",
  });
});

async function salesOrder() {
  const res = await call("POST", "/api/sales/orders", {
    warehouseId,
    orderDate: new Date().toISOString().slice(0, 10),
    items: [{ productId, quantity: "1" }],
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().order as { taxAmount: string; totalAmount: string; items: { taxRate: string }[] };
}

async function purchaseOrder() {
  const supplier = await call("POST", "/api/purchase/suppliers", { name: `Ta'minotchi ${Date.now()}` });
  const res = await call("POST", "/api/purchase/orders", {
    supplierId: supplier.json().supplier.id,
    warehouseId,
    orderDate: new Date().toISOString().slice(0, 10),
    items: [{ productId, unitId: pieceUnitId, orderedQty: "1", unitPrice: "80000", taxRate: "12" }],
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().order as { taxAmount: string; totalAmount: string };
}

describe("Soliq yoqilgan (standart)", () => {
  it("sotuvda ham, xaridda ham QQS hisoblanadi", async () => {
    const sale = await salesOrder();
    expect(Number(sale.taxAmount)).toBeGreaterThan(0);
    expect(sale.items[0]!.taxRate).toBe("12.00");

    const purchase = await purchaseOrder();
    expect(Number(purchase.taxAmount)).toBeGreaterThan(0);
  });
});

describe("Soliq o'chirilgan", () => {
  beforeEach(async () => {
    expect((await setTax(false)).statusCode).toBeLessThan(300);
  });

  it("sotuv hujjatida QQS 0", async () => {
    const sale = await salesOrder();
    expect(Number(sale.taxAmount)).toBe(0);
    expect(Number(sale.items[0]!.taxRate)).toBe(0);
    expect(Number(sale.totalAmount)).toBe(100000);
  });

  it("xarid hujjatida QQS 0 — qator stavkasi yuborilsa ham", async () => {
    const purchase = await purchaseOrder();
    expect(Number(purchase.taxAmount)).toBe(0);
    expect(Number(purchase.totalAmount)).toBe(80000);
  });

  it("kassa qurilmasiga 0 stavkali mahsulot boradi", async () => {
    const device = await app.inject({
      method: "POST",
      url: "/api/pos-device/setup/register",
      payload: { phone: company.owner.phone, password: company.owner.password, warehouseId, name: "Kassa 1" },
    });
    expect(device.statusCode, device.body).toBe(201);
    const token = device.json().token as string;

    const pull = await app.inject({
      method: "POST",
      url: "/api/pos-device/pull",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(pull.statusCode, pull.body).toBe(200);
    const rows = pull.json().entities.products.rows as { id: string; taxRate: string }[];
    const row = rows.find((item) => item.id === productId);
    expect(row).toBeDefined();
    expect(Number(row!.taxRate)).toBe(0);
  });

  it("qayta yoqilsa yangi hujjatlarda QQS qaytadi", async () => {
    expect(Number((await salesOrder()).taxAmount)).toBe(0);
    expect((await setTax(true)).statusCode).toBeLessThan(300);
    expect(Number((await salesOrder()).taxAmount)).toBeGreaterThan(0);
  });
});
