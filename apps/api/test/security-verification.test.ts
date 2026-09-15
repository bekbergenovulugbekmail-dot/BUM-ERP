/**
 * Mustaqil xavfsizlik tekshiruvi (2026-09-15): A va B kompaniyalari, turli rollar bilan hujum stsenariylari —
 * CSRF, sessiya (cookie bayroqlari, fiksatsiya, chiqishdan keyin qayta ishlatish), SQL injection va XSS yuklamalari,
 * obuna muddati, agent/HR orqali boshqa xodim loginini bloklash, boshqa kompaniya buyurtmasini va takroriy qaytarish.
 * Boshqa toifalar (litsenziya, modul, terminal va bank hisobi izolyatsiyasi, aralash to'lov, oflayn takror, fayl
 * yuklash, limitlar) o'z testlarida: subscription, modules, payment-terminals, pos-mixed-payment, pos-sale-sync,
 * files, auth, tenant-isolation, security-hardening, owner-decisions.
 */
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { companyMembers } from "../src/db/schema/platform.js";
import { env } from "../src/env.js";
import { buildServer } from "../src/server.js";
import { caller, deliveryCompany, resetUnits, type DeliveryCompany } from "./delivery-setup.js";
import { addEmployee, me, resetDatabase, signedIn } from "./helpers.js";

let app: FastifyInstance;
let call: ReturnType<typeof caller>;
let a: DeliveryCompany;
let b: DeliveryCompany;

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
  call = caller(app);
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

beforeEach(async () => {
  await resetDatabase();
  await resetUnits();
  const admin = (await signedIn(app, { isPlatformAdmin: true })).cookie;
  a = await deliveryCompany(app, admin, "Bonnu");
  b = await deliveryCompany(app, admin, "Hadicha");
});

const inject = (method: "GET" | "POST", url: string, headers: Record<string, string>, payload?: object) =>
  app.inject({ method, url, headers, ...(payload ? { payload } : {}) });

describe("CSRF: sessiya cookie'si bilan boshqa saytdan o'zgartiruvchi so'rov", () => {
  it("begona Origin, boshqa subdomen va cross-site belgisi — 403; ilova manzili va shu host — ruxsat; o'qish va cookie'siz so'rov tegilmaydi", async () => {
    const create = (headers: Record<string, string>, name: string) => inject("POST", "/api/sales/customers", { cookie: a.ownerCookie, ...headers }, { name });

    const evil = await create({ origin: "https://evil.example" }, "CSRF 1");
    expect(evil.statusCode).toBe(403);
    expect(evil.json().details).toMatchObject({ reason: "csrf_origin" });
    const sibling = await create({ origin: "https://evil.bum-erp.uz", host: "app.bum-erp.uz" }, "CSRF 2");
    expect(sibling.statusCode).toBe(403);
    expect((await create({ "sec-fetch-site": "cross-site" }, "CSRF 3")).statusCode).toBe(403);
    expect((await create({ origin: "null" }, "CSRF 4")).statusCode).toBe(403);

    expect((await create({ origin: env.WEB_ORIGIN }, "Ruxsat 1")).statusCode).toBe(201);
    expect((await create({ origin: "https://app.bum-erp.uz", host: "app.bum-erp.uz" }, "Ruxsat 2")).statusCode).toBe(201);
    expect((await create({ "sec-fetch-site": "same-origin" }, "Ruxsat 3")).statusCode).toBe(201);

    expect((await inject("GET", "/api/sales/customers", { cookie: a.ownerCookie, origin: "https://evil.example" })).statusCode).toBe(200);
    expect((await inject("POST", "/api/sales/customers", { origin: "https://evil.example" }, { name: "Cookie'siz" })).statusCode).toBe(401);

    const names = ((await call(a.ownerCookie, "GET", "/api/sales/customers?limit=500")).json().customers as { name: string }[]).map((row) => row.name);
    expect(names.filter((name) => name.startsWith("CSRF"))).toEqual([]);
    expect(names.filter((name) => name.startsWith("Ruxsat")).sort()).toEqual(["Ruxsat 1", "Ruxsat 2", "Ruxsat 3"]);
  });
});

