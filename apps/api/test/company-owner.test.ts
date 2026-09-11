import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { auditLogs, companyMembers, roles } from "../src/db/schema/platform.js";
import { buildServer } from "../src/server.js";
import { createCompany, login, me, resetDatabase, signedIn, uniquePhone } from "./helpers.js";

let app: FastifyInstance;
let admin: Awaited<ReturnType<typeof signedIn>>;
let companyA: Awaited<ReturnType<typeof createCompany>>;
let companyB: Awaited<ReturnType<typeof createCompany>>;

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
  companyA = await createCompany(app, admin.cookie, { name: "A kompaniya" });
  companyB = await createCompany(app, admin.cookie, { name: "B kompaniya" });
});

const call = (cookie: string, method: "GET" | "POST", url: string, payload?: object) =>
  app.inject({ method, url: `/api/company${url}`, headers: { cookie }, ...(payload ? { payload } : {}) });

async function addEmployee(ownerCookie: string, fields: { role?: string; phone?: string } = {}) {
  const payload = { phone: fields.phone ?? uniquePhone(), password: "xodim-parol-123", name: "Xodim", ...fields };
  const res = await call(ownerCookie, "POST", "/employees", payload);
  return { res, payload, id: res.statusCode === 201 ? (res.json().employee.id as string) : "" };
}

describe("Xodim qo'shish", () => {
  it("egasi o'z kompaniyasiga xodim qo'shadi — standart rol Kassir", async () => {
    const { res, payload, id } = await addEmployee(companyA.ownerCookie);
    expect(res.statusCode).toBe(201);
    expect(res.json().employee).toMatchObject({ phone: payload.phone, companyRole: "Kassir" });

    const [membership] = await db.select().from(companyMembers).where(eq(companyMembers.userId, id));
    const [kassir] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.companyId, companyA.companyId), eq(roles.name, "Kassir")));
    expect(membership).toMatchObject({ companyId: companyA.companyId, roleId: kassir!.id });

    const { cookie } = await login(app, payload.phone, payload.password);
    expect((await me(app, cookie!)).json().user).toMatchObject({ companyName: "A kompaniya", companyRole: "Kassir" });

    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "EMPLOYEE_CREATED"));
    expect(audit).toMatchObject({ userId: companyA.owner.id, companyId: companyA.companyId, resourceId: id });
  });

  it("egalik rolini bermaydi, noma'lum rolga 400, band raqamga 409", async () => {
    expect((await addEmployee(companyA.ownerCookie, { role: "Business Owner" })).res.statusCode).toBe(403);
    expect((await addEmployee(companyA.ownerCookie, { role: "Superadmin" })).res.statusCode).toBe(403);
    expect((await addEmployee(companyA.ownerCookie, { role: "Mavjud emas" })).res.statusCode).toBe(400);
    expect((await addEmployee(companyA.ownerCookie, { phone: companyB.owner.phone })).res.statusCode).toBe(409);
  });

  it("xodim boshqa xodim qo'sha olmaydi, platforma admini ham kompaniyasiz 403", async () => {
    const { payload } = await addEmployee(companyA.ownerCookie);
    const { cookie } = await login(app, payload.phone, payload.password);
    expect((await addEmployee(cookie!)).res.statusCode).toBe(403);
    expect((await call(admin.cookie, "GET", "/employees")).statusCode).toBe(403);
  });
});

describe("Xodim parolini tiklash", () => {
  it("parolni tiklaydi va xodimning barcha sessiyalarini bekor qiladi", async () => {
    const { payload, id } = await addEmployee(companyA.ownerCookie);
    const { cookie } = await login(app, payload.phone, payload.password);

    const res = await call(companyA.ownerCookie, "POST", `/employees/${id}/password`, { newPassword: "yangi-xodim-456" });
    expect(res.statusCode).toBe(200);

    expect((await me(app, cookie!)).statusCode).toBe(401);
    expect((await login(app, payload.phone, payload.password)).res.statusCode).toBe(401);
    expect((await login(app, payload.phone, "yangi-xodim-456")).res.statusCode).toBe(200);

    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "USER_PASSWORD_RESET"));
    expect(audit).toMatchObject({ userId: companyA.owner.id, resourceId: id, companyId: companyA.companyId });
    expect(audit!.details).toMatchObject({ by: "company_owner" });
  });

  it("boshqa kompaniya xodimiga tegolmaydi — 404", async () => {
    const { payload, id } = await addEmployee(companyB.ownerCookie);
    const res = await call(companyA.ownerCookie, "POST", `/employees/${id}/password`, { newPassword: "egallash-parol-1" });
    expect(res.statusCode).toBe(404);
    expect((await login(app, payload.phone, payload.password)).res.statusCode).toBe(200);
  });

  it("o'zini va boshqa kompaniyaga ham a'zo xodimni tiklay olmaydi", async () => {
    expect(
      (await call(companyA.ownerCookie, "POST", `/employees/${companyA.owner.id}/password`, { newPassword: "o'zim-parol-123" })).statusCode,
    ).toBe(403);

    const { id } = await addEmployee(companyA.ownerCookie);
    await db.insert(companyMembers).values({
      companyId: companyB.companyId,
      userId: id,
      companyRole: "Kassir",
      joinedAt: new Date(),
    });
    expect(
      (await call(companyA.ownerCookie, "POST", `/employees/${id}/password`, { newPassword: "yangi-parol-789" })).statusCode,
    ).toBe(403);
  });
});

describe("Xodimlar ro'yxati", () => {
  it("faqat o'z kompaniyasi a'zolarini ko'rsatadi", async () => {
    const a = await addEmployee(companyA.ownerCookie);
    const b = await addEmployee(companyB.ownerCookie);

    const res = await call(companyA.ownerCookie, "GET", "/employees");
    expect(res.statusCode).toBe(200);
    const phones = (res.json().employees as { phone: string }[]).map((e) => e.phone);
    expect(phones.sort()).toEqual([companyA.owner.phone, a.payload.phone].sort());
    expect(phones).not.toContain(b.payload.phone);
  });
});
