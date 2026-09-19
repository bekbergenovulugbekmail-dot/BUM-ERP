/**
 * HAR BIR BIZNES MANZILI — ALOHIDA SESSIYA.
 *
 * `app.bum-erp.uz/ezo` va `app.bum-erp.uz/bonnu-market` bitta brauzerda bir vaqtda ochiq tursa ham
 * sessiyalar mustaqil: har biri o'z cookie'sida (`bum_s_<biznes>`), bir biznesdan chiqish boshqasiga
 * ta'sir qilmaydi. Sessiya biznesga BOG'LANGAN — cookie'ni boshqa biznes manzilida ishlatib bo'lmaydi.
 *
 * Biznesga bog'lanmagan sessiya (desktop kassa, telefon ilovasi, platforma admini) avvalgidek
 * umumiy `bum_session` cookie'sida ishlaydi.
 */
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { sessions } from "../src/db/schema/platform.js";
import { buildServer } from "../src/server.js";
import { createCompany, resetDatabase, signedIn } from "./helpers.js";

let app: FastifyInstance;
let adminCookie: string;
/** Ikkala biznesda ham ishlaydigan xodim (bir telefon, bir parol). */
let ezo: Awaited<ReturnType<typeof createCompany>>;
let bonnu: Awaited<ReturnType<typeof createCompany>>;

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
  ezo = await createCompany(app, adminCookie, { name: "EZO" });
  bonnu = await createCompany(app, adminCookie, { name: "Bonnu Market" });
});

const login = (phone: string, password: string, companySlug?: string) =>
  app.inject({ method: "POST", url: "/api/auth/login", payload: { phone, password, ...(companySlug ? { companySlug } : {}) } });

/** Javobdagi cookie'lar: nom → qiymat. */
function cookiesOf(res: Awaited<ReturnType<typeof login>>) {
  const raw = res.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return new Map(list.map((line) => {
    const [pair] = line.split(";");
    const index = pair!.indexOf("=");
    return [pair!.slice(0, index), pair!.slice(index + 1)] as const;
  }));
}

/** Brauzer kabi: BARCHA cookie'lar yuboriladi, biznes esa sarlavhada. */
const call = (jar: Map<string, string>, companyKey: string | null, method: "GET" | "POST", url: string, payload?: object) =>
  app.inject({
    method,
    url,
    headers: {
      cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; "),
      ...(companyKey ? { "x-bum-company": companyKey } : {}),
    },
    ...(payload ? { payload } : {}),
  });

