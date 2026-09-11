import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../src/db/client.js";
import { buildServer } from "../src/server.js";
import { createCompany, resetDatabase, signedIn } from "./helpers.js";

let app: FastifyInstance;
let admin: Awaited<ReturnType<typeof signedIn>>;
let alfa: Awaited<ReturnType<typeof createCompany>>;
let beta: Awaited<ReturnType<typeof createCompany>>;

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
  alfa = await createCompany(app, admin.cookie, { name: "Alfa Savdo" });
  beta = await createCompany(app, admin.cookie, { name: "Beta" });
});

const access = (slug: string, cookie?: string) =>
  app.inject({
    method: "GET",
    url: `/api/public/companies/${slug}/access`,
    ...(cookie ? { headers: { cookie } } : {}),
  });

describe("/t/:slug portali", () => {
  it("ommaviy ma'lumot faqat xavfsiz maydonlar bilan, sessiyasiz", async () => {
    const res = await app.inject({ method: "GET", url: `/api/public/companies/${alfa.slug}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().company).toMatchObject({ name: "Alfa Savdo", slug: "alfa-savdo", status: "active" });
    expect(Object.keys(res.json().company).sort()).toEqual(
      ["city", "country", "currency", "id", "language", "legalName", "logoUrl", "name", "slug", "status"].sort(),
    );
    expect((await app.inject({ method: "GET", url: "/api/public/companies/yoq-kompaniya" })).statusCode).toBe(404);
  });

  it("kirish tekshiruvi: a'zo, begona, platforma admini, to'xtatilgan, sessiyasiz", async () => {
    expect((await access(alfa.slug, alfa.ownerCookie)).json()).toEqual({
      allowed: true,
      companyId: alfa.companyId,
      reason: "ok",
    });
    expect((await access(alfa.slug, beta.ownerCookie)).json()).toMatchObject({ allowed: false, reason: "not_member" });
    expect((await access(alfa.slug, admin.cookie)).json()).toMatchObject({ allowed: true, reason: "platform_admin" });
    expect((await access("yoq-kompaniya", alfa.ownerCookie)).json()).toMatchObject({
      allowed: false,
      reason: "company_not_found",
    });

    await app.inject({
      method: "POST",
      url: `/api/platform/companies/${alfa.companyId}/status`,
      headers: { cookie: admin.cookie },
      payload: { status: "suspended" },
    });
    expect((await access(alfa.slug, alfa.ownerCookie)).json()).toMatchObject({ allowed: false, reason: "company_inactive" });

    expect((await access(alfa.slug)).statusCode).toBe(401);
  });
});
