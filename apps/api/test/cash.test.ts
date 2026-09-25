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

/**
 * Kirim/chiqim maqsadi (moliya moddasi) endi MAJBURIY — testlarda sukut bo'yicha
 * birinchi daromad/xarajat moddasi olinadi.
 */
async function purposeFor(type: "in" | "out") {
  // Ro'yxat doim egasining cookie'si bilan olinadi — ruxsati yo'q xodim tekshiruvi
  // maqsad qidirishda emas, so'rovning o'zida sodir bo'lishi kerak
  const res = await api(company.ownerCookie, "GET", `/accounts?type=${type === "in" ? "income" : "expense"}`);
  const accounts = res.json().accounts as { id: string; isActive: boolean; subtype: string | null }[];
  // Sotuv daromadi (4000) va tannarx (5000) qo'lda kassa harakatiga yaramaydi (audit AUD-012) — oddiy modda olinadi
  return accounts.find((row) => row.isActive && !["sales", "cogs"].includes(row.subtype ?? ""))!.id;
}

const record = async (body: { type?: string } & Record<string, unknown>, cookie = company.ownerCookie) =>
  api(cookie, "POST", "/cash-transactions", {
    description: "Sinov",
    counterAccountId: await purposeFor(body.type === "out" ? "out" : "in"),
    ...body,
  });

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

    // Maqsad (moliya moddasi) MAJBURIY — berilmasa so'rov rad etiladi
    const noPurpose = await api(company.ownerCookie, "POST", "/cash-transactions", {
      cashAccountId: mainCash,
      type: "out",
      amount: "1000",
      description: "Maqsadsiz",
    });
    expect(noPurpose.statusCode, noPurpose.body).toBe(400);

    // "Boshqa xarajatlar" (5500) tanlangan chiqim: kassa va buxgalteriya sinxron qoladi
    const other = await ledger("5500");
    const plain = await record({ cashAccountId: mainCash, type: "out", amount: "100000.25", counterAccountId: other.id });
    expect(plain.json()).toMatchObject({ transaction: { balanceAfter: "199999.75" } });
    expect(plain.json().journalEntryId).not.toBeNull();
    expect((await ledger("1010")).balance).toBe("199999.75");
    expect((await ledger("5500")).balance).toBe("100000.25");

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

  it("kassaning mas'ul xodimi: rahbar kassasi mas'ulsiz, qolganlari xodimga biriktiriladi", async () => {
    /** HR kartochkasi (dasturga kirmaydigan xodim ham bo'lishi mumkin). */
    const hrEmployee = async (cookie: string, name: string) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/hr/employees",
        headers: { cookie },
        payload: { name, hireDate: new Date().toISOString().slice(0, 10), baseSalary: "0", salaryType: "monthly" },
      });
      if (res.statusCode !== 201) throw new Error(`Xodim yaratilmadi: ${res.statusCode} ${res.body}`);
      return res.json().employee as { id: string; name: string };
    };

    const diana = await hrEmployee(company.ownerCookie, "Axmedova Diana");

    // Xodimga biriktirilgan kassa
    const created = await api(company.ownerCookie, "POST", "/cash-accounts", {
      name: "Kassir Diana",
      type: "cash",
      employeeId: diana.id,
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().cashAccount.employeeId).toBe(diana.id);

    // Ro'yxatda mas'ul xodim ismi bilan; rahbar (asosiy) kassa mas'ulsiz va birinchi
    const list = (await api(company.ownerCookie, "GET", "/cash-accounts")).json().cashAccounts as {
      id: string;
      isDefault: boolean;
      employeeId: string | null;
      employeeName: string | null;
    }[];
    expect(list[0]!.isDefault, "asosiy (rahbar) kassa birinchi").toBe(true);
    expect(list[0]!.employeeId).toBeNull();
    const linkedId = created.json().cashAccount.id as string;
    expect(list.find((row) => row.id === linkedId)!.employeeName).toBe("Axmedova Diana");

    // Bog'lanishni bo'shatish va qayta biriktirish
    expect((await api(company.ownerCookie, "PATCH", `/cash-accounts/${linkedId}`, { employeeId: null })).json().cashAccount.employeeId).toBeNull();
    expect((await api(company.ownerCookie, "PATCH", `/cash-accounts/${linkedId}`, { employeeId: diana.id })).json().cashAccount.employeeId).toBe(diana.id);

    // Begona kompaniya xodimi biriktirilmaydi
    const admin = await signedIn(app, { isPlatformAdmin: true });
    const other = await createCompany(app, admin.cookie, { name: "Boshqa kompaniya" });
    const foreign = await hrEmployee(other.ownerCookie, "Begona xodim");
    const rejected = await api(company.ownerCookie, "POST", "/cash-accounts", { name: "Begona kassa", type: "cash", employeeId: foreign.id });
    expect(rejected.statusCode, rejected.body).toBe(404);
  });
});
