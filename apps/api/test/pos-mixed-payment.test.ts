import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { accounts, cashAccounts, cashTransactions } from "../src/db/schema/finance.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { customerPayments, salesOrderItems, salesOrders, salesReturns } from "../src/db/schema/sales.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
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
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  const cash = await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId));
  mainCash = cash.find((c) => c.type === "cash")!.id;
  mainBank = cash.find((c) => c.type === "bank")!.id;
  const product = await call(company.ownerCookie, "POST", "/api/catalog/products", { name: "Choy", sku: "CHOY", baseUnitId: piece, salesPrice: "5000", taxRate: "0" });
  productId = product.json().product.id;
  await call(company.ownerCookie, "POST", "/api/inventory/stock/movements", { type: "receive", productId, warehouseId: mainWh, quantity: "40", costPrice: "3000" });
});

function call(cookie: string, method: "GET" | "POST", url: string, payload?: object) {
  return app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
}
const pos = (method: "GET" | "POST", url: string, cookie: string, payload?: object) => call(cookie, method, `/api/sales/pos${url}`, payload);

async function ledger(code: string) {
  const [row] = await db.select().from(accounts).where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, code)));
  return row!.balance;
}
async function balanceOf(id: string) {
  const [row] = await db.select().from(cashAccounts).where(eq(cashAccounts.id, id));
  return row!.balance;
}
async function openShift(cookie: string) {
  const res = await pos("POST", "/shifts", cookie, { warehouseId: mainWh, openingCash: "100000" });
  expect(res.statusCode).toBe(201);
  return res.json().shift as { id: string };
}
const shiftOf = async (cookie: string, id: string) => (await pos("GET", `/shifts/${id}`, cookie)).json().shift as Record<string, unknown>;
const MIXED = [
  { method: "cash", amount: "10000" },
  { method: "card", amount: "7000" },
  { method: "bank", amount: "3000" },
];