describe("Sessiya xavfsizligi", () => {
  it("cookie HttpOnly va SameSite=Lax; oldindan qo'yilgan sessiya ID qabul qilinmaydi; chiqishdan keyin eski cookie ishlamaydi", async () => {
    const attacker = "bum_session=hujumchi-tanlagan-qiymat";
    const login = await inject("POST", "/api/auth/login", { cookie: attacker }, { phone: a.owner.phone, password: a.owner.password });
    expect(login.statusCode, login.body).toBe(200);
    const setCookie = String(login.headers["set-cookie"]);
    expect(setCookie).toMatch(/bum_session=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).not.toMatch(/Domain=/i);
    expect(setCookie).not.toContain("hujumchi-tanlagan-qiymat");
    expect(login.body).not.toContain("passwordHash");
    expect((await me(app, attacker)).statusCode).toBe(401);

    const cookie = setCookie.split(";")[0]!;
    expect((await me(app, cookie)).statusCode).toBe(200);
    expect((await call(cookie, "POST", "/api/auth/logout")).statusCode).toBeLessThan(300);
    expect((await me(app, cookie)).statusCode).toBe(401);
    expect((await call(cookie, "POST", "/api/sales/customers", { name: "Chiqqandan keyin" })).statusCode).toBe(401);
  });
});

describe("SQL injection va XSS yuklamalari", () => {
  const PAYLOADS = ["' OR '1'='1", "%' OR 1=1 --", "\"; DROP TABLE customers; --", "'); SELECT pg_sleep(5); --", "\\' UNION SELECT password_hash FROM users --"];

  it("qidiruv va ID parametrlarida SQL yuklama: 500 yo'q, boshqa kompaniya ma'lumoti chiqmaydi, jadvallar joyida", async () => {
    for (const payload of PAYLOADS) {
      for (const path of ["/api/sales/customers?search=", "/api/catalog/products?search=", "/api/purchase/suppliers?search="]) {
        const started = Date.now();
        const res = await call(b.ownerCookie, "GET", `${path}${encodeURIComponent(payload)}`);
        expect([200, 400], `${path}${payload} -> ${res.statusCode} ${res.body}`).toContain(res.statusCode);
        expect(res.body).not.toContain("Bonnu");
        expect(res.body).not.toContain("password_hash");
        expect(Date.now() - started).toBeLessThan(4000);
      }
      const byId = await call(b.ownerCookie, "GET", `/api/sales/customers/${encodeURIComponent(payload)}`);
      expect([400, 404], `id ${payload} -> ${byId.statusCode}`).toContain(byId.statusCode);
    }
    const own = (await call(a.ownerCookie, "GET", "/api/sales/customers")).json().customers as { name: string }[];
    expect(own.map((row) => row.name)).toContain("Bonnu do'koni");
  });

  it("XSS yuklama saqlanadi va JSON matn sifatida qaytadi (HTML sifatida emas), nosniff sarlavhasi bilan", async () => {
    const payload = `<img src=x onerror="alert(document.cookie)"><script>alert(1)</script>`;
    const created = await call(a.ownerCookie, "POST", "/api/sales/customers", { name: payload, address: "<svg onload=alert(1)>" });
    expect(created.statusCode, created.body).toBe(201);
    const fetched = await call(a.ownerCookie, "GET", `/api/sales/customers/${created.json().customer.id}`);
    expect(fetched.headers["content-type"]).toMatch(/^application\/json/);
    expect(fetched.headers["x-content-type-options"]).toBe("nosniff");
    expect(fetched.json().customer).toMatchObject({ name: payload, address: "<svg onload=alert(1)>" });
  });
});

