import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { attendances } from "../src/db/schema/hr.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
let other: Company;

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
  company = await createCompany(app, admin.cookie, { name: "HR kompaniyasi" });
  other = await createCompany(app, admin.cookie, { name: "Boshqa kompaniya" });
});

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
const hr = (method: Method, url: string, payload?: object, cookie = company.ownerCookie) =>
  app.inject({ method, url: `/api/hr${url}`, headers: { cookie }, ...(payload ? { payload } : {}) });

let seq = 0;
async function employee(extra: object = {}, owner = company) {
  seq += 1;
  const res = await hr(
    "POST",
    "/employees",
    { name: `Xodim ${seq}`, hireDate: "2020-01-01", baseSalary: "1000000", salaryType: "monthly", ...extra },
    owner.ownerCookie,
  );
  expect(res.statusCode).toBe(201);
  return res.json().employee as { id: string; code: string; departmentId: string | null };
}

describe("Bo'limlar, lavozimlar va xodimlar", () => {
  it("bog'liqliklar, sikllar, maxfiy maydonlar, o'chirish qoidalari va ruxsatlar", async () => {
    const sales = await hr("POST", "/departments", { name: "Savdo", code: "SAV" });
    expect(sales.statusCode).toBe(201);
    const salesId = sales.json().department.id;
    expect((await hr("POST", "/departments", { name: "X", code: "SAV" })).statusCode).toBe(409);
    const retail = (await hr("POST", "/departments", { name: "Chakana", code: "CHK", parentId: salesId })).json().department.id;
    expect((await hr("PATCH", `/departments/${salesId}`, { parentId: retail })).statusCode).toBe(400);

    const foreignDept = (await hr("POST", "/departments", { name: "F", code: "F" }, other.ownerCookie)).json().department.id;
    expect((await hr("POST", "/positions", { departmentId: foreignDept, name: "X" })).statusCode).toBe(400);
    expect((await hr("POST", "/positions", { departmentId: salesId, name: "X", minSalary: "5", maxSalary: "1" })).statusCode).toBe(400);
    const seller = (await hr("POST", "/positions", { departmentId: salesId, name: "Sotuvchi", minSalary: "1000000", maxSalary: "3000000" })).json().position.id;
    const cashier = (await hr("POST", "/positions", { departmentId: retail, name: "Kassir" })).json().position.id;

    const first = await employee({ departmentId: salesId, positionId: seller, passportNumber: "AA1234567", inn: "123456789" });
    expect(first.code).toBe("EMP-0001");
    const mismatch = await hr("POST", "/employees", {
      name: "X",
      hireDate: "2020-01-01",
      baseSalary: "1",
      salaryType: "monthly",
      departmentId: salesId,
      positionId: cashier,
    });
    expect(mismatch.statusCode).toBe(400);
    expect((await employee({ positionId: cashier })).departmentId).toBe(retail);

    expect((await hr("PATCH", `/employees/${first.id}`, { managerId: first.id })).statusCode).toBe(400);
    const second = await employee({ managerId: first.id });
    expect((await hr("PATCH", `/employees/${first.id}`, { managerId: second.id })).statusCode).toBe(400);

    const hrManager = await addEmployee(app, company, "HR menejeri");
    const finance = await addEmployee(app, company, "Moliya menejeri");
    expect((await hr("GET", `/employees/${first.id}`, undefined, hrManager.cookie)).json().employee.passportNumber).toBe("AA1234567");
    const hidden = (await hr("GET", `/employees/${first.id}`, undefined, finance.cookie)).json().employee;
    expect(hidden.passportNumber).toBeUndefined();
    expect(hidden).toMatchObject({ code: "EMP-0001", departmentName: "Savdo", positionName: "Sotuvchi" });
    const listed = (await hr("GET", "/employees", undefined, finance.cookie)).json().employees;
    expect(listed.every((e: { inn?: string }) => e.inn === undefined)).toBe(true);
    const kassir = await addEmployee(app, company, "Kassir");
    expect((await hr("GET", "/employees", undefined, kassir.cookie)).statusCode).toBe(403);

    expect((await hr("DELETE", `/departments/${salesId}`)).statusCode).toBe(409);
    expect((await hr("DELETE", `/positions/${seller}`)).statusCode).toBe(409);
    expect((await hr("GET", "/employees/stats")).json()).toMatchObject({ total: 3, active: 3, totalSalary: "3000000.00" });
    expect((await hr("PATCH", `/employees/${first.id}`, { status: "terminated" })).json().employee.status).toBe("terminated");
    expect((await hr("GET", `/employees/${first.id}`, undefined, other.ownerCookie)).statusCode).toBe(404);
  });
});

