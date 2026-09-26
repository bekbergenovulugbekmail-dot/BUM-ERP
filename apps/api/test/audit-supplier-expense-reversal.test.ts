/**
 * AUDIT AUD-013 — ta'minotchi to'lovini va to'langan xarajatni BEKOR QILISH.
 * Hech narsa o'chirilmaydi: teskari yozuvlar (kassa, jurnal, bank komissiyasi, buyurtma, ta'minotchi balansi),
 * holat `reversed`, sabab majburiy, qayta bekor qilish — 409, `finance.approve`. Har qadamda aylanma balans teng.
 */
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { accounts, cashAccounts, expenses, journalEntries, journalLines } from "../src/db/schema/finance.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { supplierPayments, suppliers } from "../src/db/schema/purchase.js";
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

const localIso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const today = localIso(new Date());

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
  company = await createCompany(app, admin.cookie, { name: "To'lov kompaniyasi" });
  other = await createCompany(app, admin.cookie, { name: "Boshqa kompaniya" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  const cash = await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId));
  mainCash = cash.find((c) => c.type === "cash")!.id;
  mainBank = cash.find((c) => c.type === "bank")!.id;
});

const call = (cookie: string, method: "GET" | "POST" | "PATCH", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
const pay = (body: object, cookie = company.ownerCookie) => call(cookie, "POST", "/api/purchase/payments", body);

async function ledger(code: string) {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, code)));
  return row!;
}

async function balanceOf(cashAccountId: string) {
  const [row] = await db.select().from(cashAccounts).where(eq(cashAccounts.id, cashAccountId));
  return row!.balance;
}

async function debtOf(supplierId: string) {
  const [row] = await db.select().from(suppliers).where(eq(suppliers.id, supplierId));
  return row!.totalDebt;
}

async function fund(cashAccountId: string, amount: string) {
  const capital = await ledger("3000");
  const res = await call(company.ownerCookie, "POST", "/api/finance/cash-transactions", {
    cashAccountId,
    type: "in",
    amount,
    description: "Kirim",
    counterAccountId: capital.id,
  });
  expect(res.statusCode).toBe(201);
}

let seq = 0;
async function setup(options: { qty: string; price: string; receive?: boolean; confirm?: boolean; supplierId?: string }) {
  seq += 1;
  const productRes = await call(company.ownerCookie, "POST", "/api/catalog/products", { name: `P ${seq}`, sku: `P-${seq}`, baseUnitId: piece });
  const supplierId =
    options.supplierId ??
    (await call(company.ownerCookie, "POST", "/api/purchase/suppliers", { name: `S ${seq}`, code: `S-${seq}` })).json().supplier.id;
  const orderRes = await call(company.ownerCookie, "POST", "/api/purchase/orders", {
    supplierId,
    warehouseId: mainWh,
    orderDate: today,
    items: [{ productId: productRes.json().product.id, unitId: piece, orderedQty: options.qty, unitPrice: options.price }],
  });
  let order = orderRes.json().order;
  if (options.confirm !== false) {
    order = (await call(company.ownerCookie, "POST", `/api/purchase/orders/${order.id}/confirm`)).json().order;
  }
  if (options.receive) {
    const received = await call(company.ownerCookie, "POST", `/api/purchase/orders/${order.id}/receipts`, {
      items: [{ orderItemId: order.items[0].id, receivedQty: options.qty }],
    });
    expect(received.statusCode).toBe(201);
  }
  return { order, supplierId: supplierId as string };
}

const getOrder = async (orderId: string) =>
  (await call(company.ownerCookie, "GET", `/api/purchase/orders/${orderId}`)).json().order;