describe("Obuna va boshqa xodim loginini bloklash", () => {
  it("obuna muddati tugagan kompaniya yozuv qila olmaydi (subscription_expired); boshqa kompaniya ta'sirlanmaydi", async () => {
    await db.execute(sql`update subscriptions set status = 'active', expires_at = now() - interval '1 day' where company_id = ${a.companyId}`);
    const denied = await call(a.ownerCookie, "POST", "/api/sales/customers", { name: "Muddati o'tgan" });
    expect(denied.statusCode, denied.body).toBe(403);
    expect(denied.json().details).toMatchObject({ reason: "subscription_expired" });
    expect((await call(b.ownerCookie, "POST", "/api/sales/customers", { name: "Faol kompaniya" })).statusCode).toBe(201);
  });

  it("agentlar menejeri boshqa xodimni agent profiliga bog'lab, HR menejeri HR yozuvini bog'lab o'chirib uning loginini bloklay olmaydi", async () => {
    const storekeeper = await addEmployee(app, a, "Ombor menejeri");
    const active = async () =>
      (await db.select({ isActive: companyMembers.isActive }).from(companyMembers).where(and(eq(companyMembers.companyId, a.companyId), eq(companyMembers.userId, storekeeper.id))))[0]!
        .isActive;

    const role = await call(a.ownerCookie, "POST", "/api/company/roles", { name: "Agent rahbari", permissions: ["distribution.view", "distribution.manage", "sales_agent.agents.manage"] });
    expect(role.statusCode, role.body).toBe(201);
    const manager = await addEmployee(app, a, "Agent rahbari");
    const rep = await call(manager.cookie, "POST", "/api/distribution/sales-reps", { name: "Soxta agent", userId: storekeeper.id });
    if (rep.statusCode === 201) {
      const repId = (rep.json().salesRep ?? rep.json().rep).id as string;
      const deactivate = await call(manager.cookie, "PATCH", `/api/sales-agent/team/${repId}`, { isActive: false });
      expect(deactivate.statusCode, deactivate.body).toBe(403);
    } else {
      expect([400, 403, 409]).toContain(rep.statusCode);
    }
    expect(await active()).toBe(true);
    expect((await me(app, storekeeper.cookie)).statusCode).toBe(200);

    const hrRecord = await call(a.ownerCookie, "POST", "/api/hr/employees", { name: "Omborchi", hireDate: "2026-01-01", baseSalary: "1000000", salaryType: "monthly", userId: storekeeper.id });
    expect(hrRecord.statusCode, hrRecord.body).toBe(201);
    const hr = await addEmployee(app, a, "HR menejeri");
    const removed = await call(hr.cookie, "DELETE", `/api/hr/employees/${hrRecord.json().employee.id}`);
    expect(removed.statusCode, removed.body).toBe(403);
    expect(await active()).toBe(true);
    expect((await me(app, storekeeper.cookie)).statusCode).toBe(200);
  });
});

describe("Qaytarish (refund) ruxsati", () => {
  it("B kompaniyasi A chekini qaytara olmaydi; bir qator ikki marta qaytarilmaydi; ruxsatsiz xodim qaytara olmaydi", async () => {
    const shift = await call(a.ownerCookie, "POST", "/api/sales/pos/shifts", { warehouseId: a.warehouseId, openingCash: "0" });
    expect(shift.statusCode, shift.body).toBe(201);
    const sale = await call(a.ownerCookie, "POST", "/api/sales/pos/sales", {
      shiftId: shift.json().shift.id,
      items: [{ productId: a.productId, quantity: "2" }],
      paymentMethod: "cash",
      amountPaid: "10000",
    });
    expect(sale.statusCode, sale.body).toBe(201);
    const order = sale.json().order as { id: string; items: { id: string }[] };
    const body = { items: [{ orderItemId: order.items[0]!.id, quantity: "2" }], refundMethod: "cash" };

    expect((await call(b.ownerCookie, "POST", `/api/sales/orders/${order.id}/return-items`, body)).statusCode).toBe(404);
    const kassir = await addEmployee(app, a, "Kassir");
    expect((await call(kassir.cookie, "POST", `/api/sales/orders/${order.id}/return-items`, body)).statusCode).toBe(403);

    const first = await call(a.ownerCookie, "POST", `/api/sales/orders/${order.id}/return-items`, body);
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json().return).toMatchObject({ refundAmount: "10000.00" });
    const again = await call(a.ownerCookie, "POST", `/api/sales/orders/${order.id}/return-items`, { ...body, items: [{ orderItemId: order.items[0]!.id, quantity: "1" }] });
    expect([400, 409]).toContain(again.statusCode);
  });
});