describe("Davomat va ta'tillar", () => {
  it("davomat upsert, ommaviy yozish, ta'til oraliqlari va qaror qoidalari", async () => {
    const worker = await employee();
    const colleague = await employee();
    const foreign = await employee({}, other);

    const first = await hr("PUT", "/attendance", { employeeId: worker.id, date: `${month}-01`, status: "present", checkIn: "09:00", checkOut: "18:00" });
    expect(first.statusCode).toBe(200);
    expect(first.json().attendance).toMatchObject({ workHours: "8.0000", checkIn: "09:00:00" });
    const again = await hr("PUT", "/attendance", { employeeId: worker.id, date: `${month}-01`, status: "late", workHours: "7" });
    expect(again.json().attendance).toMatchObject({ status: "late", workHours: "7.0000" });
    expect(await db.select().from(attendances).where(eq(attendances.employeeId, worker.id))).toHaveLength(1);
    expect((await hr("PUT", "/attendance", { employeeId: worker.id, date: `${month}-02`, status: "present", checkIn: "18:00", checkOut: "09:00" })).statusCode).toBe(400);

    const mixed = await hr("PUT", "/attendance/bulk", {
      date: `${month}-02`,
      records: [
        { employeeId: worker.id, status: "present" },
        { employeeId: foreign.id, status: "present" },
      ],
    });
    expect(mixed.statusCode).toBe(400);
    expect(await db.select().from(attendances).where(eq(attendances.companyId, company.companyId))).toHaveLength(1);
    const bulk = await hr("PUT", "/attendance/bulk", {
      date: `${month}-02`,
      records: [
        { employeeId: worker.id, status: "present" },
        { employeeId: colleague.id, status: "half_day" },
      ],
    });
    expect(bulk.json()).toEqual({ processed: 2 });
    expect((await hr("GET", `/attendance/stats?month=${month}`)).json()).toMatchObject({ total: 3, present: 1, late: 1, halfDay: 1, totalHours: "19.0000" });

    await hr("PATCH", `/employees/${colleague.id}`, { status: "terminated" });
    expect((await hr("PUT", "/attendance", { employeeId: colleague.id, date: `${month}-03`, status: "present" })).statusCode).toBe(400);

    const leave = await hr("POST", "/leaves", { employeeId: worker.id, type: "annual", startDate: `${month}-10`, endDate: `${month}-14` });
    expect(leave.statusCode).toBe(201);
    expect(leave.json().leave).toMatchObject({ days: "5.0000", status: "pending" });
    expect((await hr("POST", "/leaves", { employeeId: worker.id, type: "sick", startDate: `${month}-14`, endDate: `${month}-16` })).statusCode).toBe(409);
    expect((await hr("POST", "/leaves", { employeeId: worker.id, type: "sick", startDate: `${month}-20`, endDate: `${month}-21`, days: "3" })).statusCode).toBe(400);

    const leaveId = leave.json().leave.id;
    const hrManager = await addEmployee(app, company, "HR menejeri");
    expect((await hr("POST", `/leaves/${leaveId}/decision`, { status: "approved" }, hrManager.cookie)).statusCode).toBe(403);
    expect((await hr("POST", `/leaves/${leaveId}/decision`, { status: "approved" })).json().leave.status).toBe("approved");
    expect((await hr("POST", `/leaves/${leaveId}/decision`, { status: "rejected" })).statusCode).toBe(400);
    expect((await hr("DELETE", `/leaves/${leaveId}`)).statusCode).toBe(400);
    expect((await hr("GET", `/leaves?employeeId=${worker.id}`)).json().leaves).toHaveLength(1);
  });
});
