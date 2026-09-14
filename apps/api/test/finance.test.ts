import { and, count, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { accounts, cashAccounts, journalEntries, journalLines } from "../src/db/schema/finance.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let companyA: Company;
let companyB: Company;

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
  companyA = await createCompany(app, admin.cookie, { name: "A kompaniya" });
  companyB = await createCompany(app, admin.cookie, { name: "B kompaniya" });
});

const api = (cookie: string, method: "GET" | "POST" | "PATCH", url: string, payload?: object) =>
  app.inject({ method, url: `/api/finance${url}`, headers: { cookie }, ...(payload ? { payload } : {}) });

async function account(company: Company, code: string) {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, code)));
  return row!;
}

describe("Hisoblar rejasi", () => {
  it("kompaniya yaratilganda standart hisoblar va kassalar ochiladi; setup idempotent", async () => {
    const list = (await api(companyA.ownerCookie, "GET", "/accounts")).json().accounts;
    // 21 asosiy + 5800 "Bank komissiyasi xarajatlari"
    expect(list).toHaveLength(22);
    expect(list[0]).toMatchObject({ code: "1010", type: "asset", subtype: "cash", balance: "0.00" });

    const cash = await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, companyA.companyId));
    expect(cash.map((c) => [c.type, c.isDefault]).sort()).toEqual([["bank", false], ["cash", true]]);

    expect((await api(companyA.ownerCookie, "POST", "/setup")).json()).toEqual({ accountsCreated: 0, cashAccountsCreated: 0 });

    // Hisoblar rejasi yo'q eski kompaniya
    await db.delete(accounts).where(eq(accounts.companyId, companyB.companyId));
    expect((await api(companyB.ownerCookie, "POST", "/setup")).json()).toEqual({ accountsCreated: 22, cashAccountsCreated: 0 });
  });

  it("yaratish va tahrirlash: kod noyob, ota hisob turi va sikli, ruxsatlar", async () => {
    const rent = await account(companyA, "5200");
    const created = await api(companyA.ownerCookie, "POST", "/accounts", {
      code: "5210",
      name: "Ofis ijarasi",
      type: "expense",
      subtype: "rent",
      parentId: rent.id,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().account).toMatchObject({ code: "5210", currency: "UZS", balance: "0.00" });

    expect((await api(companyA.ownerCookie, "POST", "/accounts", { code: "5210", name: "X", type: "expense" })).statusCode).toBe(409);

    const cash = await account(companyA, "1010");
    const wrongType = { code: "5220", name: "X", type: "expense", parentId: cash.id };
    expect((await api(companyA.ownerCookie, "POST", "/accounts", wrongType)).statusCode).toBe(400);

    const foreign = await account(companyB, "5200");
    const foreignParent = { code: "5230", name: "X", type: "expense", parentId: foreign.id };
    expect((await api(companyA.ownerCookie, "POST", "/accounts", foreignParent)).statusCode).toBe(400);

    const cycle = await api(companyA.ownerCookie, "PATCH", `/accounts/${rent.id}`, { parentId: created.json().account.id });
    expect(cycle.statusCode).toBe(400);

    const sales = await addEmployee(app, companyA, "Savdo menejeri");
    expect((await api(sales.cookie, "GET", "/accounts")).statusCode).toBe(200);
    expect((await api(sales.cookie, "POST", "/accounts", { code: "9", name: "X", type: "asset" })).statusCode).toBe(403);
    const kassir = await addEmployee(app, companyA, "Kassir");
    expect((await api(kassir.cookie, "GET", "/accounts")).statusCode).toBe(403);
  });
});

