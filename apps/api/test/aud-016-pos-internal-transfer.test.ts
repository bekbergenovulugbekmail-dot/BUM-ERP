/**
 * AUD-016 (egasi qarori, 2026-09-28): POS dagi "boshqa chiqim" — real xarajat EMAS, "ASOSIY KASSAGA TOPSHIRISH" (ichki
 * o'tkazma). Real chiqim faqat Xarajat (EXP-) orqali. Bitta amal bir vaqtda ham o'tkazma, ham xarajat bo'lmaydi;
 * kassa hisobotida o'tkazma va xarajat alohida qatorlarda.
 */
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { accounts, cashAccounts, cashTransactions, expenses } from "../src/db/schema/finance.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { todayIso } from "../src/modules/finance/cash.service.js";
import { buildServer } from "../src/server.js";
import { createCompany, resetDatabase, signedIn } from "./helpers.js";

let app: FastifyInstance;
let company: Awaited<ReturnType<typeof createCompany>>;
let mainWh: string;
let mainCash: string;
let productId: string;

const call = (method: "GET" | "POST", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie: company.ownerCookie }, ...(payload ? { payload } : {}) });
const pos = (method: "GET" | "POST", url: string, payload?: object) => call(method, `/api/sales/pos${url}`, payload);
const n = (value: string | null | undefined) => Number(value ?? 0);

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
  const piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Topshirish" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  mainCash = (await db.select().from(cashAccounts).where(and(eq(cashAccounts.companyId, company.companyId), eq(cashAccounts.isDefault, true))))[0]!.id;
  productId = (await call("POST", "/api/catalog/products", { name: "Non", sku: "NON", baseUnitId: piece, salesPrice: "5000" })).json().product.id;
  await call("POST", "/api/inventory/stock/movements", { type: "receive", productId, warehouseId: mainWh, quantity: "100", costPrice: "3000" });
});

const ledger = async (code: string) =>
  n((await db.select().from(accounts).where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, code))))[0]?.balance);
const companyCash = async () =>
  n((await db.select({ sum: sql<string>`coalesce(sum(${cashAccounts.balance}), 0)::numeric(18,2)` }).from(cashAccounts).where(and(eq(cashAccounts.companyId, company.companyId), eq(cashAccounts.type, "cash"))))[0]!.sum);

async function openShiftWithSales(cashAccountId?: string) {
  const shift = await pos("POST", "/shifts", { warehouseId: mainWh, ...(cashAccountId ? { cashAccountId } : {}) });
  expect(shift.statusCode, shift.body).toBe(201);
  const shiftId = shift.json().shift.id as string;
  const sale = await pos("POST", "/sales", { shiftId, items: [{ productId, quantity: "10" }], paymentMethod: "cash", amountPaid: "50000" });
  expect(sale.statusCode, sale.body).toBe(201);
  return shiftId;
}

describe("AUD-016 — POS 'boshqa chiqim' = asosiy kassaga topshirish (ichki o'tkazma)", () => {
  it("kassali smena: topshirish — o'tkazma (xarajat emas), xarajat — alohida; hisobotda ajraladi; kompaniya naqdi o'zgarmaydi", async () => {
    const kassa = (await call("POST", "/api/finance/cash-accounts", { name: "Kassa 1", type: "cash", code: "K1", warehouseId: mainWh })).json().cashAccount.id as string;
    const shiftId = await openShiftWithSales(kassa);
    const cashBefore = await companyCash();
    const otherExpenseBefore = await ledger("5500");

    const handover = await pos("POST", `/shifts/${shiftId}/cash-movements`, { kind: "other_out", amount: "20000", notes: "Kun o'rtasida" });
    expect(handover.statusCode, handover.body).toBe(201);
    const transfers = await db.select().from(cashTransactions).where(and(eq(cashTransactions.companyId, company.companyId), eq(cashTransactions.referenceType, "cash_transfer")));
    const out = transfers.find((row) => row.cashAccountId === kassa && row.type === "out")!;
    expect(out.description, "ma'nosi: asosiy kassaga topshirish").toMatch(/^Asosiy kassaga topshirish/);
    expect(transfers.find((row) => row.cashAccountId === mainCash && row.type === "in")?.amount).toBe("20000.00");
    expect(await companyCash(), "kompaniya naqdi o'zgarmaydi").toBe(cashBefore);
    expect(await ledger("5500"), "xarajat emas").toBe(otherExpenseBefore);
    expect(await db.$count(expenses, eq(expenses.companyId, company.companyId)), "xarajat hujjati yo'q").toBe(0);

    // Kategoriya berilsa ham topshirish xarajatga aylanmaydi
    expect((await pos("POST", `/shifts/${shiftId}/cash-movements`, { kind: "other_out", amount: "1000", category: "suv" })).statusCode).toBe(201);
    expect(await db.$count(expenses, eq(expenses.companyId, company.companyId))).toBe(0);

    // Real xarajat — faqat Xarajat turi: EXP- hujjati, o'tkazma emas
    const expense = await pos("POST", `/shifts/${shiftId}/cash-movements`, { kind: "expense", amount: "3000", category: "suv" });
    expect(expense.statusCode, expense.body).toBe(201);
    expect(await db.$count(expenses, eq(expenses.companyId, company.companyId))).toBe(1);
    const transferCount = await db.$count(cashTransactions, and(eq(cashTransactions.companyId, company.companyId), eq(cashTransactions.referenceType, "cash_transfer")));
    expect(transferCount, "xarajat o'tkazma yozmadi (2 topshirish × 2 tomon)").toBe(4);
    expect(await companyCash(), "real chiqim faqat xarajat summasi").toBe(cashBefore - 3000);

    const report = (await call("GET", `/api/analytics/reports/kassa?from=${todayIso()}&to=${todayIso()}`)).json().kassas as Record<string, string>[];
    const row = report.find((item) => item.cashAccountId === kassa || item.id === kassa)!;
    expect(row).toMatchObject({ transfersOut: "21000.00", expenses: "3000.00", otherOut: "0.00" });
  });

  it("kassasiz (tarixiy) smena: topshirish faqat smena hisoblagichi — kassa harakati ham, xarajat ham yo'q", async () => {
    const shiftId = await openShiftWithSales();
    const txBefore = await db.$count(cashTransactions, eq(cashTransactions.companyId, company.companyId));
    const res = await pos("POST", `/shifts/${shiftId}/cash-movements`, { kind: "other_out", amount: "10000" });
    expect(res.statusCode, res.body).toBe(201);
    expect(await db.$count(cashTransactions, eq(cashTransactions.companyId, company.companyId))).toBe(txBefore);
    expect(await db.$count(expenses, eq(expenses.companyId, company.companyId))).toBe(0);
    const shift = (await pos("GET", `/shifts/${shiftId}`)).json().shift;
    expect(n(shift.expectedCash), "smena kutilgan naqdi kamaydi").toBe(40_000);
  });
});
