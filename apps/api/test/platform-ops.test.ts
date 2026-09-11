import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { auditLogs, companies, settings } from "../src/db/schema/platform.js";
import { buildServer } from "../src/server.js";
import { createCompany, resetDatabase, signedIn, uniquePhone } from "./helpers.js";

let app: FastifyInstance;
let admin: Awaited<ReturnType<typeof signedIn>>;
let alfa: Awaited<ReturnType<typeof createCompany>>;

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
  admin = await signedIn(app, { isPlatformAdmin: true });
  alfa = await createCompany(app, admin.cookie, { name: "Alfa" });
});

const asAdmin = (method: "GET" | "POST" | "PUT", url: string, payload?: object) =>
  app.inject({
    method,
    url: `/api/platform${url}`,
    headers: { cookie: admin.cookie },
    ...(payload ? { payload } : {}),
  });

describe("Ruxsat", () => {
  it("oddiy foydalanuvchiga barcha platforma endpointlari 403", async () => {
    const regular = await signedIn(app);
    const calls: [string, string, object?][] = [
      ["GET", "/stats"],
      ["GET", "/users"],
      ["GET", "/audit-logs"],
      ["GET", "/settings"],
      ["PUT", "/settings", { platformName: "Egallandi" }],
      ["GET", `/companies/${alfa.companyId}`],
      ["POST", `/companies/${alfa.companyId}/status`, { status: "suspended" }],
    ];
    for (const [method, url, payload] of calls) {
      const res = await app.inject({
        method: method as "GET",
        url: `/api/platform${url}`,
        headers: { cookie: regular.cookie },
        ...(payload ? { payload } : {}),
      });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
  });
});

describe("Kompaniyalar", () => {
  it("holat bo'yicha filtr va a'zolar soni", async () => {
    const beta = await createCompany(app, admin.cookie, { name: "Beta" });
    await app.inject({
      method: "POST",
      url: "/api/company/employees",
      headers: { cookie: alfa.ownerCookie },
      payload: { phone: uniquePhone(), password: "xodim-parol-123" },
    });
    expect((await asAdmin("POST", `/companies/${beta.companyId}/status`, { status: "suspended" })).statusCode).toBe(200);

    const suspended = (await asAdmin("GET", "/companies?status=suspended")).json().companies;
    expect(suspended.map((c: { name: string }) => c.name)).toEqual(["Beta"]);

    const all = (await asAdmin("GET", "/companies")).json().companies as { name: string; memberCount: number }[];
    expect(all.find((c) => c.name === "Alfa")!.memberCount).toBe(2);
    expect((await asAdmin("GET", "/companies?status=yoq")).statusCode).toBe(400);
  });

  it("tafsilot: egasi, a'zolar, filiallar — xeshlarsiz; noma'lum kompaniya 404", async () => {
    const res = await asAdmin("GET", `/companies/${alfa.companyId}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.company).toMatchObject({ id: alfa.companyId, name: "Alfa", status: "active" });
    expect(body.owner).toMatchObject({ id: alfa.owner.id, phone: alfa.owner.phone });
    expect(body.members).toEqual([expect.objectContaining({ userId: alfa.owner.id, companyRole: "Business Owner" })]);
    expect(body.branches).toEqual([expect.objectContaining({ code: "BR-001", isDefault: true })]);
    expect(res.body).not.toMatch(/argon2|passwordHash|pinHash|legacyId/);

    expect((await asAdmin("GET", `/companies/${randomUUID()}`)).statusCode).toBe(404);
  });

  it("to'xtatish yozishni yopadi, o'qish qoladi; faollashtirish ochadi", async () => {
    const suspend = await asAdmin("POST", `/companies/${alfa.companyId}/status`, {
      status: "suspended",
      reason: "To'lov qilinmagan",
    });
    expect(suspend.statusCode).toBe(200);
    expect(suspend.json().company).toMatchObject({ status: "suspended", suspendReason: "To'lov qilinmagan" });
    expect(suspend.json().company.suspendedAt).toBeTruthy();

    const ownerPatch = () =>
      app.inject({ method: "PATCH", url: "/api/company", headers: { cookie: alfa.ownerCookie }, payload: { city: "Samarqand" } });
    expect((await ownerPatch()).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/company", headers: { cookie: alfa.ownerCookie } })).statusCode).toBe(200);

    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "COMPANY_STATUS_CHANGED"));
    expect(audit).toMatchObject({ companyId: alfa.companyId, severity: "warning", userId: admin.user.id });
    expect(audit!.details).toEqual({ from: "active", to: "suspended", reason: "To'lov qilinmagan" });

    const activate = await asAdmin("POST", `/companies/${alfa.companyId}/status`, { status: "active" });
    expect(activate.json().company).toMatchObject({ status: "active", suspendReason: null, suspendedAt: null });
    expect((await ownerPatch()).statusCode).toBe(200);

    expect((await asAdmin("POST", `/companies/${alfa.companyId}/status`, { status: "yoq" })).statusCode).toBe(400);
    expect((await asAdmin("POST", `/companies/${randomUUID()}/status`, { status: "active" })).statusCode).toBe(404);
  });
});

describe("Statistika", () => {
  it("kompaniyalar, foydalanuvchilar, a'zolar va holatlar soni", async () => {
    const beta = await createCompany(app, admin.cookie, { name: "Beta" });
    await asAdmin("POST", `/companies/${beta.companyId}/status`, { status: "suspended" });

    const stats = (await asAdmin("GET", "/stats")).json();
    expect(stats).toEqual({
      totalCompanies: 2,
      totalUsers: 3,
      totalMembers: 2,
      byStatus: { active: 1, trial: 0, pending: 0, suspended: 1, cancelled: 0 },
    });
  });
});

describe("Audit jurnali", () => {
  it("yangidan eskiga, kursor bilan hammasini tushirmasdan sahifalaydi", async () => {
    const total = (await db.select().from(auditLogs)).length;
    expect(total).toBeGreaterThan(3);

    const seen: { id: string; occurredAt: string }[] = [];
    let cursor: string | null = null;
    do {
      const url: string = `/audit-logs?limit=2${cursor ? `&cursor=${cursor}` : ""}`;
      const page = (await asAdmin("GET", url)).json() as { logs: { id: string; occurredAt: string }[]; nextCursor: string | null };
      expect(page.logs.length).toBeLessThanOrEqual(2);
      seen.push(...page.logs);
      cursor = page.nextCursor;
    } while (cursor);

    expect(new Set(seen.map((l) => l.id)).size).toBe(total);
    const times = seen.map((l) => Date.parse(l.occurredAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("kompaniya bo'yicha filtr va kompaniya nomi; noto'g'ri kursor 400", async () => {
    const { logs } = (await asAdmin("GET", `/audit-logs?companyId=${alfa.companyId}`)).json();
    expect(logs.length).toBeGreaterThan(0);
    for (const log of logs) expect(log).toMatchObject({ companyId: alfa.companyId, companyName: "Alfa" });

    const all = (await asAdmin("GET", "/audit-logs")).json().logs as { companyId: string | null; companyName: string }[];
    expect(all.filter((l) => l.companyId === null).every((l) => l.companyName === "Platforma")).toBe(true);

    expect((await asAdmin("GET", "/audit-logs?cursor=buzilgan")).statusCode).toBe(400);
  });
});

describe("Foydalanuvchilar", () => {
  it("maxfiy maydonlarsiz ro'yxat va qidiruv", async () => {
    const res = await asAdmin("GET", "/users");
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(2);
    expect(res.body).not.toMatch(/argon2|passwordHash|pinHash|password_hash/);

    const found = (await asAdmin("GET", `/users?search=${alfa.owner.phone.slice(-7)}`)).json();
    expect(found.total).toBe(1);
    expect(found.users[0]).toMatchObject({ id: alfa.owner.id, activeCompanyName: "Alfa", isBootstrapAdmin: false });

    // % oddiy belgi sifatida — hammasini qaytarmaydi
    expect((await asAdmin("GET", "/users?search=%25")).json().total).toBe(0);
  });
});

describe("Sozlamalar", () => {
  it("standart qiymatlar, saqlash, audit; takroriy saqlash dublikat qator yaratmaydi", async () => {
    expect((await asAdmin("GET", "/settings")).json().settings).toEqual({
      registrationEnabled: true,
      defaultTrialDays: 14,
      platformName: "BUM ERP",
      supportEmail: "",
    });

    const saved = await asAdmin("PUT", "/settings", {
      registrationEnabled: false,
      defaultTrialDays: 30,
      supportEmail: "help@bum.uz",
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().settings).toMatchObject({ registrationEnabled: false, defaultTrialDays: 30 });

    expect((await asAdmin("PUT", "/settings", { defaultTrialDays: 7 })).statusCode).toBe(200);
    expect((await asAdmin("GET", "/settings")).json().settings).toEqual({
      registrationEnabled: false,
      defaultTrialDays: 7,
      platformName: "BUM ERP",
      supportEmail: "help@bum.uz",
    });

    const rows = await db
      .select()
      .from(settings)
      .where(and(isNull(settings.companyId), eq(settings.group, "platform")));
    expect(rows.map((r) => r.key).sort()).toEqual(["defaultTrialDays", "registrationEnabled", "supportEmail"]);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "PLATFORM_SETTINGS_UPDATED"))).toHaveLength(2);
  });

  it("noto'g'ri qiymatlarni rad etadi", async () => {
    for (const body of [{ defaultTrialDays: -1 }, { supportEmail: "xato" }, { nomalum: 1 }, { platformName: "" }]) {
      expect((await asAdmin("PUT", "/settings", body)).statusCode, JSON.stringify(body)).toBe(400);
    }
    const [company] = await db.select().from(companies).where(eq(companies.id, alfa.companyId));
    expect(company!.status).toBe("active");
  });
});
