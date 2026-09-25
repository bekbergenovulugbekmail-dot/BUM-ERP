/**
 * AUDIT AUD-001 — MIJOZ TO'LOVINI BEKOR QILISH va moliyaviy zanjirning yaxlitligi.
 *
 * Egasining majburiy senariysi (topshiriqning 7-bo'limi):
 *   Sotuv 1 000 000 → To'lov 400 000 → qarz 600 000 → to'lovni bekor qilish → qarz 1 000 000
 *   → sotuvni bekor qilish (to'liq qaytarish) → qarz 0. Kassa, jurnal, ombor ham mos bo'lishi kerak.
 *
 * Har qadamda to'rtta mustaqil manba solishtiriladi: `customers.total_debt` (kesh), mijozning JURNAL
 * subhisobi (1100 qatorlari, kontragent = mijoz), hisob qoldig'i (1100) va kassa. Biri boshqasidan ajralsa —
 * test yiqiladi.
 */
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { accounts, cashAccounts, journalEntries, journalLines } from "../src/db/schema/finance.js";
import { stockLevels, warehouses } from "../src/db/schema/inventory.js";
import { customerPayments, customers, salesOrders } from "../src/db/schema/sales.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
let piece: string;
let mainWh: string;
let mainCash: string;
let bank: string;

const today = new Date().toISOString().slice(0, 10);

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
  company = await createCompany(app, admin.cookie, { name: "Audit kompaniyasi" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  const accountsList = await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId));
  mainCash = accountsList.find((row) => row.isDefault)!.id;
  bank = accountsList.find((row) => row.type === "bank")!.id;
});

const call = (cookie: string, method: "GET" | "POST" | "PUT", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
const sales = (method: "GET" | "POST", url: string, payload?: object, cookie = company.ownerCookie) =>
  call(cookie, method, `/api/sales${url}`, payload);

async function ledger(code: string) {
  const [row] = await db.select().from(accounts).where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, code)));
  return row!.balance;
}

async function cash(id = mainCash) {
  const [row] = await db.select().from(cashAccounts).where(eq(cashAccounts.id, id));
  return row!.balance;
}

