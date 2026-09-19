/**
 * Qo'shimcha to'lovlar (yo'l puli, ovqat puli): xodimga va davrga biriktiriladi,
 * maosh tayyorlashda avtomatik qo'shiladi (soliqqa kirmaydi), xarajatda esa to'lov turi majburiy.
 */
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { accounts, cashAccounts, journalEntries, journalLines } from "../src/db/schema/finance.js";
import { salaryPayments } from "../src/db/schema/hr.js";
import { buildServer } from "../src/server.js";
import { createCompany, resetDatabase, signedIn } from "./helpers.js";

let app: FastifyInstance;
let adminCookie: string;
let company: Awaited<ReturnType<typeof createCompany>>;
let employeeId: string;

const call = (cookie: string, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

const owner = () => company.ownerCookie;

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
  adminCookie = (await signedIn(app, { isPlatformAdmin: true })).cookie;
  company = await createCompany(app, adminCookie, { name: "Maosh qo'shimchalari" });
  const employee = await call(owner(), "POST", "/api/hr/employees", {
    name: "Aliyev Ali",
    hireDate: "2026-01-05",
    baseSalary: "3000000",
    salaryType: "monthly",
  });
  expect(employee.statusCode, employee.body).toBe(201);
  employeeId = employee.json().employee.id as string;
});

