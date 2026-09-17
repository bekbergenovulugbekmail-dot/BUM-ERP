/**
 * QABUL TESTI — ruxsatlar, kompaniya izolyatsiyasi, modullar, obuna, hodim va kassa joylashuvi.
 *
 * API + baza darajasida (haqiqiy Fastify server va PostgreSQL test bazasi). UI yashirilishi emas — to'g'ridan-to'g'ri
 * so'rov yuborilganda ham yopiq bo'lishi tekshiriladi.
 */
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { employees } from "../src/db/schema/hr.js";
import { users } from "../src/db/schema/platform.js";
import { licenses, subscriptions } from "../src/db/schema/subscription.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
let adminCookie: string;

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
  adminCookie = admin.cookie;
  company = await createCompany(app, adminCookie, { name: "Ruxsat do'koni" });
});

const call = (cookie: string, method: "GET" | "POST" | "PUT" | "PATCH", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
const owner = () => company.ownerCookie;

describe("QABUL: rollar va ruxsatlar (to'g'ridan-to'g'ri API)", () => {
  it("kassirda kadrlar, audit, modul va moliyaviy tasdiq yopiq; egasida ochiq", async () => {
    const kassir = await addEmployee(app, company, "Kassir");

    const denied = [
      ["POST", "/api/hr/employees", { name: "X", hireDate: "2026-01-01", baseSalary: "0", salaryType: "monthly" }],
      ["GET", "/api/company/audit-logs", undefined],
      ["PUT", "/api/company/modules/hr", { enabled: false }],
      ["GET", "/api/hr/employees/export", undefined],
    ] as const;
    for (const [method, url, payload] of denied) {
      const res = await call(kassir.cookie, method, url, payload);
      expect(res.statusCode, `${method} ${url}: ${res.body}`).toBe(403);
    }

    // Egasi — o'sha marshrutlar ochiq
    expect((await call(owner(), "GET", "/api/company/audit-logs")).statusCode).toBe(200);
    expect((await call(owner(), "GET", "/api/hr/employees/export")).statusCode).toBe(200);
  });
});

describe("QABUL: kompaniyalar izolyatsiyasi", () => {
  it("A kompaniya foydalanuvchisi B kompaniya ma'lumotini ID bilan ham ko'ra olmaydi", async () => {
    const other = await createCompany(app, adminCookie, { name: "Begona kompaniya" });
    const otherCustomer = (await call(other.ownerCookie, "POST", "/api/sales/customers", { name: "B mijoz" })).json().customer.id as string;
    const otherSupplier = (await call(other.ownerCookie, "POST", "/api/purchase/suppliers", { name: "B ta'minotchi", code: "B-1" })).json().supplier.id as string;
    const otherEmployee = (await call(other.ownerCookie, "POST", "/api/hr/employees", { name: "B hodim", hireDate: "2026-01-10", baseSalary: "0", salaryType: "monthly" })).json().employee.id as string;
    const otherRoute = (await call(other.ownerCookie, "POST", "/api/distribution/routes", { name: "B marshrut", days: [1] })).json().route.id as string;

    const cross = [
      ["GET", `/api/sales/customers/${otherCustomer}`, undefined],
      ["GET", `/api/purchase/suppliers/${otherSupplier}`, undefined],
      ["GET", `/api/hr/employees/${otherEmployee}`, undefined],
      ["GET", `/api/distribution/routes/${otherRoute}`, undefined],
      ["POST", `/api/sales/customers/${otherCustomer}/balance-adjust`, { balance: "1000", reason: "Begona mijoz" }],
      ["POST", `/api/purchase/suppliers/${otherSupplier}/set-debt`, { totalDebt: "1000", reason: "Begona ta'minotchi" }],
    ] as const;
    for (const [method, url, payload] of cross) {
      const res = await call(owner(), method, url, payload);
      expect([403, 404], `${method} ${url}: ${res.statusCode} ${res.body}`).toContain(res.statusCode);
    }

    // O'z ro'yxatida begona yozuvlar ko'rinmaydi
    const customers = (await call(owner(), "GET", "/api/sales/customers")).json().customers as { id: string }[];
    expect(customers.find((row) => row.id === otherCustomer)).toBeUndefined();
  });
});

describe("QABUL: modullarni yoqish va o'chirish", () => {
  it("modul o'chirilganda API 403 MODULE_DISABLED, ma'lumot saqlanadi, qayta yoqilganda ochiladi", async () => {
    const created = await call(owner(), "POST", "/api/hr/employees", { name: "Kadr hodimi", hireDate: "2026-01-20", baseSalary: "1000000", salaryType: "monthly" });
    expect(created.statusCode, created.body).toBe(201);
    const before = await db.select({ id: employees.id }).from(employees).where(eq(employees.companyId, company.companyId));
    expect(before).toHaveLength(1);

    const off = await call(adminCookie, "PUT", `/api/platform/companies/${company.companyId}/modules/hr`, { enabled: false });
    expect(off.statusCode, off.body).toBe(200);

    const blocked = await call(owner(), "GET", "/api/hr/employees");
    expect(blocked.statusCode, blocked.body).toBe(403);
    expect(blocked.json()).toMatchObject({ code: "MODULE_DISABLED" });
    // Yozish ham yopiq
    expect((await call(owner(), "POST", "/api/hr/employees", { name: "Yangi", hireDate: "2026-01-21", baseSalary: "0", salaryType: "monthly" })).statusCode).toBe(403);

    // Ma'lumot o'chmagan
    const during = await db.select({ id: employees.id }).from(employees).where(eq(employees.companyId, company.companyId));
    expect(during).toEqual(before);

    const on = await call(adminCookie, "PUT", `/api/platform/companies/${company.companyId}/modules/hr`, { enabled: true });
    expect(on.statusCode, on.body).toBe(200);
    const list = await call(owner(), "GET", "/api/hr/employees");
    expect(list.statusCode).toBe(200);
    expect((list.json().employees as { name: string }[]).map((row) => row.name)).toContain("Kadr hodimi");
  });
});

describe("QABUL: obuna muddati", () => {
  it("obuna tugaganda biznes API yopiq, bosh sahifa va obuna ochiq", async () => {
    await db
      .update(subscriptions)
      .set({ status: "expired", expiresAt: new Date(Date.now() - 86_400_000) })
      .where(eq(subscriptions.companyId, company.companyId));

    const blocked = await call(owner(), "GET", "/api/sales/customers");
    expect(blocked.statusCode, blocked.body).toBe(403);
    expect(blocked.json().details).toMatchObject({ reason: "subscription_expired" });

    expect((await call(owner(), "GET", "/api/finance/cash-accounts")).statusCode).toBe(403);
    // Bosh sahifa va obuna sahifasi ochiq qoladi (obunani uzaytirish uchun)
    expect((await call(owner(), "GET", "/api/analytics/dashboard")).statusCode).toBe(200);
    expect((await call(owner(), "GET", "/api/subscription")).statusCode).toBe(200);
  });
});

describe("QABUL: hodim — BEPUL yoqilgan va o'chirilgan", () => {
  it("BEPUL: foydalanuvchi, login va litsenziya yaratilmaydi; BEPUL o'chiq: yaratiladi", async () => {
    const usersBefore = (await db.select({ id: users.id }).from(users)).length;
    const licensesBefore = (await db.select({ id: licenses.id }).from(licenses)).length;

    const free = await call(owner(), "POST", "/api/hr/employees", {
      name: "Bepul hodim",
      hireDate: "2026-03-01",
      baseSalary: "1500000",
      salaryType: "monthly",
    });
    expect(free.statusCode, free.body).toBe(201);
    expect((await db.select({ id: users.id }).from(users)).length).toBe(usersBefore);
    expect((await db.select({ id: licenses.id }).from(licenses)).length).toBe(licensesBefore);

    const paid = await call(owner(), "POST", "/api/hr/employees", {
      name: "Dasturdan foydalanuvchi",
      hireDate: "2026-03-02",
      baseSalary: "2000000",
      salaryType: "monthly",
      softwareAccess: { phone: "+998935550001", password: "xodim-parol-123", pin: "4321", role: "Kassir" },
    });
    expect(paid.statusCode, paid.body).toBe(201);
    expect((await db.select({ id: users.id }).from(users)).length).toBe(usersBefore + 1);
    expect((await db.select({ id: licenses.id }).from(licenses)).length).toBe(licensesBefore + 1);

    const list = (await call(owner(), "GET", "/api/hr/employees")).json().employees as { name: string; loginPhone: string | null }[];
    expect(list.find((row) => row.name === "Bepul hodim")!.loginPhone).toBeNull();
    expect(list.find((row) => row.name === "Dasturdan foydalanuvchi")!.loginPhone).toBe("+998935550001");
  });
});

describe("QABUL: kassa joylashuvi va ko'rinishi", () => {
  it("to'lov paneli tomoni va tuzilishi saqlanadi, kassaga uzatiladi; noto'g'ri qiymat rad etiladi", async () => {
    const saved = await call(owner(), "PUT", "/api/pos/devices/appearance", {
      locked: false,
      theme: "system",
      paymentPanelSide: "left",
      layout: "table",
    });
    expect(saved.statusCode, saved.body).toBe(200);

    const reloaded = await call(owner(), "GET", "/api/pos/devices/appearance");
    expect(reloaded.statusCode, reloaded.body).toBe(200);
    expect(reloaded.json().appearance).toMatchObject({ paymentPanelSide: "left", layout: "table" });

    // Kassa ekrani shu sozlamani oladi
    const kassir = await addEmployee(app, company, "Kassir");
    const options = await call(kassir.cookie, "GET", "/api/sales/pos/payment-options");
    expect(options.statusCode, options.body).toBe(200);
    expect(options.json().layout).toMatchObject({ paymentPanelSide: "left", layout: "table" });

    // Mavzu o'zgarsa ham joylashuv saqlanadi
    expect((await call(owner(), "PUT", "/api/pos/devices/appearance", { locked: false, theme: "midnight" })).statusCode).toBe(200);
    expect((await call(owner(), "GET", "/api/pos/devices/appearance")).json().appearance).toMatchObject({ paymentPanelSide: "left", layout: "table" });

    // Noto'g'ri qiymat
    expect((await call(owner(), "PUT", "/api/pos/devices/appearance", { locked: false, theme: "system", layout: "yo'q" })).statusCode).toBe(400);
    expect((await call(owner(), "PUT", "/api/pos/devices/appearance", { locked: false, theme: "system", paymentPanelSide: "yuqori" })).statusCode).toBe(400);
  });
});
