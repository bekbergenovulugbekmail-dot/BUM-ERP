/**
 * QABUL TESTI — universal to'lov arxitekturasi: pul KIRIMI va CHIQIMI bitta qoidalar to'plami bilan.
 *
 * Har bir ssenariyda tekshiriladi:
 *   - buxgalteriya balanslangan (kompaniya bo'yicha jami debet = jami kredit)
 *   - summa to'g'ri va AYNAN bog'langan hisobga tushgan/chiqqan (UZCARD → o'z banki, HUMO → boshqa bank)
 *   - takroriy yuborishda ikkinchi to'lov yozilmaydi
 *   - bir modulning to'lovi boshqa modul biznes ma'nosini o'zgartirmaydi
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { accounts, cashAccounts, journalLines } from "../src/db/schema/finance.js";
import { supplierPayments } from "../src/db/schema/purchase.js";
import { customerPayments, customers, salesOrders } from "../src/db/schema/sales.js";
import { buildServer } from "../src/server.js";
import {
  NO_PROOFS,
  agentAction,
  arrivedTask,
  caller,
  deliveryAgent,
  deliveryCompany,
  resetUnits,
  setPolicy,
  startShift,
  near,
  type DeliveryCompany,
} from "./delivery-setup.js";
import { addEmployee, resetDatabase, signedIn } from "./helpers.js";

let app: FastifyInstance;
let call: ReturnType<typeof caller>;
let adminCookie: string;
let company: DeliveryCompany;
let piece: string;
let mainCash: string;
let mainBank: string;
let secondBank: string;
let uzcard: { id: string; cashAccountId: string };
let humo: { id: string; cashAccountId: string };

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
  call = caller(app);
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

beforeEach(async () => {
  await resetDatabase();
  await resetUnits();
  adminCookie = (await signedIn(app, { isPlatformAdmin: true })).cookie;
  company = await deliveryCompany(app, adminCookie, "To'lov do'koni");
  piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;

  const rows = await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId));
  mainCash = rows.find((row) => row.type === "cash")!.id;
  mainBank = rows.find((row) => row.type === "bank")!.id;
  const bank = await call(owner(), "POST", "/api/finance/cash-accounts", { name: "Ikkinchi bank", type: "bank", bankName: "Hamkorbank" });
  expect(bank.statusCode, bank.body).toBe(201);
  secondBank = bank.json().cashAccount.id;

  uzcard = (await call(owner(), "POST", "/api/finance/terminals", {
    name: "UZCARD-01",
    network: "uzcard",
    cashAccountId: mainBank,
  })).json().terminal;
  humo = (await call(owner(), "POST", "/api/finance/terminals", {
    name: "HUMO-01",
    network: "humo",
    cashAccountId: secondBank,
  })).json().terminal;
});

const owner = () => company.ownerCookie;

const balanceOf = async (id: string) =>
  (await db.select({ balance: cashAccounts.balance }).from(cashAccounts).where(eq(cashAccounts.id, id)))[0]!.balance;
const debtOf = async (customerId: string) =>
  (await db.select({ totalDebt: customers.totalDebt }).from(customers).where(eq(customers.id, customerId)))[0]!.totalDebt;

/** Buxgalteriya invarianti: kompaniya bo'yicha jami debet = jami kredit. */
async function expectBalanced() {
  const [row] = await db
    .select({
      debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)::numeric(18,2)`,
      credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)::numeric(18,2)`,
    })
    .from(journalLines)
    .where(eq(journalLines.companyId, company.companyId));
  expect(row!.debit, "buxgalteriya balanslanmagan").toBe(row!.credit);
  return row!;
}

async function openShift() {
  const kassir = await addEmployee(app, company, "Kassir");
  const res = await call(kassir.cookie, "POST", "/api/sales/pos/shifts", { warehouseId: company.warehouseId, openingCash: "0" });
  expect(res.statusCode, res.body).toBe(201);
  return { cookie: kassir.cookie, shiftId: res.json().shift.id as string };
}

