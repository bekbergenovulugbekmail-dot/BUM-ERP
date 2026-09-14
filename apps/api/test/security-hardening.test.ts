import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { auditLogs, companyMembers, passwordResetCodes, users } from "../src/db/schema/platform.js";
import { posDeviceCashiers } from "../src/db/schema/pos.js";
import { buildServer } from "../src/server.js";
import { writeAuditLog } from "../src/shared/audit.js";
import { smsProvider } from "../src/shared/sms.js";
import { addEmployee, createCompany, createUser, login, me, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
let ownerId: string;
const originalSms = smsProvider.client;
const today = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  smsProvider.client = originalSms;
  await app.close();
  await closeDb();
});

beforeEach(async () => {
  await resetDatabase();
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Xavfsizlik do'koni", includedLicenses: 10 });
  ownerId = (await db.select({ id: users.id }).from(users).where(eq(users.phone, company.owner.phone)))[0]!.id;
});

const call = (cookie: string, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object, headers: Record<string, string> = {}) =>
  app.inject({ method, url, headers: { cookie, ...headers }, ...(payload ? { payload } : {}) });

const memberActive = async (userId: string) =>
  (await db.select({ isActive: companyMembers.isActive }).from(companyMembers).where(and(eq(companyMembers.companyId, company.companyId), eq(companyMembers.userId, userId))))[0]!
    .isActive;
const userActive = async (userId: string) => (await db.select({ isActive: users.isActive }).from(users).where(eq(users.id, userId)))[0]!.isActive;

async function hrEmployee(cookie: string, userId: string, name = "Xodim") {
  const res = await call(cookie, "POST", "/api/hr/employees", { name, hireDate: today, baseSalary: "1000000", salaryType: "monthly", userId });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().employee.id as string;
}

describe("Xavfsizlik: a'zolik kirishini xodim/agent boshqaruvi orqali o'zgartirish", () => {
  it("HR menejeri yoki egasi ham egani ishdan bo'shatib kompaniyadan chiqara olmaydi; HR yozuvini o'chirish egaga tegmaydi", async () => {
    const hr = await addEmployee(app, company, "HR menejeri");
    const employeeId = await hrEmployee(company.ownerCookie, ownerId, "Ega (HR yozuvi)");

    // HR menejerida dastur kirishini boshqarish ruxsati yo'q — 403
    const byHr = await call(hr.cookie, "PATCH", `/api/hr/employees/${employeeId}`, { status: "terminated" });
    expect(byHr.statusCode, byHr.body).toBe(403);
    // Egasi o'zi ham — ega himoyalangan
    const byOwner = await call(company.ownerCookie, "PATCH", `/api/hr/employees/${employeeId}`, { status: "terminated" });
    expect(byOwner.statusCode, byOwner.body).toBe(403);
    expect(byOwner.json().message).toContain("egasi");

    expect(await memberActive(ownerId)).toBe(true);
    expect(await userActive(ownerId)).toBe(true);
    expect((await me(app, company.ownerCookie)).statusCode).toBe(200);

    expect((await call(company.ownerCookie, "DELETE", `/api/hr/employees/${employeeId}`)).statusCode).toBe(204);
    expect(await memberActive(ownerId)).toBe(true);
    expect((await me(app, company.ownerCookie)).statusCode).toBe(200);
  });

  it("agentlar menejeri egaga bog'langan savdo agentini faolsizlantirib egani bloklay olmaydi", async () => {
    const rep = await call(company.ownerCookie, "POST", "/api/distribution/sales-reps", { name: "Ega agent", userId: ownerId });
    expect(rep.statusCode, rep.body).toBe(201);
    const repId = (rep.json().salesRep ?? rep.json().rep).id as string;
    const deactivate = await call(company.ownerCookie, "PATCH", `/api/sales-agent/team/${repId}`, { isActive: false });
    expect(deactivate.statusCode, deactivate.body).toBe(403);
    expect(deactivate.json().code).toBe("FORBIDDEN");
    expect(await memberActive(ownerId)).toBe(true);
    expect((await me(app, company.ownerCookie)).statusCode).toBe(200);
  });

  it("qayta ishga olish platforma admini bloklagan hisobni ochmaydi; oddiy qayta ishga olish kirishni tiklaydi", async () => {
    const blocked = await addEmployee(app, company, "Kassir");
    const normal = await addEmployee(app, company, "Kassir");
    const blockedEmployee = await hrEmployee(company.ownerCookie, blocked.id, "Bloklangan");
    const normalEmployee = await hrEmployee(company.ownerCookie, normal.id, "Oddiy");

    for (const id of [blockedEmployee, normalEmployee]) {
      expect((await call(company.ownerCookie, "PATCH", `/api/hr/employees/${id}`, { status: "terminated" })).statusCode).toBe(200);
    }
    expect([await userActive(blocked.id), await userActive(normal.id)]).toEqual([false, false]);

    // Platforma admini bloklagan (audit yozuvi) — HR orqali qayta ishga olinsa ham hisob ochilmaydi
    await writeAuditLog({ action: "USER_BLOCKED", resource: "users", resourceId: blocked.id, severity: "warning" });
    for (const id of [blockedEmployee, normalEmployee]) {
      const rehire = await call(company.ownerCookie, "PATCH", `/api/hr/employees/${id}`, { status: "active" });
      expect(rehire.statusCode, rehire.body).toBe(200);
    }
    expect(await memberActive(blocked.id)).toBe(true);
    expect(await userActive(blocked.id)).toBe(false);
    expect(await userActive(normal.id)).toBe(true);
  });
});

