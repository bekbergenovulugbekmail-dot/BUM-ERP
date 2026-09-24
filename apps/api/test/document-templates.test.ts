/**
 * Hujjat shablonlari: xavfsizlik, versiyalash va tenant ajratilishi.
 *
 * Eng muhim qoida: shablon PREZENTATSIYA qatlami. Uning ichiga HTML, JS yoki maxfiy ustun
 * (tannarx) tushmasligi va u orqali boshqa kompaniyaning hujjatiga yetib bo'lmasligi kerak.
 */
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { documentTemplateVersions, documentTemplates } from "../src/db/schema/documents.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;
type Method = "GET" | "POST" | "PATCH" | "DELETE";

let app: FastifyInstance;
let company: Company;
let other: Company;

const call = (cookie: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

const createTemplate = (cookie: string, payload: object) => call(cookie, "POST", "/api/documents/templates", payload);

/** Eng oddiy yaroqli sxema. */
const simpleSchema = (label = "Salom") => ({
  schemaVersion: 1,
  page: { size: "a4", orientation: "portrait", margins: { top: 14, right: 14, bottom: 14, left: 14 }, footerOnEveryPage: true, signaturesOnLastPage: true },
  sections: [
    { key: "header", elements: [{ id: "e1", type: "text", label }] },
    { key: "body", elements: [{ id: "e2", type: "field", field: "customer.name", label: "Mijoz" }] },
    { key: "footer", elements: [] },
  ],
});

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
}, 120_000);

afterAll(async () => {
  await app.close();
  await closeDb();
});

beforeEach(async () => {
  await resetDatabase();
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "DOC-CO" });
  other = await createCompany(app, admin.cookie, { name: "DOC-OUTSIDER" });
});

describe("Shablon yaratish va versiyalash", () => {
  it("birinchi shablon o'zi standart bo'ladi va zavod sxemasidan boshlanadi", async () => {
    const res = await createTemplate(company.ownerCookie, { documentType: "sales_invoice", name: "Asosiy" });
    expect(res.statusCode, res.body).toBe(201);
    const { template, version } = res.json();
    expect(template.isDefault).toBe(true);
    expect(version.version).toBe(1);

    const detail = (await call(company.ownerCookie, "GET", `/api/documents/templates/${template.id}`)).json();
    // Zavod sxemasi: sarlavhada hujjat nomi bor
    const header = detail.schema.sections.find((s: { key: string }) => s.key === "header");
    expect(header.elements.length).toBeGreaterThan(0);
  });

  it("har saqlash YANGI versiya; eski versiya joyida qoladi", async () => {
    const { template } = (await createTemplate(company.ownerCookie, { documentType: "sales_invoice", name: "Asosiy" })).json();

    const v2 = await call(company.ownerCookie, "POST", `/api/documents/templates/${template.id}/versions`, {
      schema: simpleSchema("Ikkinchi"),
      note: "Matn o'zgartirildi",
    });
    expect(v2.statusCode, v2.body).toBe(201);
    expect(v2.json().version.version).toBe(2);

    const versions = (await call(company.ownerCookie, "GET", `/api/documents/templates/${template.id}/versions`)).json().versions;
    expect(versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
  });

  it("eski versiyaga qaytish — YANGI versiya yasaydi, tarix uzilmaydi", async () => {
    const { template } = (await createTemplate(company.ownerCookie, { documentType: "sales_invoice", name: "Asosiy", schema: simpleSchema("Birinchi") })).json();
    await call(company.ownerCookie, "POST", `/api/documents/templates/${template.id}/versions`, { schema: simpleSchema("Ikkinchi") });

    const versions = (await call(company.ownerCookie, "GET", `/api/documents/templates/${template.id}/versions`)).json().versions;
    const first = versions.find((v: { version: number }) => v.version === 1);

    const restored = await call(company.ownerCookie, "POST", `/api/documents/templates/${template.id}/restore`, { versionId: first.id });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json().version.version, "qaytarish 3-versiya bo'ladi").toBe(3);

    const detail = (await call(company.ownerCookie, "GET", `/api/documents/templates/${template.id}`)).json();
    const header = detail.schema.sections.find((s: { key: string }) => s.key === "header");
    expect(header.elements[0].label, "birinchi versiyaning matni qaytdi").toBe("Birinchi");
  });

  it("standart shablon arxivlanmaydi; boshqasi standart qilingach arxivlanadi", async () => {
    const first = (await createTemplate(company.ownerCookie, { documentType: "sales_invoice", name: "Birinchi" })).json().template;
    const second = (await createTemplate(company.ownerCookie, { documentType: "sales_invoice", name: "Ikkinchi" })).json().template;

    expect((await call(company.ownerCookie, "DELETE", `/api/documents/templates/${first.id}`)).statusCode).toBe(400);

    expect((await call(company.ownerCookie, "POST", `/api/documents/templates/${second.id}/default`)).statusCode).toBe(200);
    expect((await call(company.ownerCookie, "DELETE", `/api/documents/templates/${first.id}`)).statusCode).toBe(200);

    // Arxivdagi shablon ro'yxatda ko'rinmaydi, lekin bazadan YO'QOLMAYDI
    const list = (await call(company.ownerCookie, "GET", "/api/documents/templates")).json().templates;
    expect(list.map((t: { id: string }) => t.id)).not.toContain(first.id);
    const rows = await db.select().from(documentTemplates).where(eq(documentTemplates.id, first.id));
    expect(rows[0]!.status).toBe("archived");
  });

  it("bitta hujjat turida bitta standart shablon", async () => {
    const first = (await createTemplate(company.ownerCookie, { documentType: "sales_invoice", name: "Birinchi" })).json().template;
    const second = (await createTemplate(company.ownerCookie, { documentType: "sales_invoice", name: "Ikkinchi", makeDefault: true })).json().template;
    const rows = await db
      .select()
      .from(documentTemplates)
      .where(and(eq(documentTemplates.companyId, company.companyId), eq(documentTemplates.documentType, "sales_invoice")));
    expect(rows.filter((row) => row.isDefault).map((row) => row.id)).toEqual([second.id]);
    expect(rows.find((row) => row.id === first.id)!.isDefault).toBe(false);
  });
});

