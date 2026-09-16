/**
 * CSV eksport va import: mijozlar, ta'minotchilar, hodimlar va marshrutlar.
 *
 * Muhim qoidalar: import pul qiymatlarini (qarz, balans) o'zgartirmaydi; hodim importi login/parol yaratmaydi;
 * maxfiy ustunlar (pasport, INN, hisob raqami, maosh) eksportga faqat `hr.salary` ruxsati bilan qo'shiladi.
 */
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { users } from "../src/db/schema/platform.js";
import { customers } from "../src/db/schema/sales.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

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
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "CSV do'koni" });
});

const call = (cookie: string, method: "GET" | "POST", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
const owner = () => company.ownerCookie;

describe("CSV eksport va import", () => {
  it("mijozlar: to'g'ri qatorlar yoziladi, xatolari alohida qaytadi; eksportda BOM va sarlavha", async () => {
    const res = await call(owner(), "POST", "/api/sales/customers/import", {
      rows: [
        { name: "Do'kon A", phone: "+998901234567", partyType: "Yuridik shaxs", creditLimit: "1 000 000", paymentTermDays: "14" },
        { name: "", phone: "+998900000000" },
        { name: "Do'kon B", discountPercent: "150" },
      ],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ created: 1 });
    expect(res.json().errors).toHaveLength(2);
    expect(res.json().errors[0]).toMatchObject({ row: 2, message: "Nomi majburiy" });

    const [saved] = await db.select().from(customers).where(eq(customers.companyId, company.companyId));
    // Import pul qiymatlariga tegmaydi — qarz va balans nol
    expect(saved).toMatchObject({ name: "Do'kon A", partyType: "legal", creditLimit: "1000000.00", paymentTermDays: 14, totalDebt: "0.00", balance: "0.00" });

    const csv = await call(owner(), "GET", "/api/sales/customers/export");
    expect(csv.statusCode, csv.body).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    // Excel uchun UTF-8 BOM va CRLF
    expect(csv.body.startsWith("﻿")).toBe(true);
    expect(csv.body.split("\r\n")[0]).toContain("Nomi");
    expect(csv.body).toContain("Do'kon A");
  });

  it("ta'minotchilar: mavjud kod bilan qator rad etiladi, qolganlari yoziladi", async () => {
    expect((await call(owner(), "POST", "/api/purchase/suppliers", { name: "Eski", code: "S-100" })).statusCode).toBe(201);

    const res = await call(owner(), "POST", "/api/purchase/suppliers/import", {
      rows: [
        { name: "Yangi 1", code: "S-100" },
        { name: "Yangi 2", code: "S-200", paymentTermDays: "30", partyType: "Jismoniy shaxs" },
        { name: "Yangi 3" },
        { name: "Yangi 4", paymentTermDays: "-5" },
      ],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ created: 2 });
    expect(res.json().errors).toHaveLength(2);
    expect(res.json().errors[0].message).toContain("S-100");

    const csv = (await call(owner(), "GET", "/api/purchase/suppliers/export")).body;
    expect(csv).toContain("S-200");
    expect(csv).toContain("Yangi 3");
  });

  it("hodimlar: import login yaratmaydi; maosh ustunlari faqat hr.salary bilan", async () => {
    const usersBefore = (await db.select({ id: users.id }).from(users)).length;

    const res = await call(owner(), "POST", "/api/hr/employees/import", {
      rows: [
        { name: "Ali Valiyev", hireDate: "2026-01-15", baseSalary: "3 000 000", salaryType: "Oylik", gender: "Erkak" },
        { name: "Sanasiz Xodim" },
        { name: "Bo'limsiz", hireDate: "2026-02-01", department: "Yo'q bo'lim" },
      ],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ created: 1 });
    expect(res.json().errors).toHaveLength(2);
    // Fayldan login/parol o'qilmaydi — yangi foydalanuvchi yaratilmadi
    expect((await db.select({ id: users.id }).from(users)).length).toBe(usersBefore);

    const plain = await call(owner(), "GET", "/api/hr/employees/export");
    expect(plain.statusCode, plain.body).toBe(200);
    expect(plain.body).toContain("Ali Valiyev");
    expect(plain.body).not.toContain("Maosh");

    const full = await call(owner(), "GET", "/api/hr/employees/export?includeSalary=true");
    expect(full.statusCode, full.body).toBe(200);
    expect(full.body).toContain("Maosh");
    expect(full.body).toContain("3000000.00");

    // Kassirda hr.view yo'q
    const kassir = await addEmployee(app, company, "Kassir");
    expect((await call(kassir.cookie, "GET", "/api/hr/employees/export")).statusCode).toBe(403);
    expect((await call(kassir.cookie, "POST", "/api/hr/employees/import", { rows: [{ name: "X", hireDate: "2026-01-01" }] })).statusCode).toBe(403);
  });

  it("marshrutlar: kunlar tekshiriladi, noma'lum agent rad etiladi", async () => {
    const res = await call(owner(), "POST", "/api/distribution/routes/import", {
      rows: [
        { name: "Chorsu", days: "1,3,5", description: "Bozor atrofi" },
        { name: "Yakkasaroy", days: "9" },
        { name: "Sergeli", salesRep: "Yo'q agent" },
      ],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ created: 1 });
    expect(res.json().errors).toHaveLength(2);

    const csv = (await call(owner(), "GET", "/api/distribution/routes/export")).body;
    expect(csv).toContain("Chorsu");
    expect(csv).toContain("1 3 5");
  });
});