describe("Xavfsizlik: parallel so'rovlar bilan limitlarni aylanib o'tish", () => {
  it("login: 12 ta parallel xato urinishdan ko'pi bilan 5 tasi parolni tekshiradi; keyin to'g'ri parol ham 429", async () => {
    const { phone, password } = await createUser();
    const results = await Promise.all(Array.from({ length: 12 }, () => login(app, phone, "xato-parol-000")));
    const codes = results.map((r) => r.res.statusCode);
    expect(codes.filter((code) => code === 401).length).toBeLessThanOrEqual(5);
    expect(codes.filter((code) => code === 429).length).toBeGreaterThanOrEqual(7);
    expect((await login(app, phone, password)).res.statusCode).toBe(429);
  });

  it("login: to'g'ri parol hisobni qaytaradi — muvaffaqiyatli kirishlar bloklamaydi", async () => {
    const { phone, password } = await createUser();
    for (let i = 0; i < 8; i++) expect((await login(app, phone, password)).res.statusCode).toBe(200);
  });

  it("parol tiklash: 15 ta parallel xato kod — kodga ko'pi bilan 5 urinish, kod yonadi, parol o'zgarmaydi", async () => {
    const sent: string[] = [];
    smsProvider.client = async (_phone, message) => {
      sent.push(message);
    };
    const victim = await createUser({ password: "eski-parol-123" });
    expect((await app.inject({ method: "POST", url: "/api/auth/password-reset/request", payload: { phone: victim.phone } })).statusCode).toBe(200);
    const code = sent.at(-1)!.match(/\b(\d{6})\b/)![1]!;
    const wrong = code === "000000" ? "111111" : "000000";

    const results = await Promise.all(
      Array.from({ length: 15 }, () =>
        app.inject({ method: "POST", url: "/api/auth/password-reset/confirm", payload: { phone: victim.phone, code: wrong, newPassword: "yangi-parol-456" } }),
      ),
    );
    expect(results.every((res) => res.statusCode === 400 || res.statusCode === 429)).toBe(true);
    const [record] = await db.select().from(passwordResetCodes).where(eq(passwordResetCodes.userId, victim.user.id));
    expect(record!.attempts).toBeLessThanOrEqual(5);
    expect(record!.consumedAt).not.toBeNull();

    const late = await app.inject({ method: "POST", url: "/api/auth/password-reset/confirm", payload: { phone: victim.phone, code, newPassword: "yangi-parol-456" } });
    expect([400, 429]).toContain(late.statusCode);
    expect((await login(app, victim.phone, "eski-parol-123")).res.statusCode).toBe(200);
  });
});

