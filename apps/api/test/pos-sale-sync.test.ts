import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { stockLevels, warehouses } from "../src/db/schema/inventory.js";
import { posSyncConflicts } from "../src/db/schema/pos.js";
import { customers, posShifts, salesOrderItems, salesOrders } from "../src/db/schema/sales.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;
type Method = "GET" | "POST" | "PATCH";
type PushResult = {
  opId: string | null;
  status: string;
  duplicate?: boolean;
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
  const body = res.json() as { token: string; device: { id: string; code: string } };
  // Ega kassada parol bilan kiradi — qurilma amallari faqat shu qurilmaga bog'langan kassir nomidan qabul qilinadi
  const login = await app.inject({ method: "POST", url: "/api/pos-device/cashiers/login", headers: { authorization: `Bearer ${body.token}` }, payload: { phone: company.owner.phone, password: company.owner.password } });
  expect(login.statusCode, login.body).toBe(200);
  return body;
}

async function product(name: string, sku: string, salesPrice: string) {
  const res = await web(company.ownerCookie, "POST", "/api/catalog/products", { name, sku, baseUnitId: piece, salesPrice, taxRate: "0" });
  expect(res.statusCode).toBe(201);
  return res.json().product.id as string;
}

async function receive(productId: string, quantity: string, costPrice = "1000") {
  const res = await web(company.ownerCookie, "POST", "/api/inventory/stock/movements", {
    type: "receive",
    productId,
    warehouseId: mainWarehouseId,
    quantity,
    costPrice,
  });
  expect(res.statusCode).toBeLessThan(300);
}

async function push(token: string, ops: object[]) {
  const res = await device(token, "POST", "/api/pos-device/push", { ops });
  expect(res.statusCode).toBe(200);
  return res.json().results as PushResult[];
}

const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const op = (type: string, cashierId: string, payload: object, minutesAgo = 1) => ({ opId: randomUUID(), type, cashierId, createdAt: at(minutesAgo), payload });
const saleItem = (productId: string, quantity: string, unitPrice: string) => ({ id: randomUUID(), productId, unitId: piece, quantity, unitPrice });

async function openDeviceShift(token: string, cashierId: string) {
  const shiftId = randomUUID();
  const [opened] = await push(token, [op("shift.open", cashierId, { shiftId, openingCash: "0" }, 60)]);
  expect(opened!.status).toBe("applied");
  return shiftId;
}

async function stockOf(productId: string) {
  const [level] = await db
    .select()
    .from(stockLevels)
    .where(and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, mainWarehouseId)));
  return level;
}

