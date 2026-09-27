/**
 * BITO BENCHMARK — KO'P KASSA, TO'LOV USULLARI, SOTUVCHI: REAL BIZNES QABUL TESTI (2026-09-27).
 *
 * BONNU MARKET: Kassa 1/2/3 (bitta omborda), kassirlar Ozoda / Diana / Sanaver, sotuvchilar Ali / Sardor / Bekzod /
 * Farangiz; to'lovlar Naqd, UZCARD, HUMO (faqat Kassa 3), aralash, nasiya; qaytarish, inkassatsiya, almashtirish puli,
 * mijoz qarz to'lovi, smena yopish (kamomad/ortiqcha), parallel sotuv, takroriy so'rov, begona kompaniya.
 * Har qadamdan keyin kutilgan qiymat test ichida MUSTAQIL hisoblanadi (`book`) va bazadagi bilan tiyingacha solishtiriladi:
 * kassa balansi = harakatlar yig'indisi, 1010 = Σ naqd hisoblar, 1020 = bank, mijoz qarzi kesh = jurnal, 1200 = Σ qoldiq ×
 * AVCO, jurnal debet = kredit, hisobotlar (kassa, kassir, sotuvchi + KPI, to'lov usuli) = kitob.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { accounts, cashAccounts, cashTransactions, journalEntries, journalLines } from "../src/db/schema/finance.js";
import { employees } from "../src/db/schema/hr.js";
import { stockLevels, warehouses } from "../src/db/schema/inventory.js";
import { users } from "../src/db/schema/platform.js";
import { customers, posShifts, salesOrders } from "../src/db/schema/sales.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn, uniquePhone } from "./helpers.js";

type Method = "GET" | "POST" | "PUT" | "PATCH";
type Company = Awaited<ReturnType<typeof createCompany>>;
let app: FastifyInstance;
let bonnu: Company;
let other: Company;

const call = (cookie: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
const n = (value: string | number | null | undefined) => Number(value ?? 0);
const today = () => new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);
const PERIOD = () => `from=${today()}&to=${today()}`;

const S = {
  wh: "", main: "", bank: "", k1: "", k2: "", k3: "", uzcard: "", humo: "", A: "", B: "", karim: "",
  m: {} as Record<string, string>,
  cashier: {} as Record<"ozoda" | "diana" | "sanaver", { cookie: string; userId: string }>,
  seller: {} as Record<"ali" | "sardor" | "bekzod" | "farangiz", string>,
  shift: {} as Record<"k1" | "k2" | "k3", string>,
  orders: {} as Record<string, { id: string; number: string }>,
};
/** Mustaqil kitob. */
const book = { k1: 0, k2: 0, k3: 0, main: 0, bank: 0, debt: 0, sales: 0 };

