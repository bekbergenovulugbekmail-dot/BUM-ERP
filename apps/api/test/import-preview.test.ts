/**
 * Import preview (`dryRun`) va dublikat nazorati.
 *
 * Preview: server qatorlarni tekshiradi, lekin bazaga HECH NARSA yozmaydi — `created: 0`, `valid` — yozilishga tayyor
 * qatorlar soni. Dublikat (CREATE ONLY rejimi): mavjud yozuv o'zgartirilmaydi va yangisi ochilmaydi — qator
 * `duplicates` ro'yxatida qaytadi. Har entity o'z kaliti bo'yicha: mijoz — telefon, ta'minotchi — kod va STIR,
 * hodim — telefon, marshrut — nom, xarajat — kategoriya+tavsif+summa+sana, mahsulot — SKU.
 */
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { products, units } from "../src/db/schema/catalog.js";
import { expenses } from "../src/db/schema/finance.js";
import { employees } from "../src/db/schema/hr.js";
import { distributionRoutes } from "../src/db/schema/crm.js";
import { suppliers } from "../src/db/schema/purchase.js";
import { customers } from "../src/db/schema/sales.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
let piece: string;

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
  await db.delete(units);
  await seedDefaultUnits(db);
  piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Preview do'koni" });
});

const post = (url: string, payload: object) =>
  app.inject({ method: "POST", url, headers: { cookie: company.ownerCookie }, payload });

const countOf = async (table: typeof customers | typeof suppliers | typeof employees | typeof distributionRoutes | typeof expenses | typeof products) =>
  (await db.select({ id: table.id }).from(table).where(eq(table.companyId, company.companyId))).length;

describe("Import preview (dryRun)", () => {
  it("mijozlar: preview hech narsa yozmaydi, tasdiqlangandan keyin yoziladi", async () => {
    const rows = [{ name: "Mijoz A", phone: "+998901112233" }, { name: "Mijoz B", phone: "+998901112244" }];

    const preview = await post("/api/sales/customers/import", { rows, dryRun: true });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json()).toMatchObject({ created: 0, valid: 2, dryRun: true });
    expect(preview.json().errors).toHaveLength(0);
    expect(preview.json().duplicates).toHaveLength(0);
    expect(await countOf(customers)).toBe(0);

    const commit = await post("/api/sales/customers/import", { rows });
    expect(commit.statusCode, commit.body).toBe(200);
    expect(commit.json()).toMatchObject({ created: 2, valid: 2, dryRun: false });
    expect(await countOf(customers)).toBe(2);
  });

  it("preview xato qatorlarni ham ko'rsatadi va hech narsa yozmaydi", async () => {
    const preview = await post("/api/sales/customers/import", {
      dryRun: true,
      rows: [{ name: "To'g'ri", phone: "+998901110000" }, { name: "" }, { name: "Chegirma xato", discountPercent: "150" }],
    });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json()).toMatchObject({ created: 0, valid: 1, dryRun: true });
    expect(preview.json().errors).toHaveLength(2);
    expect(await countOf(customers)).toBe(0);
  });

  it("mahsulotlar: preview yozmaydi, keyin yoziladi", async () => {
    const rows = [{ name: "Choy", sku: "CHOY-1", unit: "d", salesPrice: "12000" }];
    const preview = await post("/api/catalog/products/import", { rows, dryRun: true });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json()).toMatchObject({ created: 0, valid: 1, dryRun: true });
    expect(await countOf(products)).toBe(0);

    expect((await post("/api/catalog/products/import", { rows })).json()).toMatchObject({ created: 1, dryRun: false });
    expect(await countOf(products)).toBe(1);
  });
});

