import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { accounts, cashAccounts, cashTransactions } from "../src/db/schema/finance.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
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
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Kassa kompaniyasi" });
  const rows = await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId));
  mainCash = rows.find((r) => r.type === "cash")!.id;
  mainBank = rows.find((r) => r.type === "bank")!.id;
});

const api = (cookie: string, method: "GET" | "POST" | "PATCH", url: string, payload?: object) =>
  app.inject({ method, url: `/api/finance${url}`, headers: { cookie }, ...(payload ? { payload } : {}) });

async function ledger(code: string) {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, code)));
  return row!;
}

async function cashBalance(id: string) {
  const [row] = await db.select().from(cashAccounts).where(eq(cashAccounts.id, id));
  return row!.balance;
}

const record = (body: object, cookie = company.ownerCookie) =>
  api(cookie, "POST", "/cash-transactions", { description: "Sinov", ...body });

describe("Kassa va bank", () => {
  it("boshlang'ich qoldiq: kirim tranzaksiyasi va DR kassa / CR ustav kapitali", async () => {
    const res = await api(company.ownerCookie, "POST", "/cash-accounts", {
      name: "Filial kassasi",
      type: "cash",
      openingBalance: "500000",
    });
    expect(res.statusCode).toBe(201);
    const created = res.json().cashAccount;
    expect(created).toMatchObject({ balance: "500000.00", currency: "UZS", isDefault: false });

    const txs = (await api(company.ownerCookie, "GET", `/cash-accounts/${created.id}/transactions`)).json().transactions;
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ type: "in", category: "opening_balance", balanceAfter: "500000.00" });
    expect((await ledger("1010")).balance).toBe("500000.00");
    expect((await ledger("3000")).balance).toBe("500000.00");
  });

  it("kirim/chiqim: yetmasa 400 va hech narsa yozilmaydi; qarshi hisob bilan jurnal yozuvi", async () => {
    const otherIncome = await ledger("4100");
    const income = await record({ cashAccountId: mainCash, type: "in", amount: "300000", counterAccountId: otherIncome.id });
    expect(income.statusCode).toBe(201);
    expect(income.json().journalEntryId).not.toBeNull();
    expect((await ledger("1010")).balance).toBe("300000.00");
    expect((await ledger("4100")).balance).toBe("300000.00");

    const tooMuch = await record({ cashAccountId: mainCash, type: "out", amount: "500000" });
    expect(tooMuch.statusCode).toBe(400);
    expect(tooMuch.json().message).toContain("yetarli");
    expect(await cashBalance(mainCash)).toBe("300000.00");
    expect(await db.select().from(cashTransactions).where(eq(cashTransactions.cashAccountId, mainCash))).toHaveLength(1);

    const plain = await record({ cashAccountId: mainCash, type: "out", amount: "100000.25" });
    expect(plain.json()).toMatchObject({ journalEntryId: null, transaction: { balanceAfter: "199999.75" } });

    const cashLedger = await ledger("1010");
    const self = await record({ cashAccountId: mainCash, type: "in", amount: "1", counterAccountId: cashLedger.id });
    expect(self.statusCode).toBe(400);
    expect((await record({ cashAccountId: mainCash, type: "transfer", amount: "1" })).statusCode).toBe(400);
    expect((await record({ cashAccountId: mainCash, type: "in", amount: "0" })).statusCode).toBe(400);
  });

  it("o'tkazma kassa → bank: ikki tranzaksiya va DR bank / CR kassa", async () => {
    const capital = await ledger("3000");
    await record({ cashAccountId: mainCash, type: "in", amount: "1000000", counterAccountId: capital.id });

    const res = await api(company.ownerCookie, "POST", "/cash-transfers", {
      fromCashAccountId: mainCash,
      toCashAccountId: mainBank,
      amount: "400000",
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().journalEntryId).not.toBeNull();
    expect(await cashBalance(mainCash)).toBe("600000.00");
    expect(await cashBalance(mainBank)).toBe("400000.00");
    expect((await ledger("1010")).balance).toBe("600000.00");
    expect((await ledger("1020")).balance).toBe("400000.00");

    const pair = await db.select().from(cashTransactions).where(eq(cashTransactions.referenceId, res.json().referenceId));
    expect(pair.map((t) => t.type).sort()).toEqual(["in", "out"]);

    const same = { fromCashAccountId: mainCash, toCashAccountId: mainCash, amount: "1" };
    expect((await api(company.ownerCookie, "POST", "/cash-transfers", same)).statusCode).toBe(400);
    const tooMuch = { fromCashAccountId: mainBank, toCashAccountId: mainCash, amount: "400000.01" };
    expect((await api(company.ownerCookie, "POST", "/cash-transfers", tooMuch)).statusCode).toBe(400);
    expect(await cashBalance(mainBank)).toBe("400000.00");
  });

  it("parallel chiqimlar kassani manfiyga tushirmaydi", async () => {
    await record({ cashAccountId: mainCash, type: "in", amount: "100" });
    const results = await Promise.all(
      [1, 2, 3].map(() => record({ cashAccountId: mainCash, type: "out", amount: "40" })),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 201, 400]);
    expect(await cashBalance(mainCash)).toBe("20.00");
  });

  it("dashboard, asosiy kassa yagonaligi, faolsizlantirish qoidalari va ruxsatlar", async () => {
    await record({ cashAccountId: mainBank, type: "in", amount: "50" });
    const dashboard = (await api(company.ownerCookie, "GET", "/dashboard")).json();
    expect(dashboard).toMatchObject({
      totalCash: "0.00",
      totalBank: "50.00",
      totalBalance: "50.00",
      monthIncome: "50.00",
      monthExpense: "0.00",
      monthNetCash: "50.00",
      monthSalesTotal: "0.00",
      monthPurchaseTotal: "0.00",
    });
    expect(dashboard.accounts).toHaveLength(2);

    const second = (await api(company.ownerCookie, "POST", "/cash-accounts", { name: "Yangi kassa", type: "cash", isDefault: true })).json().cashAccount;
    const defaults = await db
      .select()
      .from(cashAccounts)
      .where(and(eq(cashAccounts.companyId, company.companyId), eq(cashAccounts.isDefault, true)));
    expect(defaults.map((d) => d.id)).toEqual([second.id]);

    expect((await api(company.ownerCookie, "PATCH", `/cash-accounts/${second.id}`, { isActive: false })).statusCode).toBe(400);
    expect((await api(company.ownerCookie, "PATCH", `/cash-accounts/${mainBank}`, { isActive: false })).statusCode).toBe(409);
    expect((await api(company.ownerCookie, "PATCH", `/cash-accounts/${mainCash}`, { isActive: false })).statusCode).toBe(200);

    const kassir = await addEmployee(app, company, "Kassir");
    expect((await record({ cashAccountId: mainBank, type: "in", amount: "1" }, kassir.cookie)).statusCode).toBe(403);
    const sales = await addEmployee(app, company, "Savdo menejeri");
    expect((await api(sales.cookie, "GET", "/cash-accounts")).statusCode).toBe(200);
    expect((await record({ cashAccountId: mainBank, type: "in", amount: "1" }, sales.cookie)).statusCode).toBe(403);
  });
});