describe("Xodimning qo'shimcha to'lovlari", () => {
  it("yo'l va ovqat puli davri bilan biriktiriladi va ro'yxatda ko'rinadi", async () => {
    const transport = await call(owner(), "POST", "/api/hr/allowances", {
      employeeId,
      kind: "transport",
      amount: "300000",
      startMonth: "2026-02",
      endMonth: "2026-06",
    });
    expect(transport.statusCode, transport.body).toBe(201);

    const meal = await call(owner(), "POST", "/api/hr/allowances", {
      employeeId,
      kind: "meal",
      amount: "500000",
      startMonth: "2026-01",
    });
    expect(meal.statusCode, meal.body).toBe(201);

    const list = await call(owner(), "GET", `/api/hr/allowances?employeeId=${employeeId}`);
    expect(list.statusCode).toBe(200);
    const rows = list.json().allowances as { kind: string; amount: string; employeeName: string; endMonth: string | null }[];
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.employeeName === "Aliyev Ali")).toBe(true);

    // Davr bo'yicha filtr: 2026-07 da yo'l puli tugagan, ovqat puli davom etadi
    const july = await call(owner(), "GET", "/api/hr/allowances?month=2026-07");
    expect((july.json().allowances as { kind: string }[]).map((row) => row.kind)).toEqual(["meal"]);

    // 2026-03 da ikkalasi ham amalda
    const march = await call(owner(), "GET", "/api/hr/allowances?month=2026-03");
    expect((march.json().allowances as { kind: string }[]).length).toBe(2);
  });

  it("noto'g'ri davr va summa rad etiladi; «Boshqa» uchun nom majburiy", async () => {
    const badPeriod = await call(owner(), "POST", "/api/hr/allowances", {
      employeeId,
      kind: "meal",
      amount: "100000",
      startMonth: "2026-05",
      endMonth: "2026-02",
    });
    expect(badPeriod.statusCode).toBe(400);

    const zero = await call(owner(), "POST", "/api/hr/allowances", {
      employeeId,
      kind: "meal",
      amount: "0",
      startMonth: "2026-05",
    });
    expect(zero.statusCode).toBe(400);

    const other = await call(owner(), "POST", "/api/hr/allowances", {
      employeeId,
      kind: "other",
      amount: "100000",
      startMonth: "2026-05",
    });
    expect(other.statusCode, "«Boshqa» uchun nom kerak").toBe(400);

    const named = await call(owner(), "POST", "/api/hr/allowances", {
      employeeId,
      kind: "other",
      label: "Telefon aloqasi",
      amount: "100000",
      startMonth: "2026-05",
    });
    expect(named.statusCode, named.body).toBe(201);
  });

  it("maosh tayyorlashda qo'shiladi: soliq faqat maoshdan, qo'lga qo'shimcha bilan", async () => {
    await call(owner(), "POST", "/api/hr/allowances", {
      employeeId,
      kind: "transport",
      amount: "300000",
      startMonth: "2026-03",
      endMonth: "2026-03",
    });
    await call(owner(), "POST", "/api/hr/allowances", {
      employeeId,
      kind: "meal",
      amount: "200000",
      startMonth: "2026-01",
    });

    const generated = await call(owner(), "POST", "/api/hr/salaries/generate", { month: "2026-03", taxRate: "12", workDays: "26" });
    expect(generated.statusCode, generated.body).toBe(200);

    const [salary] = await db.select().from(salaryPayments).where(eq(salaryPayments.employeeId, employeeId));
    expect(salary).toBeTruthy();
    expect(salary!.allowances, "yo'l 300 000 + ovqat 200 000").toBe("500000.00");
    // Soliq faqat hisoblangan maoshdan (3 000 000 * 12%)
    expect(salary!.grossSalary).toBe("3000000.00");
    expect(salary!.tax).toBe("360000.00");
    expect(salary!.netSalary, "2 640 000 + 500 000").toBe("3140000.00");
  });

  it("qo'shimchasi bor maosh to'lanadi va jurnal balanslangan bo'ladi", async () => {
    await call(owner(), "POST", "/api/hr/allowances", {
      employeeId,
      kind: "transport",
      amount: "300000",
      startMonth: "2026-03",
      endMonth: "2026-03",
    });
    expect((await call(owner(), "POST", "/api/hr/salaries/generate", { month: "2026-03", taxRate: "12", workDays: "26" })).statusCode).toBe(200);
    const [salary] = await db.select().from(salaryPayments).where(eq(salaryPayments.employeeId, employeeId));
    expect(salary!.netSalary, "2 640 000 + 300 000").toBe("2940000.00");

    // Kassaga pul kiritamiz (maosh naqd to'lanadi)
    const [cash] = await db.select({ id: cashAccounts.id }).from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId));
    const [capital] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, "3000")));
    expect(
      (await call(owner(), "POST", "/api/finance/cash-transactions", {
        cashAccountId: cash!.id,
        type: "in",
        amount: "10000000",
        description: "Kassaga kirim",
        counterAccountId: capital!.id,
      })).statusCode,
    ).toBe(201);

    expect((await call(owner(), "POST", `/api/hr/salaries/${salary!.id}/approve`)).statusCode).toBe(200);
    const paid = await call(owner(), "POST", `/api/hr/salaries/${salary!.id}/pay`, { method: "cash" });
    expect(paid.statusCode, paid.body).toBe(200);

    // Jurnal: debet (ish haqi 3 000 000 + kompensatsiya 300 000) = kredit (qo'lga 2 940 000 + soliq 360 000)
    const [entry] = await db.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.referenceId, salary!.id));
    expect(entry, "to'lov jurnali yozilishi kerak").toBeTruthy();
    const lines = await db
      .select({ debit: journalLines.debit, credit: journalLines.credit })
      .from(journalLines)
      .where(eq(journalLines.entryId, entry!.id));
    const debit = lines.reduce((sum, line) => sum + Number(line.debit ?? 0), 0);
    const credit = lines.reduce((sum, line) => sum + Number(line.credit ?? 0), 0);
    expect(debit, "DEBIT = CREDIT").toBe(credit);
    expect(debit, "ish haqi + kompensatsiya").toBe(3_300_000);

    // Kassadan aynan qo'lga beriladigan summa chiqdi
    const [cashAfter] = await db.select({ balance: cashAccounts.balance }).from(cashAccounts).where(eq(cashAccounts.id, cash!.id));
    expect(cashAfter!.balance).toBe("7060000.00");
  });

  it("tahrirlashda qo'shimcha to'lov yo'qolmaydi", async () => {
    await call(owner(), "POST", "/api/hr/allowances", {
      employeeId,
      kind: "meal",
      amount: "200000",
      startMonth: "2026-03",
      endMonth: "2026-03",
    });
    await call(owner(), "POST", "/api/hr/salaries/generate", { month: "2026-03", taxRate: "12", workDays: "26" });
    const [salary] = await db.select().from(salaryPayments).where(eq(salaryPayments.employeeId, employeeId));

    const updated = await call(owner(), "PATCH", `/api/hr/salaries/${salary!.id}`, { deductions: "100000" });
    expect(updated.statusCode, updated.body).toBe(200);
    // 3 000 000 − 360 000 soliq − 100 000 ushlab qolish + 200 000 ovqat puli
    expect(updated.json().salary.netSalary).toBe("2740000.00");
    expect(updated.json().salary.allowances).toBe("200000.00");
  });

  it("davridan tashqari oyda qo'shilmaydi", async () => {
    await call(owner(), "POST", "/api/hr/allowances", {
      employeeId,
      kind: "transport",
      amount: "300000",
      startMonth: "2026-05",
      endMonth: "2026-05",
    });
    const generated = await call(owner(), "POST", "/api/hr/salaries/generate", { month: "2026-04", taxRate: "12", workDays: "26" });
    expect(generated.statusCode, generated.body).toBe(200);
    const [salary] = await db.select().from(salaryPayments).where(eq(salaryPayments.employeeId, employeeId));
    expect(salary!.allowances).toBe("0.00");
  });

  it("o'zgartirish va o'chirish ishlaydi; begona kompaniya xodimi biriktirilmaydi", async () => {
    const created = await call(owner(), "POST", "/api/hr/allowances", {
      employeeId,
      kind: "meal",
      amount: "200000",
      startMonth: "2026-01",
    });
    const id = created.json().allowance.id as string;

    const patched = await call(owner(), "PATCH", `/api/hr/allowances/${id}`, { amount: "250000", endMonth: "2026-12" });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json().allowance).toMatchObject({ amount: "250000.00", endMonth: "2026-12" });

    const other = await createCompany(app, adminCookie, { name: "Begona" });
    const foreign = await call(other.ownerCookie, "POST", "/api/hr/employees", {
      name: "Begona xodim",
      hireDate: "2026-01-05",
      baseSalary: "0",
      salaryType: "monthly",
    });
    const rejected = await call(owner(), "POST", "/api/hr/allowances", {
      employeeId: foreign.json().employee.id,
      kind: "meal",
      amount: "100000",
      startMonth: "2026-01",
    });
    expect(rejected.statusCode).toBe(404);

    expect((await call(owner(), "DELETE", `/api/hr/allowances/${id}`)).statusCode).toBe(204);
    expect((await call(owner(), "GET", `/api/hr/allowances?employeeId=${employeeId}`)).json().allowances).toHaveLength(0);
  });
});

