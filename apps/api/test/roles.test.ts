import { and, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ROLES } from "@bum/shared";
import { closeDb, db } from "../src/db/client.js";
import { auditLogs, roles } from "../src/db/schema/platform.js";
import { seedGlobalRoles } from "../src/modules/platform/bootstrap.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let companyA: Company;
let companyB: Company;

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
  companyA = await createCompany(app, admin.cookie, { name: "A kompaniya" });
  companyB = await createCompany(app, admin.cookie, { name: "B kompaniya" });
});

const api = (cookie: string, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) =>
  app.inject({ method, url: `/api/company${url}`, headers: { cookie }, ...(payload ? { payload } : {}) });

async function roleId(companyId: string | null, name: string): Promise<string> {
  const [role] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(companyId ? eq(roles.companyId, companyId) : isNull(roles.companyId), eq(roles.name, name)));
  return role!.id;
}

const permissionsOf = async (cookie: string) =>
  ((await api(cookie, "GET", "")).json().permissions as string[]).sort();

describe("Rollar ro'yxati", () => {
  it("faqat shu kompaniyaning rollari, har qanday a'zoga", async () => {
    const res = await api(companyA.ownerCookie, "GET", "/roles");
    expect(res.statusCode).toBe(200);
    const list = res.json().roles as { id: string; name: string }[];
    expect(list.map((r) => r.name).sort()).toEqual(DEFAULT_ROLES.map((r) => r.name).sort());
    expect(list.map((r) => r.id)).not.toContain(await roleId(companyB.companyId, "Kassir"));

    const kassir = await addEmployee(app, companyA);
    expect((await api(kassir.cookie, "GET", "/roles")).statusCode).toBe(200);
  });
});

describe("Rol yaratish", () => {
  it("egasi maxsus rol yaratadi va u xodimga berilganda amalda ishlaydi", async () => {
    const created = await api(companyA.ownerCookie, "POST", "/roles", {
      name: "Filial boshlig'i",
      color: "#10b981",
      permissions: ["branches.manage", "users.view"],
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().role).toMatchObject({ name: "Filial boshlig'i", isSystem: false });

    const xodim = await addEmployee(app, companyA);
    expect((await api(companyA.ownerCookie, "PATCH", `/employees/${xodim.id}`, { role: "Filial boshlig'i" })).statusCode).toBe(200);

    expect((await api(xodim.cookie, "POST", "/branches", { name: "Yangi", code: "BR-777" })).statusCode).toBe(201);
    expect((await api(xodim.cookie, "GET", "/employees")).statusCode).toBe(200);
    expect((await api(xodim.cookie, "PATCH", "", { name: "Egallandi" })).statusCode).toBe(403);

    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "ROLE_CREATED"))).toHaveLength(1);
  });

  it("noma'lum ruxsat 400, bo'sh ro'yxat 400, to'liq huquqli nom 403, band nom 409", async () => {
    const create = (body: object) => api(companyA.ownerCookie, "POST", "/roles", body);
    expect((await create({ name: "X", permissions: ["hamma.narsa"] })).statusCode).toBe(400);
    expect((await create({ name: "X", permissions: [] })).statusCode).toBe(400);
    expect((await create({ name: "Business Owner", permissions: ["users.view"] })).statusCode).toBe(403);
    expect((await create({ name: "Superadmin", permissions: ["users.view"] })).statusCode).toBe(403);
    expect((await create({ name: "Kassir", permissions: ["users.view"] })).statusCode).toBe(409);
  });

  it("roles.manage yo'q — 403 (Direktor ham, Kassir ham)", async () => {
    const direktor = await addEmployee(app, companyA, "Direktor");
    const kassir = await addEmployee(app, companyA, "Kassir");
    const body = { name: "Yangi rol", permissions: ["users.view"] };
    expect((await api(direktor.cookie, "POST", "/roles", body)).statusCode).toBe(403);
    expect((await api(kassir.cookie, "PATCH", `/roles/${await roleId(companyA.companyId, "Kassir")}`, { permissions: ["company.manage"] })).statusCode).toBe(403);
  });
});

