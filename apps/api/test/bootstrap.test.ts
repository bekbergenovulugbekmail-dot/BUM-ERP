import { and, eq, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ROLES } from "@bum/shared";
import { closeDb, db } from "../src/db/client.js";
import { auditLogs, roles, users } from "../src/db/schema/platform.js";
import { bootstrapKeyMatches, seedGlobalRoles } from "../src/modules/platform/bootstrap.service.js";
import { buildServer } from "../src/server.js";
import { createUser, resetDatabase } from "./helpers.js";

/** vitest.config.ts dagi PLATFORM_BOOTSTRAP_KEY. */
const TEST_BOOTSTRAP_KEY = "test-bootstrap-key";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

beforeEach(resetDatabase);

const valid = {
  secretKey: TEST_BOOTSTRAP_KEY,
  phone: "+998901000001",
  password: "admin-parol-123",
  name: "Birinchi admin",
};

const bootstrap = (payload: object) =>
  app.inject({ method: "POST", url: "/api/platform/bootstrap", payload });

const status = async () =>
  (await app.inject({ method: "GET", url: "/api/platform/bootstrap" })).json();

const countUsers = async () => (await db.select({ id: users.id }).from(users)).length;

describe("GET /api/platform/bootstrap", () => {
  it("admin yo'qligida kerakligini, keyin kerak emasligini ko'rsatadi", async () => {
    expect(await status()).toEqual({ enabled: true, needed: true });
    expect((await bootstrap(valid)).statusCode).toBe(200);
    expect(await status()).toEqual({ enabled: true, needed: false });
  });
});

describe("POST /api/platform/bootstrap", () => {
  it("adminni yaratadi, rollarni qo'shadi, audit yozadi va tizimga kiritadi", async () => {
    const res = await bootstrap(valid);
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ phone: valid.phone, name: valid.name, isPlatformAdmin: true });

    const cookie = res.cookies.find((c) => c.name === "bum_session");
    expect(cookie?.value).toBeTruthy();
    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: `bum_session=${cookie!.value}` },
    });
    expect(me.json().user.isPlatformAdmin).toBe(true);

    const [admin] = await db.select().from(users).where(eq(users.phone, valid.phone));
    expect(admin!.passwordHash).toMatch(/^\$argon2id\$/);

    const globalRoles = await db.select().from(roles).where(isNull(roles.companyId));
    expect(globalRoles.map((r) => r.name).sort()).toEqual(DEFAULT_ROLES.map((r) => r.name).sort());

    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "PLATFORM_ADMIN_BOOTSTRAP"));
    expect(audit).toMatchObject({ userId: admin!.id, severity: "warning" });
    expect(audit!.details).toMatchObject({ via: "http", created: true, rolesSeeded: DEFAULT_ROLES.length });
  });

  it("admin mavjud bo'lsa ikkinchi marta ishlamaydi (409)", async () => {
    expect((await bootstrap(valid)).statusCode).toBe(200);
    const again = await bootstrap({ ...valid, phone: "+998901000002" });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("CONFLICT");
    expect(await countUsers()).toBe(1);
  });

  it("noto'g'ri kalit — 403, hech narsa yaratilmaydi", async () => {
    const res = await bootstrap({ ...valid, secretKey: "boshqa-kalit" });
    expect(res.statusCode).toBe(403);
    expect(res.cookies.find((c) => c.name === "bum_session")).toBeUndefined();
    expect(await countUsers()).toBe(0);
  });

  it("5 ta noto'g'ri kalitdan keyin to'g'ri kalit ham bloklanadi", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await bootstrap({ ...valid, secretKey: `xato-${i}` })).statusCode).toBe(403);
    }
    const res = await bootstrap(valid);
    expect(res.statusCode).toBe(429);
    expect(await countUsers()).toBe(0);
  });

  it("qisqa parol va noto'g'ri raqamni 400 bilan rad etadi", async () => {
    expect((await bootstrap({ ...valid, password: "1234567" })).statusCode).toBe(400);
    expect((await bootstrap({ ...valid, phone: "abc" })).statusCode).toBe(400);
    expect(await countUsers()).toBe(0);
  });

  it("band raqam: egasining paroli bo'lmasa rad etadi, bo'lsa admin qiladi", async () => {
    const { user, phone, password } = await createUser({ name: "Mavjud" });

    const wrong = await bootstrap({ ...valid, phone, password: "boshqa-parol-99" });
    expect(wrong.statusCode).toBe(401);
    const [stillRegular] = await db.select().from(users).where(eq(users.id, user.id));
    expect(stillRegular!.isPlatformAdmin).toBe(false);

    const ok = await bootstrap({ ...valid, phone, password });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user).toMatchObject({ id: user.id, name: "Mavjud", isPlatformAdmin: true });
    expect(await countUsers()).toBe(1);
  });
});

describe("Global rollar", () => {
  it("takroriy seed dublikat yaratmaydi", async () => {
    expect(await seedGlobalRoles(db)).toBe(DEFAULT_ROLES.length);
    expect(await seedGlobalRoles(db)).toBe(0);
    const rows = await db.select().from(roles).where(isNull(roles.companyId));
    expect(rows).toHaveLength(DEFAULT_ROLES.length);
  });

  it("baza darajasida bir xil nomli ikkinchi global rolni rad etadi", async () => {
    await db.insert(roles).values({ name: "Sinov roli" });
    await expect(db.insert(roles).values({ name: "Sinov roli" })).rejects.toThrow();
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(roles)
      .where(and(isNull(roles.companyId), eq(roles.name, "Sinov roli")));
    expect(rows[0]!.n).toBe(1);
  });
});

describe("bootstrapKeyMatches", () => {
  it("kalit sozlanmagan bo'lsa hech qachon mos kelmaydi", () => {
    expect(bootstrapKeyMatches("", undefined)).toBe(false);
    expect(bootstrapKeyMatches("har-qanday", undefined)).toBe(false);
    expect(bootstrapKeyMatches("a", "b")).toBe(false);
    expect(bootstrapKeyMatches("bir-xil", "bir-xil")).toBe(true);
  });
});
