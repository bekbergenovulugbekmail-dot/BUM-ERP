import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { products, units } from "../src/db/schema/catalog.js";
import { stockLevels, warehouses } from "../src/db/schema/inventory.js";
import { purchaseOrderItems, purchaseOrders, suppliers } from "../src/db/schema/purchase.js";
import { posCashMovements, posShifts } from "../src/db/schema/sales.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;
type Method = "GET" | "POST" | "PATCH";
type PushResult = {
  opId: string | null;
  status: string;
  result?: Record<string, unknown>;
  error?: { code: string; message: string; details?: unknown };
};

let app: FastifyInstance;
let company: Company;
let piece: string;
let mainWarehouseId: string;

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
  const adminCookie = (await signedIn(app, { isPlatformAdmin: true })).cookie;
  company = await createCompany(app, adminCookie, { name: "Bonnu" });
  mainWarehouseId = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
});

const web = (cookie: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
const device = (token: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });

async function register(name: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/pos-device/setup/register",
    payload: { phone: company.owner.phone, password: company.owner.password, warehouseId: mainWarehouseId, name },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { token: string; device: { id: string; code: string } };
}

async function product(name: string, sku: string, salesPrice = "10000") {
  const res = await web(company.ownerCookie, "POST", "/api/catalog/products", { name, sku, baseUnitId: piece, salesPrice, taxRate: "0" });
  expect(res.statusCode).toBe(201);
  return res.json().product.id as string;
}

async function push(token: string, ops: object[]) {
  const res = await device(token, "POST", "/api/pos-device/push", { ops });
  expect(res.statusCode).toBe(200);
  return res.json().results as PushResult[];
}

const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const op = (type: string, cashierId: string, payload: object, minutesAgo = 1) => ({ opId: randomUUID(), type, cashierId, createdAt: at(minutesAgo), payload });
const line = (productId: string, quantity: string, unitPrice: string, extra: object = {}) => ({ id: randomUUID(), productId, unitId: piece, quantity, unitPrice, ...extra });

async function stockOf(productId: string) {
  const [level] = await db.select().from(stockLevels).where(and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, mainWarehouseId)));
  return level?.quantity;
}

async function supplierDebt(supplierId: string) {
  return (await db.select().from(suppliers).where(eq(suppliers.id, supplierId)))[0]!.totalDebt;
}