/** 20 dona × 5 000 = 100 000 so'mlik kassa cheki. */
const sell = (cookie: string, shiftId: string, payload: object) =>
  call(cookie, "POST", "/api/sales/pos/sales", { shiftId, items: [{ productId: company.productId, quantity: "20" }], ...payload });

/** Ta'minotchi + unga qarz (to'lash uchun). */
async function supplierWithDebt(totalDebt: string) {
  const created = await call(owner(), "POST", "/api/purchase/suppliers", { name: `Ta'minotchi ${randomUUID().slice(0, 8)}`, code: `S-${randomUUID().slice(0, 6)}` });
  expect(created.statusCode, created.body).toBe(201);
  const supplierId = created.json().supplier.id as string;
  const debt = await call(owner(), "POST", `/api/purchase/suppliers/${supplierId}/set-debt`, { totalDebt, reason: "Boshlang'ich qarz" });
  expect(debt.statusCode, debt.body).toBe(200);
  return supplierId;
}

/** Tasdiqlangan xarajat (to'lashga tayyor). */
async function approvedExpense(amount: string) {
  const created = await call(owner(), "POST", "/api/finance/expenses", {
    category: "boshqa",
    description: "Ijara",
    amount,
    expenseDate: new Date().toISOString().slice(0, 10),
  });
  expect(created.statusCode, created.body).toBe(201);
  const id = created.json().expense.id as string;
  expect((await call(owner(), "POST", `/api/finance/expenses/${id}/status`, { status: "approved" })).statusCode).toBe(200);
  return id;
}

/** Chiquvchi to'lovni sinash uchun hisobga boshlang'ich qoldiq (tizim manfiy qoldiqqa ruxsat bermaydi). */
async function fund(accountId: string, balance: string) {
  const res = await call(owner(), "POST", `/api/finance/cash-accounts/${accountId}/set-balance`, {
    balance,
    reason: "Sinov uchun boshlang'ich qoldiq",
  });
  expect(res.statusCode, res.body).toBe(200);
}

const payExpense = (id: string, body: object) => call(owner(), "POST", `/api/finance/expenses/${id}/status`, { status: "paid", ...body });
const paySupplier = (body: object, cookie = owner()) => call(cookie, "POST", "/api/purchase/payments", body);

// ─── 1–4. Pul kirimi: kassa ──────────────────────────────────────────────────

describe("Pul kirimi — kassa cheki", () => {
  it("1. naqd: pul kassaga, buxgalteriya balanslangan", async () => {
    const { cookie, shiftId } = await openShift();
    const sale = await sell(cookie, shiftId, { paymentMethod: "cash", amountPaid: "100000" });
    expect(sale.statusCode, sale.body).toBe(201);

    expect(await balanceOf(mainCash)).toBe("100000.00");
    expect(await balanceOf(mainBank)).toBe("0.00");
    await expectBalanced();
  });

  it("2. UZCARD: pul terminalga bog'langan bankka tushadi, kassaga emas", async () => {
    const { cookie, shiftId } = await openShift();
    const sale = await sell(cookie, shiftId, { payments: [{ method: "card", amount: "100000", terminalId: uzcard.id }] });
    expect(sale.statusCode, sale.body).toBe(201);

    expect(await balanceOf(mainBank)).toBe("100000.00");
    expect(await balanceOf(mainCash)).toBe("0.00");
    expect(await balanceOf(secondBank)).toBe("0.00");
    await expectBalanced();
  });

  it("3. naqd + UZCARD: har qism o'z hisobiga", async () => {
    const { cookie, shiftId } = await openShift();
    const sale = await sell(cookie, shiftId, {
      payments: [
        { method: "cash", amount: "50000" },
        { method: "card", amount: "50000", terminalId: uzcard.id },
      ],
    });
    expect(sale.statusCode, sale.body).toBe(201);

    expect(await balanceOf(mainCash)).toBe("50000.00");
    expect(await balanceOf(mainBank)).toBe("50000.00");
    await expectBalanced();
  });

  it("4. naqd + UZCARD + bank: uch qism, uch hisob; HUMO boshqa bankka", async () => {
    const { cookie, shiftId } = await openShift();
    const sale = await sell(cookie, shiftId, {
      payments: [
        { method: "cash", amount: "30000" },
        { method: "card", amount: "40000", terminalId: uzcard.id },
        { method: "card", amount: "30000", terminalId: humo.id },
      ],
    });
    expect(sale.statusCode, sale.body).toBe(201);

    expect(await balanceOf(mainCash)).toBe("30000.00");
    expect(await balanceOf(mainBank)).toBe("40000.00");
    expect(await balanceOf(secondBank)).toBe("30000.00");
    const { debit } = await expectBalanced();
    expect(Number(debit)).toBeGreaterThan(0);
  });
});

