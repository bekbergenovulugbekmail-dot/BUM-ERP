import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../src/db/client.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
let other: Company;

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
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Do'kon" });
  other = await createCompany(app, admin.cookie, { name: "Boshqa do'kon" });
});

const get = (cookie: string) => app.inject({ method: "GET", url: "/api/company/print-settings", headers: { cookie } });
const putReceipt = (cookie: string, payload: object) =>
  app.inject({ method: "PUT", url: "/api/company/print-settings/receipt", headers: { cookie }, payload });

describe("Chop etish sozlamalari", () => {
  it("standart chek shabloni; kassir o'qiydi, saqlay olmaydi; egasi saqlaydi; noto'g'ri qiymatlar rad", async () => {
    const kassir = await addEmployee(app, company, "Kassir");
    const initial = await get(kassir.cookie);
    expect(initial.statusCode).toBe(200);
    expect(initial.json().receipt).toMatchObject({
      paperWidth: 80,
      showLogo: false,
      logo: null,
      showCustomerDebt: true,
      footerText: "Xaridingiz uchun rahmat!",
    });

    const template = {
      ...initial.json().receipt,
      paperWidth: 58,
      fontSize: "lg",
      showLogo: true,
      logo: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      headerText: "Chilonzor filiali\n09:00 — 22:00",
      showCustomerDebt: false,
      footerText: "Rahmat! Yana keling",
      autoPrint: true,
    };
    expect((await putReceipt(kassir.cookie, template)).statusCode).toBe(403);

    const saved = await putReceipt(company.ownerCookie, template);
    expect(saved.statusCode).toBe(200);
    expect(saved.json().receipt).toEqual(template);
    expect((await get(kassir.cookie)).json().receipt).toEqual(template);

    expect((await putReceipt(company.ownerCookie, { ...template, logo: "https://example.com/logo.png" })).statusCode).toBe(400);
    expect((await putReceipt(company.ownerCookie, { ...template, logo: `data:image/png;base64,${"A".repeat(300_001)}` })).statusCode).toBe(400);
    expect((await putReceipt(company.ownerCookie, { ...template, paperWidth: 70 })).statusCode).toBe(400);
    expect((await putReceipt(company.ownerCookie, { ...template, unknownField: true })).statusCode).toBe(400);
    const { footerText: _footer, ...incomplete } = template;
    expect((await putReceipt(company.ownerCookie, incomplete)).statusCode).toBe(400);

    // Umumiy sozlamalar endpointi orqali tekshiruvsiz yozib bo'lmaydi
    const bypass = await app.inject({
      method: "PUT",
      url: "/api/company/settings/print.receipt",
      headers: { cookie: company.ownerCookie },
      payload: { value: "{\"logo\":\"javascript:alert(1)\"}", group: "print" },
    });
    expect(bypass.statusCode).toBe(400);

    // Boshqa kompaniya o'z standartini ko'radi
    expect((await get(other.ownerCookie)).json().receipt.paperWidth).toBe(80);
  });
});