describe("Desktop kassa: xarid, ta'minotchiga qaytarish va to'lov sinxroni", () => {
  it("supplier.create + purchase.complete: tasdiqlangan va qabul qilingan xarid, sotuv narxi, qarz, smenadan naqd to'lov; ruxsat va band raqam", async () => {
    const { token, device: kassa } = await register("Kassa 1");
    const owner = company.owner.id;
    const rice = await product("Guruch", "RICE");
    const shiftId = randomUUID();
    const supplierId = randomUUID();
    const riceLine = line(rice, "10", "8000", { salesPrice: "10500" });
    const results = await push(token, [
      op("shift.open", owner, { shiftId, openingCash: "100000" }, 60),
      op("supplier.create", owner, { supplierId, name: "Olma savdo", phone: "+998901112233" }, 50),
      op(
        "purchase.complete",
        owner,
        { purchaseId: randomUUID(), number: "K01-P000001", supplierId, items: [riceLine], payment: { shiftId, amount: "50000", method: "cash" } },
        40,
      ),
    ]);
    expect(results.map((row) => row.status)).toEqual(["applied", "applied", "applied"]);
    expect(results[2]!.result).toMatchObject({ number: "K01-P000001", total: "80000.00", status: "received", payment: { amount: "50000.00", method: "cash" } });

    const [order] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.number, "K01-P000001"));
    expect(order).toMatchObject({ deviceId: kassa.id, status: "received", supplierId, totalAmount: "80000.00", paidAmount: "50000.00" });
    expect((await db.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.orderId, order!.id))).map((row) => row.id)).toEqual([riceLine.id]);
    expect(await stockOf(rice)).toBe("10.0000");
    expect((await db.select().from(products).where(eq(products.id, rice)))[0]!.salesPrice).toBe("10500.0000");
    expect(await supplierDebt(supplierId)).toBe("30000.00");
    expect((await db.select().from(posShifts).where(eq(posShifts.id, shiftId)))[0]).toMatchObject({ cashOut: "50000.00" });
    expect((await db.select().from(posCashMovements).where(eq(posCashMovements.shiftId, shiftId)))[0]).toMatchObject({
      kind: "supplier_payment",
      type: "out",
      amount: "50000.00",
      referenceType: "supplier_payment",
    });

    // Kassirda xarid ruxsati yo'q; o'sha raqam — band
    const kassir = await addEmployee(app, company, "Kassir");
    const denied = await push(token, [
      op("purchase.complete", kassir.id, { purchaseId: randomUUID(), number: "K01-P000002", supplierId, items: [line(rice, "1", "8000")] }),
      op("purchase.complete", owner, { purchaseId: randomUUID(), number: "K01-P000001", supplierId, items: [line(rice, "1", "8000")] }),
    ]);
    expect(denied.map((row) => row.error?.code)).toEqual(["FORBIDDEN", "CONFLICT"]);
  });

  it("purchase.return: qisman qaytarish — zaxira va qarz kamayadi, qaytgan pul smenaga; web qaytarish; oxirgisidan ko'p bo'lmaydi", async () => {
    const { token } = await register("Kassa 1");
    const owner = company.owner.id;
    const oil = await product("Yog'", "OIL");
    const supplier = await web(company.ownerCookie, "POST", "/api/purchase/suppliers", { name: "Yog' zavodi" });
    const supplierId = supplier.json().supplier.id as string;
    const shiftId = randomUUID();
    const oilLine = line(oil, "3", "7000");
    const purchaseId = randomUUID();
    expect(
      (
        await push(token, [
          op("shift.open", owner, { shiftId, openingCash: "0" }, 60),
          op("purchase.complete", owner, { purchaseId, number: "K01-P000001", supplierId, items: [oilLine] }, 50),
        ])
      ).map((row) => row.status),
    ).toEqual(["applied", "applied"]);
    expect(await supplierDebt(supplierId)).toBe("21000.00");

    const ret = (number: string, quantity: string, refund: object | null, minutesAgo: number) =>
      op("purchase.return", owner, { returnId: randomUUID(), number, orderId: purchaseId, items: [{ orderItemId: oilLine.id, quantity }], reason: "Sifatsiz", refund }, minutesAgo);
    const [first] = await push(token, [ret("K01-R000001", "1", null, 40)]);
    expect(first).toMatchObject({ status: "applied", result: { number: "K01-R000001", totalAmount: "7000.00", conflicts: [] } });
    expect(await stockOf(oil)).toBe("2.0000");
    expect(await supplierDebt(supplierId)).toBe("14000.00");

    const [second] = await push(token, [ret("K01-R000002", "1", { shiftId, amount: "3000", method: "cash" }, 30)]);
    expect(second).toMatchObject({ status: "applied", result: { refundMethod: "cash", refundAmount: "3000.00" } });
    expect(await supplierDebt(supplierId)).toBe("10000.00");
    expect((await db.select().from(posShifts).where(eq(posShifts.id, shiftId)))[0]).toMatchObject({ cashIn: "3000.00" });

    // Web: oxirgi dona — aniq qolgan summa; undan keyin qaytarib bo'lmaydi
    const webReturn = await web(company.ownerCookie, "POST", `/api/purchase/orders/${purchaseId}/returns`, { items: [{ orderItemId: oilLine.id, quantity: "1" }] });
    expect(webReturn.statusCode).toBe(201);
    expect(webReturn.json().return).toMatchObject({ number: expect.stringMatching(/^PR-\d{4}-0001$/), totalAmount: "7000.00" });
    expect(webReturn.json().order.returns).toHaveLength(3);
    expect(webReturn.json().order.items[0]).toMatchObject({ receivedQty: "3.0000", returnedQty: "3.0000" });
    expect(await stockOf(oil)).toBe("0.0000");
    expect(await supplierDebt(supplierId)).toBe("3000.00");
    expect(
      (await web(company.ownerCookie, "POST", `/api/purchase/orders/${purchaseId}/returns`, { items: [{ orderItemId: oilLine.id, quantity: "1" }] })).statusCode,
    ).toBe(400);

    // Kassirda purchase.return yo'q
    const kassir = await addEmployee(app, company, "Kassir");
    const [denied] = await push(token, [op("purchase.return", kassir.id, { returnId: randomUUID(), number: "K01-R000003", orderId: purchaseId, items: [{ orderItemId: oilLine.id, quantity: "1" }] })]);
    expect(denied).toMatchObject({ status: "rejected", error: { code: "FORBIDDEN" } });
  });

  it("supplier.payment: qarzdan ortig'i avans (nomuvofiqlik), naqd — smena chiqimi; pull ta'minotchilar va xaridni raqam bo'yicha topish", async () => {
    const { token } = await register("Kassa 1");
    const owner = company.owner.id;
    const salt = await product("Tuz", "SALT");
    const supplierId = randomUUID();
    const shiftId = randomUUID();
    expect(
      (
        await push(token, [
          op("shift.open", owner, { shiftId, openingCash: "20000" }, 60),
          op("supplier.create", owner, { supplierId, name: "Tuz kombinati" }, 55),
          op("purchase.complete", owner, { purchaseId: randomUUID(), number: "K01-P000001", supplierId, items: [line(salt, "5", "1000")] }, 50),
        ])
      ).map((row) => row.status),
    ).toEqual(["applied", "applied", "applied"]);
    expect(await supplierDebt(supplierId)).toBe("5000.00");

    const [paid] = await push(token, [op("supplier.payment", owner, { paymentId: randomUUID(), shiftId, supplierId, amount: "8000", method: "cash" }, 30)]);
    expect(paid).toMatchObject({ status: "applied", result: { advance: "3000.00", conflicts: ["supplier_overpaid"] } });
    expect(await supplierDebt(supplierId)).toBe("-3000.00");
    expect((await db.select().from(posShifts).where(eq(posShifts.id, shiftId)))[0]).toMatchObject({ cashOut: "8000.00" });

    const pulled = await device(token, "POST", "/api/pos-device/pull", {});
    expect(pulled.statusCode).toBe(200);
    expect(pulled.json().entities.suppliers.rows).toEqual([expect.objectContaining({ id: supplierId, name: "Tuz kombinati", totalDebt: "-3000.00", isActive: true })]);
    expect(pulled.json().entities.products.rows[0]).toHaveProperty("trackExpiry", false);

    const found = await device(token, "GET", "/api/pos-device/purchases/K01-P000001");
    expect(found.statusCode).toBe(200);
    expect(found.json().purchase).toMatchObject({
      number: "K01-P000001",
      supplierName: "Tuz kombinati",
      status: "received",
      items: [expect.objectContaining({ productName: "Tuz", receivedQty: "5.0000", returnedQty: "0.0000" })],
    });
    expect((await device(token, "GET", "/api/pos-device/purchases/K01-P999999")).statusCode).toBe(404);
  });
});