describe("Dublikat nazorati (CREATE ONLY)", () => {
  it("mijoz — telefon bo'yicha; fayl ichidagi takror ham preview'da ko'rinadi", async () => {
    expect((await post("/api/sales/customers/import", { rows: [{ name: "Birinchi", phone: "+998 90 111 22 33" }] })).json()).toMatchObject({ created: 1 });

    // Bazadagi bilan bir xil telefon (boshqacha yozilgan) — dublikat
    const again = await post("/api/sales/customers/import", { rows: [{ name: "Ikkinchi", phone: "998901112233" }] });
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json()).toMatchObject({ created: 0, valid: 0 });
    expect(again.json().duplicates).toHaveLength(1);
    expect(await countOf(customers)).toBe(1);

    // Fayl ichida ikki marta uchragan telefon — ikkinchisi dublikat
    const inFile = await post("/api/sales/customers/import", {
      dryRun: true,
      rows: [{ name: "A", phone: "+998905550001" }, { name: "B", phone: "+998905550001" }],
    });
    expect(inFile.json()).toMatchObject({ valid: 1 });
    expect(inFile.json().duplicates).toHaveLength(1);
  });

  it("ta'minotchi — kod va STIR bo'yicha", async () => {
    expect(
      (await app.inject({
        method: "POST",
        url: "/api/purchase/suppliers",
        headers: { cookie: company.ownerCookie },
        payload: { name: "Eski", code: "S-100", taxId: "123456789" },
      })).statusCode,
    ).toBe(201);

    const res = await post("/api/purchase/suppliers/import", {
      rows: [
        { name: "Kod takror", code: "S-100" },
        { name: "STIR takror", code: "S-200", taxId: "123456789" },
        { name: "Yangi", code: "S-300" },
      ],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ created: 1, valid: 1 });
    expect(res.json().duplicates).toHaveLength(2);
    expect(res.json().errors).toHaveLength(0);
    expect(await countOf(suppliers)).toBe(2);
  });

  it("hodim — telefon bo'yicha", async () => {
    const rows = [{ name: "Ali Valiyev", hireDate: "2026-02-01", phone: "+998901234567" }];
    expect((await post("/api/hr/employees/import", { rows })).json()).toMatchObject({ created: 1 });

    const again = await post("/api/hr/employees/import", { rows });
    expect(again.json()).toMatchObject({ created: 0, valid: 0 });
    expect(again.json().duplicates).toHaveLength(1);
    expect(await countOf(employees)).toBe(1);
  });

  it("marshrut — nom bo'yicha", async () => {
    expect((await post("/api/distribution/routes/import", { rows: [{ name: "Chorsu", days: "1,3" }] })).json()).toMatchObject({ created: 1 });

    const again = await post("/api/distribution/routes/import", { rows: [{ name: " chorsu " }] });
    expect(again.json()).toMatchObject({ created: 0 });
    expect(again.json().duplicates).toHaveLength(1);
    expect(await countOf(distributionRoutes)).toBe(1);
  });

  it("xarajat — kategoriya, tavsif, summa va sana bo'yicha", async () => {
    const rows = [{ category: "ijara", description: "Ofis ijarasi", amount: "1 500 000", expenseDate: "2026-09-10" }];
    expect((await post("/api/finance/expenses/import", { rows })).json()).toMatchObject({ created: 1 });

    const again = await post("/api/finance/expenses/import", { rows });
    expect(again.json()).toMatchObject({ created: 0, valid: 0 });
    expect(again.json().duplicates).toHaveLength(1);
    expect(await countOf(expenses)).toBe(1);

    // Boshqa sanadagi xuddi shu xarajat — dublikat emas
    const other = await post("/api/finance/expenses/import", {
      rows: [{ category: "ijara", description: "Ofis ijarasi", amount: "1500000", expenseDate: "2026-10-10" }],
    });
    expect(other.json()).toMatchObject({ created: 1 });
  });

  it("mahsulot — SKU bo'yicha", async () => {
    const rows = [{ name: "Choy", sku: "CHOY-1", unit: "d", salesPrice: "12000" }];
    expect((await post("/api/catalog/products/import", { rows })).json()).toMatchObject({ created: 1 });

    const again = await post("/api/catalog/products/import", { rows });
    expect(again.json()).toMatchObject({ created: 0 });
    expect(again.json().duplicates).toHaveLength(1);
    expect(again.json().duplicates[0].message).toContain("SKU");
    expect(await countOf(products)).toBe(1);
  });
});