/** Mijoz qarzi JURNALDAN: 1100 qatorlari, kontragent = mijoz, bekor qilinmagan yozuvlar. */
async function ledgerDebt(customerId: string) {
  const [row] = await db
    .select({ debt: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)::numeric(18,2)` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(
      and(
        eq(journalLines.partyType, "customer"),
        eq(journalLines.partyId, customerId),
        eq(accounts.subtype, "receivable"),
        eq(journalEntries.status, "posted"),
      ),
    );
  return row!.debt;
}

/** To'rt manba bir xil qarzni ko'rsatadimi: kesh = jurnal subhisobi = 1100 qoldig'i (yagona mijoz). */
async function expectDebt(customerId: string, expected: string) {
  const [customer] = await db.select().from(customers).where(eq(customers.id, customerId));
  expect(customer!.totalDebt, "kesh (customers.total_debt)").toBe(expected);
  expect(await ledgerDebt(customerId), "mijozning jurnal subhisobi").toBe(expected);
  expect(await ledger("1100"), "1100 Debitorlar qoldig'i").toBe(expected);
}

/** Aylanma balans: jami debet = jami kredit (butun kompaniya). */
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

let seq = 0;
async function product(price: string, stock: string, cost: string) {
  seq += 1;
  const created = await call(company.ownerCookie, "POST", "/api/catalog/products", {
    name: `Mahsulot ${seq}`,
    sku: `AUD-${seq}`,
    baseUnitId: piece,
    salesPrice: price,
    taxRate: "0",
  });
  const productId = created.json().product.id as string;
  await call(company.ownerCookie, "POST", "/api/inventory/stock/movements", {
    type: "receive",
    productId,
    warehouseId: mainWh,
    quantity: stock,
    costPrice: cost,
  });
  return productId;
}

async function stock(productId: string) {
  const [level] = await db.select().from(stockLevels).where(and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, mainWh)));
  return level!.quantity;
}

async function shipped(customerId: string, productId: string, quantity: string) {
  const created = await sales("POST", "/orders", { customerId, warehouseId: mainWh, orderDate: today, items: [{ productId, quantity }] });
  expect(created.statusCode, created.body).toBe(201);
  const orderId = created.json().order.id as string;
  expect((await sales("POST", `/orders/${orderId}/confirm`)).statusCode).toBe(200);
  const ship = await sales("POST", `/orders/${orderId}/ship`);
  expect(ship.statusCode, ship.body).toBe(200);
  return orderId;
}

async function newCustomer(name: string) {
  return (await sales("POST", "/customers", { name })).json().customer.id as string;
}

async function paid(orderId: string) {
  const [row] = await db.select().from(salesOrders).where(eq(salesOrders.id, orderId));
  return row!.paidAmount;
}

describe("AUD-001: sotuv → to'lov → to'lovni bekor qilish → sotuvni bekor qilish", () => {
  it("egasining senariysi: qarz 1 000 000 → 600 000 → 1 000 000 → 0; kassa, jurnal va ombor mos", async () => {
    const productId = await product("100000", "20", "60000");
    const customerId = await newCustomer("Ulgurji mijoz");

    // Sotuv 1 000 000 (10 × 100 000), tannarx 600 000
    const orderId = await shipped(customerId, productId, "10");
    await expectDebt(customerId, "1000000.00");
    expect(await ledger("4000")).toBe("1000000.00");
    expect(await ledger("5000")).toBe("600000.00");
    expect(await stock(productId)).toBe("10.0000");

    // To'lov 400 000 naqd
    const payment = await sales("POST", "/payments", { orderId, amount: "400000", method: "cash" });
    expect(payment.statusCode, payment.body).toBe(201);
    const paymentId = payment.json().payment.id as string;
    await expectDebt(customerId, "600000.00");
    expect(await cash()).toBe("400000.00");
    expect(await ledger("1010")).toBe("400000.00");
    expect(await paid(orderId)).toBe("400000.00");

    // Ko'rib chiqish: nima bo'lishi — yozishdan OLDIN
    const preview = await sales("GET", `/payments/${paymentId}/reversal`);
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json()).toMatchObject({
      total: "400000.00",
      blockers: [],
      customer: { debtBefore: "600000.00", debtAfter: "1000000.00" },
      orders: [{ id: orderId, paidBefore: "400000.00", paidAfter: "0.00" }],
      parts: [{ method: "cash", moneyBack: { kind: "cash_account", accountId: mainCash, enough: true } }],
    });
    await expectDebt(customerId, "600000.00"); // ko'rib chiqish hech narsa yozmaydi

    // Sabab majburiy; kassir bekor qila olmaydi
    expect((await sales("POST", `/payments/${paymentId}/reverse`, { reason: "" })).statusCode).toBe(400);
    const cashier = await addEmployee(app, company, "Kassir");
    expect((await sales("POST", `/payments/${paymentId}/reverse`, { reason: "Xato" }, cashier.cookie)).statusCode).toBe(403);

    // To'lovni bekor qilish
    const reversed = await sales("POST", `/payments/${paymentId}/reverse`, { reason: "Summa xato kiritilgan" });
    expect(reversed.statusCode, reversed.body).toBe(200);
    await expectDebt(customerId, "1000000.00");
    expect(await cash()).toBe("0.00");
    expect(await ledger("1010")).toBe("0.00");
    expect(await paid(orderId)).toBe("0.00");
    const [row] = await db.select().from(customerPayments).where(eq(customerPayments.id, paymentId));
    expect(row).toMatchObject({ status: "reversed", reversalReason: "Summa xato kiritilgan" });
    // Asl jurnal yozuvi O'CHIRILMAGAN — joyida; teskari yozuv alohida
    const entries = await db.select().from(journalEntries).where(eq(journalEntries.referenceId, paymentId));
    expect(entries.map((entry) => `${entry.referenceType}:${entry.status}`).sort()).toEqual([
      "customer_payment:posted",
      "customer_payment_reversal:posted",
    ]);
    // Qayta bekor qilib bo'lmaydi
    expect((await sales("POST", `/payments/${paymentId}/reverse`, { reason: "Yana" })).statusCode).toBe(409);
    // Bekor qilingan to'lov qarzni hisoblashda qatnashmaydi, lekin tarixda ko'rinadi
    expect((await sales("GET", `/payments?customerId=${customerId}`)).json().payments[0]).toMatchObject({ id: paymentId, status: "reversed" });

    // Sotuvni bekor qilish — to'liq qaytarish (pul olinmagan, qaytariladigan pul yo'q)
    const returned = await sales("POST", `/orders/${orderId}/return`, { reason: "Sotuv bekor qilindi", refund: false });
    expect(returned.statusCode, returned.body).toBe(200);
    await expectDebt(customerId, "0.00");
    expect(await ledger("4000")).toBe("0.00");
    expect(await ledger("5000")).toBe("0.00");
    expect(await ledger("1200")).toBe("1200000.00");
    expect(await stock(productId)).toBe("20.0000");
    expect(await cash()).toBe("0.00");
    await expectTrialBalance();
  });

  it("parallel ikki bekor qilish so'rovidan faqat bittasi o'tadi", async () => {
    const productId = await product("50000", "10", "30000");
    const customerId = await newCustomer("Parallel");
    const orderId = await shipped(customerId, productId, "2");
    const paymentId = (await sales("POST", "/payments", { orderId, amount: "100000" })).json().payment.id as string;

    const results = await Promise.all([
      sales("POST", `/payments/${paymentId}/reverse`, { reason: "Birinchi" }),
      sales("POST", `/payments/${paymentId}/reverse`, { reason: "Ikkinchi" }),
    ]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([200, 409]);
    await expectDebt(customerId, "100000.00");
    expect(await cash()).toBe("0.00");
    await expectTrialBalance();
  });

  it("aralash to'lov (naqd + o'tkazma) — ikkala qism birga bekor qilinadi", async () => {
    const productId = await product("30000", "10", "10000");
    const customerId = await newCustomer("Aralash");
    const orderId = await shipped(customerId, productId, "10");
    const mixed = await sales("POST", "/payments", {
      orderId,
      parts: [
        { method: "cash", amount: "100000" },
        { method: "transfer", amount: "150000", cashAccountId: bank },
      ],
    });
    expect(mixed.statusCode, mixed.body).toBe(201);
    await expectDebt(customerId, "50000.00");
    expect(await cash()).toBe("100000.00");
    expect(await cash(bank)).toBe("150000.00");

    const parts = await db.select().from(customerPayments).where(eq(customerPayments.orderId, orderId));
    expect(parts).toHaveLength(2);
    // Istalgan qismdan boshlansa ham butun hujjat bekor qilinadi
    const preview = (await sales("GET", `/payments/${parts[1]!.id}/reversal`)).json();
    expect(preview.parts).toHaveLength(2);
    expect(preview.total).toBe("250000.00");

    expect((await sales("POST", `/payments/${parts[1]!.id}/reverse`, { reason: "Mijoz boshqa" })).statusCode).toBe(200);
    await expectDebt(customerId, "300000.00");
    expect(await cash()).toBe("0.00");
    expect(await cash(bank)).toBe("0.00");
    expect(await ledger("1010")).toBe("0.00");
    expect(await ledger("1020")).toBe("0.00");
    const after = await db.select().from(customerPayments).where(eq(customerPayments.orderId, orderId));
    expect(after.every((part) => part.status === "reversed")).toBe(true);
    await expectTrialBalance();
  });

  it("buyurtmasiz to'lov: taqsimot aynan qaytariladi", async () => {
    const productId = await product("10000", "20", "5000");
    const customerId = await newCustomer("Qarzdor");
    const first = await shipped(customerId, productId, "3"); // 30 000
    const second = await shipped(customerId, productId, "5"); // 50 000
    await expectDebt(customerId, "80000.00");

    // 40 000 — ochiq hujjatlarga eng eski muddatdan (bir kunda — id tartibida) taqsimlanadi
    const beforeFirst = await paid(first);
    const beforeSecond = await paid(second);
    const payment = await sales("POST", "/payments", { customerId, amount: "40000" });
    expect(payment.statusCode, payment.body).toBe(201);
    const allocatedFirst = Number(await paid(first)) - Number(beforeFirst);
    const allocatedSecond = Number(await paid(second)) - Number(beforeSecond);
    expect(allocatedFirst + allocatedSecond, "to'lov to'liq taqsimlandi").toBe(40000);

    // Keyin ikkinchisiga alohida buyurtmali to'lov — bekor qilish uni buzmasligi kerak
    await sales("POST", "/payments", { orderId: second, amount: "5000" });
    await expectDebt(customerId, "35000.00");
    const secondBeforeReversal = Number(await paid(second));

    const preview = (await sales("GET", `/payments/${payment.json().payment.id}/reversal`)).json();
    expect(preview.legacyAllocation).toBe(false);
    expect((await sales("POST", `/payments/${payment.json().payment.id}/reverse`, { reason: "Ikki marta kiritilgan" })).statusCode).toBe(200);
    // Aynan taqsimlangan summalar qaytdi; alohida to'lov joyida qoldi
    expect(await paid(first)).toBe("0.00");
    expect(Number(await paid(second))).toBe(secondBeforeReversal - allocatedSecond);
    expect(await paid(second)).toBe("5000.00");
    await expectDebt(customerId, "75000.00");
    await expectTrialBalance();
  });

  it("kassada pul qolmagan bo'lsa — to'siq ko'rsatiladi va hech narsa yozilmaydi", async () => {
    const productId = await product("10000", "20", "5000");
    const customerId = await newCustomer("Kassa bo'sh");
    const orderId = await shipped(customerId, productId, "5");
    const paymentId = (await sales("POST", "/payments", { orderId, amount: "50000" })).json().payment.id as string;
    // Pul bankka o'tkazildi — kassada yo'q
    const transfer = await call(company.ownerCookie, "POST", "/api/finance/cash-transfers", {
      fromCashAccountId: mainCash,
      toCashAccountId: bank,
      amount: "50000",
    });
    expect(transfer.statusCode, transfer.body).toBeLessThan(300);

    const preview = (await sales("GET", `/payments/${paymentId}/reversal`)).json();
    expect(preview.blockers.join(" ")).toContain("yetarli pul yo'q");
    const attempt = await sales("POST", `/payments/${paymentId}/reverse`, { reason: "Xato" });
    expect(attempt.statusCode).toBe(400);
    // Atomiklik: hech narsa o'zgarmadi
    await expectDebt(customerId, "0.00");
    expect(await paid(orderId)).toBe("50000.00");
    const [row] = await db.select().from(customerPayments).where(eq(customerPayments.id, paymentId));
    expect(row!.status).toBe("posted");
  });

  it("balansdan (hamyon) to'lov bekor qilinsa pul hamyonga qaytadi", async () => {
    const productId = await product("20000", "10", "10000");
    const customerId = await newCustomer("Hamyon");
    const deposit = await sales("POST", `/customers/${customerId}/balance-deposit`, { amount: "50000", method: "cash" });
    expect(deposit.statusCode, deposit.body).toBeLessThan(300);
    const orderId = await shipped(customerId, productId, "2");
    const pay = await sales("POST", "/payments", { orderId, amount: "40000", method: "balance" });
    expect(pay.statusCode, pay.body).toBe(201);
    await expectDebt(customerId, "0.00");
    expect((await db.select().from(customers).where(eq(customers.id, customerId)))[0]!.balance).toBe("10000.00");

    expect((await sales("POST", `/payments/${pay.json().payment.id}/reverse`, { reason: "Mijoz naqd to'laydi" })).statusCode).toBe(200);
    await expectDebt(customerId, "40000.00");
    expect((await db.select().from(customers).where(eq(customers.id, customerId)))[0]!.balance).toBe("50000.00");
    expect(await ledger("2300")).toBe("50000.00");
    await expectTrialBalance();
  });

  it("bekor qilingan to'lov qaytarishda IKKINCHI marta qaytarilmaydi", async () => {
    const productId = await product("25000", "10", "10000");
    const customerId = await newCustomer("Ikki marta");
    const orderId = await shipped(customerId, productId, "4"); // 100 000
    const paymentId = (await sales("POST", "/payments", { orderId, amount: "100000" })).json().payment.id as string;
    expect(await cash()).toBe("100000.00");
    expect((await sales("POST", `/payments/${paymentId}/reverse`, { reason: "Pul qaytarildi" })).statusCode).toBe(200);
    expect(await cash()).toBe("0.00");

    // Qaytarish pul qaytarish bilan so'ralsa ham — pul bekor qilishda qaytgan, kassadan yana chiqmaydi
    const returned = await sales("POST", `/orders/${orderId}/return`, { reason: "Qaytdi" });
    expect(returned.statusCode, returned.body).toBe(200);
    expect(returned.json().refunded).toBe("0.00");
    expect(await cash()).toBe("0.00");
    await expectDebt(customerId, "0.00");
    await expectTrialBalance();
  });

  it("yopilgan davrda bekor qilib bo'lmaydi", async () => {
    const productId = await product("10000", "10", "5000");
    const customerId = await newCustomer("Davr");
    const orderId = await shipped(customerId, productId, "1");
    const paymentId = (await sales("POST", "/payments", { orderId, amount: "10000" })).json().payment.id as string;
    const lock = await call(company.ownerCookie, "PUT", "/api/finance/lock-date", { lockDate: today });
    expect(lock.statusCode, lock.body).toBeLessThan(300);
    const attempt = await sales("POST", `/payments/${paymentId}/reverse`, { reason: "Kech" });
    expect(attempt.statusCode).toBe(400);
    expect(attempt.json().message).toContain("yopilgan");
  });
});
