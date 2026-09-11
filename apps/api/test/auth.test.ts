import { createHash, randomBytes, scryptSync } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { auditLogs, companies, companyMembers, sessions, users } from "../src/db/schema/platform.js";
import { buildServer } from "../src/server.js";
import { createUser, login, resetDatabase, signedIn } from "./helpers.js";

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

/** Convex Auth (lucia Scrypt) formatidagi xesh — ko'chirilgan akkaunt uchun. */
function luciaScryptHash(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const key = scryptSync(password.normalize("NFKC"), salt, 64, {
    N: 16384,
    r: 16,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `${salt}:${key.toString("hex")}`;
}

const me = (cookie?: string) =>
  app.inject({ method: "GET", url: "/api/auth/me", ...(cookie ? { headers: { cookie } } : {}) });

describe("POST /api/auth/login", () => {
  it("to'g'ri parol bilan httpOnly cookie va foydalanuvchini qaytaradi", async () => {
    const { user, phone, password } = await createUser();
    const { res, token } = await login(app, phone, password);

    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ id: user.id, phone, hasCompany: false });
    expect(res.body).not.toContain("argon2");

    const cookie = res.cookies.find((c) => c.name === "bum_session");
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });

    // Bazada token xom emas, faqat SHA-256 xeshi
    const [session] = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(session!.tokenHash).toBe(createHash("sha256").update(token!).digest("hex"));
  });

  it("telefon raqamni normallashtiradi", async () => {
    const { password } = await createUser({ phone: "+998901112233" });
    const { res } = await login(app, "90 111 22 33", password);
    expect(res.statusCode).toBe(200);
  });

  it("noto'g'ri parol va noma'lum raqamga bir xil javob beradi", async () => {
    const { phone } = await createUser();
    const wrong = await login(app, phone, "noto'g'ri-parol");
    const unknown = await login(app, "+998909999999", "noto'g'ri-parol");

    for (const { res, token } of [wrong, unknown]) {
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({
        code: "UNAUTHENTICATED",
        message: "Telefon raqam yoki parol noto'g'ri",
      });
      expect(token).toBeUndefined();
    }
  });

  it("raqamsiz qiymatni 400 bilan rad etadi", async () => {
    const { res } = await login(app, "abc", "parol");
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("BAD_REQUEST");
  });

  it("faol bo'lmagan hisobni 403 bilan rad etadi", async () => {
    const { phone, password } = await createUser({ isActive: false });
    const { res, token } = await login(app, phone, password);
    expect(res.statusCode).toBe(403);
    expect(token).toBeUndefined();
  });

  it("5 ta xatodan keyin to'g'ri parolni ham bloklaydi", async () => {
    const { phone, password } = await createUser();
    for (let i = 0; i < 5; i++) {
      expect((await login(app, phone, "xato")).res.statusCode).toBe(401);
    }
    const { res } = await login(app, phone, password);
    expect(res.statusCode).toBe(429);
    expect(res.json().code).toBe("RATE_LIMITED");
  });

  it("muvaffaqiyatli va muvaffaqiyatsiz kirishni audit jurnaliga yozadi", async () => {
    const { user, phone, password } = await createUser();
    await login(app, phone, "xato");
    await login(app, phone, password);

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.userId, user.id));
    expect(rows.map((r) => r.action).sort()).toEqual(["login_failed", "login_success"]);
  });

  it("Convex'dan ko'chirilgan scrypt xeshi bilan kiradi va argon2id ga o'tkazadi", async () => {
    const password = "eski-convex-parol";
    const { user, phone } = await createUser({
      passwordHash: luciaScryptHash(password),
      passwordAlgo: "scrypt",
    });

    expect((await login(app, phone, "boshqa-parol")).res.statusCode).toBe(401);
    expect((await login(app, phone, password)).res.statusCode).toBe(200);

    const [updated] = await db.select().from(users).where(eq(users.id, user.id));
    expect(updated!.passwordAlgo).toBe("argon2id");
    expect(updated!.passwordHash).toMatch(/^\$argon2id\$/);

    // Yangi xesh bilan ham kiradi
    expect((await login(app, phone, password)).res.statusCode).toBe(200);
  });
});

describe("GET /api/auth/me", () => {
  it("cookie'siz 401", async () => {
    const res = await me();
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("UNAUTHENTICATED");
  });

  it("soxta token bilan 401 va cookie tozalanadi", async () => {
    const res = await me("bum_session=soxta-token");
    expect(res.statusCode).toBe(401);
    expect(res.cookies.find((c) => c.name === "bum_session")?.value).toBe("");
  });

  it("aktiv kompaniya va rolni qaytaradi", async () => {
    const { user, cookie } = await signedIn(app);
    const [company] = await db
      .insert(companies)
      .values({ name: "Bonnu Market", slug: "bonnu", currency: "UZS" })
      .returning();
    await db.insert(companyMembers).values({
      companyId: company!.id,
      userId: user.id,
      companyRole: "Business Owner",
      joinedAt: new Date(),
    });
    await db.update(users).set({ activeCompanyId: company!.id }).where(eq(users.id, user.id));

    const res = await me(cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({
      id: user.id,
      hasCompany: true,
      companyName: "Bonnu Market",
      companySlug: "bonnu",
      companyCurrency: "UZS",
      companyRole: "Business Owner",
    });
  });

  it("faolsizlik muddati o'tgan sessiyani rad etadi", async () => {
    const { user, cookie } = await signedIn(app);
    await db
      .update(sessions)
      .set({ idleExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.userId, user.id));
    expect((await me(cookie)).statusCode).toBe(401);
  });

  it("mutlaq muddati o'tgan sessiyani rad etadi", async () => {
    const { user, cookie } = await signedIn(app);
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.userId, user.id));
    expect((await me(cookie)).statusCode).toBe(401);
  });

  it("hisob o'chirilsa mavjud sessiya ishlamaydi", async () => {
    const { user, cookie } = await signedIn(app);
    expect((await me(cookie)).statusCode).toBe(200);
    await db.update(users).set({ isActive: false }).where(eq(users.id, user.id));
    expect((await me(cookie)).statusCode).toBe(401);
  });

  it("faol so'rovda faolsizlik muddatini uzaytiradi", async () => {
    const { user, cookie } = await signedIn(app);
    const soon = new Date(Date.now() + 60_000);
    await db
      .update(sessions)
      .set({ idleExpiresAt: soon, lastUsedAt: new Date(Date.now() - 120_000) })
      .where(eq(sessions.userId, user.id));

    expect((await me(cookie)).statusCode).toBe(200);
    const [session] = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(session!.idleExpiresAt.getTime()).toBeGreaterThan(soon.getTime());
  });
});

describe("POST /api/auth/logout", () => {
  it("sessiyani bekor qiladi va cookie'ni tozalaydi", async () => {
    const { user, cookie } = await signedIn(app);

    const res = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.cookies.find((c) => c.name === "bum_session")?.value).toBe("");

    expect((await me(cookie)).statusCode).toBe(401);
    const [session] = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, user.id)));
    expect(session!.revokedAt).not.toBeNull();

    const logouts = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.userId, user.id), eq(auditLogs.action, "logout")));
    expect(logouts).toHaveLength(1);
  });

  it("cookie'siz ham xatosiz ishlaydi", async () => {
    const res = await app.inject({ method: "POST", url: "/api/auth/logout" });
    expect(res.statusCode).toBe(200);
  });
});