describe("Ruxsat va kiritish chegaralari (LOW topilmalar)", () => {
  it("kassir boshqa kassirning smenasini (tushum, kassa farqi) ko'rmaydi; rahbar ko'radi", async () => {
    const first = await addEmployee(app, a, "Kassir");
    const second = await addEmployee(app, a, "Kassir");
    const opened = await call(first.cookie, "POST", "/api/sales/pos/shifts", { warehouseId: a.warehouseId, openingCash: "150000" });
    expect(opened.statusCode, opened.body).toBe(201);
    const shiftId = opened.json().shift.id as string;
    expect((await call(first.cookie, "GET", `/api/sales/pos/shifts/${shiftId}`)).statusCode).toBe(200);
    expect((await call(second.cookie, "GET", `/api/sales/pos/shifts/${shiftId}`)).statusCode).toBe(404);
    expect(((await call(second.cookie, "GET", "/api/sales/pos/shifts")).json().shifts as { id: string }[]).map((row) => row.id)).not.toContain(shiftId);
    expect(((await call(a.ownerCookie, "GET", "/api/sales/pos/shifts")).json().shifts as { id: string }[]).map((row) => row.id)).toContain(shiftId);
  });

  it("maoshni faqat hr.salary bilan belgilash; keshbek pog'onasida tiyindan mayda summa 400 (500 emas)", async () => {
    const role = await call(a.ownerCookie, "POST", "/api/company/roles", { name: "Kadrlar", permissions: ["hr.view", "hr.manage"] });
    expect(role.statusCode, role.body).toBe(201);
    const hr = await addEmployee(app, a, "Kadrlar");
    const body = { name: "Yangi xodim", hireDate: "2026-01-01", salaryType: "monthly" };
    expect((await call(hr.cookie, "POST", "/api/hr/employees", { ...body, baseSalary: "5000000" })).statusCode).toBe(403);
    expect((await call(hr.cookie, "POST", "/api/hr/employees", { ...body, baseSalary: "0" })).statusCode).toBe(201);

    const settings = { enabled: true, accrualBase: "paid", maxUsagePercent: 50, categoryRates: [] };
    for (const minAmount of [0.001, 1e-7]) {
      expect((await call(a.ownerCookie, "PUT", "/api/sales/cashback/settings", { ...settings, tiers: [{ minAmount, percent: 1 }] })).statusCode).toBe(400);
    }
    expect((await call(a.ownerCookie, "PUT", "/api/sales/cashback/settings", { ...settings, tiers: [{ minAmount: 100000.5, percent: 1 }] })).statusCode).toBe(200);
  });
});

describe("Faol sessiyalar (boshqa qurilmalarni ko'rish va yopish)", () => {
  it("o'z sessiyalari ro'yxati (token yo'q), bitta sessiyani va boshqalarini tugatish; joriyni emas; begona sessiya 404", async () => {
    const loginAs = async (userAgent: string) => {
      const res = await inject("POST", "/api/auth/login", { "user-agent": userAgent }, { phone: a.owner.phone, password: a.owner.password });
      expect(res.statusCode, res.body).toBe(200);
      return String(res.headers["set-cookie"]).split(";")[0]!;
    };
    const desk = await loginAs("Kompyuter");
    const phone = await loginAs("Telefon");
    const tablet = await loginAs("Planshet");

    const list = await call(desk, "GET", "/api/auth/sessions");
    expect(list.statusCode, list.body).toBe(200);
    const rows = list.json().sessions as { id: string; userAgent: string; current: boolean }[];
    expect(rows.filter((row) => row.current).map((row) => row.userAgent)).toEqual(["Kompyuter"]);
    expect(rows.map((row) => row.userAgent)).toEqual(expect.arrayContaining(["Kompyuter", "Telefon", "Planshet"]));
    expect(list.body).not.toMatch(/token/i);

    const current = rows.find((row) => row.current)!;
    expect((await call(desk, "DELETE", `/api/auth/sessions/${current.id}`)).statusCode).toBe(400);
    const phoneSession = rows.find((row) => row.userAgent === "Telefon")!;
    expect((await call(b.ownerCookie, "DELETE", `/api/auth/sessions/${phoneSession.id}`)).statusCode).toBe(404);
    expect((await me(app, phone)).statusCode).toBe(200);

    expect((await call(desk, "DELETE", `/api/auth/sessions/${phoneSession.id}`)).statusCode).toBe(200);
    expect((await me(app, phone)).statusCode).toBe(401);
    expect((await me(app, tablet)).statusCode).toBe(200);

    const others = await call(desk, "POST", "/api/auth/sessions/revoke-others");
    expect(others.json().revoked).toBeGreaterThanOrEqual(1);
    expect((await me(app, tablet)).statusCode).toBe(401);
    expect((await me(app, desk)).statusCode).toBe(200);
  });
});
