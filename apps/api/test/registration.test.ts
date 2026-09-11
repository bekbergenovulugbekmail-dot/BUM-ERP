import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ROLES } from "@bum/shared";
import { closeDb, db } from "../src/db/client.js";
import { auditLogs, branches, companies, roles, users } from "../src/db/schema/platform.js";
import { buildServer } from "../src/server.js";
import { createUser, me, resetDatabase, signedIn, uniquePhone } from "./helpers.js";

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

const settings = (patch: object) =>
  app.inject({ method: "PUT", url: "/api/platform/settings", headers: { cookie: admin.cookie }, payload: patch });

const register = (payload: object) => app.inject({ method: "POST", url: "/api/registration", payload });

const valid = () => ({
  companyName: "Yangi Do'kon",
  ownerName: "Ali Valiyev",
  phone: uniquePhone("97"),
  password: "yangi-parol-123",
});

describe("Ro'yxatdan o'tish", () => {
  it("standart holatda yopiq — hech narsa yaratilmaydi", async () => {
    expect((await app.inject({ method: "GET", url: "/api/registration" })).json()).toEqual({ enabled: false });
    const res = await register(valid());
    expect(res.statusCode).toBe(403);
    expect(await db.select().from(companies)).toHaveLength(0);
  });

  it("admin yoqsa — sinov muddatli kompaniya ochiladi va ega tizimga kiradi", async () => {
    await settings({ registrationEnabled: true, defaultTrialDays: 10 });
    expect((await app.inject({ method: "GET", url: "/api/registration" })).json()).toEqual({ enabled: true });

    const input = valid();
    const res = await register(input);
    expect(res.statusCode).toBe(201);
    expect(res.json().company).toMatchObject({ name: "Yangi Do'kon", status: "trial" });

    const cookie = res.cookies.find((c) => c.name === "bum_session");
    const profile = (await me(app, `bum_session=${cookie!.value}`)).json().user;
    expect(profile).toMatchObject({ phone: input.phone, name: "Ali Valiyev", companyRole: "Business Owner" });

    const [company] = await db.select().from(companies).where(eq(companies.id, res.json().company.id));
    const expected = Date.now() + 10 * 24 * 60 * 60 * 1000;
    expect(Math.abs(company!.trialEndsAt!.getTime() - expected)).toBeLessThan(60_000);
    expect(await db.select().from(branches).where(eq(branches.companyId, company!.id))).toHaveLength(1);
    expect(await db.select().from(roles).where(eq(roles.companyId, company!.id))).toHaveLength(DEFAULT_ROLES.length);

    const [owner] = await db.select().from(users).where(eq(users.phone, input.phone));
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "COMPANY_REGISTERED"));
    expect(audit).toMatchObject({ userId: owner!.id, companyId: company!.id });
  });

  it("sinov muddati 0 bo'lsa kompaniya darhol active", async () => {
    await settings({ registrationEnabled: true, defaultTrialDays: 0 });
    const res = await register(valid());
    expect(res.json().company).toMatchObject({ status: "active", trialEndsAt: null });
  });

  it("band raqam 409, qisqa parol 400, admin qayta yopsa 403", async () => {
    await settings({ registrationEnabled: true });
    const taken = await createUser();
    expect((await register({ ...valid(), phone: taken.phone })).statusCode).toBe(409);
    expect((await register({ ...valid(), password: "1234567" })).statusCode).toBe(400);

    await settings({ registrationEnabled: false });
    expect((await register(valid())).statusCode).toBe(403);
  });

  it("bitta IP dan soatiga 5 ta urinishdan keyin 429", async () => {
    await settings({ registrationEnabled: true });
    const taken = await createUser();
    for (let i = 0; i < 5; i++) {
      expect((await register({ ...valid(), phone: taken.phone })).statusCode).toBe(409);
    }
    expect((await register(valid())).statusCode).toBe(429);
  });

  it("sinov muddati tugagan kompaniyada yozish yopiladi, o'qish qoladi", async () => {
    await settings({ registrationEnabled: true, defaultTrialDays: 14 });
    const res = await register(valid());
    const cookie = `bum_session=${res.cookies.find((c) => c.name === "bum_session")!.value}`;
    await db
      .update(companies)
      .set({ trialEndsAt: new Date(Date.now() - 1000) })
      .where(eq(companies.id, res.json().company.id));

    const patch = await app.inject({ method: "PATCH", url: "/api/company", headers: { cookie }, payload: { city: "Buxoro" } });
    expect(patch.statusCode).toBe(403);
    expect(patch.json().message).toContain("Sinov muddati");

    const employee = await app.inject({
      method: "POST",
      url: "/api/company/employees",
      headers: { cookie },
      payload: { phone: uniquePhone("97"), password: "xodim-parol-123" },
    });
    expect(employee.statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/company", headers: { cookie } })).statusCode).toBe(200);
  });
});
