import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { accounts, cashAccounts, cashTransactions, journalEntries } from "../src/db/schema/finance.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
let other: Company;
let mainCash: string;

const today = new Date().toISOString().slice(0, 10);
const year = today.slice(0, 4);

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
  company = await createCompany(app, admin.cookie, { name: "Xarajat kompaniyasi" });
  other = await createCompany(app, admin.cookie, { name: "Boshqa kompaniya" });
  const [cash] = await db
    .select()
    .from(cashAccounts)
    .where(and(eq(cashAccounts.companyId, company.companyId), eq(cashAccounts.isDefault, true)));
  mainCash = cash!.id;
});

const api = (cookie: string, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) =>
  app.inject({ method, url: `/api/finance${url}`, headers: { cookie }, ...(payload ? { payload } : {}) });

async function ledger(code: string) {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, code)));
  return row!;
}

async function fund(amount: string) {
  const capital = await ledger("3000");
  const res = await api(company.ownerCookie, "POST", "/cash-transactions", {
    cashAccountId: mainCash,
    type: "in",
    amount,
    description: "Kassaga kirim",
    counterAccountId: capital.id,
  });
  expect(res.statusCode).toBe(201);
}

const create = (body: object, cookie = company.ownerCookie) =>
  api(cookie, "POST", "/expenses", { category: "boshqa", description: "Sinov", amount: "1000", expenseDate: today, ...body });
const setStatus = (id: string, body: object, cookie = company.ownerCookie) =>
  api(cookie, "POST", `/expenses/${id}/status`, body);

describe("Xarajatlar", () => {
  it("raqamlash, tahrir, tasdiq va to'lov: kassa chiqimi va DR ijara / CR kassa", async () => {
    await fund("1000000");

    const first = await create({ category: "ijara", description: "Sentabr ijarasi", amount: "300000" });
    expect(first.statusCode).toBe(201);
    const expense = first.json().expense;
    expect(expense).toMatchObject({ number: `EXP-${year}-0001`, status: "pending", amount: "300000.00" });
    const second = (await create({})).json().expense;
    expect(second.number).toBe(`EXP-${year}-0002`);

    expect((await api(company.ownerCookie, "PATCH", `/expenses/${expense.id}`, { amount: "350000" })).json().expense.amount).toBe("350000.00");

    expect((await setStatus(expense.id, { status: "paid" })).statusCode).toBe(400);
    expect((await setStatus(expense.id, { status: "approved" })).statusCode).toBe(200);
    expect((await api(company.ownerCookie, "PATCH", `/expenses/${expense.id}`, { amount: "1" })).statusCode).toBe(400);

    const paid = await setStatus(expense.id, { status: "paid" });
    expect(paid.statusCode).toBe(200);
    expect(paid.json().expense.status).toBe("paid");
    expect(paid.json().payment.journalEntryId).toBeTruthy();

    const [cash] = await db.select().from(cashAccounts).where(eq(cashAccounts.id, mainCash));
    expect(cash!.balance).toBe("650000.00");
    expect((await ledger("5200")).balance).toBe("350000.00");
    expect((await ledger("1010")).balance).toBe("650000.00");

    const [outflow] = await db.select().from(cashTransactions).where(eq(cashTransactions.referenceId, expense.id));
    expect(outflow).toMatchObject({ type: "out", amount: "350000.00", category: "ijara" });
    const [entry] = await db.select().from(journalEntries).where(eq(journalEntries.referenceId, expense.id));
    expect(entry).toMatchObject({ referenceType: "expense", totalDebit: "350000.00" });

    expect((await setStatus(expense.id, { status: "pending" })).statusCode).toBe(400);
    expect((await api(company.ownerCookie, "DELETE", `/expenses/${expense.id}`)).statusCode).toBe(400);
    expect((await api(company.ownerCookie, "DELETE", `/expenses/${second.id}`)).statusCode).toBe(204);
  });

  it("kassa yetmasa to'lov 400 va xarajat tasdiqlangan qoladi; noma'lum kategoriya → Boshqa xarajatlar", async () => {
    const expense = (await create({ category: "reklama", amount: "100" })).json().expense;
    await setStatus(expense.id, { status: "approved" });

    const failed = await setStatus(expense.id, { status: "paid" });
    expect(failed.statusCode).toBe(400);
    const listed = (await api(company.ownerCookie, "GET", "/expenses?status=approved")).json().expenses;
    expect(listed.map((e: { id: string }) => e.id)).toEqual([expense.id]);
    expect(await db.select().from(journalEntries).where(eq(journalEntries.referenceId, expense.id))).toHaveLength(0);

    await fund("200");
    expect((await setStatus(expense.id, { status: "paid", cashAccountId: mainCash })).statusCode).toBe(200);
    expect((await ledger("5500")).balance).toBe("100.00");

    const incomeAccount = await ledger("4000");
    expect((await create({ accountId: incomeAccount.id })).statusCode).toBe(400);
  });

  it("parallel yaratishda raqamlar takrorlanmaydi; statistika va kursorli ro'yxat", async () => {
    const results = await Promise.all([1, 2, 3, 4, 5].map((i) => create({ description: `Parallel ${i}` })));
    expect(results.every((r) => r.statusCode === 201)).toBe(true);
    const numbers = new Set(results.map((r) => r.json().expense.number));
    expect(numbers.size).toBe(5);

    const stats = (await api(company.ownerCookie, "GET", "/expenses/stats")).json();
    expect(stats).toMatchObject({ totalThisMonth: "5000.00", countThisMonth: 5, pendingCount: 5, pendingAmount: "5000.00" });
    expect(stats.byCategory).toEqual([{ category: "boshqa", total: "5000.00" }]);

    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const url: string = `/expenses?limit=2${cursor ? `&cursor=${cursor}` : ""}`;
      const page = (await api(company.ownerCookie, "GET", url)).json() as { expenses: { id: string }[]; nextCursor: string | null };
      ids.push(...page.expenses.map((e) => e.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(new Set(ids).size).toBe(5);
  });

  it("ruxsatlar: Savdo menejeri ko'radi, yarata olmaydi; Moliya menejeri yaratadi, boshqa mas'ul tasdiqlaydi; begona xarajat 404", async () => {
    const sales = await addEmployee(app, company, "Savdo menejeri");
    const finance = await addEmployee(app, company, "Moliya menejeri");

    expect((await api(sales.cookie, "GET", "/expenses")).statusCode).toBe(200);
    expect((await create({}, sales.cookie)).statusCode).toBe(403);

    const created = await create({}, finance.cookie);
    expect(created.statusCode).toBe(201);
    // Vazifalar ajratimi: kiritgan xodim o'zi tasdiqlamaydi
    expect((await setStatus(created.json().expense.id, { status: "approved" }, finance.cookie)).statusCode).toBe(403);
    const approver = await addEmployee(app, company, "Moliya menejeri");
    expect((await setStatus(created.json().expense.id, { status: "approved" }, approver.cookie)).statusCode).toBe(200);
    expect((await setStatus(created.json().expense.id, { status: "pending" }, sales.cookie)).statusCode).toBe(403);

    expect((await setStatus(created.json().expense.id, { status: "pending" }, other.ownerCookie)).statusCode).toBe(404);
    expect((await api(other.ownerCookie, "DELETE", `/expenses/${created.json().expense.id}`)).statusCode).toBe(404);
  });
});