async function balanceOf(id: string) {
  const [row] = await db.select({ balance: cashAccounts.balance }).from(cashAccounts).where(eq(cashAccounts.id, id));
  return n(row!.balance);
}
async function txSum(id: string) {
  const [row] = await db
    .select({ s: sql<string>`coalesce(sum(case when ${cashTransactions.type} = 'in' then ${cashTransactions.amount} else -${cashTransactions.amount} end), 0)::numeric(18,2)` })
    .from(cashTransactions)
    .where(eq(cashTransactions.cashAccountId, id));
  return n(row!.s);
}
async function ledger(code: string) {
  const [row] = await db.select({ balance: accounts.balance }).from(accounts).where(and(eq(accounts.companyId, bonnu.companyId), eq(accounts.code, code)));
  return n(row?.balance);
}
async function debtOf(customerId: string) {
  const [cache] = await db.select({ debt: customers.totalDebt }).from(customers).where(eq(customers.id, customerId));
  const [led] = await db
    .select({ debt: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)::numeric(18,2)` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(eq(journalLines.partyType, "customer"), eq(journalLines.partyId, customerId), eq(accounts.subtype, "receivable"), eq(journalEntries.status, "posted")));
  expect(n(cache!.debt), "mijoz qarzi: kesh = jurnal").toBe(n(led!.debt));
  return n(cache!.debt);
}
/** Butun pul grafigi: har kassa = kitob = harakatlar yig'indisi; 1010 = Σ naqd; 1020 = bank; jurnal balansda; 1200 = ombor. */
async function reconcile(label: string) {
  for (const key of ["k1", "k2", "k3", "main", "bank"] as const) {
    const id = S[key];
    expect(await balanceOf(id), `${label}: ${key} = kitob`).toBe(book[key]);
    expect(await txSum(id), `${label}: ${key} = harakatlar yig'indisi`).toBe(book[key]);
  }
  expect(await ledger("1010"), `${label}: 1010 = Σ kassalar`).toBe(book.k1 + book.k2 + book.k3 + book.main);
  expect(await ledger("1020"), `${label}: 1020 = bank`).toBe(book.bank);
  if (S.karim) expect(await debtOf(S.karim), `${label}: mijoz qarzi`).toBe(book.debt);
  const unbalanced = await db
    .select({ id: journalLines.entryId })
    .from(journalLines)
    .where(eq(journalLines.companyId, bonnu.companyId))
    .groupBy(journalLines.entryId)
    .having(sql`sum(${journalLines.debit}) <> sum(${journalLines.credit})`);
  expect(unbalanced, `${label}: jurnal debet = kredit`).toHaveLength(0);
  const [inv] = await db
    .select({ v: sql<string>`coalesce(sum(round(${stockLevels.quantity} * ${stockLevels.avgCostPrice}, 2)), 0)::numeric(18,2)` })
    .from(stockLevels)
    .where(eq(stockLevels.companyId, bonnu.companyId));
  expect(Math.abs((await ledger("1200")) - n(inv!.v)), `${label}: 1200 = Σ qoldiq × AVCO`).toBeLessThanOrEqual(0.05);
}

async function employeeOf(companyId: string, phone: string) {
  const [row] = await db
    .select({ id: employees.id, userId: employees.userId })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .where(and(eq(employees.companyId, companyId), eq(users.phone, phone)));
  return row!;
}

type Part = { method: "cash" | "card" | "bank"; amount: string; paymentMethodId?: string; cashAccountId?: string; terminalId?: string };
const sale = (who: "ozoda" | "diana" | "sanaver", kassa: "k1" | "k2" | "k3", items: [string, string][], parts: Part[], extra: object = {}) =>
  call(S.cashier[who].cookie, "POST", "/api/sales/pos/sales", {
    shiftId: S.shift[kassa],
    items: items.map(([productId, quantity]) => ({ productId, quantity })),
    paymentMethod: "cash",
    payments: parts,
    ...extra,
  });

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
  await resetDatabase();
  await db.delete(units);
  await seedDefaultUnits(db);
});
afterAll(async () => {
  await app.close();
  await closeDb();
});

