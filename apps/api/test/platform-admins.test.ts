import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { auditLogs, users } from "../src/db/schema/platform.js";
import { withTransaction } from "../src/db/transaction.js";
import { seedBootstrapAdmin } from "../src/modules/platform/bootstrap.service.js";
import { buildServer } from "../src/server.js";
import { createUser, login, me, resetDatabase, signedIn } from "./helpers.js";

let app: FastifyInstance;
let rootCookie: string;
let rootId: string;

const ROOT = { phone: "+998901000001", password: "root-parol-123", name: "Root" };

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
  const seeded = await withTransaction((tx) =>
    seedBootstrapAdmin(tx, ROOT, { ipAddress: "test", userAgent: null }),
  );
  rootId = seeded.user.id;
  rootCookie = (await login(app, ROOT.phone, ROOT.password)).cookie!;
});

const grant = (cookie: string, userId: string, isPlatformAdmin: boolean) =>
  app.inject({
    method: "POST",
    url: `/api/platform/users/${userId}/platform-admin`,
    headers: { cookie },
    payload: { isPlatformAdmin },
  });

const stats = (cookie: string) => app.inject({ method: "GET", url: "/api/platform/stats", headers: { cookie } });

describe("Platforma adminini tayinlash", () => {
  it("faqat bootstrap admin tayinlaydi; oddiy platforma admini ham 403", async () => {
    const otherAdmin = await signedIn(app, { isPlatformAdmin: true });
    const target = await createUser();

    expect((await grant(otherAdmin.cookie, target.user.id, true)).statusCode).toBe(403);
    expect((await grant(rootCookie, target.user.id, true)).statusCode).toBe(200);

    const { cookie } = await login(app, target.phone, target.password);
    expect((await me(app, cookie!)).json().user.isPlatformAdmin).toBe(true);
    expect((await stats(cookie!)).statusCode).toBe(200);

    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "PLATFORM_ADMIN_GRANTED"));
    expect(audit).toMatchObject({ userId: rootId, resourceId: target.user.id });
  });

  it("olib tashlash mavjud sessiyada darhol amal qiladi", async () => {
    const target = await createUser();
    await grant(rootCookie, target.user.id, true);
    const { cookie } = await login(app, target.phone, target.password);
    expect((await stats(cookie!)).statusCode).toBe(200);

    expect((await grant(rootCookie, target.user.id, false)).statusCode).toBe(200);
    expect((await stats(cookie!)).statusCode).toBe(403);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "PLATFORM_ADMIN_REVOKED"))).toHaveLength(1);
  });

  it("bootstrap adminning o'ziga tegmaydi; faol bo'lmaganni admin qilmaydi", async () => {
    expect((await grant(rootCookie, rootId, false)).statusCode).toBe(403);
    const inactive = await createUser({ isActive: false });
    expect((await grant(rootCookie, inactive.user.id, true)).statusCode).toBe(400);

    const [row] = await db.select().from(users).where(eq(users.id, inactive.user.id));
    expect(row!.isPlatformAdmin).toBe(false);
  });

  it("oddiy foydalanuvchi bu endpointga kira olmaydi", async () => {
    const regular = await signedIn(app);
    expect((await grant(regular.cookie, regular.user.id, true)).statusCode).toBe(403);
  });
});