describe("Xodimga xarajat (chiqim) turi", () => {
  it("xodim tanlansa to'lov turi majburiy; tur xarajatda saqlanadi", async () => {
    const purposes = await call(owner(), "GET", "/api/finance/accounts?type=expense");
    const accountId = (purposes.json().accounts as { id: string; isActive: boolean }[]).find((a) => a.isActive)!.id;

    const missingKind = await call(owner(), "POST", "/api/finance/expenses", {
      category: "salary",
      description: "Ovqat puli",
      amount: "200000",
      expenseDate: "2026-03-05",
      accountId,
      employeeId,
    });
    expect(missingKind.statusCode, "tur ko'rsatilmasa rad etiladi").toBe(400);

    const created = await call(owner(), "POST", "/api/finance/expenses", {
      category: "salary",
      description: "Ovqat puli",
      amount: "200000",
      expenseDate: "2026-03-05",
      accountId,
      employeeId,
      payoutKind: "meal",
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().expense).toMatchObject({ employeeId, payoutKind: "meal" });

    const orphanKind = await call(owner(), "POST", "/api/finance/expenses", {
      category: "salary",
      description: "Xodimsiz",
      amount: "100000",
      expenseDate: "2026-03-05",
      accountId,
      payoutKind: "salary",
    });
    expect(orphanKind.statusCode, "xodimsiz tur bo'lmaydi").toBe(400);
  });
});