describe("Desktop kassa: offline chek va qaytarish sinxroni", () => {
  it("sale.complete: qurilma ID, raqam va vaqti; zaxira yetmasa manfiy qoldiq, eski narx — nomuvofiqlik; takror bitta chek", async () => {
    const kassir = await addEmployee(app, company, "Kassir");
    const { token, device: kassa } = await register("Kassa 1");
    // Kassir shu kassada parol bilan kiradi (qurilma amallari bog'langan kassir nomidan)
    expect((await device(token, "POST", "/api/pos-device/cashiers/login", { phone: kassir.phone, password: "xodim-parol-123" })).statusCode).toBe(200);
    const cola = await product("Coca Cola", "COLA", "10000");
    const pepsi = await product("Pepsi", "PEPSI", "8000");
    await receive(cola, "2");
    const shiftId = await openDeviceShift(token, kassir.id);
    // Qurilma eski narxni bilgan holda sotdi — serverda narx oshirilgan (kassirda sales.edit yo'q)
    expect((await web(company.ownerCookie, "PATCH", `/api/catalog/products/${cola}`, { salesPrice: "12000" })).statusCode).toBe(200);

    const saleId = randomUUID();
    const items = [saleItem(cola, "5", "10000"), saleItem(pepsi, "1", "8000")];
    const saleOp = op("sale.complete", kassir.id, { saleId, shiftId, number: "K01-000001", items, paymentMethod: "cash", amountPaid: "60000" }, 20);
    const [sold] = await push(token, [saleOp]);
    expect(sold).toMatchObject({ status: "applied", result: { orderId: saleId, number: "K01-000001", totalAmount: "58000.00", change: "2000.00", debt: "0.00" } });
    expect(sold!.result!.conflicts).toEqual(expect.arrayContaining(["stock_shortage", "price_changed"]));

    const [order] = await db.select().from(salesOrders).where(eq(salesOrders.id, saleId));
    expect(order).toMatchObject({ number: "K01-000001", deviceId: kassa.id, posShiftId: shiftId, isPos: true });
    expect(Math.abs(order!.createdAt.getTime() - Date.parse(saleOp.createdAt))).toBeLessThan(1000);
    const itemIds = (await db.select({ id: salesOrderItems.id }).from(salesOrderItems).where(eq(salesOrderItems.orderId, saleId))).map((row) => row.id);
    expect(itemIds.sort()).toEqual(items.map((item) => item.id).sort());
    expect((await stockOf(cola))!.quantity).toBe("-3.0000");
    expect((await stockOf(pepsi))!.quantity).toBe("-1.0000");

    const conflicts = await db.select().from(posSyncConflicts).where(eq(posSyncConflicts.referenceId, saleId));
    expect(conflicts.map((row) => row.kind).sort()).toEqual(["price_changed", "stock_shortage"]);
    const shortage = conflicts.find((row) => row.kind === "stock_shortage")!.details as { items: { productId: string; requested: string; available: string }[] };
    expect(shortage.items).toEqual(expect.arrayContaining([expect.objectContaining({ productId: cola, requested: "5.0000", available: "2.0000" })]));
    const [shift] = await db.select().from(posShifts).where(eq(posShifts.id, shiftId));
    expect(shift).toMatchObject({ totalSales: "58000.00", totalCash: "58000.00", receiptCount: 1 });

    // Takror — o'sha natija; o'sha raqam boshqa amalda — rad; boshqa qurilma kodi — rad
    expect((await push(token, [saleOp]))[0]).toMatchObject({ status: "applied", duplicate: true });
    const again = await push(token, [
      op("sale.complete", kassir.id, { saleId: randomUUID(), shiftId, number: "K01-000001", items: [saleItem(cola, "1", "10000")], paymentMethod: "cash", amountPaid: "10000" }),
      op("sale.complete", kassir.id, { saleId: randomUUID(), shiftId, number: "K02-000001", items: [saleItem(cola, "1", "10000")], paymentMethod: "cash", amountPaid: "10000" }),
    ]);
    expect(again.map((row) => row.status)).toEqual(["rejected", "rejected"]);
    expect(again[0]!.error!.code).toBe("CONFLICT");
    expect(again[1]!.error!.code).toBe("BAD_REQUEST");
    expect(await db.$count(salesOrders)).toBe(1);

    // Manfiy qoldiqdan keyin kirim: o'rtacha tannarx — kirim tannarxi
    await receive(cola, "10", "1500");
    expect(await stockOf(cola)).toMatchObject({ quantity: "7.0000", avgCostPrice: "1500.0000" });

    // Web kassa desktop smenasini yopa olmaydi
    expect((await web(company.ownerCookie, "POST", `/api/sales/pos/shifts/${shiftId}/close`, { closingCash: "0" })).statusCode).toBe(400);
  });

  it("sale.return: qisman qaytarish — pul smenadan, zaxira qaytadi, oxirgisi aniq summa; ruxsat; web qisman va to'liq qaytarish", async () => {
    const { token } = await register("Kassa 1");
    const owner = company.owner.id;
    const tea = await product("Choy", "TEA", "10000");
    await receive(tea, "10");
    const shiftId = await openDeviceShift(token, owner);
    const saleId = randomUUID();
    const line = saleItem(tea, "3", "10000");
    const [sold] = await push(token, [op("sale.complete", owner, { saleId, shiftId, number: "K01-000001", items: [line], paymentMethod: "cash", amountPaid: "30000" }, 30)]);
    expect(sold!.status).toBe("applied");

    const ret = (number: string, quantity: string, minutesAgo: number) =>
      op("sale.return", owner, { returnId: randomUUID(), orderId: saleId, shiftId, number, items: [{ orderItemId: line.id, quantity }], refundMethod: "cash", reason: "Sifatsiz" }, minutesAgo);
    const [first] = await push(token, [ret("K01-Q000001", "1", 20)]);
    expect(first).toMatchObject({ status: "applied", result: { number: "K01-Q000001", totalAmount: "10000.00", refundAmount: "10000.00", orderStatus: "completed" } });
    expect((await stockOf(tea))!.quantity).toBe("8.0000");
    expect((await db.select().from(posShifts).where(eq(posShifts.id, shiftId)))[0]).toMatchObject({ totalReturns: "10000.00", totalCash: "20000.00" });

    const [tooMany] = await push(token, [ret("K01-Q000002", "3", 15)]);
    expect(tooMany).toMatchObject({ status: "rejected", error: { code: "BAD_REQUEST" } });
    const [last] = await push(token, [ret("K01-Q000003", "2", 10)]);
    expect(last).toMatchObject({ status: "applied", result: { totalAmount: "20000.00", refundAmount: "20000.00", orderStatus: "returned" } });
    expect((await db.select().from(salesOrders).where(eq(salesOrders.id, saleId)))[0]).toMatchObject({ status: "returned", paidAmount: "0.00" });
    expect((await db.select().from(salesOrderItems).where(eq(salesOrderItems.id, line.id)))[0]!.returnedQty).toBe("3.0000");
    expect((await db.select().from(posShifts).where(eq(posShifts.id, shiftId)))[0]).toMatchObject({ totalReturns: "30000.00", totalCash: "0.00" });
    expect((await stockOf(tea))!.quantity).toBe("10.0000");
    expect(first!.result!.conflicts).toEqual([]);

    // Web kassa cheki kassa qurilmasida qaytarildi — pul qurilmada berilgan, rad etilmaydi, nomuvofiqlik yoziladi
    const webShift = await web(company.ownerCookie, "POST", "/api/sales/pos/shifts", { warehouseId: mainWarehouseId, openingCash: "0" });
    expect(webShift.statusCode, webShift.body).toBe(201);
    const webSale = await web(company.ownerCookie, "POST", "/api/sales/pos/sales", { shiftId: webShift.json().shift.id, items: [{ productId: tea, quantity: "1" }], paymentMethod: "cash", amountPaid: "10000" });
    expect(webSale.statusCode, webSale.body).toBe(201);
    const webOrder = webSale.json().order as { id: string; items: { id: string }[] };
    const [foreign] = await push(token, [
      op("sale.return", owner, { returnId: randomUUID(), orderId: webOrder.id, shiftId, number: "K01-Q000009", items: [{ orderItemId: webOrder.items[0]!.id, quantity: "1" }], refundMethod: "cash" }, 1),
    ]);
    expect(foreign).toMatchObject({ status: "applied", result: { conflicts: ["return_foreign_order"] } });
    const foreignConflicts = await db.select().from(posSyncConflicts).where(eq(posSyncConflicts.kind, "return_foreign_order"));
    expect(foreignConflicts).toHaveLength(1);

    // Kassirda sales.refund yo'q
    const kassir = await addEmployee(app, company, "Kassir");
    const secondId = randomUUID();
    const line2 = saleItem(tea, "2", "10000");
    expect((await push(token, [op("sale.complete", owner, { saleId: secondId, shiftId, number: "K01-000002", items: [line2], paymentMethod: "cash", amountPaid: "20000" }, 5)]))[0]!.status).toBe("applied");
    const [denied] = await push(token, [
      op("sale.return", kassir.id, { returnId: randomUUID(), orderId: secondId, shiftId, number: "K01-Q000004", items: [{ orderItemId: line2.id, quantity: "1" }], refundMethod: "cash" }, 4),
    ]);
    expect(denied).toMatchObject({ status: "rejected", error: { code: "FORBIDDEN" } });

    // Web: qisman qaytarish (QR- raqami), keyin to'liq qaytarish bloklanadi
    const webReturn = await web(company.ownerCookie, "POST", `/api/sales/orders/${secondId}/return-items`, { items: [{ orderItemId: line2.id, quantity: "1" }], refundMethod: "cash" });
    expect(webReturn.statusCode).toBe(201);
    expect(webReturn.json().return).toMatchObject({ number: expect.stringMatching(/^QR-\d{4}-0001$/), totalAmount: "10000.00", refundAmount: "10000.00" });
    expect(webReturn.json().order.returns).toHaveLength(1);
    const full = await web(company.ownerCookie, "POST", `/api/sales/orders/${secondId}/return`, {});
    expect(full.statusCode).toBe(400);
    expect(full.json().message).toContain("qisman");
  });

  it("customer.create va offline balans/kredit limiti: farq qarzga yoziladi, nomuvofiqlik qayd etiladi", async () => {
    const { token } = await register("Kassa 1");
    const owner = company.owner.id;
    const rice = await product("Guruch", "RICE", "10000");
    await receive(rice, "100");

    const customerId = randomUUID();
    const [created] = await push(token, [op("customer.create", owner, { customerId, name: "Ali Valiyev", phone: "+998901112233" }, 50)]);
    expect(created).toMatchObject({ status: "applied", result: { customerId, conflicts: [] } });
    const [dupe] = await push(token, [op("customer.create", owner, { customerId: randomUUID(), name: "Ali V.", phone: "90 111 22 33" }, 49)]);
    expect(dupe).toMatchObject({ status: "applied", result: { conflicts: ["customer_duplicate_phone"] } });

    // Web kassada balans 5000 ga to'ldirildi; qurilma eski ma'lumot bilan 8000 ishlatdi
    const webShift = await web(company.ownerCookie, "POST", "/api/sales/pos/shifts", { warehouseId: mainWarehouseId, openingCash: "0" });
    expect(webShift.statusCode).toBe(201);
    const deposit = await web(company.ownerCookie, "POST", `/api/sales/pos/customers/${customerId}/payments`, {
      shiftId: webShift.json().shift.id,
      purpose: "deposit",
      amount: "5000",
      method: "cash",
    });
    expect(deposit.statusCode).toBe(201);

    const shiftId = await openDeviceShift(token, owner);
    const [sold] = await push(token, [
      op("sale.complete", owner, { saleId: randomUUID(), shiftId, number: "K01-000001", customerId, items: [saleItem(rice, "1", "10000")], paymentMethod: "cash", amountPaid: "2000", balanceAmount: "8000" }, 10),
    ]);
    expect(sold).toMatchObject({ status: "applied", result: { balanceUsed: "5000.00", paid: "2000.00", debt: "3000.00", conflicts: ["balance_insufficient"] } });
    expect((await db.select().from(customers).where(eq(customers.id, customerId)))[0]).toMatchObject({ balance: "0.00", totalDebt: "3000.00" });

    // Kredit limiti 1000: qarzga sotuv baribir yoziladi
    expect((await web(company.ownerCookie, "PATCH", `/api/sales/customers/${customerId}`, { creditLimit: "1000" })).statusCode).toBe(200);
    const [credit] = await push(token, [
      op("sale.complete", owner, { saleId: randomUUID(), shiftId, number: "K01-000002", customerId, items: [saleItem(rice, "1", "10000")], paymentMethod: "cash", amountPaid: "0" }, 5),
    ]);
    expect(credit).toMatchObject({ status: "applied", result: { debt: "10000.00", conflicts: ["credit_limit"] } });
    expect((await db.select().from(customers).where(eq(customers.id, customerId)))[0]!.totalDebt).toBe("13000.00");
  });

  it("pull config xesh bilan, chekni raqam bo'yicha topish, nomuvofiqliklar ro'yxati va yopish", async () => {
    const { token } = await register("Kassa 1");
    const pull = async (configHash?: string) => {
      const res = await device(token, "POST", "/api/pos-device/pull", configHash ? { configHash } : {});
      expect(res.statusCode).toBe(200);
      return res.json();
    };
    const first = await pull();
    expect(first.config).toMatchObject({ hash: expect.any(String), company: { name: "Bonnu", currency: "UZS" }, cashback: { enabled: false }, receipt: { paperWidth: 80 } });
    expect((await pull(first.config.hash)).config).toBeNull();

    const owner = company.owner.id;
    const water = await product("Suv", "WATER", "3000");
    const shiftId = await openDeviceShift(token, owner);
    const line = saleItem(water, "2", "3000");
    expect((await push(token, [op("sale.complete", owner, { saleId: randomUUID(), shiftId, number: "K01-000001", items: [line], paymentMethod: "cash", amountPaid: "6000" }, 5)]))[0]!.status).toBe("applied");

    const found = await device(token, "GET", "/api/pos-device/receipts/K01-000001");
    expect(found.statusCode).toBe(200);
    expect(found.json().receipt).toMatchObject({
      number: "K01-000001",
      totalAmount: "6000.00",
      items: [expect.objectContaining({ id: line.id, quantity: "2.0000", returnedQty: "0.0000", productName: "Suv" })],
    });
    expect((await device(token, "GET", "/api/pos-device/receipts/K01-999999")).statusCode).toBe(404);

    const list = await web(company.ownerCookie, "GET", "/api/pos/devices/conflicts");
    expect(list.statusCode).toBe(200);
    const [shortage] = list.json().conflicts;
    expect(shortage).toMatchObject({ kind: "stock_shortage", deviceCode: "K01" });
    const kassir = await addEmployee(app, company, "Kassir");
    expect((await web(kassir.cookie, "GET", "/api/pos/devices/conflicts")).statusCode).toBe(403);
    expect((await web(company.ownerCookie, "POST", `/api/pos/devices/conflicts/${shortage.id}/resolve`)).statusCode).toBe(200);
    expect((await web(company.ownerCookie, "GET", "/api/pos/devices/conflicts")).json().conflicts).toEqual([]);
    expect((await web(company.ownerCookie, "GET", "/api/pos/devices/conflicts?resolved=true")).json().conflicts).toHaveLength(1);
  });
});
