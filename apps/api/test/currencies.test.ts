import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { companyCurrencies, exchangeRates } from "../src/db/schema/finance.js";
import { setCbuFetcher } from "../src/modules/finance/currencies.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
let other: Company;

const CBU = [
  { Ccy: "USD", Rate: "12650.50", Nominal: "1", Date: "11.09.2026" },
  { Ccy: "RUB", Rate: "140.25", Nominal: "1", Date: "11.09.2026" },
  { Ccy: "IDR", Rate: "8.1234", Nominal: "10", Date: "11.09.2026" },
];

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  setCbuFetcher(null);
  await app.close();
  await closeDb();
});

beforeEach(async () => {
  setCbuFetcher(async () => CBU);
  await resetDatabase();
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Do'kon" });
  other = await createCompany(app, admin.cookie, { name: "Boshqa do'kon" });
});

const call = (cookie: string, method: "GET" | "PUT" | "POST", url: string, payload?: object) =>
  app.inject({ method, url: `/api/finance${url}`, headers: { cookie }, ...(payload ? { payload } : {}) });

describe("Valyutalar va kurslar", () => {
  it("standart — faqat asosiy valyuta; kassir o'qiydi, saqlay olmaydi; qo'lda kurs, tarix va tekshiruvlar", async () => {
    const kassir = await addEmployee(app, company, "Kassir");
    const initial = await call(kassir.cookie, "GET", "/currencies");
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toEqual({ baseCurrency: "UZS", cbuEnabled: false, currencies: [] });

    const usd = { code: "usd", rate: "12600", source: "manual", isActive: true };
    expect((await call(kassir.cookie, "PUT", "/currencies", { cbuEnabled: false, currencies: [usd] })).statusCode).toBe(403);

    const saved = await call(company.ownerCookie, "PUT", "/currencies", { cbuEnabled: false, currencies: [usd] });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().currencies).toMatchObject([{ code: "USD", rate: "12600.0000", source: "manual", isActive: true }]);

    const reject = async (currencies: object[], cbuEnabled = false) =>
      (await call(company.ownerCookie, "PUT", "/currencies", { cbuEnabled, currencies })).statusCode;
    expect(await reject([{ ...usd, source: "cbu" }])).toBe(400);
    expect(await reject([{ code: "UZS", rate: "1", source: "manual", isActive: true }])).toBe(400);
    expect(await reject([usd, usd])).toBe(400);
    expect(await reject([{ code: "USD", source: "manual", isActive: true }])).toBe(400);
    expect(await reject([{ ...usd, rate: "0" }])).toBe(400);

    // Kurs o'zgarsa tarixga yoziladi, o'zgarmasa — yo'q
    await call(company.ownerCookie, "PUT", "/currencies", { cbuEnabled: false, currencies: [{ ...usd, rate: "12700" }] });
    await call(company.ownerCookie, "PUT", "/currencies", { cbuEnabled: false, currencies: [{ ...usd, rate: "12700" }] });
    const history = await db
      .select()
      .from(exchangeRates)
      .where(and(eq(exchangeRates.companyId, company.companyId), eq(exchangeRates.code, "USD")));
    expect(history.map((h) => h.rate).sort()).toEqual(["12600.0000", "12700.0000"]);

    // Ro'yxatdan olib tashlangan valyuta faolsizlanadi, o'chmaydi
    const removed = await call(company.ownerCookie, "PUT", "/currencies", { cbuEnabled: false, currencies: [] });
    expect(removed.json().currencies).toMatchObject([{ code: "USD", isActive: false, rate: "12700.0000" }]);

    expect((await call(other.ownerCookie, "GET", "/currencies")).json().currencies).toEqual([]);
  });

  it("Markaziy bank: yoqish, kurslarni ko'rish, avtomatik va qo'lda yangilash, xatoda rad", async () => {
    const settings = {
      cbuEnabled: true,
      currencies: [
        { code: "USD", rate: "12600", source: "manual", isActive: true },
        { code: "RUB", source: "cbu", isActive: true },
      ],
    };
    const saved = await call(company.ownerCookie, "PUT", "/currencies", settings);
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      cbuEnabled: true,
      currencies: [
        { code: "RUB", rate: "140.2500", source: "cbu", rateDate: "2026-09-11" },
        { code: "USD", rate: "12600.0000", source: "manual" },
      ],
    });

    const cbu = await call(company.ownerCookie, "GET", "/currencies/cbu");
    expect(cbu.statusCode).toBe(200);
    expect(cbu.json().rates).toEqual(
      expect.arrayContaining([
        { code: "USD", rate: "12650.5000", date: "2026-09-11" },
        { code: "IDR", rate: "0.8123", date: "2026-09-11" },
      ]),
    );

    // Kecha yangilangan CBU kursi o'qishda avtomatik yangilanadi
    await db
      .update(companyCurrencies)
      .set({ updatedAt: sql`now() - interval '2 days'` })
      .where(and(eq(companyCurrencies.companyId, company.companyId), eq(companyCurrencies.code, "RUB")));
    setCbuFetcher(async () => [{ Ccy: "RUB", Rate: "141", Nominal: "1", Date: "12.09.2026" }]);
    expect((await call(company.ownerCookie, "GET", "/currencies")).json().currencies).toMatchObject([
      { code: "RUB", rate: "141.0000", rateDate: "2026-09-12" },
      { code: "USD", rate: "12600.0000" },
    ]);

    setCbuFetcher(async () => [{ Ccy: "RUB", Rate: "139.5", Nominal: "1", Date: "13.09.2026" }]);
    const refreshed = await call(company.ownerCookie, "POST", "/currencies/refresh");
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().currencies[0]).toMatchObject({ code: "RUB", rate: "139.5000" });

    // Markaziy bank ishlamasa: CBU manbali saqlash rad, ro'yxat 503, sozlamalar o'qiladi
    setCbuFetcher(async () => {
      throw new Error("offline");
    });
    expect(
      (await call(company.ownerCookie, "PUT", "/currencies", {
        ...settings,
        currencies: [...settings.currencies, { code: "EUR", source: "cbu", isActive: true }],
      })).statusCode,
    ).toBe(400);
    expect((await call(company.ownerCookie, "GET", "/currencies/cbu")).statusCode).toBe(503);
    expect((await call(company.ownerCookie, "GET", "/currencies")).statusCode).toBe(200);
  });
});