describe("Xavfsizlik: shablon ichiga nima tushmaydi", () => {
  it("noma'lum element, HTML va skript saqlanmaydi", async () => {
    const res = await createTemplate(company.ownerCookie, {
      documentType: "sales_invoice",
      name: "Xavfli",
      schema: {
        schemaVersion: 1,
        page: { size: "a4" },
        sections: [
          {
            key: "header",
            elements: [
              { id: "x1", type: "script", label: "<script>alert(1)</script>" },
              { id: "x2", type: "text", label: "Toza matn", html: "<img src=x onerror=alert(1)>", onClick: "steal()" },
            ],
          },
        ],
      },
    });
    expect(res.statusCode, res.body).toBe(201);

    const { template } = res.json();
    const detail = (await call(company.ownerCookie, "GET", `/api/documents/templates/${template.id}`)).json();
    const header = detail.schema.sections.find((s: { key: string }) => s.key === "header");

    expect(header.elements, "noma'lum tur tashlanadi").toHaveLength(1);
    const element = header.elements[0];
    expect(element.type).toBe("text");
    expect(element.label).toBe("Toza matn");
    // Begona kalitlar umuman ko'chirilmaydi
    expect(Object.keys(element).sort()).toEqual(["id", "label", "type"]);
    expect(JSON.stringify(detail.schema)).not.toContain("script");
    expect(JSON.stringify(detail.schema)).not.toContain("onerror");
  });

  it("mavjud bo'lmagan maydon va boshqa hujjat turining maydoni rad etiladi", async () => {
    const res = await createTemplate(company.ownerCookie, {
      documentType: "purchase_order",
      name: "Maydonlar",
      schema: {
        schemaVersion: 1,
        sections: [
          {
            key: "body",
            elements: [
              { id: "a", type: "field", field: "customer.name" }, // xaridda mijoz yo'q
              { id: "b", type: "field", field: "secret.password" }, // umuman yo'q
              { id: "c", type: "field", field: "supplier.name" }, // to'g'ri
            ],
          },
        ],
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().warnings.length).toBeGreaterThanOrEqual(2);

    const detail = (await call(company.ownerCookie, "GET", `/api/documents/templates/${res.json().template.id}`)).json();
    const body = detail.schema.sections.find((s: { key: string }) => s.key === "body");
    expect(body.elements.map((e: { field: string }) => e.field)).toEqual(["supplier.name"]);
  });

  it("rang faqat #rrggbb; ifoda va URL qabul qilinmaydi", async () => {
    const res = await createTemplate(company.ownerCookie, {
      documentType: "sales_invoice",
      name: "Rang",
      schema: {
        schemaVersion: 1,
        sections: [
          {
            key: "header",
            elements: [
              { id: "a", type: "text", label: "Bir", style: { color: "url(javascript:alert(1))", fontSize: 999 } },
              { id: "b", type: "text", label: "Ikki", style: { color: "#FF8800", fontSize: 12 } },
            ],
          },
        ],
      },
    });
    const detail = (await call(company.ownerCookie, "GET", `/api/documents/templates/${res.json().template.id}`)).json();
    const [first, second] = detail.schema.sections.find((s: { key: string }) => s.key === "header").elements;
    expect(first.style.color, "yaroqsiz rang tashlanadi").toBeUndefined();
    expect(first.style.fontSize, "shrift chegaraga tushiriladi").toBeLessThanOrEqual(48);
    expect(second.style.color).toBe("#ff8800");
  });

  it("rasm faqat fayl kaliti — tashqi URL saqlanmaydi", async () => {
    const res = await createTemplate(company.ownerCookie, {
      documentType: "sales_invoice",
      name: "Rasm",
      schema: {
        schemaVersion: 1,
        sections: [
          {
            key: "header",
            elements: [
              { id: "a", type: "image", imageKey: "https://evil.example/x.png" },
              { id: "b", type: "image", imageKey: "data:image/png;base64,AAAA" },
            ],
          },
        ],
      },
    });
    const detail = (await call(company.ownerCookie, "GET", `/api/documents/templates/${res.json().template.id}`)).json();
    expect(detail.schema.sections.find((s: { key: string }) => s.key === "header").elements).toHaveLength(0);
    expect(JSON.stringify(detail.schema)).not.toContain("evil.example");
  });
});

describe("Maxfiy ustun va ruxsatlar", () => {
  it("tannarx ustuni `products.view_cost` siz ro'yxatda ham yo'q, shablonga ham tushmaydi", async () => {
    // Kassir: tannarxni ko'rish ruxsati yo'q, lekin sozlamalarni boshqara oladigan rol emas —
    // shuning uchun egasi nomidan tekshiramiz: katalogda tannarx BOR
    const ownerFields = (await call(company.ownerCookie, "GET", "/api/documents/fields?documentType=sales_invoice")).json();
    expect(ownerFields.columns.map((c: { key: string }) => c.key)).toContain("cost");

    // Buxgalter sozlamalarni ko'radi, lekin tannarxni emas
    const accountant = await addEmployee(app, company, "Buxgalter");
    const fields = (await call(accountant.cookie, "GET", "/api/documents/fields?documentType=sales_invoice")).json();
    expect(fields.columns.map((c: { key: string }) => c.key), "tannarx ruxsatsiz ro'yxatga kirmaydi").not.toContain("cost");

// Ruxsatsiz rolda sozlamalarni boshqarish ham yopiq — shablon umuman yaratilmaydi
    const denied = await createTemplate(accountant.cookie, { documentType: "sales_invoice", name: "Tannarxli" });
    expect(denied.statusCode, "settings.manage yo'q").toBe(403);
  });
});

describe("Tenant ajratilishi", () => {
  it("boshqa kompaniyaning shabloni ko'rinmaydi va tahrirlanmaydi", async () => {
    const mine = (await createTemplate(company.ownerCookie, { documentType: "sales_invoice", name: "Meniki" })).json().template;

    expect((await call(other.ownerCookie, "GET", `/api/documents/templates/${mine.id}`)).statusCode).toBe(404);
    expect(
      (await call(other.ownerCookie, "POST", `/api/documents/templates/${mine.id}/versions`, { schema: simpleSchema() })).statusCode,
    ).toBe(404);
    expect((await call(other.ownerCookie, "DELETE", `/api/documents/templates/${mine.id}`)).statusCode).toBe(404);

    const list = (await call(other.ownerCookie, "GET", "/api/documents/templates")).json().templates;
    expect(list).toHaveLength(0);

    // Versiya yozuvi ham begona kompaniyaga tegmaydi
    const versions = await db.select().from(documentTemplateVersions).where(eq(documentTemplateVersions.companyId, other.companyId));
    expect(versions).toHaveLength(0);
  });

  it("amaldagi sxema — o'z kompaniyasiniki; boshqasiniki umuman ta'sir qilmaydi", async () => {
    await createTemplate(company.ownerCookie, { documentType: "sales_invoice", name: "Meniki", schema: simpleSchema("MENIKI") });
    const mineActive = (await call(company.ownerCookie, "GET", "/api/documents/active/sales_invoice")).json();
    expect(JSON.stringify(mineActive.schema)).toContain("MENIKI");

    const otherActive = (await call(other.ownerCookie, "GET", "/api/documents/active/sales_invoice")).json();
    expect(JSON.stringify(otherActive.schema), "begona shablon ko'chib o'tmaydi").not.toContain("MENIKI");
    // Shabloni yo'q kompaniya ZAVOD sxemasini oladi — hujjat baribir chiqadi
    expect(otherActive.schema.sections.length).toBe(3);
  });
});
