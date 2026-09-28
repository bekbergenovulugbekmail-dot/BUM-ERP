/**
 * AUD-022 (egasi qarori, 2026-09-28: VARIANT 1). Ta'minotchiga qaytarish qaytarilayotgan partiyaning XARID narxida
 * ombordan chiqadi, qolgan zaxira uchun AVCO qayta hisoblanadi; 1200 = ombor bahosi (Σ qty × AVCO) har qadamda.
 *
 *   100 × 10 000 + 100 × 12 000 → 200 dona, 2 200 000, AVCO 11 000
 *   12 000 lik partiyadan 50 dona qaytarish → 150 dona, 1 600 000, AVCO 10 666,6667; 1200 = 1 600 000
 *   150 dona sotildi → zaxira 0, 1200 = 0, 5000 COGS = 1 600 000, foyda = 2 250 000 − 1 600 000 = 650 000
 *
 * AVCO 4 kasrli (mavjud arxitektura): 150 × 10 666,6667 = 1 600 000,005 → sotuv COGS 1 600 000,01. Qaytarishdagi tiyin
 * yaxlitlash qoldig'i 5000 ga (tannarx tuzatmasi) yoziladi — natijada 5000 aynan 1 600 000, 1200 aynan 0.
 */
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { accounts, journalEntries, journalLines } from "../src/db/schema/finance.js";
import { stockLevels, warehouses } from "../src/db/schema/inventory.js";
import { suppliers } from "../src/db/schema/purchase.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { todayIso } from "../src/modules/finance/cash.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

let app: FastifyInstance;
let company: Awaited<ReturnType<typeof createCompany>>;
let other: Awaited<ReturnType<typeof createCompany>>;
let piece: string;
let mainWh: string;
let productId: string;
let supplierId: string;

const call = (method: "GET" | "POST", url: string, payload?: object, cookie = company.ownerCookie) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

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
  company = await createCompany(app, admin.cookie, { name: "Lot narxi" });
  other = await createCompany(app, admin.cookie, { name: "Begona" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  productId = (await call("POST", "/api/catalog/products", { name: "Shakar", sku: "SH", baseUnitId: piece, salesPrice: "15000", taxRate: "0" })).json().product.id;
  supplierId = (await call("POST", "/api/purchase/suppliers", { name: "Ta'minotchi", code: "T" })).json().supplier.id;
});

type Order = { id: string; items: { id: string }[] };
async function buy(price: string, quantity = "100", warehouseId = mainWh): Promise<Order> {
  const created = await call("POST", "/api/purchase/orders", { supplierId, warehouseId, orderDate: todayIso(), items: [{ productId, unitId: piece, orderedQty: quantity, unitPrice: price, taxRate: "0" }] });
  expect(created.statusCode, created.body).toBe(201);
  const order = created.json().order as Order;
  expect((await call("POST", `/api/purchase/orders/${order.id}/confirm`)).statusCode).toBe(200);
  const received = await call("POST", `/api/purchase/orders/${order.id}/receipts`, { items: [{ orderItemId: order.items[0]!.id, receivedQty: quantity }] });
  expect(received.statusCode, received.body).toBe(201);
  return order;
}
const giveBack = (order: Order, quantity: string, extra: object = {}) =>
  call("POST", `/api/purchase/orders/${order.id}/returns`, { items: [{ orderItemId: order.items[0]!.id, quantity }], reason: "Sifatsiz", ...extra });

async function sell(quantity: string, warehouseId = mainWh) {
  const customerId = (await call("POST", "/api/sales/customers", { name: `M ${quantity}` })).json().customer.id;
  const orderId = (await call("POST", "/api/sales/orders", { customerId, warehouseId, orderDate: todayIso(), items: [{ productId, quantity }] })).json().order.id;
  expect((await call("POST", `/api/sales/orders/${orderId}/confirm`)).statusCode).toBe(200);
  const shipped = await call("POST", `/api/sales/orders/${orderId}/ship`);
  expect(shipped.statusCode, shipped.body).toBe(200);
}

const ledger = async (code: string) =>
  (await db.select().from(accounts).where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, code))))[0]!.balance;
const level = async (warehouseId = mainWh) =>
  (await db.select().from(stockLevels).where(and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, warehouseId))))[0]!;
const supplierDebt = async () => (await db.select().from(suppliers).where(eq(suppliers.id, supplierId)))[0]!.totalDebt;

