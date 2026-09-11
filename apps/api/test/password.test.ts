import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { auditLogs } from "../src/db/schema/platform.js";
import { buildServer } from "../src/server.js";
import { createUser, login, me, resetDatabase } from "./helpers.js";

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

const changePassword = (cookie: string | undefined, currentPassword: string, newPassword: string) =>
  app.inject({
    method: "POST",
    url: "/api/auth/password",
    ...(cookie ? { headers: { cookie } } : {}),
    payload: { currentPassword, newPassword },
  });

describe("POST /api/auth/password", () => {
  it("kirmaganga 401", async () => {
    expect((await changePassword(undefined, "a", "b")).statusCode).toBe(401);
  });

  it("parolni almashtiradi: barcha sessiyalar bekor, joriy qurilmaga yangi cookie", async () => {
    const { user, phone, password } = await createUser();
    const laptop = await login(app, phone, password);
    const telefon = await login(app, phone, password);

    const res = await changePassword(laptop.cookie, password, "yangi-parol-456");
    expect(res.statusCode).toBe(200);
    const fresh = res.cookies.find((c) => c.name === "bum_session")?.value;
    expect(fresh).toBeTruthy();

    expect((await me(app, laptop.cookie!)).statusCode).toBe(401);
    expect((await me(app, telefon.cookie!)).statusCode).toBe(401);
    expect((await me(app, `bum_session=${fresh}`)).statusCode).toBe(200);

    expect((await login(app, phone, password)).res.statusCode).toBe(401);
    expect((await login(app, phone, "yangi-parol-456")).res.statusCode).toBe(200);

    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "PASSWORD_CHANGED"));
    expect(audit).toMatchObject({ userId: user.id, resourceId: user.id });
    expect(JSON.stringify(audit)).not.toContain("yangi-parol-456");
  });

  it("noto'g'ri joriy parol — 403 va sessiya saqlanadi; 5 xatodan keyin 429", async () => {
    const { phone, password } = await createUser();
    const { cookie } = await login(app, phone, password);

    for (let i = 0; i < 5; i++) {
      expect((await changePassword(cookie, "xato-parol", "yangi-parol-456")).statusCode).toBe(403);
    }
    expect((await me(app, cookie!)).statusCode).toBe(200);
    expect((await changePassword(cookie, password, "yangi-parol-456")).statusCode).toBe(429);
  });

  it("qisqa yoki eskisi bilan bir xil yangi parolni rad etadi", async () => {
    const { phone, password } = await createUser();
    const { cookie } = await login(app, phone, password);
    expect((await changePassword(cookie, password, "1234567")).statusCode).toBe(400);
    expect((await changePassword(cookie, password, password)).statusCode).toBe(400);
    expect((await me(app, cookie!)).statusCode).toBe(200);
  });
});
