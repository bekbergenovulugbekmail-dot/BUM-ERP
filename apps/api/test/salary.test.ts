import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { accounts, cashAccounts } from "../src/db/schema/finance.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
let other: Company;
let mainCash: string;

const month = new Date().toISOString().slice(0, 7);

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
  company = await createCompany(app, admin.cookie, { name: "Maosh kompaniyasi" });
  other = await createCompany(app, admin.cookie, { name: "Davomatsiz kompaniya" });
  const [cash] = await db
    .select()
    .from(cashAccounts)
    .where(and(eq(cashAccounts.companyId, company.companyId), eq(cashAccounts.isDefault, true)));
  mainCash = cash!.id;
});

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
const call = (cookie: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
const hr = (method: Method, url: string, payload?: object, cookie = company.ownerCookie) =>
  call(cookie, method, `/api/hr${url}`, payload);

async function employee(name: string, baseSalary: string, salaryType: string, owner = company) {
  const res = await call(owner.ownerCookie, "POST", "/api/hr/employees", { name, hireDate: "2020-01-01", baseSalary, salaryType });
  expect(res.statusCode).toBe(201);
  return res.json().employee.id as string;
}

async function ledger(code: string) {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, code)));
  return row!.balance;
}

async function fund(amount: string) {
  const capital = await ledger("3000");
  const [capitalRow] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, "3000")));
  expect(capital).toBe("0.00");
  const res = await call(company.ownerCookie, "POST", "/api/finance/cash-transactions", {
    cashAccountId: mainCash,
    type: "in",
    amount,
    description: "Kassaga kirim",
    counterAccountId: capitalRow!.id,
  });
  expect(res.statusCode).toBe(201);
}

const day = (n: number) => `${month}-${String(n).padStart(2, "0")}`;