// ─── 5–7. Mijoz to'lovlari ───────────────────────────────────────────────────

describe("Mijoz to'lovlari", () => {
  it("5. balansga naqd kirim", async () => {
    const { cookie, shiftId } = await openShift();
    const res = await call(cookie, "POST", `/api/sales/pos/customers/${company.customerId}/payments`, {
      shiftId,
      purpose: "deposit",
      amount: "100000",
      method: "cash",
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().customer.balance).toBe("100000.00");
    expect(await balanceOf(mainCash)).toBe("100000.00");
    await expectBalanced();
  });

  it("6. balansga aralash kirim (naqd + UZCARD + HUMO)", async () => {
    const { cookie, shiftId } = await openShift();
    const res = await call(cookie, "POST", `/api/sales/pos/customers/${company.customerId}/payments`, {
      shiftId,
      purpose: "deposit",
      parts: [
        { method: "cash", amount: "30000" },
        { method: "card", amount: "40000", terminalId: uzcard.id },
        { method: "card", amount: "30000", terminalId: humo.id },
      ],
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().customer.balance).toBe("100000.00");
    expect(await balanceOf(mainCash)).toBe("30000.00");
    expect(await balanceOf(mainBank)).toBe("40000.00");
    expect(await balanceOf(secondBank)).toBe("30000.00");
    await expectBalanced();
  });

  it("7. qarzni aralash to'lash — sotuv holati O'ZGARMAYDI", async () => {
    const { cookie, shiftId } = await openShift();
    const credit = await sell(cookie, shiftId, {
      customerId: company.customerId,
      paymentMethod: "cash",
      amountPaid: "0",
      onCredit: true,
    });
    expect(credit.statusCode, credit.body).toBe(201);
    const orderId = credit.json().order.id as string;
    expect(await debtOf(company.customerId)).toBe("100000.00");

    const paid = await call(owner(), "POST", "/api/sales/payments", {
      orderId,
      parts: [
        { method: "cash", amount: "60000" },
        { method: "card", amount: "40000", terminalId: uzcard.id },
      ],
    });
    expect(paid.statusCode, paid.body).toBe(201);

    expect(await debtOf(company.customerId)).toBe("0.00");
    expect(await balanceOf(mainCash)).toBe("60000.00");
    expect(await balanceOf(mainBank)).toBe("40000.00");
    const order = (await call(owner(), "GET", `/api/sales/orders/${orderId}`)).json().order;
    expect(order).toMatchObject({ status: "completed", paymentStatus: "paid", deliveryStatus: null });
    await expectBalanced();
  });
});

// ─── 8. Yetkazishda inkassatsiya ─────────────────────────────────────────────

describe("Yetkazishda inkassatsiya", () => {
  it("8. dostavshik aralash yig'adi — pul hisoblarga, yetkazma holati alohida", async () => {
    await setPolicy(app, owner(), NO_PROOFS);
    const agent = await deliveryAgent(app, company);
    await startShift(app, agent.cookie);
    const { taskId, orderId } = await arrivedTask(app, company, agent, "20");

    const collected = await agentAction(app, agent.cookie, taskId, "payments", {
      parts: [
        { method: "cash", amount: "60000" },
        { method: "card", amount: "40000", terminalId: uzcard.id },
      ],
    });
    expect(collected.statusCode, collected.body).toBe(201);
    expect(collected.json().task.collectedAmount).toBe("100000.00");

    // Karta qismi terminal bankiga, naqd esa dostavshikning "yo'ldagi naqd" hisobiga (asosiy kassaga emas)
    expect(await balanceOf(mainBank)).toBe("40000.00");
    expect(await balanceOf(mainCash)).toBe("0.00");
    expect((await call(owner(), "GET", `/api/sales/orders/${orderId}`)).json().order).toMatchObject({
      status: "completed",
      paymentStatus: "paid",
    });
    await expectBalanced();
  });
});

// ─── 9–11, 14. Pul chiqimi: ta'minotchi ──────────────────────────────────────

describe("Ta'minotchiga to'lov", () => {
  it("9. naqd: kassadan chiqadi, qarz kamayadi", async () => {
    const supplierId = await supplierWithDebt("100000");
    await fund(mainCash, "100000");
    const res = await paySupplier({ supplierId, amount: "100000", method: "cash" });
    expect(res.statusCode, res.body).toBe(201);

    expect(await balanceOf(mainCash)).toBe("0.00");
    await expectBalanced();
  });

  it("10. UZCARD: pul terminalga bog'langan bankdan chiqadi", async () => {
    const supplierId = await supplierWithDebt("100000");
    await fund(mainBank, "100000");
    const res = await paySupplier({ supplierId, parts: [{ method: "card", amount: "100000", terminalId: uzcard.id }] });
    expect(res.statusCode, res.body).toBe(201);

    expect(await balanceOf(mainBank)).toBe("0.00");
    expect(await balanceOf(mainCash)).toBe("0.00");
    await expectBalanced();
  });

  it("11. aralash (naqd + karta + bank): har qism o'z hisobidan, qarz to'liq yopiladi", async () => {
    const supplierId = await supplierWithDebt("1000000");
    await fund(mainCash, "300000");
    await fund(mainBank, "400000");
    await fund(secondBank, "300000");
    const res = await paySupplier({
      supplierId,
      parts: [
        { method: "cash", amount: "300000" },
        { method: "card", amount: "400000", terminalId: uzcard.id },
        { method: "bank", amount: "300000", cashAccountId: secondBank },
      ],
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().total).toBe("1000000.00");
    expect(res.json().payments).toHaveLength(3);

    // Har qism AYNAN o'z hisobidan chiqdi
    expect(await balanceOf(mainCash)).toBe("0.00");
    expect(await balanceOf(mainBank)).toBe("0.00");
    expect(await balanceOf(secondBank)).toBe("0.00");
    await expectBalanced();
  });

  it("14. xarid hujjatiga aralash to'lov; qoldiqdan ortig'i rad etiladi", async () => {
    const supplierId = await supplierWithDebt("0");
    await fund(mainCash, "100000");
    await fund(secondBank, "100000");
    const created = await call(owner(), "POST", "/api/purchase/orders", {
      supplierId,
      warehouseId: company.warehouseId,
      orderDate: new Date().toISOString().slice(0, 10),
      items: [{ productId: company.productId, unitId: piece, orderedQty: "20", unitPrice: "5000" }],
    });
    expect(created.statusCode, created.body).toBe(201);
    const orderId = created.json().order.id as string;
    expect((await call(owner(), "POST", `/api/purchase/orders/${orderId}/confirm`)).statusCode).toBe(200);

    // Buyurtma qoldig'idan ortiq — rad, hech narsa yozilmaydi
    const tooMuch = await paySupplier({
      supplierId,
      orderId,
      parts: [
        { method: "cash", amount: "60000" },
        { method: "bank", amount: "60000", cashAccountId: secondBank },
      ],
    });
    expect(tooMuch.statusCode, tooMuch.body).toBe(400);
    expect(await db.select().from(supplierPayments).where(eq(supplierPayments.companyId, company.companyId))).toHaveLength(0);

    const ok = await paySupplier({
      supplierId,
      orderId,
      parts: [
        { method: "cash", amount: "40000" },
        { method: "bank", amount: "60000", cashAccountId: secondBank },
      ],
    });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(await balanceOf(mainCash)).toBe("60000.00");
    expect(await balanceOf(secondBank)).toBe("40000.00");
    await expectBalanced();
  });
});

// ─── 12–13. Pul chiqimi: xarajat ─────────────────────────────────────────────

describe("Xarajat to'lovi", () => {
  it("12. naqd: bitta hisobdan, DR xarajat / CR kassa", async () => {
    const expenseId = await approvedExpense("100000");
    await fund(mainCash, "100000");
    const res = await payExpense(expenseId, { cashAccountId: mainCash });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().expense.status).toBe("paid");

    expect(await balanceOf(mainCash)).toBe("0.00");
    await expectBalanced();
  });

  it("13. aralash (naqd + karta + bank): bitta balanslangan yozuv, uch hisobdan chiqim", async () => {
    const expenseId = await approvedExpense("500000");
    await fund(mainCash, "100000");
    await fund(mainBank, "200000");
    await fund(secondBank, "200000");
    const res = await payExpense(expenseId, {
      parts: [
        { method: "cash", amount: "100000" },
        { method: "card", amount: "200000", cashAccountId: mainBank },
        { method: "bank", amount: "200000", cashAccountId: secondBank },
      ],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().payment.parts).toBe(3);

    expect(await balanceOf(mainCash)).toBe("0.00");
    expect(await balanceOf(mainBank)).toBe("0.00");
    expect(await balanceOf(secondBank)).toBe("0.00");
    await expectBalanced();
  });

  it("13b. qismlar yig'indisi xarajat summasiga teng bo'lmasa — rad, pul chiqmaydi", async () => {
    const expenseId = await approvedExpense("500000");
    await fund(mainCash, "100000");
    await fund(secondBank, "200000");
    const short = await payExpense(expenseId, {
      parts: [
        { method: "cash", amount: "100000" },
        { method: "bank", amount: "200000", cashAccountId: secondBank },
      ],
    });
    expect(short.statusCode, short.body).toBe(400);
    expect(short.json().details).toMatchObject({ reason: "underpayment" });
    // Pul chiqmadi
    expect(await balanceOf(mainCash)).toBe("100000.00");
    expect(await balanceOf(secondBank)).toBe("200000.00");
    await expectBalanced();
  });
});

// ─── 15–16. Qaytarish ────────────────────────────────────────────────────────

describe("Qaytarish", () => {
  it("15. aralash to'langan chek: pul o'sha usullar bo'yicha qaytadi", async () => {
    const { cookie, shiftId } = await openShift();
    const sale = await sell(cookie, shiftId, {
      payments: [
        { method: "cash", amount: "40000" },
        { method: "card", amount: "60000", terminalId: uzcard.id },
      ],
    });
    expect(sale.statusCode, sale.body).toBe(201);
    const orderId = sale.json().order.id as string;

    const back = await call(owner(), "POST", `/api/sales/orders/${orderId}/return`, { refund: true });
    expect(back.statusCode, back.body).toBe(200);

    // Naqd kassaga, karta bankka qaytdi — ikkalasi ham nolga
    expect(await balanceOf(mainCash)).toBe("0.00");
    expect(await balanceOf(mainBank)).toBe("0.00");
    expect((await call(owner(), "GET", `/api/sales/orders/${orderId}`)).json().order).toMatchObject({
      status: "returned",
      deliveryStatus: null,
    });
    await expectBalanced();
  });

  it("16. qisman qaytarish: sotuv yakunlangan bo'lib qoladi, faqat qaytgan qism chiqadi", async () => {
    const { cookie, shiftId } = await openShift();
    const sale = await sell(cookie, shiftId, {
      payments: [
        { method: "cash", amount: "40000" },
        { method: "card", amount: "60000", terminalId: uzcard.id },
      ],
    });
    const orderId = sale.json().order.id as string;
    const lineId = sale.json().order.items[0].id as string;

    const partial = await call(owner(), "POST", `/api/sales/orders/${orderId}/return-items`, {
      items: [{ orderItemId: lineId, quantity: "5" }],
      refunds: [{ method: "cash", amount: "25000" }],
    });
    expect(partial.statusCode, partial.body).toBe(201);

    expect(await balanceOf(mainCash)).toBe("15000.00");
    expect(await balanceOf(mainBank)).toBe("60000.00");
    expect((await call(owner(), "GET", `/api/sales/orders/${orderId}`)).json().order.status).toBe("completed");
    await expectBalanced();
  });
});

// ─── 17–18. Idempotentlik ────────────────────────────────────────────────────

describe("Idempotentlik", () => {
  it("17. bir xil havolali ta'minotchi to'lovi ikki marta yuborilsa — bitta yozuv", async () => {
    const supplierId = await supplierWithDebt("1000000");
    await fund(mainCash, "300000");
    await fund(secondBank, "200000");
    const reference = `SP-${randomUUID()}`;
    const body = {
      supplierId,
      reference,
      parts: [
        { method: "cash", amount: "300000" },
        { method: "bank", amount: "200000", cashAccountId: secondBank },
      ],
    };

    const first = await paySupplier(body);
    expect(first.statusCode, first.body).toBe(201);
    const second = await paySupplier(body);
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json().created).toBe(false);

    expect(await db.select().from(supplierPayments).where(eq(supplierPayments.companyId, company.companyId))).toHaveLength(2);
    expect(await balanceOf(mainCash)).toBe("0.00");
    expect(await balanceOf(secondBank)).toBe("0.00");
    await expectBalanced();
  });

  it("18. kassa chekini takroriy yuborish — ikkinchi chek va ikkinchi to'lov yozilmaydi", async () => {
    const { cookie, shiftId } = await openShift();
    const clientRequestId = randomUUID();
    const body = { paymentMethod: "cash", amountPaid: "100000", clientRequestId };

    const first = await sell(cookie, shiftId, body);
    expect(first.statusCode, first.body).toBe(201);
    // Takroriy yuborishda server ikkinchi chekni yozmaydi va asl chekni xato tafsilotida qaytaradi
    const again = await sell(cookie, shiftId, body);
    expect(again.statusCode).toBe(409);
    expect(again.json().details).toMatchObject({ duplicate: true, orderId: first.json().order.id as string });

    expect(await db.select().from(salesOrders).where(eq(salesOrders.companyId, company.companyId))).toHaveLength(1);
    expect(await balanceOf(mainCash)).toBe("100000.00");
    await expectBalanced();
  });
});

// ─── 19–21. Xavfsizlik ───────────────────────────────────────────────────────

describe("Xavfsizlik", () => {
  it("19. begona kompaniya ta'minotchisiga to'lov — rad", async () => {
    const other = await deliveryCompany(app, adminCookie, "Begona");
    const otherSupplier = (await call(other.ownerCookie, "POST", "/api/purchase/suppliers", { name: "B ta'minotchi", code: "B-1" })).json().supplier.id;

    const res = await paySupplier({ supplierId: otherSupplier, amount: "10000", method: "cash" });
    expect([403, 404]).toContain(res.statusCode);
    expect(await db.select().from(supplierPayments).where(eq(supplierPayments.companyId, company.companyId))).toHaveLength(0);
  });

  it("20. begona hisob va begona terminal — rad", async () => {
    const other = await deliveryCompany(app, adminCookie, "Begona 2");
    const otherCash = (await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, other.companyId))).find((row) => row.type === "bank")!.id;
    const supplierId = await supplierWithDebt("100000");

    const badAccount = await paySupplier({ supplierId, parts: [{ method: "bank", amount: "100000", cashAccountId: otherCash }] });
    expect([400, 404]).toContain(badAccount.statusCode);

    const otherTerminal = (await call(other.ownerCookie, "POST", "/api/finance/terminals", {
      name: "Begona terminal",
      network: "uzcard",
      cashAccountId: otherCash,
    })).json().terminal.id;
    const badTerminal = await paySupplier({ supplierId, parts: [{ method: "card", amount: "100000", terminalId: otherTerminal }] });
    expect([400, 404]).toContain(badTerminal.statusCode);

    expect(await db.select().from(supplierPayments).where(eq(supplierPayments.companyId, company.companyId))).toHaveLength(0);
  });

  it("21. ruxsatsiz xodim ta'minotchiga to'lay olmaydi va xarajat to'lay olmaydi", async () => {
    const kassir = await addEmployee(app, company, "Kassir");
    const supplierId = await supplierWithDebt("100000");
    expect((await paySupplier({ supplierId, amount: "10000", method: "cash" }, kassir.cookie)).statusCode).toBe(403);

    const expenseId = await approvedExpense("100000");
    await fund(mainCash, "100000");
    const res = await call(kassir.cookie, "POST", `/api/finance/expenses/${expenseId}/status`, { status: "paid", cashAccountId: mainCash });
    expect(res.statusCode).toBe(403);
    expect(await balanceOf(mainCash)).toBe("100000.00");
  });
});