/** 1200 = Σ round(qty × AVCO, 2) (butun kompaniya); Debit = Credit; 1200 manfiy emas. */
async function expectInventoryReconciled() {
  const [row] = await db
    .select({ value: sql<string>`coalesce(sum(round(${stockLevels.quantity} * ${stockLevels.avgCostPrice}, 2)), 0)::numeric(18,2)` })
    .from(stockLevels)
    .where(eq(stockLevels.companyId, company.companyId));
  expect(await ledger("1200"), "1200 = ombor bahosi").toBe(row!.value);
  expect(Number(await ledger("1200")), "1200 manfiy emas").toBeGreaterThanOrEqual(0);
  const [trial] = await db
    .select({
      debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)::numeric(18,2)`,
      credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)::numeric(18,2)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(eq(journalLines.companyId, company.companyId), eq(journalEntries.status, "posted")));
  expect(trial!.debit, "Debit = Credit").toBe(trial!.credit);
}

describe("AUD-022 — xarid qaytarish partiya narxida, AVCO qayta hisoblanadi", () => {
  it("egasi misoli: 12 000 lik partiyadan 50 dona → 1200 = 1 600 000, AVCO 10 666,6667; hammasi sotilsa 5000 = 1 600 000, 1200 = 0", async () => {
    await buy("10000");
    const second = await buy("12000");
    expect(await level()).toMatchObject({ quantity: "200.0000", avgCostPrice: "11000.0000" });
    expect(await ledger("1200")).toBe("2200000.00");

    const back = await giveBack(second, "50");
    expect(back.statusCode, back.body).toBe(201);
    expect(back.json().return.totalAmount, "ta'minotchi hujjati — xarid narxida").toBe("600000.00");
    expect(await level()).toMatchObject({ quantity: "150.0000", avgCostPrice: "10666.6667" });
    expect(await supplierDebt(), "qarz = xarid − qaytarish").toBe("1600000.00");
    await expectInventoryReconciled();

    await sell("150");
    expect((await level()).quantity).toBe("0.0000");
    expect(await ledger("1200"), "zaxira 0 → 1200 = 0").toBe("0.00");
    expect(await ledger("5000"), "COGS = 1 600 000").toBe("1600000.00");
    expect(await ledger("4000")).toBe("2250000.00");
    expect(Number(await ledger("4000")) - Number(await ledger("5000")), "foyda 650 000").toBe(650_000);
    await expectInventoryReconciled();
  });

  it("arzon (10 000) partiyadan qaytarish: AVCO 11 333,3333; sotuvdan keyin COGS 1 700 000", async () => {
    const first = await buy("10000");
    await buy("12000");
    expect((await giveBack(first, "50")).statusCode).toBe(201);
    expect(await level()).toMatchObject({ quantity: "150.0000", avgCostPrice: "11333.3333" });
    await expectInventoryReconciled();
    await sell("150");
    expect(await ledger("1200")).toBe("0.00");
    expect(await ledger("5000")).toBe("1700000.00");
    await expectInventoryReconciled();
  });

  it("bir qismi sotilgandan keyin qaytarish; ikki bosqichli qisman qaytarish; partiya to'liq qaytarilib zaxira 0", async () => {
    const first = await buy("10000");
    const second = await buy("12000");
    await sell("100"); // 100 × 11 000 = 1 100 000 COGS; qoldi 100 dona, 1 100 000
    expect((await giveBack(second, "30")).statusCode).toBe(201); // 360 000 → qoldi 70 dona, 740 000
    expect(await level()).toMatchObject({ quantity: "70.0000", avgCostPrice: "10571.4286" });
    await expectInventoryReconciled();
    expect((await giveBack(second, "20")).statusCode).toBe(201); // 240 000 → qoldi 50 dona, 500 000
    expect(await level()).toMatchObject({ quantity: "50.0000", avgCostPrice: "10000.0000" });
    await expectInventoryReconciled();
    expect((await giveBack(first, "50")).statusCode).toBe(201); // oxirgi 50 dona 10 000 dan → zaxira 0
    expect((await level()).quantity).toBe("0.0000");
    expect(await ledger("1200")).toBe("0.00");
    // Xarid 2 200 000 − qaytarish 1 100 000 = 1 100 000 = sotilgan 100 donaning tannarxi
    expect(await ledger("5000")).toBe("1100000.00");
    expect(await supplierDebt()).toBe("1100000.00");
    await expectInventoryReconciled();
  });

  it("qolgan baho partiya narxidan kam bo'lsa (qimmat partiya oxirida qaytsa): qoldiq 0, farq tannarxga — 1200 manfiy emas", async () => {
    await buy("10000");
    const second = await buy("12000");
    await sell("150"); // 150 × 11 000 = 1 650 000; qoldi 50 dona, 550 000
    expect((await giveBack(second, "50")).statusCode).toBe(201); // hujjat 600 000, ombor bahosi 550 000
    expect((await level()).quantity).toBe("0.0000");
    expect(await ledger("1200")).toBe("0.00");
    // Iqtisodiy tannarx: 2 200 000 − 600 000 = 1 600 000
    expect(await ledger("5000")).toBe("1600000.00");
    expect(await supplierDebt()).toBe("1600000.00");
    await expectInventoryReconciled();
  });

  it("boshqa ombor: qaytarish faqat xarid omboridagi AVCO ni o'zgartiradi", async () => {
    const branch = (await call("POST", "/api/inventory/warehouses", { name: "Filial", code: "F1" })).json().warehouse.id as string;
    await buy("10000");
    const second = await buy("12000");
    const moved = await call("POST", "/api/inventory/stock/transfers", { productId, fromWarehouseId: mainWh, toWarehouseId: branch, quantity: "40" });
    expect(moved.statusCode, moved.body).toBe(201);
    expect(await level(branch)).toMatchObject({ quantity: "40.0000", avgCostPrice: "11000.0000" });
    expect((await giveBack(second, "50")).statusCode).toBe(201); // asosiy: 160 dona, 1 760 000 − 600 000 = 1 160 000
    expect(await level()).toMatchObject({ quantity: "110.0000", avgCostPrice: "10545.4545" });
    expect(await level(branch), "filial o'zgarmaydi").toMatchObject({ quantity: "40.0000", avgCostPrice: "11000.0000" });
    await expectInventoryReconciled();
  });

  it("parallel: bir partiyadan ikki qaytarish qolgan miqdordan oshmaydi; parallel kirim + qaytarish izchil", async () => {
    await buy("10000");
    const second = await buy("12000");
    const results = await Promise.all([giveBack(second, "60"), giveBack(second, "60")]);
    expect(results.map((res) => res.statusCode).sort()).toEqual([201, 400]);
    await expectInventoryReconciled();

    const third = await (async () => {
      const created = await call("POST", "/api/purchase/orders", { supplierId, warehouseId: mainWh, orderDate: todayIso(), items: [{ productId, unitId: piece, orderedQty: "100", unitPrice: "10997", taxRate: "0" }] });
      const order = created.json().order as Order;
      await call("POST", `/api/purchase/orders/${order.id}/confirm`);
      return order;
    })();
    // Narx 10 997: ikkala tartibda ham (avval kirim yoki avval qaytarish) AVCO aniq 4 kasrli — kirimdagi mavjud AVCO
    // yaxlitlashi (qaytarishga aloqasiz, alohida topilma) bu tekshiruvni buzmasin
    const [receipt, back] = await Promise.all([
      call("POST", `/api/purchase/orders/${third.id}/receipts`, { items: [{ orderItemId: third.items[0]!.id, receivedQty: "100" }] }),
      giveBack(second, "40"),
    ]);
    expect([receipt.statusCode, back.statusCode]).toEqual([201, 201]);
    expect((await level()).quantity).toBe("200.0000"); // 200 − 60 + 100 − 40
    await expectInventoryReconciled();
  });

  it("tenant va RBAC: begona kompaniya va kassir qaytara olmaydi", async () => {
    const second = await buy("12000");
    expect((await giveBack(second, "10", {})).statusCode).toBe(201);
    const foreign = await app.inject({ method: "POST", url: `/api/purchase/orders/${second.id}/returns`, headers: { cookie: other.ownerCookie }, payload: { items: [{ orderItemId: second.items[0]!.id, quantity: "10" }] } });
    expect(foreign.statusCode).toBe(404);
    const kassir = await addEmployee(app, company, "Kassir");
    expect((await giveBack(second, "10", {})).statusCode).toBe(201);
    const denied = await app.inject({ method: "POST", url: `/api/purchase/orders/${second.id}/returns`, headers: { cookie: kassir.cookie }, payload: { items: [{ orderItemId: second.items[0]!.id, quantity: "10" }] } });
    expect(denied.statusCode).toBe(403);
    expect((await level()).quantity).toBe("80.0000");
    await expectInventoryReconciled();
  });
});