describe("Huquqni oshirishdan himoya", () => {
  it("roles.manage egasi o'zida yo'q ruxsatni bera olmaydi va o'z rolini kengaytira olmaydi", async () => {
    await api(companyA.ownerCookie, "POST", "/roles", { name: "Rol menejeri", permissions: ["roles.manage", "users.view"] });
    const menejer = await addEmployee(app, companyA);
    await api(companyA.ownerCookie, "PATCH", `/employees/${menejer.id}`, { role: "Rol menejeri" });
    const ownRoleId = await roleId(companyA.companyId, "Rol menejeri");

    const escalate = await api(menejer.cookie, "PATCH", `/roles/${ownRoleId}`, {
      permissions: ["roles.manage", "users.view", "company.manage"],
    });
    expect(escalate.statusCode).toBe(403);
    expect(escalate.json().message).toContain("company.manage");
    expect(await permissionsOf(menejer.cookie)).toEqual(["roles.manage", "users.view"]);

    expect((await api(menejer.cookie, "POST", "/roles", { name: "Moliyachi", permissions: ["finance.manage"] })).statusCode).toBe(403);
    expect((await api(menejer.cookie, "POST", "/roles", { name: "Ko'ruvchi 2", permissions: ["users.view"] })).statusCode).toBe(201);
  });

  it("global rolni va boshqa kompaniya rolini tahrirlab bo'lmaydi — 404", async () => {
    await seedGlobalRoles(db);
    const globalKassir = await roleId(null, "Kassir");
    const foreignKassir = await roleId(companyB.companyId, "Kassir");

    const patch = { permissions: ["products.view", "company.manage"] };
    expect((await api(companyA.ownerCookie, "PATCH", `/roles/${globalKassir}`, patch)).statusCode).toBe(404);
    expect((await api(companyA.ownerCookie, "PATCH", `/roles/${foreignKassir}`, patch)).statusCode).toBe(404);
    expect((await api(companyA.ownerCookie, "DELETE", `/roles/${foreignKassir}`)).statusCode).toBe(404);

    const [global] = await db.select().from(roles).where(eq(roles.id, globalKassir));
    expect(global!.permissions).not.toContain("company.manage");
  });
});

describe("Rolni tahrirlash", () => {
  it("tizim rolining nomi o'zgarmaydi, ruxsatlari o'zgaradi va darhol amal qiladi", async () => {
    const kassir = await addEmployee(app, companyA, "Kassir");
    const kassirRole = await roleId(companyA.companyId, "Kassir");

    expect((await api(companyA.ownerCookie, "PATCH", `/roles/${kassirRole}`, { name: "Sotuvchi" })).statusCode).toBe(403);

    const kassirPermissions = DEFAULT_ROLES.find((r) => r.name === "Kassir")!.permissions;
    const res = await api(companyA.ownerCookie, "PATCH", `/roles/${kassirRole}`, {
      permissions: [...kassirPermissions, "crm.view"],
    });
    expect(res.statusCode).toBe(200);
    expect(await permissionsOf(kassir.cookie)).toContain("crm.view");

    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "ROLE_UPDATED"));
    expect(audit!.details).toMatchObject({ changes: ["permissions"], added: ["crm.view"] });
  });

  it("to'liq huquqli rolni o'zgartirib bo'lmaydi", async () => {
    const ownerRole = await roleId(companyA.companyId, "Business Owner");
    expect((await api(companyA.ownerCookie, "PATCH", `/roles/${ownerRole}`, { permissions: ["users.view"] })).statusCode).toBe(403);
  });

  it("maxsus rol nomi o'zgarsa a'zolikdagi rol nomi ham yangilanadi", async () => {
    await api(companyA.ownerCookie, "POST", "/roles", { name: "Kuryer", permissions: ["sales.view"] });
    const xodim = await addEmployee(app, companyA);
    await api(companyA.ownerCookie, "PATCH", `/employees/${xodim.id}`, { role: "Kuryer" });

    const id = await roleId(companyA.companyId, "Kuryer");
    expect((await api(companyA.ownerCookie, "PATCH", `/roles/${id}`, { name: "Yetkazuvchi" })).statusCode).toBe(200);

    const body = (await api(xodim.cookie, "GET", "")).json();
    expect(body.membership.companyRole).toBe("Yetkazuvchi");
    expect(body.permissions).toEqual(["sales.view"]);
  });
});

describe("Rolni o'chirish", () => {
  it("xodimi bor rol 409, tizim roli 403, bo'sh maxsus rol o'chadi", async () => {
    await api(companyA.ownerCookie, "POST", "/roles", { name: "Vaqtinchalik", permissions: ["sales.view"] });
    const id = await roleId(companyA.companyId, "Vaqtinchalik");
    const xodim = await addEmployee(app, companyA);
    await api(companyA.ownerCookie, "PATCH", `/employees/${xodim.id}`, { role: "Vaqtinchalik" });

    expect((await api(companyA.ownerCookie, "DELETE", `/roles/${id}`)).statusCode).toBe(409);
    expect((await api(companyA.ownerCookie, "DELETE", `/roles/${await roleId(companyA.companyId, "Kassir")}`)).statusCode).toBe(403);

    await api(companyA.ownerCookie, "PATCH", `/employees/${xodim.id}`, { role: "Kassir" });
    expect((await api(companyA.ownerCookie, "DELETE", `/roles/${id}`)).statusCode).toBe(200);

    const names = ((await api(companyA.ownerCookie, "GET", "/roles")).json().roles as { name: string }[]).map((r) => r.name);
    expect(names).not.toContain("Vaqtinchalik");
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "ROLE_DELETED"))).toHaveLength(1);
  });
});
