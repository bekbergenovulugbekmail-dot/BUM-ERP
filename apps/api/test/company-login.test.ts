/**
 * Biznes manzili bilan kirish: `app.bum-erp.uz/bonnu-market` → faqat Bonnu Market.
 *
 * Login `companySlug` bilan yuborilsa: shu biznes faollashtiriladi; foydalanuvchi bu biznesning
 * faol xodimi bo'lmasa — kirish berilmaydi (sessiya ochilsa ham boshqa biznesga o'tib ketmaydi).
 */
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { auditLogs, sessions, users } from "../src/db/schema/platform.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

let app: FastifyInstance;
let adminCookie: string;
let first: Awaited<ReturnType<typeof createCompany>>;
let second: Awaited<ReturnType<typeof createCompany>>;

const login = (payload: object) => app.inject({ method: "POST", url: "/api/auth/login", payload });

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
  adminCookie = (await signedIn(app, { isPlatformAdmin: true })).cookie;
  first = await createCompany(app, adminCookie, { name: "Bonnu Market" });
  second = await createCompany(app, adminCookie, { name: "Anor Market" });
});

describe("Biznes manzili bilan kirish", () => {
  it("o'z biznesi manzilidan kirilsa shu biznes faollashadi", async () => {
    const res = await login({ phone: first.owner.phone, password: first.owner.password, companySlug: first.slug });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().user).toMatchObject({ companySlug: first.slug, companyName: "Bonnu Market" });
  });

  it("begona biznes manzilidan kirib bo'lmaydi", async () => {
    const res = await login({ phone: first.owner.phone, password: first.owner.password, companySlug: second.slug });
    expect(res.statusCode, "boshqa biznesning xodimi emas").toBe(403);
    expect(res.json().message).toContain("Anor Market");
  });

  it("begona manzildagi urinish sessiya ham, login_success izi ham qoldirmaydi", async () => {
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.phone, first.owner.phone));
    const before = await db.$count(sessions, eq(sessions.userId, user!.id));

    const res = await login({ phone: first.owner.phone, password: first.owner.password, companySlug: second.slug });
    expect(res.statusCode).toBe(403);
    expect(res.headers["set-cookie"], "cookie berilmaydi").toBeUndefined();

    expect(await db.$count(sessions, eq(sessions.userId, user!.id)), "yangi sessiya ochilmaydi").toBe(before);

    const actions = (
      await db.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.userId, user!.id))
    ).map((row) => row.action);
    expect(actions, "rad etilgan urinish login_denied bo'lib yoziladi").toContain("login_denied");
    expect(actions.filter((action) => action === "login_success"), "faqat haqiqiy kirishlar").toHaveLength(1);

    // Faol biznes ham o'zgarmaydi
    const [after] = await db.select({ activeCompanyId: users.activeCompanyId }).from(users).where(eq(users.id, user!.id));
    expect(after!.activeCompanyId).toBe(first.companyId);
  });

  it("noto'g'ri manzil — tushunarli xato", async () => {
    const res = await login({ phone: first.owner.phone, password: first.owner.password, companySlug: "yoq-biznes" });
    expect(res.statusCode).toBe(404);
  });

  it("ikkita biznesda ishlaydigan xodim manzil bo'yicha kerakligiga kiradi", async () => {
    // Xodim ikkala biznesda ham bor (bir xil telefon bilan — platforma admini qo'shadi)
    const worker = await addEmployee(app, first, "Kassir");
    const invite = await app.inject({
      method: "POST",
      url: "/api/company/employees",
      headers: { cookie: second.ownerCookie },
      payload: { name: "Kassir xodim", phone: worker.phone, password: "xodim-parol-123", role: "Kassir" },
    });
    // Mavjud telefon bilan xodim qo'shish qo'llab-quvvatlansa — ikkala biznesga ham kiradi
    if (invite.statusCode === 201) {
      const toFirst = await login({ phone: worker.phone, password: "xodim-parol-123", companySlug: first.slug });
      expect(toFirst.statusCode, toFirst.body).toBe(200);
      expect(toFirst.json().user.companySlug).toBe(first.slug);

      const toSecond = await login({ phone: worker.phone, password: "xodim-parol-123", companySlug: second.slug });
      expect(toSecond.statusCode, toSecond.body).toBe(200);
      expect(toSecond.json().user.companySlug).toBe(second.slug);
    } else {
      // Bir telefon — bitta biznes: o'z biznesidan kirsin, begonasidan kira olmasin
      const own = await login({ phone: worker.phone, password: "xodim-parol-123", companySlug: first.slug });
      expect(own.statusCode, own.body).toBe(200);
      const foreign = await login({ phone: worker.phone, password: "xodim-parol-123", companySlug: second.slug });
      expect(foreign.statusCode).toBe(403);
    }
  });

  it("manzilsiz kirish avvalgidek ishlaydi", async () => {
    const res = await login({ phone: first.owner.phone, password: first.owner.password });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().user.hasCompany).toBe(true);
  });

  it("biznes ma'lumoti sessiyasiz ochiq (kirish sahifasi uchun)", async () => {
    const res = await app.inject({ method: "GET", url: `/api/public/companies/${first.slug}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().company).toMatchObject({ name: "Bonnu Market", slug: first.slug });
    // Maxfiy maydonlar chiqmaydi
    expect(Object.keys(res.json().company)).not.toContain("ownerId");
  });
});
