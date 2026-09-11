import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { users } from "../src/db/schema/platform.js";
import { buildServer } from "../src/server.js";
import { resetDatabase, signedIn } from "./helpers.js";

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

const send = (method: "POST" | "PUT", url: string, cookie: string, payload: object) =>
  app.inject({ method, url: `/api/auth${url}`, headers: { cookie }, payload });

const security = async (cookie: string) =>
  (await app.inject({ method: "GET", url: "/api/auth/security", headers: { cookie } })).json();

/** PIN o'rnatilgan, kirgan foydalanuvchi. */
async function withPin(pin = "1234") {
  const ctx = await signedIn(app);
  expect((await send("POST", "/pin", ctx.cookie, { pin })).statusCode).toBe(200);
  return ctx;
}

const verify = (cookie: string, userId: string, pin: string, expectedCompanyId?: string) =>
  send("POST", "/pin/verify", cookie, { pin, expectedUserId: userId, expectedCompanyId });

describe("PIN o'rnatish", () => {
  it("kirmagan foydalanuvchiga 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/auth/security" });
    expect(res.statusCode).toBe(401);
  });

  it("o'rnatadi, xavfsizlik sozlamalarida ko'rinadi, xom saqlanmaydi", async () => {
    const { user, cookie } = await signedIn(app);
    expect(await security(cookie)).toMatchObject({ hasPIN: false, autoLockTimeoutSeconds: 30 });

    expect((await send("POST", "/pin", cookie, { pin: "4821" })).statusCode).toBe(200);
    expect(await security(cookie)).toMatchObject({ hasPIN: true, isPinLocked: false });

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row!.pinHash).toMatch(/^\$argon2id\$/);
  });

  it("mavjud PIN ustiga yozmaydi (409)", async () => {
    const { cookie } = await withPin();
    const res = await send("POST", "/pin", cookie, { pin: "9999" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("CONFLICT");
  });

  it("noto'g'ri formatni 400 bilan rad etadi", async () => {
    const { cookie } = await signedIn(app);
    for (const pin of ["12", "12a4", "123456789"]) {
      expect((await send("POST", "/pin", cookie, { pin })).statusCode).toBe(400);
    }
  });
});

describe("PIN bilan qulfni ochish", () => {
  it("to'g'ri PIN bilan muvaffaqiyat", async () => {
    const { user, cookie } = await withPin("1234");
    const res = await verify(cookie, user.id, "1234");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
  });

  it("5 ta xatodan keyin 5 daqiqaga bloklaydi, to'g'ri PIN ham o'tmaydi", async () => {
    const { user, cookie } = await withPin("1234");

    const reasons: string[] = [];
    for (let i = 0; i < 5; i++) reasons.push((await verify(cookie, user.id, "0000")).json().reason);
    expect(reasons).toEqual(["WRONG_PIN:4", "WRONG_PIN:3", "WRONG_PIN:2", "WRONG_PIN:1", "PIN_LOCKED:300"]);

    const locked = (await verify(cookie, user.id, "1234")).json();
    expect(locked.success).toBe(false);
    expect(locked.reason).toMatch(/^PIN_LOCKED:\d+$/);
    expect(await security(cookie)).toMatchObject({ isPinLocked: true });
  });

  it("blok muddati o'tgach to'g'ri PIN ishlaydi va hisob tiklanadi", async () => {
    const { user, cookie } = await withPin("1234");
    await db
      .update(users)
      .set({ pinLockedUntil: new Date(Date.now() - 1000), pinFailedAttempts: 0 })
      .where(eq(users.id, user.id));

    expect((await verify(cookie, user.id, "0000")).json().reason).toBe("WRONG_PIN:4");
    expect((await verify(cookie, user.id, "1234")).json()).toEqual({ success: true });

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row).toMatchObject({ pinFailedAttempts: 0, pinLockedUntil: null });
  });

  it("boshqa foydalanuvchi va boshqa kompaniya uchun ochmaydi", async () => {
    const { user, cookie } = await withPin("1234");
    expect((await verify(cookie, randomUUID(), "1234")).json().reason).toBe("SESSION_MISMATCH");
    expect((await verify(cookie, user.id, "1234", randomUUID())).json().reason).toBe("COMPANY_MISMATCH");
  });

  it("PIN o'rnatilmagan bo'lsa PIN_NOT_SET", async () => {
    const { user, cookie } = await signedIn(app);
    expect((await verify(cookie, user.id, "1234")).json().reason).toBe("PIN_NOT_SET");
  });
});

describe("PIN o'zgartirish va o'chirish", () => {
  it("eski PIN to'g'ri bo'lsa o'zgartiradi", async () => {
    const { user, cookie } = await withPin("1234");
    expect((await send("POST", "/pin/change", cookie, { oldPin: "1234", newPin: "5678" })).statusCode).toBe(200);
    expect((await verify(cookie, user.id, "5678")).json()).toEqual({ success: true });
    expect((await verify(cookie, user.id, "1234")).json().success).toBe(false);
  });

  it("noto'g'ri eski PIN — 403 va urinish hisoblanadi", async () => {
    const { user, cookie } = await withPin("1234");
    const res = await send("POST", "/pin/change", cookie, { oldPin: "0000", newPin: "5678" });
    expect(res.statusCode).toBe(403);

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row!.pinFailedAttempts).toBe(1);
  });

  it("o'chirish orqali PIN tanlab bloklashni chetlab o'tib bo'lmaydi", async () => {
    const { cookie } = await withPin("1234");
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      codes.push((await send("POST", "/pin/remove", cookie, { currentPin: "0000" })).statusCode);
    }
    expect(codes).toEqual([403, 403, 403, 403, 429]);

    // Bloklangan paytda to'g'ri PIN bilan ham o'chmaydi
    expect((await send("POST", "/pin/remove", cookie, { currentPin: "1234" })).statusCode).toBe(429);
    expect(await security(cookie)).toMatchObject({ hasPIN: true });
  });

  it("to'g'ri PIN bilan o'chiradi", async () => {
    const { cookie } = await withPin("1234");
    expect((await send("POST", "/pin/remove", cookie, { currentPin: "1234" })).statusCode).toBe(200);
    expect(await security(cookie)).toMatchObject({ hasPIN: false });
  });
});

describe("Auto-lock", () => {
  it("0-3600 oralig'idagi butun sonni saqlaydi, boshqasini rad etadi", async () => {
    const { cookie } = await signedIn(app);
    expect((await send("PUT", "/auto-lock", cookie, { seconds: 120 })).statusCode).toBe(200);
    expect(await security(cookie)).toMatchObject({ autoLockTimeoutSeconds: 120 });

    for (const seconds of [-1, 4000, 1.5]) {
      expect((await send("PUT", "/auto-lock", cookie, { seconds })).statusCode).toBe(400);
    }
  });
});
