/**
 * Qirqim (settlement): terminal puli "kutilayotgan" hisobga tushadi, komissiya to'lov paytida emas — qirqimda ushlanadi.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { accounts, cashAccounts, expenses } from "../src/db/schema/finance.js";
import { warehouses } from "../src/db/schema/inventory.js";
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
  company = await createCompany(app, admin.cookie, { name: "Qirqim do'koni" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  const rows = await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId));
  mainCash = rows.find((row) => row.type === "cash")!.id;
  mainBank = rows.find((row) => row.type === "bank")!.id;
});

const call = (cookie: string, method: "GET" | "POST" | "PATCH", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
const owner = () => company.ownerCookie;

const ledger = async (code: string) =>
  (await db.select({ balance: accounts.balance }).from(accounts).where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, code))))[0]?.balance ?? null;
const balanceOf = async (id: string) => (await db.select({ balance: cashAccounts.balance }).from(cashAccounts).where(eq(cashAccounts.id, id)))[0]!.balance;
const bankFees = () =>
  db
    .select({ amount: expenses.amount, status: expenses.status, referenceType: expenses.referenceType })
    .from(expenses)
    .where(and(eq(expenses.companyId, company.companyId), eq(expenses.category, "bank komissiyasi")));

/** Kutilayotgan (karta) hisob — standartda mainBank ga 0.25% bilan qirqiladi. */
async function clearingAccount(body: object = {}) {
  const res = await call(owner(), "POST", "/api/finance/cash-accounts", {
    name: "UZCARD kutilayotgan",
    type: "card",
    settlesToCashAccountId: mainBank,
    settlementCommissionPercent: "0.25",
    ...body,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().cashAccount as { id: string; type: string; settlementCommissionPercent: string };
}

const settlements = async () => (await call(owner(), "GET", "/api/finance/settlements")).json().accounts as {
  id: string;
  pending: string;
  today: string;
  commissionPercent: string;
  settlesTo: { id: string; name: string } | null;
  terminals: { name: string }[];
}[];

describe("Qirqim (settlement)", () => {
  it("karta to'lovi kutilayotgan hisobga tushadi — komissiya to'lovda emas, qirqimda ushlanadi", async () => {
    const clearing = await clearingAccount();
    // Terminal foizi 1% — kutilayotgan hisobda u ishlatilmaydi, qirqim foizi (0.25%) ushlanadi
    const terminal = await call(owner(), "POST", "/api/finance/terminals", {
      name: "UZCARD",
      network: "uzcard",
      cashAccountId: clearing.id,
      commissionPercent: "1",
    });
    expect(terminal.statusCode, terminal.body).toBe(201);
    const terminalId = terminal.json().terminal.id as string;

    const product = await call(owner(), "POST", "/api/catalog/products", { name: "Televizor", sku: "TV", baseUnitId: piece, salesPrice: "100000", taxRate: "0" });
    const productId = product.json().product.id as string;
    expect((await call(owner(), "POST", "/api/inventory/stock/movements", { type: "receive", productId, warehouseId: mainWh, quantity: "5", costPrice: "50000" })).statusCode).toBe(201);

    const kassir = await addEmployee(app, company, "Kassir");
    const shift = await call(kassir.cookie, "POST", "/api/sales/pos/shifts", { warehouseId: mainWh, openingCash: "0" });
    expect(shift.statusCode, shift.body).toBe(201);
    const sale = await call(kassir.cookie, "POST", "/api/sales/pos/sales", {
      shiftId: shift.json().shift.id,
      items: [{ productId, quantity: "1" }],
      clientRequestId: randomUUID(),
      payments: [{ method: "card", amount: "100000", terminalId }],
    });
    expect(sale.statusCode, sale.body).toBe(201);
    expect(sale.json()).toMatchObject({ paid: "100000.00", debt: "0.00" });

    // To'lov paytida komissiya yo'q: pul to'liq kutilayotgan hisobda, bank tegilmagan
    expect(await balanceOf(clearing.id)).toBe("100000.00");
    expect(await balanceOf(mainBank)).toBe("0.00");
    expect(await bankFees()).toHaveLength(0);
    expect([await ledger("1030"), await ledger("1020"), await ledger("5800")]).toEqual(["100000.00", "0.00", "0.00"]);

    // "UZCARD'dan kutilayotgan": qirqilmagan qoldiq, bugungi tushum va terminal nomi
    expect(await settlements()).toMatchObject([
      { id: clearing.id, pending: "100000.00", today: "100000.00", commissionPercent: "0.25", settlesTo: { id: mainBank }, terminals: [{ name: "UZCARD" }] },
    ]);

    // Qirqim: 0.25% ushlanadi, qolgani bank hisobiga
    const settled = await call(owner(), "POST", `/api/finance/cash-accounts/${clearing.id}/settle`, {});
    expect(settled.statusCode, settled.body).toBe(201);
    expect(settled.json().settlement).toMatchObject({ amount: "100000.00", commission: "250.00", net: "99750.00", toCashAccountId: mainBank, pending: "0.00" });

    expect(await balanceOf(clearing.id)).toBe("0.00");
    expect(await balanceOf(mainBank)).toBe("99750.00");
    expect(await bankFees()).toMatchObject([{ amount: "250.00", status: "paid", referenceType: "cash_settlement" }]);
    expect([await ledger("1030"), await ledger("1020"), await ledger("5800")]).toEqual(["0.00", "99750.00", "250.00"]);

    // Bank hisobi tarixida qirqim ko'rinadi
    const history = (await call(owner(), "GET", `/api/finance/cash-accounts/${mainBank}/transactions`)).json().transactions as { type: string; amount: string; description: string }[];
    expect(history.some((tx) => tx.type === "in" && tx.amount === "99750.00" && tx.description.startsWith("Qirqim:"))).toBe(true);
    expect((await settlements())[0]).toMatchObject({ pending: "0.00" });
  });

  it("qirqim qoidalari: qoldiqdan ortiq emas, faqat kutilayotgan hisob, manzilsiz terminal ulanmaydi", async () => {
    const clearing = await clearingAccount({ settlesToCashAccountId: null, settlementCommissionPercent: "0" });
    expect(clearing.type).toBe("card");

    // Manzili belgilanmagan kutilayotgan hisobga terminal ulanmaydi
    const early = await call(owner(), "POST", "/api/finance/terminals", { name: "HUMO", network: "humo", cashAccountId: clearing.id });
    expect(early.statusCode, early.body).toBe(400);

    // Qirqim sozlamasi bank hisobida bo'lmaydi
    expect((await call(owner(), "PATCH", `/api/finance/cash-accounts/${mainBank}`, { settlementCommissionPercent: "1" })).statusCode).toBe(400);
    expect((await call(owner(), "POST", "/api/finance/cash-accounts", { name: "Bank 2", type: "bank", settlementCommissionPercent: "1" })).statusCode).toBe(400);
    // Naqd kassa qirqim manzili bo'la olmaydi
    expect((await call(owner(), "PATCH", `/api/finance/cash-accounts/${clearing.id}`, { settlesToCashAccountId: mainCash })).statusCode).toBe(400);

    expect((await call(owner(), "PATCH", `/api/finance/cash-accounts/${clearing.id}`, { settlesToCashAccountId: mainBank })).statusCode).toBe(200);
    // Pul yo'q — qirqiladigan summa yo'q
    expect((await call(owner(), "POST", `/api/finance/cash-accounts/${clearing.id}/settle`, {})).statusCode).toBe(400);

    const capital = (await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, "3000"))))[0]!;
    expect((await call(owner(), "POST", "/api/finance/cash-transactions", { cashAccountId: clearing.id, type: "in", amount: "50000", description: "Terminal tushumi", counterAccountId: capital.id })).statusCode).toBe(201);

    // Qoldiqdan ortiq qirqilmaydi
    expect((await call(owner(), "POST", `/api/finance/cash-accounts/${clearing.id}/settle`, { amount: "50001" })).statusCode).toBe(400);
    // Bank hisobini qirqib bo'lmaydi
    expect((await call(owner(), "POST", `/api/finance/cash-accounts/${mainBank}/settle`, {})).statusCode).toBe(400);

    // Qisman qirqim: komissiya 0 — to'liq summa bankka
    const part = await call(owner(), "POST", `/api/finance/cash-accounts/${clearing.id}/settle`, { amount: "20000" });
    expect(part.statusCode, part.body).toBe(201);
    expect(part.json().settlement).toMatchObject({ amount: "20000.00", commission: "0.00", net: "20000.00", pending: "30000.00" });
    expect(await balanceOf(clearing.id)).toBe("30000.00");
    expect(await balanceOf(mainBank)).toBe("20000.00");
    expect(await bankFees()).toHaveLength(0);
  });
});
