import { and, eq, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ROLES } from "@bum/shared";
import { closeDb, db } from "../src/db/client.js";
import { auditLogs, roles, users } from "../src/db/schema/platform.js";
import { withTransaction } from "../src/db/transaction.js";
import { seedBootstrapAdmin, seedGlobalRoles } from "../src/modules/platform/bootstrap.service.js";
import { buildServer } from "../src/server.js";
import { createUser, login, me, resetDatabase, signedIn } from "./helpers.js";

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

const meta = { ipAddress: "test", userAgent: null };
const ROOT = { phone: "+998901000001", password: "root-parol-123", name: "Ildiz admin" };

const seed = (input: Partial<typeof ROOT> = {}) =>
  withTransaction((tx) => seedBootstrapAdmin(tx, { ...ROOT, ...input }, meta));

const seedAudits = () =>
  db.select().from(auditLogs).where(eq(auditLogs.action, "BOOTSTRAP_ADMIN_SEEDED"));

describe("db:seed — bootstrap admin", () => {
  it("yaratadi: platforma admini, argon2id xesh, global rollar, audit", async () => {
    const result = await seed();
    expect(result).toMatchObject({ action: "created", changes: [], rolesSeeded: DEFAULT_ROLES.length });
    expect(result.user).toMatchObject({
      phone: ROOT.phone,
      name: ROOT.name,
      isPlatformAdmin: true,
      isBootstrapAdmin: true,
      isActive: true,
    });
    expect(result.user.passwordHash).toMatch(/^\$argon2id\$/);

    // Parol ochiq holda hech qayerda saqlanmaydi
    const rows = await db.select().from(users);
    const audits = await seedAudits();
    expect(JSON.stringify(rows)).not.toContain(ROOT.password);
    expect(JSON.stringify(audits)).not.toContain(ROOT.password);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.details).toEqual({ action: "created", changes: [] });

    expect((await login(app, "90 100 00 01", ROOT.password)).res.statusCode).toBe(200);
  });

  it("takroriy seed hech narsani o'zgartirmaydi va audit yozmaydi", async () => {
    await seed();
    const again = await seed();
    expect(again).toMatchObject({ action: "unchanged", changes: [], rolesSeeded: 0 });
    expect(await db.select().from(users)).toHaveLength(1);
    expect(await seedAudits()).toHaveLength(1);
  });

  it(".env dagi parol o'zgarsa — xesh almashadi va barcha sessiyalar bekor qilinadi", async () => {
    await seed();
    const { cookie } = await login(app, ROOT.phone, ROOT.password);
    expect((await me(app, cookie!)).statusCode).toBe(200);

    const rotated = await seed({ password: "yangi-root-parol-456" });
    expect(rotated).toMatchObject({ action: "updated", changes: ["password"] });

    expect((await me(app, cookie!)).statusCode).toBe(401);
    expect((await login(app, ROOT.phone, ROOT.password)).res.statusCode).toBe(401);
    expect((await login(app, ROOT.phone, "yangi-root-parol-456")).res.statusCode).toBe(200);
  });

  it(".env dagi telefon o'zgarsa — o'sha hisobning raqami yangilanadi", async () => {
    const { user } = await seed();
    const moved = await seed({ phone: "+998901000002" });
    expect(moved).toMatchObject({ action: "updated", changes: ["phone"] });
    expect(moved.user.id).toBe(user.id);
    expect(await db.select().from(users)).toHaveLength(1);
  });

  it("raqam mavjud hisobga tegishli bo'lsa — uni bootstrap admin qiladi, parol .env dan", async () => {
    const existing = await createUser({ phone: ROOT.phone, password: "eski-parol-789" });
    const promoted = await seed();

    expect(promoted.action).toBe("promoted");
    expect(promoted.user).toMatchObject({ id: existing.user.id, isBootstrapAdmin: true, isPlatformAdmin: true });
    expect((await login(app, ROOT.phone, "eski-parol-789")).res.statusCode).toBe(401);
    expect((await login(app, ROOT.phone, ROOT.password)).res.statusCode).toBe(200);
  });

  it("bootstrap admin bor, .env raqami esa boshqa foydalanuvchiniki — CONFLICT", async () => {
    await seed();
    const other = await createUser();
    await expect(seed({ phone: other.phone })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("qisqa parol va noto'g'ri raqamni rad etadi", async () => {
    await expect(seed({ password: "1234567" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(seed({ phone: "abc" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await db.select().from(users)).toHaveLength(0);
  });
});

describe("Bootstrap admin — baza darajasidagi himoya", () => {
  it("o'chirib, adminlikni olib, bloklab yoki maqomini olib bo'lmaydi", async () => {
    const { user } = await seed();
    const byId = eq(users.id, user.id);

    await expect(db.delete(users).where(byId)).rejects.toThrow();
    await expect(db.update(users).set({ isPlatformAdmin: false }).where(byId)).rejects.toThrow();
    await expect(db.update(users).set({ isActive: false }).where(byId)).rejects.toThrow();
    await expect(db.update(users).set({ isBootstrapAdmin: false }).where(byId)).rejects.toThrow();

    const [row] = await db.select().from(users).where(byId);
    expect(row).toMatchObject({ isBootstrapAdmin: true, isPlatformAdmin: true, isActive: true });
  });

  it("ikkinchi bootstrap admin bo'lmaydi", async () => {
    await seed();
    await expect(
      db.insert(users).values({ phone: "+998901000009", isPlatformAdmin: true, isBootstrapAdmin: true }),
    ).rejects.toThrow();
  });
});

describe("Bootstrap admin — API darajasidagi himoya", () => {
  it("o'z parolini API orqali o'zgartira olmaydi", async () => {
    await seed();
    const { cookie } = await login(app, ROOT.phone, ROOT.password);
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/password",
      headers: { cookie: cookie! },
      payload: { currentPassword: ROOT.password, newPassword: "boshqa-parol-000" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("boshqa platforma admini uning parolini, raqamini va holatini o'zgartira olmaydi", async () => {
    const { user: root } = await seed();
    const admin = await signedIn(app, { isPlatformAdmin: true });
    const headers = { cookie: admin.cookie };

    const attempts = [
      app.inject({ method: "POST", url: `/api/platform/users/${root.id}/password`, headers, payload: { newPassword: "egallash-parol-1" } }),
      app.inject({ method: "PATCH", url: `/api/platform/users/${root.id}`, headers, payload: { phone: "+998909999999" } }),
      app.inject({ method: "POST", url: `/api/platform/users/${root.id}/status`, headers, payload: { isActive: false } }),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.statusCode).toBe(403);
      expect(res.json().message).toBe("Bootstrap admin faqat .env orqali boshqariladi");
    }
    expect((await login(app, ROOT.phone, ROOT.password)).res.statusCode).toBe(200);
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
