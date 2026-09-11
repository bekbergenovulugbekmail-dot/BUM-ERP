import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { accounts, cashAccounts } from "../src/db/schema/finance.js";
import { stockLevels, warehouses } from "../src/db/schema/inventory.js";
import { salesOrders } from "../src/db/schema/sales.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
let other: Company;
let piece: string;
let mainWh: string;
let mainCash: string;
let mainBank: string;
let productId: string;

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
  company = await createCompany(app, admin.cookie, { name: "Do'kon" });
  other = await createCompany(app, admin.cookie, { name: "Boshqa do'kon" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  const cash = await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId));
  mainCash = cash.find((c) => c.type === "cash")!.id;
  mainBank = cash.find((c) => c.type === "bank")!.id;

  const product = await call(company.ownerCookie, "POST", "/api/catalog/products", {
    name: "Choy",
    sku: "CHOY",
    baseUnitId: piece,
    salesPrice: "5000",
    taxRate: "12",
    taxIncluded: true,
  });
  productId = product.json().product.id;
  await call(company.ownerCookie, "POST", "/api/inventory/stock/movements", {
    type: "receive",
    productId,
    warehouseId: mainWh,
    quantity: "10",
    costPrice: "3000",
  });
});

function call(cookie: string, method: "GET" | "POST", url: string, payload?: object) {
  return app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
}
const pos = (method: "GET" | "POST", url: string, cookie: string, payload?: object) =>
  call(cookie, method, `/api/sales/pos${url}`, payload);

async function ledger(code: string) {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, code)));
  return row!.balance;
}

async function balanceOf(id: string) {
  const [row] = await db.select().from(cashAccounts).where(eq(cashAccounts.id, id));
  return row!.balance;
}

async function stockQty() {
  const [row] = await db
    .select()
    .from(stockLevels)
    .where(and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, mainWh)));
  return row!.quantity;
}

async function openShift(cookie: string, openingCash = "100000") {
  const res = await pos("POST", "/shifts", cookie, { warehouseId: mainWh, openingCash });
  expect(res.statusCode).toBe(201);
  return res.json().shift as { id: string };
}

describe("POS", () => {
  it("smena, naqd va karta cheklari: qaytim, soliq narx ichida, zaxira, kassa/bank, jurnal, smena yig'indilari", async () => {
    const kassir = await addEmployee(app, company, "Kassir");
    const shift = await openShift(kassir.cookie);
    expect((await pos("GET", `/shifts/${shift.id}`, kassir.cookie)).json().shift).toMatchObject({
      status: "open",
      cashierName: "Kassir xodim",
      openingCash: "100000.00",
    });
    expect((await pos("POST", "/shifts", kassir.cookie, { warehouseId: mainWh })).statusCode).toBe(409);
    expect((await pos("GET", `/shifts/open?warehouseId=${mainWh}`, kassir.cookie)).json().shift.id).toBe(shift.id);

    const sale = await pos("POST", "/sales", kassir.cookie, {
      shiftId: shift.id,
      items: [{ productId, quantity: "2" }],
      paymentMethod: "cash",
      amountPaid: "20000",
    });
    expect(sale.statusCode).toBe(201);
    expect(sale.json()).toMatchObject({ paid: "10000.00", change: "10000.00" });
    expect(sale.json().order).toMatchObject({
      isPos: true,
      status: "delivered",
      totalAmount: "10000.00",
      taxAmount: "1071.43",
      paidAmount: "10000.00",
    });
    expect(await stockQty()).toBe("8.0000");
    expect(await balanceOf(mainCash)).toBe("10000.00");
    expect(await ledger("1010")).toBe("10000.00");
    expect(await ledger("4000")).toBe("10000.00");
    expect(await ledger("5000")).toBe("6000.00");
    expect(await ledger("1100")).toBe("0.00");

    const card = await pos("POST", "/sales", kassir.cookie, {
      shiftId: shift.id,
      items: [{ productId, quantity: "1" }],
      paymentMethod: "card",
      amountPaid: "5000",
    });
    expect(card.statusCode).toBe(201);
    expect(await balanceOf(mainBank)).toBe("5000.00");

    expect((await pos("GET", `/shifts/${shift.id}`, kassir.cookie)).json().shift).toMatchObject({
      totalSales: "15000.00",
      totalCash: "10000.00",
      totalCard: "5000.00",
      receiptCount: 2,
      expectedCash: "110000.00",
    });
  });

  it("rad etiladi: kassir narxni o'zgartira olmaydi, to'liq bo'lmagan to'lov, karta ortiqcha, zaxira yetmasa; boshqa kassir", async () => {
    const kassir = await addEmployee(app, company, "Kassir");
    const shift = await openShift(kassir.cookie);
    const sell = (body: object, cookie = kassir.cookie) =>
      pos("POST", "/sales", cookie, { shiftId: shift.id, items: [{ productId, quantity: "1" }], amountPaid: "5000", ...body });

    expect((await sell({ items: [{ productId, quantity: "1", unitPrice: "1" }] })).statusCode).toBe(403);
    expect((await sell({ amountPaid: "1000" })).statusCode).toBe(400);
    expect((await sell({ paymentMethod: "card", amountPaid: "6000" })).statusCode).toBe(400);
    const shortage = await sell({ items: [{ productId, quantity: "11" }], amountPaid: "55000" });
    expect(shortage.statusCode).toBe(400);

    expect((await pos("GET", `/shifts/${shift.id}`, kassir.cookie)).json().shift.receiptCount).toBe(0);
    expect(await stockQty()).toBe("10.0000");
    expect(await db.select().from(salesOrders).where(eq(salesOrders.companyId, company.companyId))).toHaveLength(0);

    const discounted = await sell({ items: [{ productId, quantity: "1", discountPercent: "10" }], amountPaid: "4500" }, company.ownerCookie);
    expect(discounted.statusCode).toBe(201);
    expect(discounted.json().order.totalAmount).toBe("4500.00");

    const secondCashier = await addEmployee(app, company, "Kassir");
    expect((await sell({}, secondCashier.cookie)).statusCode).toBe(403);
  });

  it("smenani yopish: kassa farqi, qayta yopish va yopiq smenada sotuv rad; begona smena", async () => {
    const kassir = await addEmployee(app, company, "Kassir");
    const shift = await openShift(kassir.cookie, "50000");
    await pos("POST", "/sales", kassir.cookie, { shiftId: shift.id, items: [{ productId, quantity: "1" }], amountPaid: "5000" });

    const secondCashier = await addEmployee(app, company, "Kassir");
    expect((await pos("POST", `/shifts/${shift.id}/close`, secondCashier.cookie, { closingCash: "55000" })).statusCode).toBe(403);

    const closed = await pos("POST", `/shifts/${shift.id}/close`, kassir.cookie, { closingCash: "54000" });
    expect(closed.statusCode).toBe(200);
    expect(closed.json()).toMatchObject({
      expectedCash: "55000.00",
      difference: "-1000.00",
      shift: { status: "closed", closingCash: "54000.00" },
    });

    expect((await pos("POST", `/shifts/${shift.id}/close`, kassir.cookie, { closingCash: "54000" })).statusCode).toBe(400);
    const afterClose = await pos("POST", "/sales", kassir.cookie, { shiftId: shift.id, items: [{ productId, quantity: "1" }], amountPaid: "5000" });
    expect(afterClose.statusCode).toBe(400);
    expect((await pos("GET", `/shifts/${shift.id}`, other.ownerCookie)).statusCode).toBe(404);

    await openShift(kassir.cookie);
  });
});
