import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { cashAccounts } from "../src/db/schema/finance.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { auditLogs, companyModuleHistory, companyModules } from "../src/db/schema/platform.js";
import { subscriptions } from "../src/db/schema/subscription.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn, uniquePhone } from "./helpers.js";

type Method = "GET" | "POST" | "PUT" | "PATCH";
type ModuleRow = { key: string; enabled: boolean };

let app: FastifyInstance;
let admin: Awaited<ReturnType<typeof signedIn>>;

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
});

const call = (cookie: string | null, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: cookie ? { cookie } : {}, ...(payload ? { payload } : {}) });
/**
 * Modullar FAQAT platforma admini orqali o'zgaradi — kompaniyaning o'z endpointi rad etadi
 * (`companySetModule` bilan alohida tekshiriladi).
 */
const setModule = (company: { companyId: string }, key: string, enabled: boolean, extra: object = {}) =>
  call(admin.cookie, "PUT", `/api/platform/companies/${company.companyId}/modules/${key}`, { enabled, ...extra });
/** Kompaniyaning o'z yo'li — endi har doim rad etiladi. */
const companySetModule = (cookie: string, key: string, enabled: boolean) =>
  call(cookie, "PUT", `/api/company/modules/${key}`, { enabled });

describe("Modullar: server guard, bog'liqliklar, RBAC, obuna, ro'yxatdan o'tish", () => {
  it("o'chirish: API MODULE_DISABLED, ma'lumot saqlanadi, boshqa kompaniya ta'sirlanmaydi, qayta yoqish; tarix va audit", async () => {
    const a = await createCompany(app, admin.cookie, { name: "A do'kon" });
    const b = await createCompany(app, admin.cookie, { name: "B do'kon" });
    const created = await call(a.ownerCookie, "POST", "/api/finance/cash-accounts", { name: "Zaxira kassa", type: "cash" });
    expect(created.statusCode, created.body).toBe(201);
    expect((await call(a.ownerCookie, "GET", "/api/company")).json().modules).toMatchObject({ finance: true, pos: true, manufacturing: true });

    const off = await setModule(a, "finance", false, { reason: "Hozircha kerak emas" });
    expect(off.statusCode, off.body).toBe(200);
    expect(off.json().changed).toBe(true);
    expect(off.json().modules.find((row: ModuleRow) => row.key === "finance")).toMatchObject({ enabled: false });

    const blockedCalls: [Method, string, object?][] = [
      ["GET", "/api/finance/cash-accounts"],
      ["POST", "/api/finance/cash-accounts", { name: "Yana kassa", type: "cash" }],
      ["GET", "/api/finance/terminals"],
    ];
    for (const [method, url, payload] of blockedCalls) {
      const res = await call(a.ownerCookie, method, url, payload);
      expect(res.statusCode, url).toBe(403);
      expect(res.json()).toMatchObject({ code: "MODULE_DISABLED", details: { reason: "module_disabled", module: "finance" } });
    }
    // Valyuta kurslari hamma bo'limda kerak — modulga bog'lanmagan
    expect((await call(a.ownerCookie, "GET", "/api/finance/currencies")).statusCode).toBe(200);
    // Ma'lumot o'chirilmaydi
    expect(await db.select().from(cashAccounts).where(and(eq(cashAccounts.companyId, a.companyId), eq(cashAccounts.name, "Zaxira kassa")))).toHaveLength(1);
    expect((await call(a.ownerCookie, "GET", "/api/company")).json().modules.finance).toBe(false);
    // Boshqa kompaniya ta'sirlanmaydi
    expect((await call(b.ownerCookie, "GET", "/api/finance/cash-accounts")).statusCode).toBe(200);
    expect((await call(b.ownerCookie, "GET", "/api/company")).json().modules.finance).toBe(true);

    expect((await setModule(a, "finance", false)).json().changed).toBe(false);
    expect((await setModule(a, "finance", true)).statusCode).toBe(200);
    const list = await call(a.ownerCookie, "GET", "/api/finance/cash-accounts");
    expect(list.statusCode).toBe(200);
    expect(list.json().cashAccounts.map((row: { name: string }) => row.name)).toContain("Zaxira kassa");

    const history = await db.select().from(companyModuleHistory).where(eq(companyModuleHistory.companyId, a.companyId));
    expect(history.map((row) => `${row.moduleKey}:${row.enabled}:${row.source}`).sort()).toEqual(["finance:false:platform", "finance:true:platform"]);
    const actions = await db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(and(eq(auditLogs.companyId, a.companyId), eq(auditLogs.resource, "company_modules")));
    expect(actions.map((row) => row.action).sort()).toEqual(["MODULE_DISABLED", "MODULE_ENABLED"]);
    const view = (await call(a.ownerCookie, "GET", "/api/company/modules")).json();
    expect(view.modules).toHaveLength(12);
    expect(view.history).toHaveLength(2);
    expect(view.history.find((row: { enabled: boolean }) => !row.enabled)).toMatchObject({ reason: "Hozircha kerak emas", source: "platform" });
  });

  it("bog'liqliklar va tizim qismlari; POS o'chsa POS API, qurilma sinxroni va yangi qurilma yopiladi", async () => {
    const a = await createCompany(app, admin.cookie, { name: "A do'kon" });
    const [warehouse] = await db.select().from(warehouses).where(eq(warehouses.companyId, a.companyId));
    const register = (name: string) =>
      app.inject({ method: "POST", url: "/api/pos-device/setup/register", payload: { phone: a.owner.phone, password: a.owner.password, warehouseId: warehouse!.id, name } });
    const registered = await register("Kassa 1");
    expect(registered.statusCode, registered.body).toBe(201);
    const deviceHeaders = { authorization: `Bearer ${registered.json().token as string}` };

    const products = await setModule(a, "products", false);
    expect(products.statusCode).toBe(400);
    expect(products.json().details).toMatchObject({ reason: "module_has_dependents" });
    expect(products.json().details.dependents).toEqual(expect.arrayContaining(["warehouse", "sales", "pos", "purchase", "manufacturing"]));
    for (const core of ["dashboard", "subscription", "settings", "auth", "company"]) {
      expect((await setModule(a, core, false)).statusCode, core).toBe(400);
    }

    expect((await setModule(a, "sales", false)).json().details.dependents).toEqual(expect.arrayContaining(["distribution", "delivery"]));
    for (const key of ["delivery", "distribution", "sales"]) expect((await setModule(a, key, false)).statusCode, key).toBe(200);
    const needsSales = await setModule(a, "delivery", true);
    expect(needsSales.statusCode).toBe(400);
    expect(needsSales.json().details).toMatchObject({ reason: "module_dependency_disabled", requires: ["sales"] });

    // Savdo o'chiq, POS yoqilgan: POS cheklari uchun umumiy buyurtmalar API ochiq; dostavka yopiq
    expect((await call(a.ownerCookie, "GET", "/api/sales/orders")).statusCode).toBe(200);
    expect((await call(a.ownerCookie, "GET", "/api/sales/pos/payment-options")).statusCode).toBe(200);
    expect((await call(a.ownerCookie, "GET", "/api/delivery/policy")).json()).toMatchObject({ code: "MODULE_DISABLED", details: { module: "delivery" } });

    expect((await setModule(a, "pos", false)).statusCode).toBe(200);
    expect((await call(a.ownerCookie, "GET", "/api/sales/pos/payment-options")).json()).toMatchObject({ code: "MODULE_DISABLED", details: { module: "pos" } });
    expect((await call(a.ownerCookie, "GET", "/api/sales/orders")).json()).toMatchObject({ code: "MODULE_DISABLED" });
    expect((await call(a.ownerCookie, "GET", "/api/catalog/products")).statusCode).toBe(200);

    // Qurilma: holat ochiq (kassa sababni ko'rsatadi), sinxron yopiq — navbatdagi amallar qurilmada qoladi
    expect((await app.inject({ method: "GET", url: "/api/pos-device/session", headers: deviceHeaders })).statusCode).toBe(200);
    const push = await app.inject({ method: "POST", url: "/api/pos-device/push", headers: deviceHeaders, payload: { ops: [] } });
    expect(push.statusCode).toBe(403);
    expect(push.json()).toMatchObject({ code: "MODULE_DISABLED", details: { module: "pos" } });
    expect((await register("Kassa 2")).json()).toMatchObject({ code: "MODULE_DISABLED" });
  });

  it("RBAC va obuna: xodim o'zgartira olmaydi; ruxsatsiz — FORBIDDEN, modul o'chiq — MODULE_DISABLED; obuna tugagani ustun; platforma admini", async () => {
    const a = await createCompany(app, admin.cookie, { name: "A do'kon" });
    const kassir = await addEmployee(app, a, "Kassir");
    // Kompaniyaning o'z yo'li hamma uchun yopiq: xodim ham, egasi ham modul yoqa olmaydi
    for (const cookie of [kassir.cookie, a.ownerCookie]) {
      const denied = await companySetModule(cookie, "finance", false);
      expect(denied.statusCode).toBe(403);
      expect(denied.json().code).toBe("FORBIDDEN");
      expect(denied.json().message).toContain("administratori");
    }
    const noPermission = await call(kassir.cookie, "GET", "/api/finance/cash-accounts");
    expect(noPermission.statusCode).toBe(403);
    expect(noPermission.json().code).toBe("FORBIDDEN");
    const kassirView = (await call(kassir.cookie, "GET", "/api/company/modules")).json();
    expect(kassirView.modules).toHaveLength(12);
    expect(kassirView.history).toEqual([]);

    expect((await setModule(a, "finance", false)).statusCode).toBe(200);
    expect((await call(kassir.cookie, "GET", "/api/finance/cash-accounts")).json().code).toBe("MODULE_DISABLED");
    expect((await call(kassir.cookie, "GET", "/api/company")).json().modules.finance).toBe(false);

    expect((await call(a.ownerCookie, "GET", `/api/platform/companies/${a.companyId}/modules`)).statusCode).toBe(403);
    expect((await call(admin.cookie, "GET", "/api/platform/companies/00000000-0000-4000-8000-000000000000/modules")).statusCode).toBe(404);

    // Obuna tugagan + modul o'chiq — obuna xatosi (uzaytirish yo'li ko'rinadi); modulni ham o'zgartirib bo'lmaydi
    await db.update(subscriptions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(subscriptions.companyId, a.companyId));
    const expired = await call(a.ownerCookie, "GET", "/api/finance/cash-accounts");
    expect(expired.statusCode).toBe(403);
    expect(expired.json().details).toMatchObject({ reason: "subscription_expired" });
    const platform = await call(admin.cookie, "PUT", `/api/platform/companies/${a.companyId}/modules/finance`, { enabled: true, reason: "Qo'llab-quvvatlash" });
    expect(platform.statusCode, platform.body).toBe(200);
    const view = (await call(admin.cookie, "GET", `/api/platform/companies/${a.companyId}/modules`)).json();
    expect(view.modules.find((row: ModuleRow) => row.key === "finance")).toMatchObject({ enabled: true });
    expect(view.history[0]).toMatchObject({ moduleKey: "finance", enabled: true, source: "platform", reason: "Qo'llab-quvvatlash" });
  });

  it("ro'yxatdan o'tish: tanlangan modullar va bog'liqliklari yoqiladi, qolganlari o'chiq; tanlovsiz yaratilgan kompaniyada hammasi yoqilgan", async () => {
    expect((await call(admin.cookie, "PUT", "/api/platform/settings", { registrationEnabled: true })).statusCode).toBe(200);
    const body = (modules: string[]) => ({ companyName: "Modulli do'kon", phone: uniquePhone("97"), password: "yangi-parol-123", modules });
    expect((await call(null, "POST", "/api/registration", body(["pos", "dashboard"]))).statusCode).toBe(400);

    const res = await call(null, "POST", "/api/registration", body(["pos", "finance"]));
    expect(res.statusCode, res.body).toBe(201);
    const companyId = res.json().company.id as string;
    const rows = await db.select().from(companyModules).where(eq(companyModules.companyId, companyId));
    expect(rows).toHaveLength(12);
    expect(rows.filter((row) => row.enabled).map((row) => row.moduleKey).sort()).toEqual(["finance", "pos", "products", "warehouse"]);
    const history = await db.select().from(companyModuleHistory).where(eq(companyModuleHistory.companyId, companyId));
    expect(history).toHaveLength(12);
    expect(history.every((row) => row.source === "registration")).toBe(true);

    const cookie = `bum_session=${res.cookies.find((item) => item.name === "bum_session")!.value}`;
    expect((await call(cookie, "GET", "/api/company")).json().modules).toMatchObject({ pos: true, finance: true, sales: false, delivery: false, reports: false, manufacturing: false });
    expect((await call(cookie, "GET", "/api/analytics/reports/overview")).json()).toMatchObject({ code: "MODULE_DISABLED", details: { module: "reports" } });
    expect((await call(cookie, "GET", "/api/analytics/dashboard")).statusCode).toBe(200);
    expect((await call(cookie, "GET", "/api/delivery/policy")).json()).toMatchObject({ code: "MODULE_DISABLED" });

    const plain = await createCompany(app, admin.cookie, { name: "Oddiy do'kon" });
    expect(await db.select().from(companyModules).where(eq(companyModules.companyId, plain.companyId))).toHaveLength(0);
    expect((await call(plain.ownerCookie, "GET", "/api/company")).json().modules).toMatchObject({ manufacturing: true, reports: true });
  });
});