describe("Xavfsizlik: kassa qurilmasi boshqa xodim nomidan ish qila olmaydi", () => {
  it("qurilmada kirmagan xodim nomidan analitika va yuqori huquqli amal rad; smena qabul qilinadi; parol bilan kirgach ruxsat; bo'shatish va uzish bog'lanishni bekor qiladi", async () => {
    const [warehouse] = await db.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.companyId, company.companyId));
    const registered = await app.inject({
      method: "POST",
      url: "/api/pos-device/setup/register",
      payload: { phone: company.owner.phone, password: company.owner.password, warehouseId: warehouse!.id, name: "Kassa X" },
    });
    expect(registered.statusCode, registered.body).toBe(201);
    const auth = { authorization: `Bearer ${registered.json().token as string}` };
    const deviceId = registered.json().device.id as string;
    const binding = async (userId: string) =>
      (await db.select().from(posDeviceCashiers).where(and(eq(posDeviceCashiers.deviceId, deviceId), eq(posDeviceCashiers.userId, userId))))[0];

    // Ro'yxatdan o'tkazgan ega bog'langan; "hech qachon kirmagan" holatini sinash uchun bekor qilinadi
    expect((await binding(ownerId))?.revokedAt).toBeNull();
    await db.update(posDeviceCashiers).set({ revokedAt: new Date() }).where(eq(posDeviceCashiers.deviceId, deviceId));

    const push = async (type: string, payload: object, cashierId = ownerId) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/pos-device/push",
        headers: auth,
        payload: { ops: [{ opId: randomUUID(), type, cashierId, createdAt: new Date().toISOString(), payload }] },
      });
      expect(res.statusCode, res.body).toBe(200);
      return res.json().results[0] as { status: string; error?: { code: string; details?: { reason?: string } } };
    };
    const analytics = () =>
      app.inject({ method: "GET", url: `/api/pos-device/analytics?from=${today}&to=${today}&cashierId=${ownerId}`, headers: auth });

    const denied = await analytics();
    expect(denied.statusCode, denied.body).toBe(403);
    expect(denied.json().details?.reason).toBe("cashier_not_bound");

    const customer = await call(company.ownerCookie, "POST", "/api/sales/customers", { name: "Mijoz A" });
    expect(customer.statusCode, customer.body).toBe(201);
    const customerId = customer.json().customer.id as string;
    const rename = { customerId, changes: { name: { from: "Mijoz A", to: "Mijoz B" } } };

    const elevated = await push("customer.update", rename);
    expect(elevated).toMatchObject({ status: "rejected", error: { code: "FORBIDDEN", details: { reason: "cashier_not_bound" } } });
    // Oddiy kassa amali (smena) bog'lanishsiz ham qabul qilinadi — offline ish to'xtamaydi
    expect(await push("shift.open", { shiftId: randomUUID(), openingCash: "0" })).toMatchObject({ status: "applied" });

    const login = await app.inject({
      method: "POST",
      url: "/api/pos-device/cashiers/login",
      headers: auth,
      payload: { phone: company.owner.phone, password: company.owner.password },
    });
    expect(login.statusCode, login.body).toBe(200);
    expect((await binding(ownerId))?.revokedAt).toBeNull();
    expect((await analytics()).statusCode).toBe(200);
    expect(await push("customer.update", rename)).toMatchObject({ status: "applied" });

    // Kassir qurilmada kirdi, keyin ishdan bo'shatildi — bog'lanish bekor
    const kassir = await addEmployee(app, company, "Kassir");
    const kassirLogin = await app.inject({
      method: "POST",
      url: "/api/pos-device/cashiers/login",
      headers: auth,
      payload: { phone: kassir.phone, password: "xodim-parol-123" },
    });
    expect(kassirLogin.statusCode, kassirLogin.body).toBe(200);
    expect((await binding(kassir.id))?.revokedAt).toBeNull();
    const employeeId = await hrEmployee(company.ownerCookie, kassir.id, "Kassir");
    expect((await call(company.ownerCookie, "PATCH", `/api/hr/employees/${employeeId}`, { status: "terminated" })).statusCode).toBe(200);
    expect((await binding(kassir.id))?.revokedAt).not.toBeNull();

    // Qurilma uzildi — barcha bog'lanishlar bekor
    expect((await app.inject({ method: "POST", url: "/api/pos-device/unregister", headers: auth })).statusCode).toBe(200);
    expect((await binding(ownerId))?.revokedAt).not.toBeNull();
  });
});

describe("Xavfsizlik: aqlli ogohlantirishlar ruxsat bo'yicha", () => {
  it("kutilayotgan xarajat ogohlantirishi moliya ruxsati yo'q kassirga ko'rinmaydi; egaga ko'rinadi", async () => {
    const kassir = await addEmployee(app, company, "Kassir");
    const expense = await call(company.ownerCookie, "POST", "/api/finance/expenses", { category: "ijara", description: "Maxfiy ijara", amount: "5000000", expenseDate: today });
    expect(expense.statusCode, expense.body).toBe(201);
    const refresh = await call(company.ownerCookie, "POST", "/api/notifications/refresh");
    expect(refresh.statusCode, refresh.body).toBeLessThan(300);

    const list = async (cookie: string) =>
      (await call(cookie, "GET", "/api/notifications")).json().notifications as { id: string; relatedType: string | null; message: string }[];
    const ownerAlerts = await list(company.ownerCookie);
    const alert = ownerAlerts.find((item) => item.relatedType === "expenses");
    expect(alert?.message).toContain("Maxfiy ijara");

    const kassirAlerts = await list(kassir.cookie);
    expect(kassirAlerts.some((item) => item.relatedType === "expenses" || item.message.includes("Maxfiy ijara"))).toBe(false);
    // To'g'ridan-to'g'ri ID bilan ham o'qib/yopib bo'lmaydi
    expect((await call(kassir.cookie, "POST", `/api/notifications/${alert!.id}/read`)).statusCode).toBe(404);
  });
});

describe("Xavfsizlik: mijoz IP soxtalashtirilmaydi", () => {
  it("X-Forwarded-For dagi chap (mijoz yuborgan) qiymat emas, ishonchli proksi qo'shgan oxirgi qiymat yoziladi", async () => {
    const { user, phone } = await createUser();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { phone, password: "xato-parol-000" },
      headers: { "x-forwarded-for": "203.0.113.7, 198.51.100.9" },
    });
    expect(res.statusCode).toBe(401);
    const [row] = await db
      .select({ ipAddress: auditLogs.ipAddress })
      .from(auditLogs)
      .where(and(eq(auditLogs.userId, user.id), eq(auditLogs.action, "login_failed")));
    expect(row!.ipAddress).toBe("198.51.100.9");
  });
});