async function expectTrialBalance() {
  const [row] = await db
    .select({
      debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)::numeric(18,2)`,
      credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)::numeric(18,2)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(eq(journalLines.companyId, company.companyId), eq(journalEntries.status, "posted")));
  expect(row!.debit).toBe(row!.credit);
}

const reverse = (paymentId: string, reason = "Xato kiritilgan", cookie = company.ownerCookie) =>
  call(cookie, "POST", `/api/purchase/payments/${paymentId}/reverse`, { reason });

describe("AUD-013: ta'minotchi to'lovini bekor qilish", () => {
  it("kassadan to'lov: pul qaytadi, qarz tiklanadi, buyurtma 'paid' → 'received', jurnal teskari; qayta bekor — 409", async () => {
    await fund(mainCash, "1000000");
    const { order, supplierId } = await setup({ qty: "10", price: "1000", receive: true });
    const payableBefore = (await ledger("2000")).balance;
    const paid = await pay({ supplierId, orderId: order.id, amount: "10000", method: "cash" });
    expect(paid.statusCode, paid.body).toBe(201);
    const paymentId = paid.json().payment.id as string;
    expect((await getOrder(order.id)).status).toBe("paid");
    expect(await debtOf(supplierId)).toBe("0.00");
    expect(await balanceOf(mainCash)).toBe("990000.00");

    const preview = await call(company.ownerCookie, "GET", `/api/purchase/payments/${paymentId}/reversal`);
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().blockers).toEqual([]);

    const res = await reverse(paymentId);
    expect(res.statusCode, res.body).toBe(200);
    expect(await balanceOf(mainCash)).toBe("1000000.00");
    expect(await debtOf(supplierId)).toBe("10000.00");
    const after = await getOrder(order.id);
    expect(after.status).toBe("received");
    expect(Number(after.paidAmount)).toBe(0);
    expect((await ledger("2000")).balance, "kreditorlar tiklandi").toBe(payableBefore);
    const [row] = await db.select().from(supplierPayments).where(eq(supplierPayments.id, paymentId));
    expect(row).toMatchObject({ status: "reversed", reversalReason: "Xato kiritilgan" });
    await expectTrialBalance();

    expect((await reverse(paymentId)).statusCode).toBe(409);
    // Bekor qilingandan keyin qayta to'lash mumkin (qarz qaytgan)
    expect((await pay({ supplierId, orderId: order.id, amount: "10000", method: "cash" })).statusCode).toBe(201);
    await expectTrialBalance();
  });

  it("bankdan to'lov komissiya bilan: komissiya ham qaytadi, uning xarajati 'reversed'", async () => {
    expect((await call(company.ownerCookie, "PATCH", `/api/finance/cash-accounts/${mainBank}`, { outgoingCommissionPercent: "1" })).statusCode).toBe(200);
    await fund(mainBank, "100000");
    const { order, supplierId } = await setup({ qty: "5", price: "1000", receive: true });
    const paid = await pay({ supplierId, orderId: order.id, amount: "5000", method: "bank", cashAccountId: mainBank });
    expect(paid.statusCode, paid.body).toBe(201);
    expect(await balanceOf(mainBank), "5000 + 1% komissiya").toBe("94950.00");
    const feeExpenses = await db.select().from(expenses).where(and(eq(expenses.companyId, company.companyId), eq(expenses.referenceType, "supplier_payment")));
    expect(feeExpenses).toHaveLength(1);

    expect((await reverse(paid.json().payment.id)).statusCode).toBe(200);
    expect(await balanceOf(mainBank)).toBe("100000.00");
    const [fee] = await db.select().from(expenses).where(eq(expenses.id, feeExpenses[0]!.id));
    expect(fee!.status).toBe("reversed");
    expect((await ledger("5800")).balance, "komissiya xarajati qaytdi").toBe("0.00");
    await expectTrialBalance();
  });

  it("ruxsat: finance.approve siz bekor qilinmaydi; begona kompaniya to'lovi topilmaydi", async () => {
    await fund(mainCash, "100000");
    const { order, supplierId } = await setup({ qty: "1", price: "1000", receive: true });
    const paid = await pay({ supplierId, orderId: order.id, amount: "1000", method: "cash" });
    const storekeeper = await addEmployee(app, company, "Omborchi");
    expect((await reverse(paid.json().payment.id, "sabab", storekeeper.cookie)).statusCode).toBe(403);
    expect((await reverse(paid.json().payment.id, "sabab", other.ownerCookie)).statusCode).toBe(404);
    expect(await balanceOf(mainCash)).toBe("99000.00");
  });
});

describe("AUD-013: to'langan xarajatni bekor qilish", () => {
  const expenseCall = (method: "GET" | "POST", url: string, payload?: object, cookie = company.ownerCookie) => call(cookie, method, `/api/finance${url}`, payload);

  it("pul kassaga qaytadi, xarajat 'reversed', statistika va hisobotdan chiqadi; to'lanmagani bekor qilinmaydi", async () => {
    await fund(mainCash, "500000");
    const created = await expenseCall("POST", "/expenses", { category: "Ijara", description: "Sentabr ijarasi", amount: "200000", expenseDate: today });
    expect(created.statusCode, created.body).toBe(201);
    const expenseId = created.json().expense.id as string;
    expect((await expenseCall("POST", `/expenses/${expenseId}/reverse`, { reason: "Hali to'lanmagan" })).statusCode, "kutilayotgan").toBe(400);
    expect((await expenseCall("POST", `/expenses/${expenseId}/status`, { status: "approved" })).statusCode).toBe(200);
    const paid = await expenseCall("POST", `/expenses/${expenseId}/status`, { status: "paid", cashAccountId: mainCash });
    expect(paid.statusCode, paid.body).toBe(200);
    expect(await balanceOf(mainCash)).toBe("300000.00");
    const statsBefore = (await expenseCall("GET", "/expenses/stats")).json();
    expect(Number(statsBefore.totalThisMonth)).toBe(200000);

    const preview = await expenseCall("GET", `/expenses/${expenseId}/reversal`);
    expect(preview.json().blockers).toEqual([]);
    const res = await expenseCall("POST", `/expenses/${expenseId}/reverse`, { reason: "Ikki marta kiritilgan" });
    expect(res.statusCode, res.body).toBe(200);
    expect(await balanceOf(mainCash)).toBe("500000.00");
    const [row] = await db.select().from(expenses).where(eq(expenses.id, expenseId));
    expect(row).toMatchObject({ status: "reversed", reversalReason: "Ikki marta kiritilgan" });
    expect(Number((await expenseCall("GET", "/expenses/stats")).json().totalThisMonth), "statistikadan chiqdi").toBe(0);
    await expectTrialBalance();
    expect((await expenseCall("POST", `/expenses/${expenseId}/reverse`, { reason: "yana bir bor" })).statusCode).toBe(409);
    // Holat o'zgartirish yo'li bilan qayta "paid"/"approved" qilib bo'lmaydi
    expect((await expenseCall("POST", `/expenses/${expenseId}/status`, { status: "approved" })).statusCode).toBe(400);
  });

  it("vazifalar ajratimi: kiritgan xodim o'zi bekor qilmaydi", async () => {
    await fund(mainCash, "100000");
    const accountant = await addEmployee(app, company, "Buxgalter");
    const created = await expenseCall("POST", "/expenses", { category: "Transport", description: "Taksi", amount: "20000", expenseDate: today }, accountant.cookie);
    expect(created.statusCode, created.body).toBe(201);
    const expenseId = created.json().expense.id as string;
    expect((await expenseCall("POST", `/expenses/${expenseId}/status`, { status: "approved" })).statusCode).toBe(200);
    expect((await expenseCall("POST", `/expenses/${expenseId}/status`, { status: "paid", cashAccountId: mainCash })).statusCode).toBe(200);
    const own = await expenseCall("POST", `/expenses/${expenseId}/reverse`, { reason: "O'zim" }, accountant.cookie);
    expect(own.statusCode, own.body).toBe(403);
    expect((await expenseCall("POST", `/expenses/${expenseId}/reverse`, { reason: "Rahbar bekor qildi" })).statusCode).toBe(200);
  });
});