describe("Buxgalteriya jurnali", () => {
  it("qo'lda yozuv balanslarni yangilaydi; hisobotlar; bekor qilish balansni qaytaradi", async () => {
    const cash = await account(companyA, "1010");
    const capital = await account(companyA, "3000");
    const rent = await account(companyA, "5200");

    const first = await api(companyA.ownerCookie, "POST", "/journal", {
      entryDate: today,
      description: "Ta'sischi hissasi",
      lines: [
        { accountId: cash.id, debit: "1000000" },
        { accountId: capital.id, credit: "1000000" },
      ],
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().entry).toMatchObject({ number: `JE-${year}-00001`, status: "posted", totalDebit: "1000000.00" });
    expect(first.json().entry.lines).toHaveLength(2);

    const second = await api(companyA.ownerCookie, "POST", "/journal", {
      entryDate: today,
      description: "Ijara",
      lines: [
        { accountId: rent.id, debit: "250000.50" },
        { accountId: cash.id, credit: "250000.50" },
      ],
    });
    expect(second.json().entry.number).toBe(`JE-${year}-00002`);
    expect((await account(companyA, "1010")).balance).toBe("749999.50");
    expect((await account(companyA, "3000")).balance).toBe("1000000.00");
    expect((await account(companyA, "5200")).balance).toBe("250000.50");

    const tb = (await api(companyA.ownerCookie, "GET", "/reports/trial-balance")).json();
    expect(tb).toMatchObject({ totalDebit: "1250000.50", totalCredit: "1250000.50", balanced: true });
    expect(tb.rows).toHaveLength(3);

    const pl = (await api(companyA.ownerCookie, "GET", `/reports/profit-loss?dateFrom=${today}`)).json();
    expect(pl).toMatchObject({ totalIncome: "0.00", totalExpense: "250000.50", netProfit: "-250000.50" });

    const voided = await api(companyA.ownerCookie, "POST", `/journal/${second.json().entry.id}/void`);
    expect(voided.statusCode).toBe(200);
    expect(voided.json().entry.status).toBe("voided");
    expect((await account(companyA, "1010")).balance).toBe("1000000.00");
    expect((await account(companyA, "5200")).balance).toBe("0.00");
    expect((await api(companyA.ownerCookie, "POST", `/journal/${second.json().entry.id}/void`)).statusCode).toBe(400);

    const after = (await api(companyA.ownerCookie, "GET", "/reports/trial-balance")).json();
    expect(after.totalDebit).toBe("1000000.00");

    const page = (await api(companyA.ownerCookie, "GET", "/journal?status=posted")).json();
    expect(page.entries.map((e: { number: string }) => e.number)).toEqual([`JE-${year}-00001`]);
  });

  it("balanslanmagan, noto'g'ri qatorlar va begona hisob rad etiladi; hech narsa yozilmaydi", async () => {
    const cash = await account(companyA, "1010");
    const capital = await account(companyA, "3000");
    const foreign = await account(companyB, "3000");
    const post = (lines: object[]) =>
      api(companyA.ownerCookie, "POST", "/journal", { entryDate: today, description: "Sinov", lines });

    const unbalanced = await post([{ accountId: cash.id, debit: "100" }, { accountId: capital.id, credit: "90" }]);
    expect(unbalanced.statusCode).toBe(400);
    expect(unbalanced.json().message).toContain("balanslanmagan");

    const both = await post([{ accountId: cash.id, debit: "100", credit: "100" }, { accountId: capital.id, credit: "0" }]);
    expect(both.statusCode).toBe(400);
    expect((await post([{ accountId: cash.id, debit: "100" }])).statusCode).toBe(400);
    expect((await post([{ accountId: cash.id, debit: "100" }, { accountId: foreign.id, credit: "100" }])).statusCode).toBe(400);

    const sales = await addEmployee(app, companyA, "Savdo menejeri");
    const forbidden = await api(sales.cookie, "POST", "/journal", {
      entryDate: today,
      description: "X",
      lines: [{ accountId: cash.id, debit: "1" }, { accountId: capital.id, credit: "1" }],
    });
    expect(forbidden.statusCode).toBe(403);

    const [entries] = await db.select({ value: count() }).from(journalEntries);
    expect(entries?.value).toBe(0);
    expect((await account(companyA, "1010")).balance).toBe("0.00");
  });

  it("baza darajasida: balanslanmagan yozuv tranzaksiya oxirida rad etiladi", async () => {
    const cash = await account(companyA, "1010");
    const capital = await account(companyA, "3000");

    const insert = (credit: string, number: string) =>
      db.transaction(async (tx) => {
        const [entry] = await tx
          .insert(journalEntries)
          .values({ companyId: companyA.companyId, number, entryDate: today, description: "To'g'ridan-to'g'ri", totalDebit: "100", totalCredit: credit })
          .returning();
        await tx.insert(journalLines).values([
          { companyId: companyA.companyId, entryId: entry!.id, accountId: cash.id, debit: "100" },
          { companyId: companyA.companyId, entryId: entry!.id, accountId: capital.id, credit },
        ]);
      });

    const error = await insert("99.50", "JE-X-1").then(
      () => null,
      (e: { code?: string; cause?: { code?: string } }) => e,
    );
    expect(error?.code ?? error?.cause?.code).toBe("23514");

    await expect(insert("100", "JE-X-2")).resolves.toBeUndefined();
  });
});
