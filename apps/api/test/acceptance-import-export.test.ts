/**
 * QABUL TESTI — import va eksport (API + baza darajasida; brauzer UI emas).
 *
 * Har ro'yxat uchun: eksportda BOM va sarlavha, importda to'g'ri qator yoziladi, xato qator sababi bilan qaytadi,
 * takroriy kod rad etiladi, qisman muvaffaqiyatli import ishlaydi, 500 qator chegarasi hurmat qilinadi va
 * qayta import qilish mumkin. Alohida: hodim importi foydalanuvchi/login yaratmaydi, import pulga tegmaydi.
 */
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { cashAccounts } from "../src/db/schema/finance.js";
import { users } from "../src/db/schema/platform.js";
import { licenses } from "../src/db/schema/subscription.js";
import { customers } from "../src/db/schema/sales.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;

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
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Import do'koni" });
});

const call = (cookie: string, method: "GET" | "POST", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
const owner = () => company.ownerCookie;

/** Eksport javobi: 200, CSV sarlavhasi, UTF-8 BOM va ustun nomlari. */
async function expectExport(url: string, header: string, mustContain: string[]) {
  const res = await call(owner(), "GET", url);
  expect(res.statusCode, `${url}: ${res.body}`).toBe(200);
  expect(res.headers["content-type"]).toContain("text/csv");
  expect(res.headers["content-disposition"]).toContain("attachment");
  expect(res.body.startsWith("﻿"), `${url}: BOM yo'q`).toBe(true);
  const firstLine = res.body.replace("﻿", "").split("\r\n")[0]!;
  expect(firstLine).toContain(header);
  for (const text of mustContain) expect(res.body).toContain(text);
  return res.body;
}

describe("QABUL: eksport (CSV)", () => {
  it("mahsulotlar, mijozlar, yetkazuvchilar, hodimlar, marshrutlar va xarajatlar eksporti", async () => {
    const piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
    expect((await call(owner(), "POST", "/api/catalog/products", { name: "Choy", sku: "CHOY-1", baseUnitId: piece, salesPrice: "12000" })).statusCode).toBe(201);
    expect((await call(owner(), "POST", "/api/sales/customers", { name: "Do'kon A" })).statusCode).toBe(201);
    expect((await call(owner(), "POST", "/api/purchase/suppliers", { name: "Ta'minotchi A", code: "S-1" })).statusCode).toBe(201);
    expect((await call(owner(), "POST", "/api/hr/employees", { name: "Ali Valiyev", hireDate: "2026-01-15", baseSalary: "3000000", salaryType: "monthly" })).statusCode).toBe(201);
    expect((await call(owner(), "POST", "/api/distribution/routes", { name: "Chorsu", days: [1, 3] })).statusCode).toBe(201);
    expect((await call(owner(), "POST", "/api/finance/expenses", { category: "ijara", description: "Ofis", amount: "500000", expenseDate: "2026-09-10" })).statusCode).toBe(201);

    await expectExport("/api/catalog/products/export", "Nomi", ["Choy", "CHOY-1"]);
    await expectExport("/api/sales/customers/export", "Nomi", ["Do'kon A"]);
    await expectExport("/api/purchase/suppliers/export", "Nomi", ["Ta'minotchi A", "S-1"]);
    await expectExport("/api/hr/employees/export", "Ism-familiya", ["Ali Valiyev"]);
    await expectExport("/api/distribution/routes/export", "Nomi", ["Chorsu", "1 3"]);
    await expectExport("/api/finance/expenses/export", "Raqam", ["Ofis", "Kutilmoqda"]);
  });
});

describe("QABUL: import (CSV qatorlari)", () => {
  it("mijozlar: to'g'ri qator yoziladi, xato qator sababi bilan qaytadi, takroriy telefon dublikat", async () => {
    const first = await call(owner(), "POST", "/api/sales/customers/import", {
      rows: [
        { name: "Mijoz 1", phone: "+998901111111" },
        { name: "", phone: "+998902222222" },
        { name: "Mijoz 3", discountPercent: "150" },
      ],
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toMatchObject({ created: 1 });
    expect(first.json().errors).toHaveLength(2);
    expect(first.json().errors[0]).toMatchObject({ row: 2 });

    // Qayta import — bir xil telefon dublikat sifatida bloklanadi (ikkita bir xil mijoz yaratilmaydi)
    const second = await call(owner(), "POST", "/api/sales/customers/import", { rows: [{ name: "Mijoz 1", phone: "+998901111111" }] });
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json()).toMatchObject({ created: 0 });
    expect(second.json().duplicates).toHaveLength(1);

    const list = (await call(owner(), "GET", "/api/sales/customers")).json().customers as { name: string }[];
    expect(list.filter((row) => row.name === "Mijoz 1")).toHaveLength(1);
  });

  it("500 qator chegarasi: 500 — o'tadi, 501 — rad etiladi", async () => {
    const row = (index: number) => ({ name: `Ommaviy mijoz ${index}` });
    const ok = await call(owner(), "POST", "/api/sales/customers/import", {
      rows: Array.from({ length: 500 }, (_, index) => row(index)),
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ created: 500 });

    const tooMany = await call(owner(), "POST", "/api/sales/customers/import", {
      rows: Array.from({ length: 501 }, (_, index) => row(index)),
    });
    expect(tooMany.statusCode).toBe(400);

    const saved = await db.select({ id: customers.id }).from(customers).where(eq(customers.companyId, company.companyId));
    expect(saved).toHaveLength(500);
  });

  it("yetkazuvchilar: fayldagi va bazadagi takroriy kod rad etiladi, qolgani yoziladi", async () => {
    expect((await call(owner(), "POST", "/api/purchase/suppliers", { name: "Eski", code: "S-100" })).statusCode).toBe(201);
    const res = await call(owner(), "POST", "/api/purchase/suppliers/import", {
      rows: [
        { name: "Bazada bor", code: "S-100" },
        { name: "Yangi", code: "S-200" },
        { name: "Fayl ichida takror", code: "S-200" },
      ],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ created: 1 });
    // Ikkalasi ham dublikat: biri bazadagi kod, ikkinchisi fayl ichidagi takror
    expect(res.json().duplicates).toHaveLength(2);
    for (const duplicate of res.json().duplicates) expect(duplicate.message).toContain("kodli ta'minotchi");
    expect(res.json().errors).toHaveLength(0);
  });

  it("hodimlar: import foydalanuvchi, login, parol, PIN va litsenziya yaratmaydi", async () => {
    const usersBefore = (await db.select({ id: users.id }).from(users)).length;
    const licensesBefore = (await db.select({ id: licenses.id }).from(licenses)).length;

    const res = await call(owner(), "POST", "/api/hr/employees/import", {
      rows: [
        { name: "Hodim 1", hireDate: "2026-02-01", baseSalary: "2500000", salaryType: "Oylik" },
        { name: "Sanasiz" },
      ],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ created: 1 });
    expect(res.json().errors).toHaveLength(1);

    expect((await db.select({ id: users.id }).from(users)).length).toBe(usersBefore);
    expect((await db.select({ id: licenses.id }).from(licenses)).length).toBe(licensesBefore);

    const employees = (await call(owner(), "GET", "/api/hr/employees")).json().employees as { name: string; loginPhone: string | null }[];
    const imported = employees.find((row) => row.name === "Hodim 1")!;
    expect(imported.loginPhone).toBeNull();
  });

  it("import pul qiymatlariga tegmaydi: kassa, bank va mijoz balansi o'zgarmaydi", async () => {
    const before = await db.select({ id: cashAccounts.id, balance: cashAccounts.balance }).from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId));

    expect((await call(owner(), "POST", "/api/sales/customers/import", { rows: [{ name: "Balans mijozi", creditLimit: "5000000" }] })).statusCode).toBe(200);
    expect((await call(owner(), "POST", "/api/purchase/suppliers/import", { rows: [{ name: "Balans ta'minotchisi" }] })).statusCode).toBe(200);
    expect((await call(owner(), "POST", "/api/finance/expenses/import", { rows: [{ category: "ijara", description: "Import xarajati", amount: "900000", expenseDate: "2026-09-11" }] })).statusCode).toBe(200);

    const after = await db.select({ id: cashAccounts.id, balance: cashAccounts.balance }).from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId));
    expect(after).toEqual(before);

    const [customer] = await db.select().from(customers).where(eq(customers.companyId, company.companyId));
    expect(customer).toMatchObject({ totalDebt: "0.00", balance: "0.00", cashbackBalance: "0.00" });
  });

  it("marshrutlar va xarajatlar: noto'g'ri qator sababi bilan, to'g'risi yoziladi", async () => {
    const routes = await call(owner(), "POST", "/api/distribution/routes/import", {
      rows: [
        { name: "Sergeli", days: "1,3,5" },
        { name: "Xato kun", days: "9" },
      ],
    });
    expect(routes.statusCode, routes.body).toBe(200);
    expect(routes.json()).toMatchObject({ created: 1 });
    expect(routes.json().errors).toHaveLength(1);

    const expenses = await call(owner(), "POST", "/api/finance/expenses/import", {
      rows: [
        { category: "transport", description: "Yoqilg'i", amount: "300000", expenseDate: "2026-09-12" },
        { category: "transport", description: "Summasiz", amount: "0", expenseDate: "2026-09-12" },
      ],
    });
    expect(expenses.statusCode, expenses.body).toBe(200);
    expect(expenses.json()).toMatchObject({ created: 1 });
    expect(expenses.json().errors).toHaveLength(1);
  });
});
