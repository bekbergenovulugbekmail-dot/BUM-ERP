/** Biznes konteksti: bitta sessiya bilan bir nechta biznes parallel (brauzer tablari) va izolyatsiya. */
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { branches, companies, companyMembers, users } from "../src/db/schema/platform.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

let app: FastifyInstance;
let adminCookie: string;

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
});

type Method = "GET" | "POST";
const call = (cookie: string, method: Method, url: string, company?: string, payload?: object) =>
  app.inject({
    method,
    url,
    headers: { cookie, ...(company ? { "x-bum-company": company } : {}) },
    ...(payload ? { payload } : {}),
  });

/** Bitta egasi ikki biznesga ega: Bonnu Market (aktiv) va Hadicha Market. */
async function twoBusinesses() {
  const bonnu = await createCompany(app, adminCookie, { name: "Bonnu Market" });
  const hadicha = await createCompany(app, adminCookie, { name: "Hadicha Market" });
  await db.insert(companyMembers).values({ companyId: hadicha.companyId, userId: bonnu.owner.id, companyRole: "Business Owner", joinedAt: new Date() });
  await db.update(companies).set({ ownerId: bonnu.owner.id }).where(eq(companies.id, hadicha.companyId));
  return { bonnu, hadicha, cookie: bonnu.ownerCookie };
}

describe("Biznes konteksti (tab bo'yicha)", () => {
  it("bir sessiya — ikki biznes parallel: slug yoki id bilan, saqlangan aktiv kompaniya o'zgarmaydi", async () => {
    const { bonnu, hadicha, cookie } = await twoBusinesses();

    expect((await call(cookie, "GET", "/api/company")).json().company.id).toBe(bonnu.companyId);
    expect((await call(cookie, "GET", "/api/company", hadicha.slug)).json().company.id).toBe(hadicha.companyId);
    expect((await call(cookie, "GET", "/api/company", hadicha.companyId)).json().company.id).toBe(hadicha.companyId);
    expect((await call(cookie, "GET", "/api/company", hadicha.slug.toUpperCase())).json().company.id).toBe(hadicha.companyId);

    const me = (await call(cookie, "GET", "/api/auth/me", hadicha.slug)).json().user;
    expect(me).toMatchObject({ activeCompanyId: hadicha.companyId, companyName: "Hadicha Market", companySlug: hadicha.slug });

    // Parallel tablar: so'rovlar aralash kelsa ham har biri o'z biznesida
    const keys = Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? bonnu.slug : hadicha.slug));
    const results = await Promise.all(keys.map((key) => call(cookie, "GET", "/api/company", key)));
    expect(results.map((res) => res.json().company.slug)).toEqual(keys);

    const mine = (await call(cookie, "GET", "/api/company/mine", hadicha.slug)).json().companies as { id: string; isCurrent: boolean }[];
    expect(mine.find((c) => c.isCurrent)?.id).toBe(hadicha.companyId);

    const [user] = await db.select().from(users).where(eq(users.id, bonnu.owner.id));
    expect(user!.activeCompanyId).toBe(bonnu.companyId);
  });

  it("yozish tanlangan biznesga tushadi, boshqasiga aralashmaydi; parametr (rasm/yuklab olish) ham ishlaydi", async () => {
    const { bonnu, hadicha, cookie } = await twoBusinesses();
    const created = await call(cookie, "POST", "/api/company/branches", hadicha.slug, { name: "Luchevoy filiali", code: "BR-777" });
    expect(created.statusCode).toBe(201);
    const [branch] = await db.select().from(branches).where(eq(branches.code, "BR-777"));
    expect(branch!.companyId).toBe(hadicha.companyId);

    const bonnuBranches = (await call(cookie, "GET", "/api/company/branches", bonnu.slug)).json().branches as { code: string }[];
    expect(bonnuBranches.map((b) => b.code)).not.toContain("BR-777");

    const byQuery = await app.inject({ method: "GET", url: `/api/company/branches?bumCompany=${hadicha.slug}`, headers: { cookie } });
    expect((byQuery.json().branches as { code: string }[]).map((b) => b.code)).toContain("BR-777");
    // Qat'iy so'rov sxemali marshrutga parametr yetib bormaydi
    expect((await app.inject({ method: "GET", url: `/api/company/audit-logs?limit=5&bumCompany=${hadicha.slug}`, headers: { cookie } })).statusCode).toBe(200);
  });

  it("boshqa biznes, mavjud bo'lmagan yoki noto'g'ri manzil, nofaol a'zolik — 403; sessiyasiz — 401", async () => {
    const { hadicha, cookie } = await twoBusinesses();
    const stranger = await createCompany(app, adminCookie, { name: "Begona" });

    for (const key of [stranger.slug, stranger.companyId, "yoq-biznes", "../admin", "a b"]) {
      const res = await call(cookie, "GET", "/api/company", key);
      expect(res.statusCode, key).toBe(403);
      expect(res.json().details?.reason, key).toBe("company_access_denied");
    }
    expect((await call(cookie, "GET", "/api/auth/me", stranger.slug)).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: `/api/company/branches?bumCompany=${stranger.slug}`, headers: { cookie } })).statusCode).toBe(403);

    // Kassir o'z biznesidan boshqasiga kira olmaydi
    const kassir = await addEmployee(app, { ownerCookie: cookie }, "Kassir");
    expect((await call(kassir.cookie, "GET", "/api/company", hadicha.slug)).statusCode).toBe(403);

    await db
      .update(companyMembers)
      .set({ isActive: false })
      .where(and(eq(companyMembers.companyId, hadicha.companyId), eq(companyMembers.companyRole, "Business Owner")));
    expect((await call(cookie, "GET", "/api/company", hadicha.slug)).statusCode).toBe(403);

    expect((await app.inject({ method: "GET", url: "/api/company", headers: { "x-bum-company": hadicha.slug } })).statusCode).toBe(401);
  });
});
