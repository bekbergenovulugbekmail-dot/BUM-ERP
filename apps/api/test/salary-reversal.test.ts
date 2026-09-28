/**
 * TO'LANGAN MAOSHNI BEKOR QILISH (egasi qarori, 2026-09-28): to'langan maosh o'chirilmaydi va tahrirlanmaydi —
 * kompensatsion teskari yozuvlar (kassa + jurnal), asl yozuvlar joyida. Holat `reversed`; kim, qachon, nega, asl va teskari
 * yozuvlar auditda. Qayta bekor qilish — 409. Shu oy uchun to'g'rilangan maosh qaytadan tayyorlanadi.
 * Hisoblash (accrual) modeli O'ZGARMAGAN — naqd asos.
 */
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { accounts, cashAccounts, journalEntries, journalLines } from "../src/db/schema/finance.js";
import { auditLogs } from "../src/db/schema/platform.js";
import { salaryPayments } from "../src/db/schema/hr.js";
import { todayIso } from "../src/modules/finance/cash.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

let app: FastifyInstance;
let company: Awaited<ReturnType<typeof createCompany>>;
let other: Awaited<ReturnType<typeof createCompany>>;
let mainCash: string;
const month = () => todayIso().slice(0, 7);

const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object, cookie = company.ownerCookie) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

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
  company = await createCompany(app, admin.cookie, { name: "Maosh bekor" });
  other = await createCompany(app, admin.cookie, { name: "Begona" });
  mainCash = (await db.select().from(cashAccounts).where(and(eq(cashAccounts.companyId, company.companyId), eq(cashAccounts.isDefault, true))))[0]!.id;
  const capital = (await db.select().from(accounts).where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, "3000"))))[0]!.id;
  await call("POST", "/api/finance/cash-transactions", { cashAccountId: mainCash, type: "in", amount: "5000000", description: "Kapital", counterAccountId: capital });
});

const ledger = async (code: string) =>
  (await db.select().from(accounts).where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, code))))[0]!.balance;
