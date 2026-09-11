import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ROLES } from "@bum/shared";
import { closeDb, db } from "../src/db/client.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { auditLogs, branches, companies, companyMembers, roles, users } from "../src/db/schema/platform.js";
import { buildServer } from "../src/server.js";
import { createCompany, createUser, login, me, resetDatabase, signedIn } from "./helpers.js";

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

const asAdmin = (method: "GET" | "POST" | "PATCH", url: string, payload?: object) =>
  app.inject({
    method,
    url: `/api/platform${url}`,
    headers: { cookie: admin.cookie },
    ...(payload ? { payload } : {}),
  });

const auditActions = async () =>
  (await db.select({ action: auditLogs.action }).from(auditLogs)).map((r) => r.action);

describe("Ruxsat", () => {
  it("kirmaganga 401, oddiy foydalanuvchiga 403", async () => {
    const payload = { name: "X", owner: { phone: "+998907000001", password: "egasi-parol-123" } };
    const anonymous = await app.inject({ method: "POST", url: "/api/platform/companies", payload });
    expect(anonymous.statusCode).toBe(401);

    const regular = await signedIn(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/platform/companies",
      headers: { cookie: regular.cookie },
      payload,
    });
    expect(res.statusCode).toBe(403);
    expect(await db.select().from(companies)).toHaveLength(0);
  });
});

describe("POST /api/platform/companies", () => {
  it("kompaniya, filial, ombor, rollar va egasini yaratadi", async () => {
    const res = await asAdmin("POST", "/companies", {
      name: "Mega Trade",
      owner: { phone: "90 777 66 55", password: "egasi-parol-123", name: "Ega Egamov" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.company).toMatchObject({ name: "Mega Trade", slug: "mega-trade" });
    expect(body.owner).toMatchObject({ phone: "+998907776655", name: "Ega Egamov" });

    const companyId = body.company.id as string;
    const ownerId = body.owner.id as string;

    const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
    expect(company).toMatchObject({ ownerId, status: "active", isActive: true });

    const [branch] = await db.select().from(branches).where(eq(branches.companyId, companyId));
    expect(branch).toMatchObject({ code: "BR-001", isDefault: true });
    const [warehouse] = await db.select().from(warehouses).where(eq(warehouses.companyId, companyId));
    expect(warehouse).toMatchObject({ code: "WH-001", isDefault: true });

    const companyRoles = await db.select().from(roles).where(eq(roles.companyId, companyId));
    expect(companyRoles).toHaveLength(DEFAULT_ROLES.length);

    const [membership] = await db
      .select()
      .from(companyMembers)
      .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, ownerId)));
    const ownerRole = companyRoles.find((r) => r.name === "Business Owner");
    expect(membership).toMatchObject({ companyRole: "Business Owner", roleId: ownerRole!.id, branchId: branch!.id });

    const [owner] = await db.select().from(users).where(eq(users.id, ownerId));
    expect(owner).toMatchObject({ activeCompanyId: companyId, isPlatformAdmin: false });

    expect(await auditActions()).toEqual(expect.arrayContaining(["COMPANY_CREATED", "USER_CREATED"]));

    const { cookie } = await login(app, "+998907776655", "egasi-parol-123");
    expect((await me(app, cookie!)).json().user).toMatchObject({
      companyName: "Mega Trade",
      companyRole: "Business Owner",
      isPlatformAdmin: false,
    });
  });

  it("egasi raqami band bo'lsa 409 va hech narsa yaratilmaydi", async () => {
    await createUser({ phone: "+998907776655" });
    const res = await asAdmin("POST", "/companies", {
      name: "Mega Trade",
      owner: { phone: "+998907776655", password: "egasi-parol-123" },
    });
    expect(res.statusCode).toBe(409);
    expect(await db.select().from(companies)).toHaveLength(0);
  });

  it("bir xil nomdagi kompaniyalarga noyob slug beradi", async () => {
    const first = await createCompany(app, admin.cookie, { name: "Mega Trade" });
    const second = await createCompany(app, admin.cookie, { name: "Mega Trade" });
    expect([first.slug, second.slug]).toEqual(["mega-trade", "mega-trade-2"]);
  });

  it("GET /companies egasi bilan qaytaradi", async () => {
    const created = await createCompany(app, admin.cookie, { name: "Alfa" });
    const res = await asAdmin("GET", "/companies");
    expect(res.statusCode).toBe(200);
    expect(res.json().companies).toEqual([
      expect.objectContaining({
        id: created.companyId,
        name: "Alfa",
        owner: expect.objectContaining({ id: created.owner.id, phone: created.owner.phone, isActive: true }),
      }),
    ]);
  });
});