// ─── 22–24. Modul chegaralari ────────────────────────────────────────────────

describe("Modul chegaralari", () => {
  const setModule = (key: string, enabled: boolean) => call(owner(), "PUT", `/api/company/modules/${key}`, { enabled });

  it("22. Moliya moduli o'chirilganda xarajat to'lovi bloklanadi, ma'lumot qoladi", async () => {
    const expenseId = await approvedExpense("100000");
    expect((await setModule("finance", false)).statusCode).toBe(200);

    const res = await payExpense(expenseId, { cashAccountId: mainCash });
    expect(res.statusCode).toBe(403);

    expect((await setModule("finance", true)).statusCode).toBe(200);
    const after = await call(owner(), "GET", `/api/finance/expenses`);
    expect(after.statusCode).toBe(200);
    expect((after.json().expenses as { id: string }[]).some((row) => row.id === expenseId)).toBe(true);
  });

  it("23. Xarid moduli o'chirilganda ta'minotchiga to'lov bloklanadi", async () => {
    const supplierId = await supplierWithDebt("100000");
    await fund(mainCash, "100000");
    expect((await setModule("purchase", false)).statusCode).toBe(200);

    const res = await paySupplier({ supplierId, amount: "100000", method: "cash" });
    expect(res.statusCode).toBe(403);
    expect(await balanceOf(mainCash)).toBe("100000.00");
  });

  it("24. Moliya moduli o'chirilganda kassa hisoblari API'si ham bloklanadi", async () => {
    expect((await setModule("finance", false)).statusCode).toBe(200);
    expect((await call(owner(), "GET", "/api/finance/cash-accounts")).statusCode).toBe(403);

    // Hisoblar bazada turaveradi
    const rows = await db.select().from(accounts).where(and(eq(accounts.companyId, company.companyId), eq(accounts.isActive, true)));
    expect(rows.length).toBeGreaterThan(0);
  });
});

// ─── Qismlar va mijoz to'lovlari yozuvlari ───────────────────────────────────

describe("Yozuvlar tarkibi", () => {
  it("aralash kassa cheki uchun har usul alohida qator bo'lib yoziladi", async () => {
    const { cookie, shiftId } = await openShift();
    const sale = await sell(cookie, shiftId, {
      payments: [
        { method: "cash", amount: "30000" },
        { method: "card", amount: "40000", terminalId: uzcard.id },
        { method: "card", amount: "30000", terminalId: humo.id },
      ],
    });
    expect(sale.statusCode, sale.body).toBe(201);

    const rows = await db
      .select({ method: customerPayments.method, amount: customerPayments.amount, cashAccountId: customerPayments.cashAccountId })
      .from(customerPayments)
      .where(eq(customerPayments.orderId, sale.json().order.id as string));
    expect(rows).toHaveLength(3);
    expect(rows.filter((row) => row.cashAccountId === mainBank)).toHaveLength(1);
    expect(rows.filter((row) => row.cashAccountId === secondBank)).toHaveLength(1);
    expect(rows.filter((row) => row.cashAccountId === mainCash)).toHaveLength(1);
    await expectBalanced();
  });
});