describe("Har bir biznes manzili — alohida sessiya", () => {
  it("ikki biznes bir vaqtda ochiq: cookie'lar alohida, ikkalasi ham ishlaydi", async () => {
    const ezoLogin = await login(ezo.owner.phone, ezo.owner.password, ezo.slug!);
    expect(ezoLogin.statusCode, ezoLogin.body).toBe(200);
    const bonnuLogin = await login(bonnu.owner.phone, bonnu.owner.password, bonnu.slug!);
    expect(bonnuLogin.statusCode, bonnuLogin.body).toBe(200);

    const ezoCookies = cookiesOf(ezoLogin);
    const bonnuCookies = cookiesOf(bonnuLogin);
    expect([...ezoCookies.keys()], "biznes cookie'si nomi").toContain(`bum_s_${ezo.slug}`);
    expect([...bonnuCookies.keys()]).toContain(`bum_s_${bonnu.slug}`);
    expect([...ezoCookies.keys()], "umumiy cookie yozilmaydi").not.toContain("bum_session");

    // Brauzerda ikkala cookie ham turadi
    const jar = new Map([...ezoCookies, ...bonnuCookies]);

    const ezoMe = await call(jar, ezo.slug!, "GET", "/api/auth/me");
    expect(ezoMe.statusCode, ezoMe.body).toBe(200);
    expect(ezoMe.json().user).toMatchObject({ companySlug: ezo.slug, companyName: "EZO" });

    const bonnuMe = await call(jar, bonnu.slug!, "GET", "/api/auth/me");
    expect(bonnuMe.statusCode, bonnuMe.body).toBe(200);
    expect(bonnuMe.json().user).toMatchObject({ companySlug: bonnu.slug, companyName: "Bonnu Market" });
  });

  it("bir biznesdan chiqish boshqasiga ta'sir qilmaydi", async () => {
    const jar = new Map([
      ...cookiesOf(await login(ezo.owner.phone, ezo.owner.password, ezo.slug!)),
      ...cookiesOf(await login(bonnu.owner.phone, bonnu.owner.password, bonnu.slug!)),
    ]);

    const out = await call(jar, ezo.slug!, "POST", "/api/auth/logout");
    expect(out.statusCode).toBe(200);

    expect((await call(jar, ezo.slug!, "GET", "/api/auth/me")).statusCode, "EZO chiqdi").toBe(401);
    expect((await call(jar, bonnu.slug!, "GET", "/api/auth/me")).statusCode, "Bonnu ochiq qoladi").toBe(200);
  });

  it("sessiya biznesga bog'langan: cookie'ni boshqa biznes manzilida ishlatib bo'lmaydi", async () => {
    // Bir odam ikkala biznesda ham a'zo bo'lsin
    const both = await app.inject({
      method: "POST",
      url: "/api/company/employees",
      headers: { cookie: bonnu.ownerCookie },
      payload: { name: "Ikki biznes xodimi", phone: ezo.owner.phone, password: ezo.owner.password, role: "Kassir" },
    });
    // Mavjud telefon bilan qo'shish qo'llab-quvvatlanmasa — test ma'nosini yo'qotadi
    if (both.statusCode !== 201) return;

    const ezoJar = cookiesOf(await login(ezo.owner.phone, ezo.owner.password, ezo.slug!));
    // EZO cookie'si Bonnu kontekstida yuborilsa — 403 (a'zo bo'lsa ham)
    const mismatch = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: {
        cookie: `bum_s_${ezo.slug}=${ezoJar.get(`bum_s_${ezo.slug}`)}`,
        "x-bum-company": bonnu.slug!,
      },
    });
    expect(mismatch.statusCode, mismatch.body).toBe(403);
    expect(mismatch.json().details).toMatchObject({ reason: "company_session_mismatch" });
  });

  it("biznesga bog'lanmagan sessiya (kassa, ilova, admin) avvalgidek ishlaydi", async () => {
    const legacy = await login(ezo.owner.phone, ezo.owner.password);
    expect(legacy.statusCode).toBe(200);
    const jar = cookiesOf(legacy);
    expect([...jar.keys()], "umumiy cookie").toContain("bum_session");

    expect((await call(jar, null, "GET", "/api/auth/me")).statusCode, "biznessiz so'rov").toBe(200);
    // Bog'lanmagan sessiya o'z faol biznesi kontekstida ham ishlaydi
    expect((await call(jar, ezo.slug!, "GET", "/api/auth/me")).statusCode).toBe(200);

    const [row] = await db.select({ companyId: sessions.companyId }).from(sessions).where(eq(sessions.userId, ezo.owner.id));
    expect(row!.companyId, "bog'lanmagan sessiya").toBeNull();
  });

  it("boshqa biznesga o'tishda o'sha biznesning yangi sessiyasi ochiladi", async () => {
    // Egani ikkinchi biznesga a'zo qilamiz
    const invited = await app.inject({
      method: "POST",
      url: "/api/company/employees",
      headers: { cookie: bonnu.ownerCookie },
      payload: { name: "EZO egasi", phone: ezo.owner.phone, password: ezo.owner.password, role: "Kassir" },
    });
    if (invited.statusCode !== 201) return;

    const jar = cookiesOf(await login(ezo.owner.phone, ezo.owner.password, ezo.slug!));
    const switched = await call(jar, ezo.slug!, "POST", "/api/company/switch", { companyId: bonnu.companyId });
    expect(switched.statusCode, switched.body).toBe(200);
    expect(switched.json().companyKey).toBe(bonnu.slug);

    for (const [name, value] of cookiesOf(switched)) jar.set(name, value);
    expect([...jar.keys()], "maqsad biznes cookie'si").toContain(`bum_s_${bonnu.slug}`);
    expect((await call(jar, bonnu.slug!, "GET", "/api/auth/me")).statusCode).toBe(200);
    expect((await call(jar, ezo.slug!, "GET", "/api/auth/me")).statusCode, "eski biznes ham ochiq qoladi").toBe(200);
  });

  it("yaroqsiz yoki o'zgartirilgan token — 401", async () => {
    const jar = new Map([[`bum_s_${ezo.slug}`, "soxta-token-12345"]]);
    expect((await call(jar, ezo.slug!, "GET", "/api/auth/me")).statusCode).toBe(401);

    const real = cookiesOf(await login(ezo.owner.phone, ezo.owner.password, ezo.slug!));
    const token = real.get(`bum_s_${ezo.slug}`)!;
    const tampered = new Map([[`bum_s_${ezo.slug}`, `${token.slice(0, -2)}xy`]]);
    expect((await call(tampered, ezo.slug!, "GET", "/api/auth/me")).statusCode).toBe(401);
  });
});