describe("Foydalanuvchini boshqarish", () => {
  it("egasining parolini tiklaydi va uning barcha sessiyalarini bekor qiladi", async () => {
    const c = await createCompany(app, admin.cookie);
    expect((await me(app, c.ownerCookie)).statusCode).toBe(200);

    const res = await asAdmin("POST", `/users/${c.owner.id}/password`, { newPassword: "yangi-parol-456" });
    expect(res.statusCode).toBe(200);

    expect((await me(app, c.ownerCookie)).statusCode).toBe(401);
    expect((await login(app, c.owner.phone, c.owner.password)).res.statusCode).toBe(401);
    expect((await login(app, c.owner.phone, "yangi-parol-456")).res.statusCode).toBe(200);
    expect(await auditActions()).toContain("USER_PASSWORD_RESET");
  });

  it("qisqa yangi parolni rad etadi", async () => {
    const c = await createCompany(app, admin.cookie);
    expect((await asAdmin("POST", `/users/${c.owner.id}/password`, { newPassword: "123" })).statusCode).toBe(400);
  });

  it("egasining telefonini o'zgartiradi, band raqamga 409", async () => {
    const c = await createCompany(app, admin.cookie);

    const res = await asAdmin("PATCH", `/users/${c.owner.id}`, { phone: "93 555 44 33" });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.phone).toBe("+998935554433");
    expect((await login(app, "+998935554433", c.owner.password)).res.statusCode).toBe(200);
    expect((await login(app, c.owner.phone, c.owner.password)).res.statusCode).toBe(401);

    const taken = await createUser();
    expect((await asAdmin("PATCH", `/users/${c.owner.id}`, { phone: taken.phone })).statusCode).toBe(409);
    expect(await auditActions()).toContain("USER_PHONE_CHANGED");
  });

  it("bloklaydi (sessiyalar bekor, kirish 403) va qayta faollashtiradi", async () => {
    const c = await createCompany(app, admin.cookie);

    expect((await asAdmin("POST", `/users/${c.owner.id}/status`, { isActive: false })).statusCode).toBe(200);
    expect((await me(app, c.ownerCookie)).statusCode).toBe(401);
    expect((await login(app, c.owner.phone, c.owner.password)).res.statusCode).toBe(403);

    expect((await asAdmin("POST", `/users/${c.owner.id}/status`, { isActive: true })).statusCode).toBe(200);
    expect((await login(app, c.owner.phone, c.owner.password)).res.statusCode).toBe(200);
    expect(await auditActions()).toEqual(expect.arrayContaining(["USER_BLOCKED", "USER_ACTIVATED"]));
  });

  it("boshqa platforma adminiga va o'ziga tegmaydi", async () => {
    const other = await createUser({ isPlatformAdmin: true });
    expect((await asAdmin("POST", `/users/${other.user.id}/password`, { newPassword: "boshqa-parol-1" })).statusCode).toBe(403);
    expect((await asAdmin("POST", `/users/${admin.user.id}/status`, { isActive: false })).statusCode).toBe(403);
  });

  it("noma'lum foydalanuvchiga 404, noto'g'ri identifikatorga 400", async () => {
    expect((await asAdmin("POST", `/users/${randomUUID()}/status`, { isActive: false })).statusCode).toBe(404);
    expect((await asAdmin("POST", "/users/abc/status", { isActive: false })).statusCode).toBe(400);
  });
});
