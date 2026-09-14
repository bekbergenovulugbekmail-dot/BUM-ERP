import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { notifications } from "../src/db/schema/notifications.js";
import { withTransaction } from "../src/db/transaction.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { generateSmartAlerts } from "../src/modules/notifications/notifications.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
let other: Company;
let piece: string;
let mainWh: string;

const today = new Date().toISOString().slice(0, 10);

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
  company = await createCompany(app, admin.cookie, { name: "Bildirishnoma kompaniyasi" });
  other = await createCompany(app, admin.cookie, { name: "Boshqa kompaniya" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
});

type Method = "GET" | "POST" | "DELETE";
const call = (method: Method, url: string, cookie = company.ownerCookie, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
const notif = (method: Method, url: string, cookie = company.ownerCookie, payload?: object) =>
  call(method, `/api/notifications${url}`, cookie, payload);

async function ok(method: Method, url: string, payload?: object) {
  const res = await call(method, url, company.ownerCookie, payload);
  expect(res.statusCode, `${method} ${url}: ${res.body}`).toBeLessThan(300);
  return res.statusCode === 204 ? null : res.json();
}

const unread = async (cookie: string) => (await notif("GET", "/unread-count", cookie)).json().count as number;
const titles = async (cookie: string) =>
  ((await notif("GET", "/", cookie)).json().notifications as { title: string }[]).map((n) => n.title).sort();

describe("Bildirishnomalar", () => {
  it("global bildirishnomaning o'qilgan/yopilgan holati har foydalanuvchida alohida; shaxsiy — faqat egasiga", async () => {
    const kassir = await addEmployee(app, company, "Kassir");

    const global = await notif("POST", "/", company.ownerCookie, { title: "Yig'ilish", message: "Soat 10 da", link: "/uz/hr" });
    expect(global.statusCode).toBe(201);
    const globalId = global.json().notification.id;
    expect((await notif("POST", "/", kassir.cookie, { title: "Spam", message: "X" })).statusCode).toBe(403);
    expect((await notif("POST", "/", company.ownerCookie, { title: "X", message: "X", link: "https://evil.example" })).statusCode).toBe(400);
    expect((await notif("POST", "/", company.ownerCookie, { title: "X", message: "X", link: "//evil.example" })).statusCode).toBe(400);
    expect((await notif("POST", "/", company.ownerCookie, { title: "X", message: "X", userId: other.owner.id })).statusCode).toBe(400);

    const personal = await notif("POST", "/", company.ownerCookie, { title: "Shaxsiy", message: "Faqat kassirga", userId: kassir.id, severity: "warning" });
    expect(personal.json().notification.isGlobal).toBe(false);

    expect(await titles(kassir.cookie)).toEqual(["Shaxsiy", "Yig'ilish"]);
    expect(await titles(company.ownerCookie)).toEqual(["Yig'ilish"]);
    expect(await titles(other.ownerCookie)).toEqual([]);

    expect(await unread(kassir.cookie)).toBe(2);
    expect((await notif("POST", `/${globalId}/read`, kassir.cookie)).statusCode).toBe(204);
    expect(await unread(kassir.cookie)).toBe(1);
    expect(await unread(company.ownerCookie)).toBe(1);

    expect((await notif("DELETE", `/${globalId}`, kassir.cookie)).statusCode).toBe(204);
    expect(await titles(kassir.cookie)).toEqual(["Shaxsiy"]);
    expect(await titles(company.ownerCookie)).toEqual(["Yig'ilish"]);

    expect((await notif("POST", "/read-all", kassir.cookie)).statusCode).toBe(204);
    expect(await unread(kassir.cookie)).toBe(0);
    expect((await notif("POST", "/clear-read", kassir.cookie)).statusCode).toBe(204);
    expect(await titles(kassir.cookie)).toEqual([]);
    expect(await unread(company.ownerCookie)).toBe(1);

    expect((await notif("POST", `/${globalId}/read`, other.ownerCookie)).statusCode).toBe(404);
    const [stored] = await db.select().from(notifications).where(eq(notifications.id, globalId));
    expect(stored!.isRead).toBe(false);
  });

  it("aqlli ogohlantirishlar: kam zaxira, muddat, kechikkan xarid, muddati o'tgan to'lov, ta'til, xarajat; dublikat va cheklov", async () => {
    const productId = (await ok("POST", "/api/catalog/products", { name: "Sut", sku: "SUT", baseUnitId: piece, salesPrice: "1000", taxRate: "0", minStock: "5" })).product.id;
    await ok("POST", "/api/inventory/stock/movements", { type: "receive", productId, warehouseId: mainWh, quantity: "2", costPrice: "700" });
    const inTen = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    await ok("POST", `/api/catalog/products/${productId}/batches`, { batchNumber: "B-1", expiryDate: inTen, quantity: "2", unitId: piece, warehouseId: mainWh });

    const customerId = (await ok("POST", "/api/sales/customers", { name: "Qarzdor", paymentTermDays: 0 })).customer.id;
    const order = (await ok("POST", "/api/sales/orders", { customerId, warehouseId: mainWh, orderDate: "2020-01-01", items: [{ productId, quantity: "1" }] })).order.id;
    await ok("POST", `/api/sales/orders/${order}/confirm`);
    await ok("POST", `/api/sales/orders/${order}/ship`);

    const supplierId = (await ok("POST", "/api/purchase/suppliers", { name: "Sutchi", code: "S-1" })).supplier.id;
    const purchase = (await ok("POST", "/api/purchase/orders", {
      supplierId,
      warehouseId: mainWh,
      orderDate: "2020-01-01",
      expectedDate: "2020-01-02",
      items: [{ productId, unitId: piece, orderedQty: "1", unitPrice: "700" }],
    })).order.id;
    await ok("POST", `/api/purchase/orders/${purchase}/confirm`);

    await ok("POST", "/api/finance/expenses", { category: "boshqa", description: "Tozalash", amount: "300", expenseDate: today });
    const employeeId = (await ok("POST", "/api/hr/employees", { name: "Dilnoza", hireDate: "2020-01-01", baseSalary: "1", salaryType: "monthly" })).employee.id;
    await ok("POST", "/api/hr/leaves", { employeeId, type: "annual", startDate: "2030-01-01", endDate: "2030-01-05" });

    const kassir = await addEmployee(app, company, "Kassir");
    const refreshed = await notif("POST", "/refresh", kassir.cookie);
    expect(refreshed.json()).toEqual({
      created: 6,
      throttled: false,
      byType: { low_stock: 1, expiring_soon: 1, system: 1, overdue_payment: 1, leave_request: 1, pending_approval: 1 },
    });
    expect((await notif("POST", "/refresh", company.ownerCookie)).json()).toMatchObject({ created: 0, throttled: true });
    expect(await withTransaction((tx) => generateSmartAlerts(tx, company.companyId))).toEqual({ created: 0, byType: {} });

    const lowStock = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.companyId, company.companyId), eq(notifications.type, "low_stock")));
    expect(lowStock[0]).toMatchObject({ severity: "warning", link: "/warehouse", isGlobal: true });
    expect(lowStock[0]!.message).toContain("1 (minimal: 5)");
    // Ega hammasini ko'radi; kassir faqat ruxsati bor bo'limlar ogohlantirishini (xarid, ta'til, xarajat unga yashirin)
    expect(await unread(company.ownerCookie)).toBe(6);
    const kassirTypes = ((await notif("GET", "/", kassir.cookie)).json().notifications as { type: string }[]).map((item) => item.type).sort();
    expect(kassirTypes).not.toContain("pending_approval");
    expect(kassirTypes).not.toContain("leave_request");
    expect(await unread(kassir.cookie)).toBe(kassirTypes.length);
    expect(kassirTypes.length).toBeLessThan(6);
    expect(await unread(other.ownerCookie)).toBe(0);
  });
});