describe("POS: aralash to'lov (naqd + karta + bank)", () => {
  it("qismlar, qaytim faqat naqddan, ortiqcha karta/bank va qoldiq rad, idempotentlik, kassa/bank, jurnal, smena yig'indilari", async () => {
    const kassir = await addEmployee(app, company, "Kassir");
    const shift = await openShift(kassir.cookie);
    const sell = (body: object) => pos("POST", "/sales", kassir.cookie, { shiftId: shift.id, items: [{ productId, quantity: "4" }], ...body });

    // 4 × 5000 = 20000
    expect((await sell({ payments: [{ method: "card", amount: "15000" }, { method: "bank", amount: "6000" }] })).statusCode).toBe(400);
    expect((await sell({ payments: [{ method: "cash", amount: "5000" }, { method: "card", amount: "5000" }] })).statusCode).toBe(400);
    expect((await sell({ payments: [{ method: "cash", amount: "10000" }, { method: "cash", amount: "10000" }] })).statusCode).toBe(400);
    expect((await sell({})).statusCode).toBe(400);
    expect(await db.select().from(salesOrders).where(eq(salesOrders.companyId, company.companyId))).toHaveLength(0);

    // Aralash to'lovda ortiqcha to'lov (22000 > 20000) rad — qaytim faqat bitta naqd to'lovda; hech narsa yozilmaydi
    const clientRequestId = randomUUID();
    const overpaid = await sell({
      clientRequestId,
      payments: [
        { method: "cash", amount: "12000" },
        { method: "card", amount: "7000" },
        { method: "bank", amount: "3000" },
      ],
    });
    expect(overpaid.statusCode).toBe(400);
    expect(overpaid.json()).toMatchObject({ details: { reason: "overpayment", total: "20000.00", paid: "22000.00" } });
    expect(await db.select().from(salesOrders).where(eq(salesOrders.companyId, company.companyId))).toHaveLength(0);

    const payments = MIXED;
    const mixed = await sell({ clientRequestId, payments });
    expect(mixed.statusCode).toBe(201);
    expect(mixed.json()).toMatchObject({
      paid: "20000.00",
      change: "0.00",
      debt: "0.00",
      payments: [
        { method: "cash", amount: "10000.00" },
        { method: "card", amount: "7000.00" },
        { method: "bank", amount: "3000.00" },
      ],
    });
    const orderId = mixed.json().order.id as string;
    const rows = await db.select({ method: customerPayments.method, amount: customerPayments.amount }).from(customerPayments).where(eq(customerPayments.orderId, orderId));
    expect(rows.map((row) => `${row.method}:${row.amount}`).sort()).toEqual(["bank:3000.00", "card:7000.00", "cash:10000.00"]);
    expect(await balanceOf(mainCash)).toBe("10000.00");
    expect(await balanceOf(mainBank)).toBe("10000.00");
    expect(await ledger("1010")).toBe("10000.00");
    expect(await ledger("1020")).toBe("10000.00");
    expect(await ledger("1100")).toBe("0.00");
    expect(await ledger("4000")).toBe("20000.00");

    // Takroriy yuborish (tarmoq uzilib qayta bosildi) — ikkinchi chek, to'lov va jurnal yo'q
    const again = await sell({ clientRequestId, payments });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: "CONFLICT", details: { duplicate: true, orderId } });
    expect(await balanceOf(mainCash)).toBe("10000.00");
    expect(await shiftOf(kassir.cookie, shift.id)).toMatchObject({
      totalSales: "20000.00",
      totalCash: "10000.00",
      totalCard: "7000.00",
      totalBank: "3000.00",
      receiptCount: 1,
      expectedCash: "110000.00",
    });

    // Eski usul (bitta usul) o'zgarmagan; bank tushumi smenada endi ko'rinadi
    expect((await sell({ items: [{ productId, quantity: "1" }], paymentMethod: "bank", amountPaid: "5000" })).statusCode).toBe(201);
    expect((await sell({ items: [{ productId, quantity: "1" }], paymentMethod: "cash", amountPaid: "6000" })).json()).toMatchObject({ change: "1000.00", payments: [{ method: "cash", amount: "5000.00" }] });
    expect(await shiftOf(kassir.cookie, shift.id)).toMatchObject({ totalBank: "8000.00", totalCash: "15000.00", receiptCount: 3 });
  });

  it("qaytarish: taqsimot, usul chegarasi va yig'indi tekshiruvi; to'liq qaytarishda asl tarkib bo'yicha", async () => {
    const kassir = await addEmployee(app, company, "Kassir");
    const shift = await openShift(kassir.cookie);
    const sell = () => pos("POST", "/sales", kassir.cookie, { shiftId: shift.id, items: [{ productId, quantity: "4" }], payments: MIXED });
    const orderId = (await sell()).json().order.id as string;
    const [line] = await db.select().from(salesOrderItems).where(eq(salesOrderItems.orderId, orderId));
    const returnItems = (quantity: string, refunds: object[]) =>
      call(company.ownerCookie, "POST", `/api/sales/orders/${orderId}/return-items`, { items: [{ orderItemId: line!.id, quantity }], shiftId: shift.id, refunds });

    // 2 dona = 10000 qaytadi
    expect((await returnItems("2", [{ method: "cash", amount: "5000" }])).statusCode).toBe(400);
    expect((await returnItems("2", [{ method: "bank", amount: "5000" }, { method: "cash", amount: "5000" }])).json().message).toContain("Bank");
    expect((await returnItems("2", [{ method: "cash", amount: "5000" }, { method: "cash", amount: "5000" }])).statusCode).toBe(400);

    const first = await returnItems("2", [
      { method: "cash", amount: "4000" },
      { method: "card", amount: "6000" },
    ]);
    expect(first.statusCode).toBe(201);
    expect(first.json().return).toMatchObject({
      refundMethod: "mixed",
      refundAmount: "10000.00",
      refunds: [
        { method: "cash", amount: "4000.00" },
        { method: "card", amount: "6000.00" },
      ],
    });
    expect(await balanceOf(mainCash)).toBe("6000.00");
    expect(await balanceOf(mainBank)).toBe("4000.00");
    expect(await ledger("1010")).toBe("6000.00");
    expect(await ledger("1020")).toBe("4000.00");
    expect(await shiftOf(kassir.cookie, shift.id)).toMatchObject({ totalReturns: "10000.00", totalCash: "6000.00", totalCard: "1000.00", totalBank: "3000.00" });

    // Qolgan 2 dona: kartada faqat 1000 qolgan
    expect((await returnItems("2", [{ method: "cash", amount: "6000" }, { method: "card", amount: "2000" }, { method: "bank", amount: "2000" }])).json().message).toContain("Karta");
    expect(
      (await returnItems("2", [{ method: "cash", amount: "6000" }, { method: "card", amount: "1000" }, { method: "bank", amount: "3000" }])).statusCode,
    ).toBe(201);
    expect(await balanceOf(mainCash)).toBe("0.00");
    expect(await balanceOf(mainBank)).toBe("0.00");
    expect(await shiftOf(kassir.cookie, shift.id)).toMatchObject({ totalCash: "0.00", totalCard: "0.00", totalBank: "0.00" });
    expect(await db.select({ refunds: salesReturns.refunds }).from(salesReturns).where(eq(salesReturns.orderId, orderId))).toHaveLength(2);

    // To'liq qaytarish (usul ko'rsatilmagan) — asl tarkib: naqd kassaga, karta va bank bankdan; asl chek to'lovlari o'zgarmaydi
    const secondId = (await sell()).json().order.id as string;
    expect(await balanceOf(mainBank)).toBe("10000.00");
    const full = await call(company.ownerCookie, "POST", `/api/sales/orders/${secondId}/return`, {});
    expect(full.statusCode).toBe(200);
    expect(full.json()).toMatchObject({ refunded: "20000.00" });
    expect(await balanceOf(mainCash)).toBe("0.00");
    expect(await balanceOf(mainBank)).toBe("0.00");
    const refundMoves = await db
      .select({ type: cashTransactions.type, amount: cashTransactions.amount, referenceType: cashTransactions.referenceType })
      .from(cashTransactions)
      .where(and(eq(cashTransactions.referenceId, secondId), eq(cashTransactions.type, "out")));
    expect(refundMoves.map((move) => `${move.referenceType}:${move.amount}`).sort()).toEqual([
      "sales_refund_bank:3000.00",
      "sales_refund_card:7000.00",
      "sales_refund_cash:10000.00",
    ]);
    expect(await db.select().from(customerPayments).where(eq(customerPayments.orderId, secondId))).toHaveLength(3);
    expect(await shiftOf(kassir.cookie, shift.id)).toMatchObject({ totalCash: "0.00", totalCard: "0.00", totalBank: "0.00" });
  });

  it("offline kassa: sale.complete va sale.return tarkib bilan; offline taqsimot yig'indisi server hisobiga moslanadi", async () => {
    const kassir = await addEmployee(app, company, "Kassir");
    const registered = await app.inject({
      method: "POST",
      url: "/api/pos-device/setup/register",
      payload: { phone: company.owner.phone, password: company.owner.password, warehouseId: mainWh, name: "Kassa 1" },
    });
    const token = (registered.json() as { token: string }).token;
    const push = async (ops: object[]) => {
      const res = await app.inject({ method: "POST", url: "/api/pos-device/push", headers: { authorization: `Bearer ${token}` }, payload: { ops } });
      expect(res.statusCode).toBe(200);
      return res.json().results as { status: string; result?: Record<string, unknown>; error?: { message: string } }[];
    };
    const op = (type: string, payload: object, minutesAgo = 1, cashierId = kassir.id) => ({
      opId: randomUUID(),
      type,
      cashierId,
      createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
      payload,
    });
    const shiftId = randomUUID();
    expect((await push([op("shift.open", { shiftId, openingCash: "0" }, 30)]))[0]!.status).toBe("applied");

    const saleId = randomUUID();
    const itemId = randomUUID();
    const [sold] = await push([
      op(
        "sale.complete",
        {
          saleId,
          shiftId,
          number: "K01-000001",
          items: [{ id: itemId, productId, unitId: piece, quantity: "4", unitPrice: "5000" }],
          paymentMethod: "cash",
          amountPaid: "20000",
          payments: MIXED,
        },
        20,
      ),
    ]);
    expect(sold).toMatchObject({ status: "applied", result: { paid: "20000.00", payments: expect.arrayContaining([{ method: "bank", amount: "3000.00" }]) } });

    // Qurilma taqsimoti 6000 (taxminiy), server hisobida 10000 — offline'da rad etilmaydi, ulush bo'yicha.
    // Qaytarishni `sales.refund` ruxsati bor kassir (kompaniya egasi) qiladi
    const owner = company.owner.id;
    const [returned] = await push([
      op(
        "sale.return",
        {
          returnId: randomUUID(),
          orderId: saleId,
          shiftId,
          number: "K01-Q000001",
          items: [{ orderItemId: itemId, quantity: "2" }],
          refundMethod: "cash",
          refunds: [
            { method: "cash", amount: "3000" },
            { method: "card", amount: "3000" },
          ],
        },
        10,
        owner,
      ),
    ]);
    expect(returned).toMatchObject({ status: "applied", result: { refundMethod: "mixed", refundAmount: "10000.00" } });
    const [row] = await db.select({ refunds: salesReturns.refunds }).from(salesReturns).where(eq(salesReturns.orderId, saleId));
    // Hujjatda qaysi hisobdan qaytgani: naqd — kassadan, karta — sotuvda tushgan bank hisobidan
    expect(row!.refunds).toEqual([
      { method: "cash", amount: "5000.00", cashAccountId: mainCash },
      { method: "card", amount: "5000.00", cashAccountId: mainBank },
    ]);
  });
});
