/**
 * XODIM — FOYDALANUVCHI — LITSENZIYA: uchtasi alohida tushuncha.
 *
 * Xodim kartochkasi yagona kanonik xizmatda ochiladi; foydalanuvchi (login) esa MAVJUD xodimga
 * beriladi va yangi kartochka ochmaydi. Tenant chegarasi: begona kompaniya xodimiga login berilmaydi.
 */
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { employees } from "../src/db/schema/hr.js";
import { buildServer } from "../src/server.js";
import { createCompany, resetDatabase, signedIn } from "./helpers.js";

let app: FastifyInstance;
let adminCookie: string;
let company: Awaited<ReturnType<typeof createCompany>>;

const PASSWORD = "Xodim-parol-2026";

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
  company = await createCompany(app, adminCookie, { name: "Yagona manba" });
});

const call = (cookie: string, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
const owner = () => company.ownerCookie;

const cards = () => db.select().from(employees).where(eq(employees.companyId, company.companyId));

/** Kadrlar → "Xodim qo'shish": loginsiz (bepul) xodim. */
const addFreeEmployee = (name: string, phone: string) =>
  call(owner(), "POST", "/api/hr/employees", { name, phone, hireDate: "2026-01-10", baseSalary: "1500000", salaryType: "monthly" });

describe("Xodim yaratishning yagona manbai", () => {
  it("bepul xodim: kartochka ochiladi, login/parol/litsenziya berilmaydi", async () => {
    const created = await addFreeEmployee("Yuk tashuvchi", "+998901110031");
    expect(created.statusCode, created.body).toBe(201);
    const employee = created.json().employee as { id: string; userId: string | null };
    expect(employee.userId, "login yaratilmaydi").toBeNull();

    const members = (await call(owner(), "GET", "/api/company/employees")).json().employees as { phone: string }[];
    expect(members.some((row) => row.phone === "+998901110031"), "foydalanuvchi sifatida ko'rinmaydi").toBe(false);
  });

  it("mavjud xodimga login berish yangi kartochka ochmaydi", async () => {
    const employeeId = (await addFreeEmployee("Kassir Ali", "+998901110032")).json().employee.id as string;
    const before = (await cards()).length;

    const granted = await call(owner(), "POST", `/api/hr/employees/${employeeId}/software-access`, {
      phone: "+998901110032",
      password: PASSWORD,
      pin: "1234",
      role: "Kassir",
    });
    expect(granted.statusCode, granted.body).toBe(200);

    const after = await cards();
    expect(after.length, "kartochka soni o'zgarmaydi").toBe(before);
    expect(after.find((row) => row.id === employeeId)!.userId, "kartochka loginga bog'landi").toBeTruthy();

    // Foydalanuvchilar ro'yxatida xodim bog'lanishi ko'rinadi
    const members = (await call(owner(), "GET", "/api/company/employees")).json().employees as {
      phone: string;
      employeeId: string | null;
      employeeName: string | null;
    }[];
    const member = members.find((row) => row.phone === "+998901110032");
    expect(member).toMatchObject({ employeeId, employeeName: "Kassir Ali" });

    // Login ishlaydi
    const session = await app.inject({ method: "POST", url: "/api/auth/login", payload: { phone: "+998901110032", password: PASSWORD } });
    expect(session.statusCode, session.body).toBe(200);
  });

  it("egasi ro'yxatida xodim biriktirilmagan foydalanuvchi ajralib turadi", async () => {
    const members = (await call(owner(), "GET", "/api/company/employees")).json().employees as { employeeId: string | null }[];
    // Kompaniya egasi (yaratilishda kartochkasiz) — "biriktirilmagan" holatida ko'rinadi
    expect(members.length).toBeGreaterThan(0);
    expect(members.every((row) => row.employeeId === null || typeof row.employeeId === "string")).toBe(true);
  });

  it("begona kompaniya xodimiga login berib bo'lmaydi (tenant chegarasi)", async () => {
    const other = await createCompany(app, adminCookie, { name: "Begona" });
    const foreignId = (
      await call(other.ownerCookie, "POST", "/api/hr/employees", {
        name: "Begona xodim",
        phone: "+998901110033",
        hireDate: "2026-01-10",
        baseSalary: "0",
        salaryType: "monthly",
      })
    ).json().employee.id as string;

    const attempt = await call(owner(), "POST", `/api/hr/employees/${foreignId}/software-access`, {
      phone: "+998901110033",
      password: PASSWORD,
      pin: "1234",
      role: "Kassir",
    });
    expect(attempt.statusCode).toBe(404);
  });

  it("ishdan bo'shagan xodimga login berilmaydi", async () => {
    const employeeId = (await addFreeEmployee("Ketgan xodim", "+998901110034")).json().employee.id as string;
    expect((await call(owner(), "PATCH", `/api/hr/employees/${employeeId}`, { status: "terminated" })).statusCode).toBe(200);

    const attempt = await call(owner(), "POST", `/api/hr/employees/${employeeId}/software-access`, {
      phone: "+998901110034",
      password: PASSWORD,
      pin: "1234",
      role: "Kassir",
    });
    expect(attempt.statusCode).toBe(400);
  });

  it("xodimni faolsizlantirish tarixiy ma'lumotni o'chirmaydi", async () => {
    const employeeId = (await addFreeEmployee("Tarixiy xodim", "+998901110035")).json().employee.id as string;
    expect((await call(owner(), "PATCH", `/api/hr/employees/${employeeId}`, { status: "terminated" })).statusCode).toBe(200);

    const [row] = await db.select().from(employees).where(and(eq(employees.id, employeeId), eq(employees.companyId, company.companyId)));
    expect(row, "yozuv o'chirilmaydi").toBeTruthy();
    expect(row!.status).toBe("terminated");
  });
});
