/**
 * Distributsiya → Mijozlar: tezda qo'shish va import.
 *
 * Tekshiriladigan qoidalar:
 *   - "Tezda qo'shish" ham, fayl importi ham BITTA endpointdan o'tadi (`POST /api/sales/customers/import`),
 *     shuning uchun tekshiruv va dublikat qoidasi hamma joyda bir xil;
 *   - dublikat topilsa MAVJUD mijoz o'zgartirilmaydi va yangisi ochilmaydi (create-only);
 *   - "Hudud" va "Savdo agenti" parallel jadvalga emas, MAVJUD bog'lanishga (`route_customers`) tushadi;
 *   - tenant izolyatsiyasi: so'rov tanasidagi `companyId` ga ishonilmaydi, kontekst sessiyadan olinadi;
 *   - `dryRun` (preview) bazaga HECH NARSA yozmaydi.
 */
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { routeCustomers } from "../src/db/schema/crm.js";
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
  company = await createCompany(app, admin.cookie, { name: "Distribyutor" });
});

const call = (cookie: string, method: "GET" | "POST", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
const owner = () => company.ownerCookie;

/** Bitta mijozli "tezda qo'shish" so'rovi (telefon majburiy). */
const quickAdd = (row: Record<string, string>, cookie = owner()) =>
  call(cookie, "POST", "/api/sales/customers/import", { requirePhone: true, rows: [row] });

const importRows = (rows: Record<string, string>[], options: { dryRun?: boolean } = {}, cookie = owner()) =>
  call(cookie, "POST", "/api/sales/customers/import", { ...options, rows });

const savedCustomers = (companyId = company.companyId) =>
  db.select().from(customers).where(eq(customers.companyId, companyId));

/** Hudud + agent + marshrut zanjiri: mijoz shu marshrutga tushishi kerak. */
async function makeRoute(name: string, territoryName: string, repName: string) {
  const territory = await call(owner(), "POST", "/api/distribution/territories", { name: territoryName });
  expect(territory.statusCode, territory.body).toBe(201);
  const rep = await call(owner(), "POST", "/api/distribution/sales-reps", { name: repName });
  expect(rep.statusCode, rep.body).toBe(201);
  const route = await call(owner(), "POST", "/api/distribution/routes", {
    name,
    territoryId: territory.json().territory.id,
    salesRepId: rep.json().salesRep.id,
    days: [],
  });
  expect(route.statusCode, route.body).toBe(201);
  return { routeId: route.json().route.id as string, territoryName, repName };
}

describe("Distributsiya mijozlarini qo'shish", () => {
  it("1. tezda qo'shish: mijoz yaratiladi va o'z kompaniyasiga bog'lanadi", async () => {
    const res = await quickAdd({ name: "Anvar aka do'koni", phone: "+998901234567", contactName: "Anvar", address: "Urganch" });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ created: 1, errors: [], duplicates: [] });

    const [saved] = await savedCustomers();
    expect(saved).toMatchObject({
      name: "Anvar aka do'koni",
      contactName: "Anvar",
      address: "Urganch",
      companyId: company.companyId,
      // Import pulga tegmaydi
      totalDebt: "0.00",
      balance: "0.00",
    });
  });

  it("2. majburiy maydonlar: nomsiz va telefonsiz qator yozilmaydi", async () => {
    const noName = await quickAdd({ name: "", phone: "+998901110011" });
    expect(noName.json()).toMatchObject({ created: 0 });
    expect(noName.json().errors[0]).toMatchObject({ row: 1, message: "Nomi majburiy" });

    const noPhone = await quickAdd({ name: "Telefonsiz do'kon", phone: "" });
    expect(noPhone.json()).toMatchObject({ created: 0 });
    expect(noPhone.json().errors[0]).toMatchObject({ row: 1, message: "Telefon majburiy" });

    expect(await savedCustomers()).toHaveLength(0);

    // Fayl importida telefon MAJBURIY EMAS — eski xulq buzilmaydi
    const file = await importRows([{ name: "Telefonsiz do'kon" }]);
    expect(file.json()).toMatchObject({ created: 1 });
  });

  it("3. dublikat telefon: yangi mijoz ochilmaydi va mavjudi o'zgarmaydi", async () => {
    expect((await quickAdd({ name: "Birinchi", phone: "+998901234567", address: "Eski manzil" })).json()).toMatchObject({ created: 1 });

    // Telefon boshqacha yozilgan (bo'shliq, qavs, chiziqcha) — mavjud normalizatsiya faqat raqamlarni
    // solishtiradi, shuning uchun bu AYNAN o'sha raqam
    const again = await quickAdd({ name: "Ikkinchi", phone: "+998 (90) 123-45-67", address: "Yangi manzil" });
    expect(again.json()).toMatchObject({ created: 0, errors: [] });
    expect(again.json().duplicates[0].message).toContain("allaqachon mavjud");

    const rows = await savedCustomers();
    expect(rows).toHaveLength(1);
    // MAVJUD mijoz o'zgartirilmagan
    expect(rows[0]).toMatchObject({ name: "Birinchi", address: "Eski manzil" });
  });

  it("4. telefonsiz qatorlarda dublikat nom bo'yicha aniqlanadi", async () => {
    expect((await importRows([{ name: "Nomsizlar do'koni" }])).json()).toMatchObject({ created: 1 });
    const again = await importRows([{ name: "nomsizlar  DO'KONI" }]);
    expect(again.json()).toMatchObject({ created: 0 });
    expect(again.json().duplicates[0].message).toContain("allaqachon mavjud");
    expect(await savedCustomers()).toHaveLength(1);
  });

  it("5. preview (dryRun): bazaga hech narsa yozilmaydi, lekin hisob to'g'ri", async () => {
    await quickAdd({ name: "Mavjud", phone: "+998901112233" });

    const preview = await importRows(
      [
        { name: "Yangi 1", phone: "+998901000001" },
        { name: "Yangi 2", phone: "+998901000002" },
        { name: "Takror", phone: "+998901112233" },
        { name: "", phone: "+998901000003" },
      ],
      { dryRun: true },
    );
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json()).toMatchObject({ created: 0, valid: 2, dryRun: true });
    expect(preview.json().duplicates).toHaveLength(1);
    expect(preview.json().errors).toHaveLength(1);

    // Preview'dan keyin ham faqat birinchi mijoz turibdi
    expect(await savedCustomers()).toHaveLength(1);
  });

  it("6. 120 ta mijozni import qilish: hammasi yoziladi", async () => {
    const rows = Array.from({ length: 120 }, (_, index) => ({
      name: `Do'kon ${index + 1}`,
      phone: `+9989012${String(index).padStart(5, "0")}`,
    }));
    const res = await importRows(rows);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ created: 120, errors: [], duplicates: [] });
    expect(await savedCustomers()).toHaveLength(120);
  });

  it("7. xato qatorlar qator raqami va sababi bilan qaytadi, to'g'rilari yoziladi", async () => {
    const res = await importRows([
      { name: "To'g'ri", phone: "+998901234501" },
      { name: "", phone: "+998901234502" },
      { name: "Chegirmasi katta", phone: "+998901234503", discountPercent: "150" },
      { name: "Manfiy limit", phone: "+998901234504", creditLimit: "-5" },
      { name: "Uzoq muddat", phone: "+998901234505", paymentTermDays: "99999" },
    ]);
    expect(res.json()).toMatchObject({ created: 1 });
    const errors = res.json().errors as { row: number; message: string }[];
    expect(errors).toHaveLength(4);
    expect(errors.map((e) => e.row)).toEqual([2, 3, 4, 5]);
    expect(errors[0]!.message).toBe("Nomi majburiy");
    expect(errors[1]!.message).toContain("Chegirma");
    expect(errors[2]!.message).toContain("Kredit limiti");
    expect(errors[3]!.message).toContain("To'lov muddati");
  });

  it("8. hudud va savdo agenti: mijoz mos marshrutga biriktiriladi", async () => {
    const route = await makeRoute("Urganch-1", "Urganch", "Alisher Yusupov");

    const res = await quickAdd({
      name: "Marshrutli do'kon",
      phone: "+998901234599",
      territory: "urganch", // registr ahamiyatsiz
      salesRep: "Alisher Yusupov",
    });
    expect(res.json()).toMatchObject({ created: 1, warnings: [] });

    const [saved] = await savedCustomers();
    const members = await db
      .select()
      .from(routeCustomers)
      .where(and(eq(routeCustomers.companyId, company.companyId), eq(routeCustomers.customerId, saved!.id)));
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ routeId: route.routeId });
  });

  it("9. mos marshrut topilmasa mijoz baribir yaratiladi, ogohlantirish qaytadi", async () => {
    await makeRoute("Urganch-1", "Urganch", "Alisher Yusupov");

    const res = await quickAdd({ name: "Hududsiz do'kon", phone: "+998901234598", territory: "Xiva" });
    expect(res.json()).toMatchObject({ created: 1, errors: [], duplicates: [] });
    expect(res.json().warnings[0].message).toContain("Marshrut topilmadi");

    const [saved] = await savedCustomers();
    const members = await db.select().from(routeCustomers).where(eq(routeCustomers.customerId, saved!.id));
    expect(members).toHaveLength(0);
  });

  it("10. import boshqa tenantga ta'sir qilmaydi; tanadagi companyId e'tiborga olinmaydi", async () => {
    const admin = await signedIn(app, { isPlatformAdmin: true });
    const other = await createCompany(app, admin.cookie, { name: "Boshqa distribyutor" });
    expect((await call(other.ownerCookie, "POST", "/api/sales/customers/import", {
      requirePhone: true,
      rows: [{ name: "Begona do'kon", phone: "+998907770077" }],
    })).json()).toMatchObject({ created: 1 });

    // Birinchi kompaniya "begona" companyId bilan yozishga urinadi — strictObject uni rad etadi
    const spoof = await call(owner(), "POST", "/api/sales/customers/import", {
      requirePhone: true,
      rows: [{ name: "O'g'rincha", phone: "+998901234511", companyId: other.companyId }],
    });
    expect(spoof.statusCode).toBe(400);

    // Bir xil telefon ikki kompaniyada mustaqil: dublikat FAQAT kompaniya ichida tekshiriladi
    const same = await quickAdd({ name: "Shu telefon menda ham bor", phone: "+998907770077" });
    expect(same.json()).toMatchObject({ created: 1 });

    expect(await savedCustomers(company.companyId)).toHaveLength(1);
    expect(await savedCustomers(other.companyId)).toHaveLength(1);
    // Boshqa tenant mijozi o'zgarmagan
    const [theirs] = await savedCustomers(other.companyId);
    expect(theirs).toMatchObject({ name: "Begona do'kon" });
  });

  it("11. ruxsatsiz foydalanuvchi import qila olmaydi", async () => {
    const cashier = await addEmployee(app, company, "Kassir");
    const res = await call(cashier.cookie, "POST", "/api/sales/customers/import", {
      requirePhone: true,
      rows: [{ name: "Kassir do'koni", phone: "+998901234522" }],
    });
    expect(res.statusCode).toBe(403);
    expect(await savedCustomers()).toHaveLength(0);

    // Sessiyasiz ham yopiq
    const anon = await app.inject({ method: "POST", url: "/api/sales/customers/import", payload: { rows: [{ name: "X", phone: "+998901234533" }] } });
    expect(anon.statusCode).toBe(401);
  });

  it("12. qisman xato tranzaksiyani buzmaydi: to'g'ri qatorlar saqlanadi, xatolari yo'q", async () => {
    const before = await savedCustomers();
    expect(before).toHaveLength(0);

    const res = await importRows([
      { name: "Yaxshi 1", phone: "+998901234541" },
      { name: "", phone: "+998901234542" },
      { name: "Yaxshi 2", phone: "+998901234543" },
    ]);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ created: 2 });

    const after = await savedCustomers();
    expect(after.map((row) => row.name).sort()).toEqual(["Yaxshi 1", "Yaxshi 2"]);
    // Har bir mijozning kodi yagona (raqamlash buzilmagan)
    expect(new Set(after.map((row) => row.code)).size).toBe(2);
  });
});