describe("Maosh", () => {
  it("davomat bo'yicha hisob (oylik va kunlik), tahrir, vazifalar ajratimi, to'lov — kassa va jurnal", async () => {
    const monthly = await employee("Oylikchi", "2600000", "monthly");
    const daily = await employee("Kunbay", "100000", "daily");

    // Oylikchi: 20 kun keldi (1-kuni 4 soat ortiqcha), 2 kun kechikdi, 1 yarim kun → 22,5 kun
    // Kunbay: 10 kun keldi
    for (let n = 1; n <= 23; n++) {
      const status = n <= 20 ? "present" : n <= 22 ? "late" : "half_day";
      const records: object[] = [{ employeeId: monthly, status, ...(n === 1 ? { overtime: "4" } : {}) }];
      if (n <= 10) records.push({ employeeId: daily, status: "present" });
      expect((await hr("PUT", "/attendance/bulk", { date: day(n), records })).statusCode).toBe(200);
    }

    const hrManager = await addEmployee(app, company, "HR menejeri");
    const finance = await addEmployee(app, company, "Moliya menejeri");

    const generated = await hr("POST", "/salaries/generate", { month, taxRate: "12", workDays: "26" }, hrManager.cookie);
    expect(generated.json()).toEqual({ created: 2, attendanceBased: true });
    expect((await hr("POST", "/salaries/generate", { month }, hrManager.cookie)).json().created).toBe(0);

    const list = (await hr("GET", `/salaries?month=${month}`)).json().salaries as { id: string; employeeId: string }[];
    const monthlySalary = list.find((s) => s.employeeId === monthly)!;
    const dailySalary = list.find((s) => s.employeeId === daily)!;
    expect(monthlySalary).toMatchObject({
      actualDays: "22.5000",
      overtime: "4.0000",
      overtimePay: "75000.00",
      grossSalary: "2325000.00",
      tax: "279000.00",
      netSalary: "2046000.00",
      status: "draft",
    });
    expect(dailySalary).toMatchObject({ actualDays: "10.0000", grossSalary: "1000000.00", tax: "120000.00", netSalary: "880000.00" });

    const edited = await hr("PATCH", `/salaries/${monthlySalary.id}`, { bonus: "100000", deductions: "25000" }, hrManager.cookie);
    expect(edited.json().salary).toMatchObject({ grossSalary: "2425000.00", tax: "291000.00", netSalary: "2109000.00" });
    expect((await hr("PATCH", `/salaries/${monthlySalary.id}`, { deductions: "3000000" }, hrManager.cookie)).statusCode).toBe(400);

    expect((await hr("POST", `/salaries/${monthlySalary.id}/approve`, undefined, hrManager.cookie)).statusCode).toBe(403);
    expect((await hr("POST", `/salaries/${monthlySalary.id}/approve`, undefined, finance.cookie)).json().salary.status).toBe("approved");
    expect((await hr("PATCH", `/salaries/${monthlySalary.id}`, { bonus: "1" }, hrManager.cookie)).statusCode).toBe(400);

    // Tayyorlagan o'zi tasdiqlay olmaydi; kompaniya egasi mumkin
    expect((await hr("DELETE", `/salaries/${dailySalary.id}`, undefined, finance.cookie)).statusCode).toBe(204);
    expect((await hr("POST", "/salaries/generate", { month }, finance.cookie)).json().created).toBe(1);
    const regenerated = (await hr("GET", `/salaries?month=${month}&employeeId=${daily}`)).json().salaries[0];
    const selfApprove = await hr("POST", `/salaries/${regenerated.id}/approve`, undefined, finance.cookie);
    expect(selfApprove.statusCode).toBe(403);
    expect(selfApprove.json().message).toContain("o'zi tasdiqlay olmaydi");
    expect((await hr("POST", `/salaries/${regenerated.id}/approve`)).statusCode).toBe(200);

    // Kassada mablag' yetmasa to'lanmaydi
    expect((await hr("POST", `/salaries/${monthlySalary.id}/pay`, undefined, finance.cookie)).statusCode).toBe(400);
    expect((await hr("GET", `/salaries?month=${month}&employeeId=${monthly}`)).json().salaries[0].status).toBe("approved");

    await fund("3000000");
    const paid = await hr("POST", `/salaries/${monthlySalary.id}/pay`, undefined, finance.cookie);
    expect(paid.statusCode).toBe(200);
    expect(paid.json().salary).toMatchObject({ status: "paid", paidDate: new Date().toISOString().slice(0, 10) });
    const [cash] = await db.select().from(cashAccounts).where(eq(cashAccounts.id, mainCash));
    expect(cash!.balance).toBe("891000.00");
    expect(await ledger("5100")).toBe("2400000.00");
    expect(await ledger("2200")).toBe("291000.00");
    expect(await ledger("1010")).toBe("891000.00");

    expect((await hr("POST", `/salaries/${monthlySalary.id}/pay`, undefined, finance.cookie)).statusCode).toBe(400);
    expect((await hr("POST", `/salaries/${monthlySalary.id}/revert`, undefined, finance.cookie)).statusCode).toBe(400);
    expect((await hr("GET", `/salaries/summary?month=${month}`)).json()).toMatchObject({
      total: 2,
      approved: 1,
      paid: 1,
      totalNet: "2989000.00",
    });
  });

  it("davomat yuritilmagan kompaniyada to'liq oy; ta'tilda haq to'lanmaydigan kunlar hisoblanmaydi", async () => {
    const worker = await employee("Davomatsiz", "1000000", "monthly", other);
    const generated = await call(other.ownerCookie, "POST", "/api/hr/salaries/generate", { month });
    expect(generated.json()).toEqual({ created: 1, attendanceBased: false });
    const [salary] = (await call(other.ownerCookie, "GET", `/api/hr/salaries?employeeId=${worker}`)).json().salaries;
    expect(salary).toMatchObject({ actualDays: "26.0000", grossSalary: "1000000.00", netSalary: "880000.00" });

    const tracked = await employee("Ta'tilchi", "2600000", "monthly");
    await hr("PUT", "/attendance/bulk", { date: day(1), records: [{ employeeId: tracked, status: "present" }] });
    await hr("PUT", "/attendance/bulk", { date: day(2), records: [{ employeeId: tracked, status: "on_leave" }] });
    await hr("PUT", "/attendance/bulk", { date: day(3), records: [{ employeeId: tracked, status: "on_leave" }] });
    const unpaid = await hr("POST", "/leaves", { employeeId: tracked, type: "unpaid", startDate: day(3), endDate: day(3) });
    await hr("POST", `/leaves/${unpaid.json().leave.id}/decision`, { status: "approved" });

    expect((await hr("POST", "/salaries/generate", { month })).json()).toEqual({ created: 1, attendanceBased: true });
    const [trackedSalary] = (await hr("GET", `/salaries?employeeId=${tracked}`)).json().salaries;
    expect(trackedSalary).toMatchObject({ actualDays: "2.0000", grossSalary: "200000.00" });
  });
});
