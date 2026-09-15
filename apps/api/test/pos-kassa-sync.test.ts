import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { cashTransactions, expenses } from "../src/db/schema/finance.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { posShifts } from "../src/db/schema/sales.js";
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

async function register(name: string, warehouseId = mainWarehouseId) {
  const res = await app.inject({
    method: "POST",
    url: "/api/pos-device/setup/register",
    payload: { phone: company.owner.phone, password: company.owner.password, warehouseId, name },
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

async function receive(productId: string, quantity: string) {
  const res = await web(company.ownerCookie, "POST", "/api/inventory/stock/movements", { type: "receive", productId, warehouseId: mainWarehouseId, quantity, costPrice: "1000" });
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

describe("Desktop kassa: naqd harakatlari, mijoz to'lovlari, sotuv tarixi", () => {
  it("cash.movement: inkassatsiya, almashtirish puli, xarajat (ruxsat bilan), kutilgan naqd va smena yopilishi; web kassa", async () => {
    const one = await register("Kassa 1");
    const two = await register("Kassa 2");
    const owner = company.owner.id;
    const tv = await product("Televizor", "TV", "50000");
    await receive(tv, "5");

    const shiftId = randomUUID();
    const opened = await push(one.token, [
      op("shift.open", owner, { shiftId, openingCash: "10000" }, 60),
      op("sale.complete", owner, { saleId: randomUUID(), shiftId, number: "K01-000001", items: [saleItem(tv, "1", "50000")], paymentMethod: "cash", amountPaid: "50000" }, 50),
    ]);
    expect(opened.map((row) => row.status)).toEqual(["applied", "applied"]);

    const move = (kind: string, amount: string, extra: object = {}) => op("cash.movement", owner, { movementId: randomUUID(), shiftId, kind, amount, ...extra }, 40);
    const collection = move("collection", "30000", { notes: "Seyfga" });
    const moved = await push(one.token, [collection, move("change_fund", "5000")]);
    expect(moved.map((row) => row.status)).toEqual(["applied", "applied"]);
    expect(moved[0]!.result).toMatchObject({ kind: "collection", amount: "30000.00", expectedCash: "30000.00", expenseId: null });
    expect(moved[1]!.result).toMatchObject({ expectedCash: "35000.00" });

    // Kassirda pos.cash.expense yo'q — o'z smenasida ham xarajat rad etiladi
    const kassir = await addEmployee(app, company, "Kassir");
    const kassirShift = randomUUID();
    const kassirOps = await push(two.token, [
      op("shift.open", kassir.id, { shiftId: kassirShift, openingCash: "0" }, 60),
      op("cash.movement", kassir.id, { movementId: randomUUID(), shiftId: kassirShift, kind: "expense", amount: "1000" }, 30),
    ]);
    expect(kassirOps[1]).toMatchObject({ status: "rejected", error: { code: "FORBIDDEN" } });

    const [paid] = await push(one.token, [move("expense", "2000", { category: "suv", notes: "Ichimlik suvi" })]);
    expect(paid).toMatchObject({ status: "applied", result: { expectedCash: "33000.00" } });
    const [expense] = await db.select().from(expenses).where(eq(expenses.id, paid!.result!.expenseId as string));
    expect(expense).toMatchObject({ status: "paid", amount: "2000.00", category: "suv", description: "Ichimlik suvi" });
    expect(await db.$count(cashTransactions, and(eq(cashTransactions.referenceType, "expense"), eq(cashTransactions.referenceId, expense!.id)))).toBe(1);

    // Takroriy harakat ID'si
    expect((await push(one.token, [{ ...collection, opId: randomUUID() }]))[0]).toMatchObject({ status: "rejected", error: { code: "CONFLICT" } });

    const [closed] = await push(one.token, [op("shift.close", owner, { shiftId, closingCash: "33000" }, 10)]);
    expect(closed!.result).toMatchObject({ expectedCash: "33000.00", difference: "0.00" });
    expect((await db.select().from(posShifts).where(eq(posShifts.id, shiftId)))[0]).toMatchObject({ cashIn: "5000.00", cashOut: "32000.00" });

    // Web kassa: harakat va ro'yxat; desktop smenasiga yozib bo'lmaydi
    const webShift = await web(company.ownerCookie, "POST", "/api/sales/pos/shifts", { warehouseId: mainWarehouseId, openingCash: "1000" });
    expect(webShift.statusCode).toBe(201);
    const webShiftId = webShift.json().shift.id as string;
    const created = await web(company.ownerCookie, "POST", `/api/sales/pos/shifts/${webShiftId}/cash-movements`, { kind: "other_out", amount: "400", notes: "Qaytim xatosi" });
    expect(created.statusCode).toBe(201);
    expect(created.json().shift).toMatchObject({ cashOut: "400.00", expectedCash: "600.00" });
    const list = await web(company.ownerCookie, "GET", `/api/sales/pos/shifts/${webShiftId}/cash-movements`);
    expect(list.json().movements).toEqual([expect.objectContaining({ kind: "other_out", type: "out", amount: "400.00" })]);
    expect((await web(company.ownerCookie, "POST", `/api/sales/pos/shifts/${shiftId}/cash-movements`, { kind: "collection", amount: "1" })).statusCode).toBe(404);
  });

  it("customer.payment: offline qarz to'lovi qarzdan oshsa — ortig'i balansga; kartadan balansni to'ldirish", async () => {
    const { token } = await register("Kassa 1");
    const owner = company.owner.id;
    const flour = await product("Un", "FLOUR", "20000");
    await receive(flour, "10");
    const created = await web(company.ownerCookie, "POST", "/api/sales/customers", { name: "Vali", phone: "+998907776655" });
    expect(created.statusCode).toBe(201);
    const customerId = created.json().customer.id as string;

    const shiftId = randomUUID();
    const [, credit] = await push(token, [
      op("shift.open", owner, { shiftId, openingCash: "0" }, 60),
      op("sale.complete", owner, { saleId: randomUUID(), shiftId, number: "K01-000001", customerId, items: [saleItem(flour, "1", "20000")], paymentMethod: "cash", amountPaid: "0" }, 50),
    ]);
    expect(credit!.result).toMatchObject({ debt: "20000.00" });

    // Web kassada 15000 to'landi; qurilma eski qarz bilan 20000 qabul qildi
    const webShift = (await web(company.ownerCookie, "POST", "/api/sales/pos/shifts", { warehouseId: mainWarehouseId, openingCash: "0" })).json().shift.id as string;
    expect(
      (await web(company.ownerCookie, "POST", `/api/sales/pos/customers/${customerId}/payments`, { shiftId: webShift, purpose: "debt", amount: "15000", method: "cash" })).statusCode,
    ).toBe(201);

    const [paid] = await push(token, [op("customer.payment", owner, { paymentId: randomUUID(), shiftId, customerId, purpose: "debt", amount: "20000", method: "cash" }, 30)]);
    expect(paid).toMatchObject({ status: "applied", result: { conflicts: ["debt_overpaid"], customer: { totalDebt: "0.00", balance: "15000.00" } } });
    const [deposit] = await push(token, [op("customer.payment", owner, { paymentId: randomUUID(), shiftId, customerId, purpose: "deposit", amount: "3000", method: "card" }, 20)]);
    expect(deposit).toMatchObject({ status: "applied", result: { conflicts: [], customer: { balance: "18000.00" } } });
    expect((await db.select().from(posShifts).where(eq(posShifts.id, shiftId)))[0]).toMatchObject({ totalCash: "20000.00", totalCard: "3000.00" });

    expect(
      (await web(company.ownerCookie, "POST", `/api/sales/pos/customers/${customerId}/payments`, { shiftId, purpose: "deposit", amount: "1", method: "cash" })).statusCode,
    ).toBe(404);
  });

  it("sotuv tarixi: qurilma omboridagi barcha kassa cheklari (boshqa kassa va web), sahifalab; boshqa ombor ko'rmaydi", async () => {
    const one = await register("Kassa 1");
    const two = await register("Kassa 2");
    const owner = company.owner.id;
    const pen = await product("Ruchka", "PEN", "2000");
    await receive(pen, "100");

    const shiftOne = randomUUID();
    const shiftTwo = randomUUID();
    expect(
      (
        await push(one.token, [
          op("shift.open", owner, { shiftId: shiftOne, openingCash: "0" }, 60),
          op("sale.complete", owner, { saleId: randomUUID(), shiftId: shiftOne, number: "K01-000001", items: [saleItem(pen, "1", "2000")], paymentMethod: "cash", amountPaid: "2000" }, 30),
        ])
      ).map((row) => row.status),
    ).toEqual(["applied", "applied"]);
    expect(
      (
        await push(two.token, [
          op("shift.open", owner, { shiftId: shiftTwo, openingCash: "0" }, 60),
          op("sale.complete", owner, { saleId: randomUUID(), shiftId: shiftTwo, number: "K02-000001", items: [saleItem(pen, "2", "2000")], paymentMethod: "cash", amountPaid: "4000" }, 20),
        ])
      ).map((row) => row.status),
    ).toEqual(["applied", "applied"]);

    const webShift = (await web(company.ownerCookie, "POST", "/api/sales/pos/shifts", { warehouseId: mainWarehouseId, openingCash: "0" })).json().shift.id as string;
    const webSale = await web(company.ownerCookie, "POST", "/api/sales/pos/sales", {
      shiftId: webShift,
      items: [{ productId: pen, quantity: "3" }],
      paymentMethod: "cash",
      amountPaid: "6000",
    });
    expect(webSale.statusCode).toBe(201);

    const first = await device(one.token, "GET", "/api/pos-device/sales?limit=2");
    expect(first.statusCode).toBe(200);
    expect(first.json().sales.map((sale: { number: string }) => sale.number)).toEqual([webSale.json().order.number, "K02-000001"]);
    expect(first.json().sales[1]).toMatchObject({ deviceCode: "K02", totalAmount: "4000.00", status: "delivered" });
    const second = await device(one.token, "GET", `/api/pos-device/sales?limit=2&cursor=${encodeURIComponent(first.json().nextCursor)}`);
    expect(second.json()).toMatchObject({ sales: [expect.objectContaining({ number: "K01-000001", deviceCode: "K01" })], nextCursor: null });

    const filial = await web(company.ownerCookie, "POST", "/api/inventory/warehouses", { name: "Filial", code: "FIL" });
    const three = await register("Filial kassa", filial.json().warehouse.id as string);
    expect((await device(three.token, "GET", "/api/pos-device/sales")).json().sales).toEqual([]);
    expect((await device(one.token, "GET", "/api/pos-device/sales?from=yesterday")).statusCode).toBe(400);
  });
});