const cash = async () => (await db.select().from(cashAccounts).where(eq(cashAccounts.id, mainCash)))[0]!.balance;
async function expectBalanced() {
  const [row] = await db
    .select({
      debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)::numeric(18,2)`,
      credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)::numeric(18,2)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(eq(journalLines.companyId, company.companyId), eq(journalEntries.status, "posted")));
  expect(row!.debit, "Debit = Credit").toBe(row!.credit);
}

async function paidSalary() {
  const employeeId = (await call("POST", "/api/hr/employees", { name: "Ali", hireDate: "2020-01-01", baseSalary: "2000000", salaryType: "monthly" })).json().employee.id as string;
  expect((await call("POST", "/api/hr/salaries/generate", { month: month() })).statusCode).toBeLessThan(300);
  const salary = (await call("GET", `/api/hr/salaries?month=${month()}&employeeId=${employeeId}`)).json().salaries[0] as { id: string; netSalary: string; tax: string };
  expect((await call("POST", `/api/hr/salaries/${salary.id}/approve`)).statusCode).toBe(200);
  const paid = await call("POST", `/api/hr/salaries/${salary.id}/pay`);
  expect(paid.statusCode, paid.body).toBe(200);
  return { employeeId, salary };
}

describe("To'langan maoshni bekor qilish", () => {
  it("teskari yozuvlar: kassa, 5100, 2200 asl holatiga; asl yozuv joyida; holat reversed; audit; qayta bekor — 409", async () => {
    const cashBefore = await cash();
    const { employeeId, salary } = await paidSalary();
    expect(await cash()).not.toBe(cashBefore);
    expect(await ledger("5100")).toBe("2000000.00");
    expect(await ledger("2200")).toBe(salary.tax);

    // Sababsiz — rad; to'langan maoshni tahrirlash/o'chirish — rad (o'zgarmas)
    expect((await call("POST", `/api/hr/salaries/${salary.id}/reverse`, { reason: "" })).statusCode).toBe(400);
    expect((await call("PATCH", `/api/hr/salaries/${salary.id}`, { bonus: "1" })).statusCode).toBe(400);
    expect((await call("DELETE", `/api/hr/salaries/${salary.id}`)).statusCode).toBe(400);

    const reversed = await call("POST", `/api/hr/salaries/${salary.id}/reverse`, { reason: "Noto'g'ri xodimga to'langan" });
    expect(reversed.statusCode, reversed.body).toBe(200);
    expect(reversed.json().salary).toMatchObject({ status: "reversed", reversalReason: "Noto'g'ri xodimga to'langan", reversedBy: expect.any(String) });
    expect(await cash(), "pul kassaga qaytdi").toBe(cashBefore);
    expect(await ledger("5100")).toBe("0.00");
    expect(await ledger("2200")).toBe("0.00");
    expect(await ledger("2250"), "ish haqi qarzi ham nolga qaytdi").toBe("0.00");
    await expectBalanced();

    // Asl yozuvlar joyida (o'chirilmagan) + har biriga teskarisi: hisoblash (tasdiqlashda) va to'lov
    const entries = await db.select({ type: journalEntries.referenceType, status: journalEntries.status }).from(journalEntries).where(eq(journalEntries.referenceId, salary.id));
    expect(entries.map((entry) => `${entry.type}:${entry.status}`).sort()).toEqual([
      "salary_accrual:posted",
      "salary_payment:posted",
      "salary_reversal:salary_accrual:posted",
      "salary_reversal:salary_payment:posted",
    ]);
    const [audit] = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "SALARY_REVERSED"), eq(auditLogs.resourceId, salary.id)));
    expect(audit).toMatchObject({ userId: expect.any(String) });
    expect(audit!.details).toMatchObject({ reason: "Noto'g'ri xodimga to'langan", netSalary: salary.netSalary, originalReference: { type: "salary_payment", id: salary.id } });
    expect((audit!.details as { reversalJournalEntries: string[] }).reversalJournalEntries).toHaveLength(2);

    // Qayta bekor qilish — 409, hech narsa ikki marta qaytmaydi
    expect((await call("POST", `/api/hr/salaries/${salary.id}/reverse`, { reason: "Yana" })).statusCode).toBe(409);
    expect(await cash()).toBe(cashBefore);

    // To'g'rilangan maosh shu oy uchun qaytadan tayyorlanadi; jamida bekor qilingani hisoblanmaydi
    const regenerated = await call("POST", "/api/hr/salaries/generate", { month: month() });
    expect(regenerated.json().created, regenerated.body).toBe(1);
    const rows = await db.select({ status: salaryPayments.status }).from(salaryPayments).where(eq(salaryPayments.employeeId, employeeId));
    expect(rows.map((row) => row.status).sort()).toEqual(["draft", "reversed"]);
    const summary = (await call("GET", `/api/hr/salaries/summary?month=${month()}`)).json();
    expect(summary.summary ?? summary).toMatchObject({ reversed: 1, totalNet: salary.netSalary });
  });

  it("hisoblash (accrual): xarajat tasdiqlangan OYDA, to'lov keyingi oyda faqat qarzni yopadi; qoralamaga qaytarish hisobni teskari yozadi", async () => {
    const employeeId = (await call("POST", "/api/hr/employees", { name: "Hadicha", hireDate: "2020-01-01", baseSalary: "2000000", salaryType: "monthly" })).json().employee.id as string;
    expect((await call("POST", "/api/hr/salaries/generate", { month: month() })).statusCode).toBeLessThan(300);
    const salary = (await call("GET", `/api/hr/salaries?month=${month()}&employeeId=${employeeId}`)).json().salaries[0] as { id: string; netSalary: string; tax: string };

    const cashBefore = await cash();
    expect((await call("POST", `/api/hr/salaries/${salary.id}/approve`)).statusCode).toBe(200);
    // Tasdiqlash: xarajat va soliq majburiyati yoziladi, pul tegilmaydi
    expect(await ledger("5100")).toBe("2000000.00");
    expect(await ledger("2200")).toBe(salary.tax);
    expect(await ledger("2250"), "qo'lga beriladigan summa — ish haqi bo'yicha qarz").toBe(salary.netSalary);
    expect(await cash()).toBe(cashBefore);
    await expectBalanced();

    // Hisoblash yozuvi maosh OYINING oxirgi kunida (to'lov keyin bo'lsa ham o'sha oy foydasi o'zgarmaydi)
    const [accrual] = await db
      .select({ date: journalEntries.entryDate, status: journalEntries.status })
      .from(journalEntries)
      .where(and(eq(journalEntries.referenceId, salary.id), eq(journalEntries.referenceType, "salary_accrual")));
    expect(accrual!.status).toBe("posted");
    expect(accrual!.date.startsWith(month())).toBe(true);
    expect(Number(accrual!.date.slice(8))).toBeGreaterThanOrEqual(28);

    // To'lov: faqat qarz yopiladi — xarajat va soliq o'zgarmaydi
    expect((await call("POST", `/api/hr/salaries/${salary.id}/pay`)).statusCode).toBe(200);
    expect(await ledger("5100")).toBe("2000000.00");
    expect(await ledger("2200")).toBe(salary.tax);
    expect(await ledger("2250"), "qarz yopildi").toBe("0.00");
    expect(await cash()).toBe((Number(cashBefore) - Number(salary.netSalary)).toFixed(2));
    await expectBalanced();

    // Boshqa xodim: tasdiqlab, qoralamaga qaytarilsa — hisob teskari yoziladi (xarajat qolmaydi)
    const second = (await call("POST", "/api/hr/employees", { name: "Zuhra", hireDate: "2020-01-01", baseSalary: "1000000", salaryType: "monthly" })).json().employee.id as string;
    await call("POST", "/api/hr/salaries/generate", { month: month() });
    const draft = (await call("GET", `/api/hr/salaries?month=${month()}&employeeId=${second}`)).json().salaries[0] as { id: string };
    expect((await call("POST", `/api/hr/salaries/${draft.id}/approve`)).statusCode).toBe(200);
    expect(await ledger("5100")).toBe("3000000.00");
    expect((await call("POST", `/api/hr/salaries/${draft.id}/revert`)).statusCode).toBe(200);
    expect(await ledger("5100"), "qoralamada xarajat yo'q").toBe("2000000.00");
    expect(await ledger("2250")).toBe("0.00");
    await expectBalanced();
  });

  it("parallel ikki bekor qilish: bittasi o'tadi; to'lanmagan maosh bekor qilinmaydi; tenant va ruxsat", async () => {
    const { salary } = await paidSalary();
    const results = await Promise.all([
      call("POST", `/api/hr/salaries/${salary.id}/reverse`, { reason: "Birinchi" }),
      call("POST", `/api/hr/salaries/${salary.id}/reverse`, { reason: "Ikkinchi" }),
    ]);
    expect(results.map((res) => res.statusCode).sort()).toEqual([200, 409]);
    await expectBalanced();

    const draftEmployee = (await call("POST", "/api/hr/employees", { name: "Vali", hireDate: "2020-01-01", baseSalary: "1000000", salaryType: "monthly" })).json().employee.id as string;
    await call("POST", "/api/hr/salaries/generate", { month: month() });
    const draft = (await call("GET", `/api/hr/salaries?month=${month()}&employeeId=${draftEmployee}`)).json().salaries[0] as { id: string };
    expect((await call("POST", `/api/hr/salaries/${draft.id}/reverse`, { reason: "To'lanmagan" })).statusCode).toBe(400);

    expect((await call("POST", `/api/hr/salaries/${draft.id}/reverse`, { reason: "Begona" }, other.ownerCookie)).statusCode).toBe(404);
    const kassir = await addEmployee(app, company, "Kassir");
    expect((await call("POST", `/api/hr/salaries/${draft.id}/reverse`, { reason: "Ruxsatsiz" }, kassir.cookie)).statusCode).toBe(403);
  });
});