describe("Bonnu Market — ko'p kassa qabul testi", () => {
  it("M01 — kompaniya, bank terminallari (UZCARD, HUMO), 3 kassa, to'lov usullari (HUMO — faqat Kassa 3), xodimlar", async () => {
    const admin = await signedIn(app, { isPlatformAdmin: true });
    bonnu = await createCompany(app, admin.cookie, { name: "Bonnu Market" });
    other = await createCompany(app, admin.cookie, { name: "Test Market" });
    S.wh = (await db.select().from(warehouses).where(eq(warehouses.companyId, bonnu.companyId)))[0]!.id;
    const acc = await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, bonnu.companyId));
    S.main = acc.find((a) => a.isDefault)!.id;
    S.bank = acc.find((a) => a.type === "bank")!.id;
    const o = bonnu.ownerCookie;
    S.uzcard = (await call(o, "POST", "/api/finance/terminals", { name: "UZCARD", network: "uzcard", cashAccountId: S.bank })).json().terminal.id;
    S.humo = (await call(o, "POST", "/api/finance/terminals", { name: "HUMO", network: "humo", cashAccountId: S.bank })).json().terminal.id;
    for (const [key, code] of [["k1", "K1"], ["k2", "K2"], ["k3", "K3"]] as const) {
      const res = await call(o, "POST", "/api/finance/cash-accounts", { name: `Kassa ${code.slice(1)}`, type: "cash", code, warehouseId: S.wh });
      expect(res.statusCode, res.body).toBe(201);
      S[key] = res.json().cashAccount.id;
    }
    const accountsBefore = (await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, bonnu.companyId))).length;
    expect((await call(o, "POST", "/api/finance/payment-methods/bootstrap")).statusCode).toBe(200);
    expect((await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, bonnu.companyId))).length, "usul — yangi hisob emas").toBe(accountsBefore);
    for (const m of (await call(o, "GET", "/api/finance/payment-methods")).json().paymentMethods as { id: string; name: string }[]) S.m[m.name] = m.id;
    expect(Object.keys(S.m).sort()).toEqual(["HUMO", "Naqd", "UZCARD"]);
    expect((await call(o, "PATCH", `/api/finance/payment-methods/${S.m.HUMO}`, { kassaIds: [S.k3] })).statusCode).toBe(200);

    // Asosiy kassada almashtirish puli uchun 100 000
    expect((await call(o, "POST", `/api/finance/cash-accounts/${S.main}/set-balance`, { balance: "100000", reason: "Seyfdagi naqd" })).statusCode).toBe(200);
    book.main = 100000;

    for (const who of ["ozoda", "diana", "sanaver"] as const) {
      const e = await addEmployee(app, bonnu, "Kassir");
      S.cashier[who] = { cookie: e.cookie, userId: (await employeeOf(bonnu.companyId, e.phone)).userId! };
    }
    for (const who of ["ali", "sardor", "bekzod", "farangiz"] as const) {
      const e = await addEmployee(app, bonnu, "Kassir");
      S.seller[who] = (await employeeOf(bonnu.companyId, e.phone)).id;
    }

    const piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
    for (const [key, name, price, cost] of [["A", "Non", "10000", "6000"], ["B", "Sut", "25000", "15000"]] as const) {
      const res = await call(o, "POST", "/api/catalog/products", { name, sku: name.toUpperCase(), baseUnitId: piece, salesPrice: price, taxRate: "0" });
      expect(res.statusCode, res.body).toBe(201);
      S[key] = res.json().product.id;
      expect((await call(o, "POST", "/api/inventory/stock/movements", { type: "receive", productId: S[key], warehouseId: S.wh, quantity: "500", costPrice: cost })).statusCode).toBe(201);
    }
    const karim = await call(o, "POST", "/api/sales/customers", { name: "Karim aka", phone: uniquePhone("95"), creditLimit: "1000000" });
    expect(karim.statusCode, karim.body).toBe(201);
    S.karim = karim.json().customer.id;
    await reconcile("M01");
  });

  it("M02 — 3 kassada smena: Ozoda → K1, Diana → K2, Sanaver → K3; kassa tanlanmasa rad, bitta kassaga ikki smena — rad", async () => {
    expect((await call(S.cashier.ozoda.cookie, "POST", "/api/sales/pos/shifts", { warehouseId: S.wh })).statusCode).toBe(400);
    for (const [who, kassa] of [["ozoda", "k1"], ["diana", "k2"], ["sanaver", "k3"]] as const) {
      const res = await call(S.cashier[who].cookie, "POST", "/api/sales/pos/shifts", { warehouseId: S.wh, cashAccountId: S[kassa], openingCash: "0" });
      expect(res.statusCode, res.body).toBe(201);
      S.shift[kassa] = res.json().shift.id;
    }
    expect((await call(S.cashier.diana.cookie, "POST", "/api/sales/pos/shifts", { warehouseId: S.wh, cashAccountId: S.k1 })).statusCode).toBe(409);
    // Kassa 3 ekrani HUMO ni ko'radi, Kassa 1 — yo'q
    const k1Methods = (await call(S.cashier.ozoda.cookie, "GET", `/api/sales/pos/payment-options?shiftId=${S.shift.k1}`)).json().paymentMethods.map((m: { name: string }) => m.name);
    expect(k1Methods).toEqual(["Naqd", "UZCARD"]);
    await reconcile("M02");
  });

  it("M03 — sotuvlar: naqd, UZCARD, aralash, HUMO (K3), nasiya; xavfsizlik: HUMO K1 da — 403, naqd boshqa kassaga — 403", async () => {
    const ok = async (res: Awaited<ReturnType<typeof sale>>, key: string) => {
      expect(res.statusCode, res.body).toBe(201);
      S.orders[key] = { id: res.json().order.id, number: res.json().order.number };
    };
    // S1 Ozoda/K1, sotuvchi Ali: 3 × Non naqd 30 000
    await ok(await sale("ozoda", "k1", [[S.A, "3"]], [{ method: "cash", amount: "30000", paymentMethodId: S.m.Naqd! }], { sellerEmployeeId: S.seller.ali }), "S1");
    book.k1 += 30000;
    // S2 Ozoda/K1, Sardor: 2 × Sut UZCARD 50 000
    await ok(await sale("ozoda", "k1", [[S.B, "2"]], [{ method: "card", amount: "50000", paymentMethodId: S.m.UZCARD! }], { sellerEmployeeId: S.seller.sardor }), "S2");
    book.bank += 50000;
    // S3 Diana/K2, Bekzod: 2 Non + 1 Sut = 45 000 aralash — naqd 20 000 + UZCARD 25 000
    await ok(
      await sale("diana", "k2", [[S.A, "2"], [S.B, "1"]], [
        { method: "cash", amount: "20000", paymentMethodId: S.m.Naqd! },
        { method: "card", amount: "25000", paymentMethodId: S.m.UZCARD! },
      ], { sellerEmployeeId: S.seller.bekzod }),
      "S3",
    );
    book.k2 += 20000;
    book.bank += 25000;
    // S4 Sanaver/K3, Farangiz: 2 Sut HUMO 50 000
    await ok(await sale("sanaver", "k3", [[S.B, "2"]], [{ method: "card", amount: "50000", paymentMethodId: S.m.HUMO! }], { sellerEmployeeId: S.seller.farangiz }), "S4");
    book.bank += 50000;
    // S5 Diana/K2, Ali: 5 Non = 50 000 nasiya Karim akaga: naqd 10 000, qolgan 40 000 qarz
    await ok(await sale("diana", "k2", [[S.A, "5"]], [{ method: "cash", amount: "10000", paymentMethodId: S.m.Naqd! }], { sellerEmployeeId: S.seller.ali, customerId: S.karim, onCredit: true }), "S5");
    book.k2 += 10000;
    book.debt += 40000;
    // S6 Sanaver/K3, Farangiz: 1 Non naqd — takroriy so'rov kaliti bilan ikki marta
    const key = randomUUID();
    await ok(await sale("sanaver", "k3", [[S.A, "1"]], [{ method: "cash", amount: "10000", paymentMethodId: S.m.Naqd! }], { sellerEmployeeId: S.seller.farangiz, clientRequestId: key }), "S6");
    const dup = await sale("sanaver", "k3", [[S.A, "1"]], [{ method: "cash", amount: "10000", paymentMethodId: S.m.Naqd! }], { sellerEmployeeId: S.seller.farangiz, clientRequestId: key });
    expect(dup.statusCode, "takroriy chek — ikkinchi marta yozilmaydi").toBe(409);
    book.k3 += 10000;

    // Xavfsizlik
    const humoK1 = await sale("ozoda", "k1", [[S.A, "1"]], [{ method: "card", amount: "10000", paymentMethodId: S.m.HUMO! }]);
    expect(humoK1.statusCode, humoK1.body).toBe(403);
    const cashToK2 = await sale("ozoda", "k1", [[S.A, "1"]], [{ method: "cash", amount: "10000", cashAccountId: S.k2 }]);
    expect(cashToK2.statusCode, cashToK2.body).toBe(403);
    const cashToMain = await sale("ozoda", "k1", [[S.A, "1"]], [{ method: "cash", amount: "10000", cashAccountId: S.main }]);
    expect(cashToMain.statusCode).toBe(403);
    // Boshqa kassirning smenasida sotolmaydi
    expect((await call(S.cashier.ozoda.cookie, "POST", "/api/sales/pos/sales", { shiftId: S.shift.k2, items: [{ productId: S.A, quantity: "1" }], paymentMethod: "cash", amountPaid: "10000" })).statusCode).toBe(403);

    // Parallel: Diana K2 da bir vaqtda 2 chek
    const parallel = await Promise.all([
      sale("diana", "k2", [[S.A, "1"]], [{ method: "cash", amount: "10000", paymentMethodId: S.m.Naqd! }]),
      sale("diana", "k2", [[S.A, "1"]], [{ method: "cash", amount: "10000", paymentMethodId: S.m.Naqd! }]),
    ]);
    expect(parallel.map((r) => r.statusCode)).toEqual([201, 201]);
    book.k2 += 20000;
    book.sales = 30000 + 50000 + 45000 + 50000 + 50000 + 10000 + 20000;
    await reconcile("M03");
  });

  it("M04 — qaytarish (K1 dan), mijoz qarz to'lovi (K2), inkassatsiya K1 → asosiy (takror — bitta), almashtirish puli asosiy → K3", async () => {
    const o = bonnu.ownerCookie;
    const detail = (await call(o, "GET", `/api/sales/orders/${S.orders.S1!.id}`)).json();
    const itemId = (detail.order?.items ?? detail.items)[0].id as string;
    const ret = await call(o, "POST", `/api/sales/orders/${S.orders.S1!.id}/return-items`, { items: [{ orderItemId: itemId, quantity: "1" }], refundMethod: "cash", shiftId: S.shift.k1, reason: "Buzilgan" });
    expect([200, 201], ret.body).toContain(ret.statusCode);
    book.k1 -= 10000;

    const pay = await call(S.cashier.diana.cookie, "POST", `/api/sales/pos/customers/${S.karim}/payments`, { shiftId: S.shift.k2, purpose: "debt", amount: "15000", method: "cash" });
    expect(pay.statusCode, pay.body).toBe(201);
    book.k2 += 15000;
    book.debt -= 15000;

    const requestId = randomUUID();
    const collect = () => call(S.cashier.ozoda.cookie, "POST", `/api/sales/pos/shifts/${S.shift.k1}/cash-movements`, { kind: "collection", amount: "20000", requestId });
    const [c1, c2] = await Promise.all([collect(), collect()]);
    expect([c1.statusCode, c2.statusCode].sort(), `${c1.body} ${c2.body}`).toEqual([200, 201]);
    expect((await collect()).statusCode).toBe(200);
    book.k1 -= 20000;
    book.main += 20000;

    const fund = await call(S.cashier.sanaver.cookie, "POST", `/api/sales/pos/shifts/${S.shift.k3}/cash-movements`, { kind: "change_fund", amount: "5000", requestId: randomUUID() });
    expect(fund.statusCode, fund.body).toBe(201);
    book.k3 += 5000;
    book.main -= 5000;
    // Kassada bo'lmagan pulni chiqarib bo'lmaydi
    expect((await call(S.cashier.ozoda.cookie, "POST", `/api/sales/pos/shifts/${S.shift.k1}/cash-movements`, { kind: "collection", amount: "1" })).statusCode).toBe(400);
    await reconcile("M04");
  });

  it("M05 — smena yopish: kutilgan = kassa balansi; K1 aniq, K2 kamomad 1 000, K3 ortiqcha 500", async () => {
    const expected = async (kassa: "k1" | "k2" | "k3", who: "ozoda" | "diana" | "sanaver") =>
      n((await call(S.cashier[who].cookie, "GET", `/api/sales/pos/shifts/${S.shift[kassa]}`)).json().shift.expectedCash);
    expect(await expected("k1", "ozoda")).toBe(0);
    expect(await expected("k2", "diana")).toBe(65000);
    expect(await expected("k3", "sanaver")).toBe(15000);
    const close = async (kassa: "k1" | "k2" | "k3", who: "ozoda" | "diana" | "sanaver", counted: string) => {
      const res = await call(S.cashier[who].cookie, "POST", `/api/sales/pos/shifts/${S.shift[kassa]}/close`, { closingCash: counted });
      expect(res.statusCode, res.body).toBe(200);
      return res.json().shift as { cashDifference: string };
    };
    expect(n((await close("k1", "ozoda", "0")).cashDifference)).toBe(0);
    expect(n((await close("k2", "diana", "64000")).cashDifference)).toBe(-1000);
    expect(n((await close("k3", "sanaver", "15500")).cashDifference)).toBe(500);
    book.k2 = 64000;
    book.k3 = 15500;
    const shifts = await db.select().from(posShifts).where(eq(posShifts.companyId, bonnu.companyId));
    expect(shifts.every((s) => s.status === "closed")).toBe(true);
    await reconcile("M05");
  });

  it("M06 — hisobotlar: kassa sverkasi, kassir, sotuvchi (+KPI bonus Rule Builder'dan), to'lov usuli = kitob", async () => {
    const o = bonnu.ownerCookie;
    const kassa = (await call(o, "GET", `/api/analytics/reports/kassa?${PERIOD()}`)).json().kassas as Record<string, string | { count: number }>[];
    const row = (code: string) => kassa.find((k) => k.code === code)!;
    expect(row("K1")).toMatchObject({ opening: "0.00", cashSales: "30000.00", refunds: "10000.00", transfersOut: "20000.00", expected: "0.00", overShort: "0.00", closing: "0.00", balanceNow: "0.00" });
    expect(row("K2")).toMatchObject({ cashSales: "65000.00", short: "1000.00", expected: "65000.00", overShort: "-1000.00", closing: "64000.00", balanceNow: "64000.00" });
    expect(row("K3")).toMatchObject({ cashSales: "10000.00", transfersIn: "5000.00", over: "500.00", expected: "15000.00", overShort: "500.00", closing: "15500.00", balanceNow: "15500.00" });
    expect((row("K2").shifts as { count: number }).count).toBe(1);

    const cashiers = (await call(o, "GET", `/api/analytics/reports/cashiers?${PERIOD()}`)).json().cashiers as { cashierId: string; receipts: number; sales: string; card: string; over: string; short: string }[];
    const cashier = (who: "ozoda" | "diana" | "sanaver") => cashiers.find((c) => c.cashierId === S.cashier[who].userId)!;
    expect(cashier("ozoda")).toMatchObject({ receipts: 2, sales: "80000.00", card: "50000.00", short: "0.00" });
    expect(cashier("diana")).toMatchObject({ receipts: 4, sales: "115000.00", card: "25000.00", short: "1000.00" });
    expect(cashier("sanaver")).toMatchObject({ receipts: 2, sales: "60000.00", card: "50000.00", over: "500.00" });

    // KPI: Ali — sof savdoning 1%, faqat Rule Builder qoidasi
    const rule = await call(o, "PUT", "/api/hr/kpi/rules", { employeeId: S.seller.ali, metric: "seller_sales_amount", bonusType: "tiered", tiers: [{ fromValue: "0", toValue: null, rate: "1" }] });
    expect(rule.statusCode, rule.body).toBe(200);
    const sellers = (await call(o, "GET", `/api/analytics/reports/sellers?${PERIOD()}`)).json().sellers as { employeeId: string; receipts: number; units: string; sales: string; returns: string; netSales: string; cogs: string; grossProfit: string; marginPercent: string; bonus: string }[];
    const seller = (who: keyof typeof S.seller) => sellers.find((s) => s.employeeId === S.seller[who])!;
    expect(seller("ali")).toMatchObject({ receipts: 2, units: "8.0000", sales: "80000.00", returns: "10000.00", netSales: "70000.00", cogs: "42000.00", grossProfit: "28000.00", marginPercent: "40.00", bonus: "700.00" });
    expect(seller("sardor")).toMatchObject({ receipts: 1, sales: "50000.00", netSales: "50000.00", cogs: "30000.00", grossProfit: "20000.00", bonus: "0.00" });
    expect(seller("bekzod")).toMatchObject({ receipts: 1, units: "3.0000", sales: "45000.00", cogs: "27000.00", grossProfit: "18000.00" });
    expect(seller("farangiz")).toMatchObject({ receipts: 2, sales: "60000.00", cogs: "36000.00", grossProfit: "24000.00" });
    // Sotuvchilar + sotuvchisiz = barcha POS sotuvlar
    const attributed = sellers.reduce((sum, s) => sum + n(s.sales), 0);
    const [all] = await db.select({ s: sql<string>`sum(${salesOrders.totalAmount})` }).from(salesOrders).where(and(eq(salesOrders.companyId, bonnu.companyId), eq(salesOrders.source, "pos")));
    expect(n(all!.s), "POS sotuv jami = kitob").toBe(book.sales);
    expect(attributed + 20000, "atributsiyali + sotuvchisiz (2 parallel chek)").toBe(book.sales);

    const methods = (await call(o, "GET", `/api/analytics/reports/payment-methods?${PERIOD()}`)).json();
    const byLabel = (label: string) => (methods.methods as { label: string; amount: string }[]).filter((m) => m.label === label).reduce((sum, m) => sum + n(m.amount), 0);
    expect(byLabel("Naqd"), "naqd: usul (90 000) + usulsiz qarz to'lovi (15 000)").toBe(105000);
    expect(byLabel("UZCARD")).toBe(75000);
    expect(byLabel("HUMO")).toBe(50000);
    expect(n(methods.total)).toBe(230000);
    await reconcile("M06");
  });

  it("M07 — begona kompaniya: hisobot va kassalar bo'sh, Bonnu kassasi/usuli/sotuvchisi ishlatilmaydi", async () => {
    const t = other.ownerCookie;
    expect((await call(t, "GET", `/api/analytics/reports/kassa?${PERIOD()}`)).json().kassas).toEqual([]);
    expect((await call(t, "GET", `/api/analytics/reports/sellers?${PERIOD()}`)).json().sellers).toEqual([]);
    expect((await call(t, "GET", "/api/sales/pos/kassa-board")).json().kassas).toEqual([]);
    const otherWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, other.companyId)))[0]!.id;
    expect((await call(t, "POST", "/api/sales/pos/shifts", { warehouseId: otherWh, cashAccountId: S.k1 })).statusCode).toBe(404);
    const shift = (await call(t, "POST", "/api/sales/pos/shifts", { warehouseId: otherWh })).json().shift.id as string;
    const piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
    const product = (await call(t, "POST", "/api/catalog/products", { name: "X", sku: "X", baseUnitId: piece, salesPrice: "1000", taxRate: "0" })).json().product.id as string;
    await call(t, "POST", "/api/inventory/stock/movements", { type: "receive", productId: product, warehouseId: otherWh, quantity: "5", costPrice: "500" });
    const sell = (extra: object) => call(t, "POST", "/api/sales/pos/sales", { shiftId: shift, items: [{ productId: product, quantity: "1" }], paymentMethod: "cash", ...extra });
    expect((await sell({ payments: [{ method: "cash", amount: "1000", paymentMethodId: S.m.Naqd }] })).statusCode).toBe(404);
    expect((await sell({ amountPaid: "1000", sellerEmployeeId: S.seller.ali })).statusCode).toBe(404);
    // Begona kassa — mavjudligi ham oshkor qilinmaydi (404)
    expect((await sell({ payments: [{ method: "cash", amount: "1000", cashAccountId: S.k1 }] })).statusCode).toBe(404);
    await reconcile("M07 (Bonnu o'zgarmadi)");
  });
});
