/**
 * TANNARXNI FAQAT EGA KO'RADI.
 *
 * Kompaniya egasining qarori: o'rtacha tannarx, ombor qiymati, sotuv qatorining tannarxi va ishlab
 * chiqarish narxi xodimlarga ko'rinmasligi kerak. Miqdor, zaxira, aylanma va holat ochiq qoladi —
 * ular ish uchun kerak va tannarxni oshkor qilmaydi.
 *
 * Ruxsat: `products.view_cost` — hech bir tayyor rolda yo'q (Direktorda ham), faqat to'liq
 * huquqlilarda (Business Owner, Superadmin). Ega uni kerakli xodimga rollar sozlamasidan beradi.
 *
 * Bu test `product-cost.test.ts` ni TAKRORLAMAYDI: u katalog (mahsulot kartochkasi, `/products/costs`)
 * yuzasini tekshiradi, bu esa ombor, analitika, sotuv va ishlab chiqarish yuzalarini.
 */
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_ROLES } from "@bum/shared";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { todayIso } from "../src/modules/finance/cash.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn, uniquePhone } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;
type Method = "GET" | "POST" | "PATCH";

let app: FastifyInstance;
let company: Company;
let warehouseId: string;
let orderId: string;

const call = (cookie: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

const stock = (cookie: string) => call(cookie, "GET", `/api/inventory/stock?warehouseId=${warehouseId}`);
const stockStats = (cookie: string) => call(cookie, "GET", `/api/inventory/stock/stats?warehouseId=${warehouseId}`);
const stockReport = (cookie: string) => call(cookie, "GET", "/api/analytics/reports/stock");
const orderDetail = (cookie: string) => call(cookie, "GET", `/api/sales/orders/${orderId}`);

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
  await resetDatabase();
  await db.delete(units);
  await seedDefaultUnits(db);
  const piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;

  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "TANNARX-TEST" });
  warehouseId = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;

  // Tannarxi 6 000, sotuv narxi 10 000 bo'lgan bitta mahsulot va bitta sotuv
  const productId = (
    await call(company.ownerCookie, "POST", "/api/catalog/products", {
      name: "Cola",
      sku: "COLA",
      baseUnitId: piece,
      salesPrice: "10000",
      taxRate: "0",
    })
  ).json().product.id as string;
  expect(
    (await call(company.ownerCookie, "POST", "/api/inventory/stock/movements", {
      type: "receive",
      productId,
      warehouseId,
      quantity: "100",
      costPrice: "6000",
    })).statusCode,
  ).toBe(201);

  const customerId = (
    await call(company.ownerCookie, "POST", "/api/sales/customers", { name: "Mijoz", phone: uniquePhone("95"), creditLimit: "0" })
  ).json().customer.id as string;
  orderId = (
    await call(company.ownerCookie, "POST", "/api/sales/orders", {
      customerId,
      warehouseId,
      orderDate: todayIso(),
      items: [{ productId, quantity: "10" }],
    })
  ).json().order.id as string;
  expect((await call(company.ownerCookie, "POST", `/api/sales/orders/${orderId}/confirm`)).statusCode).toBe(200);
  expect((await call(company.ownerCookie, "POST", `/api/sales/orders/${orderId}/ship`)).statusCode).toBe(200);
}, 180_000);

afterAll(async () => {
  await app.close();
  await closeDb();
});

describe("Tannarxni ko'rish ruxsati", () => {
  it("tannarx ruxsati faqat ega va superadminda — Direktorda ham yo'q", () => {
    const withCost = DEFAULT_ROLES.filter((role) => role.permissions.includes("products.view_cost")).map((role) => role.name);
    expect(withCost.sort(), "boshqa hech bir tayyor rolda bo'lmasligi kerak").toEqual(["Business Owner", "Superadmin"]);
  });

  it("ega omborda tannarx va ombor qiymatini ko'radi", async () => {
    const rows = (await stock(company.ownerCookie)).json().stock as { avgCostPrice: string | null }[];
    expect(rows[0]!.avgCostPrice).toBe("6000.0000");
    // 100 dona kelgan, 10 tasi sotilgan → 90 × 6 000 = 540 000
    expect((await stockStats(company.ownerCookie)).json().totalValue).toBe("540000.00");
  });

  it("ombor menejeri qoldiqni ko'radi, tannarx va ombor qiymatini KO'RMAYDI", async () => {
    const manager = await addEmployee(app, company, "Ombor menejeri");

    const list = await stock(manager.cookie);
    expect(list.statusCode, list.body).toBe(200);
    const row = (list.json().stock as { quantity: string; avgCostPrice: string | null }[])[0]!;
    expect(row.quantity, "qoldiq ish uchun kerak — ochiq").toBe("90.0000");
    expect(row.avgCostPrice, "tannarx yashirilgan").toBeNull();

    const stats = await stockStats(manager.cookie);
    expect(stats.statusCode).toBe(200);
    expect(stats.json().totalValue, "ombor qiymati = qoldiq × tannarx").toBeNull();
    expect(stats.json().totalItems, "mahsulot soni ochiq").toBe(1);
  });

  it("Direktor ham tannarxni ko'rmaydi", async () => {
    const director = await addEmployee(app, company, "Direktor");
    const row = ((await stock(director.cookie)).json().stock as { avgCostPrice: string | null }[])[0]!;
    expect(row.avgCostPrice).toBeNull();
    expect((await call(director.cookie, "GET", "/api/catalog/products/costs")).statusCode, "tannarx sahifasi yopiq").toBe(403);
  });

  it("analitikada ombor qiymati va ABC pul qiymati yashiriladi, ABC harfi qoladi", async () => {
    const ownerReport = (await stockReport(company.ownerCookie)).json();
    expect(ownerReport).toMatchObject({ costHidden: false });
    expect(ownerReport.totalValue).not.toBeNull();

    const accountant = await addEmployee(app, company, "Buxgalter");
    const body = (await stockReport(accountant.cookie)).json();
    expect(body.costHidden).toBe(true);
    expect(body.totalValue).toBeNull();
    expect(body.totalProducts, "SKU soni ochiq").toBe(1);
    for (const row of body.abcData as { value: string | null; abc: string }[]) {
      expect(row.value, "pul qiymati yashirilgan").toBeNull();
      expect(["A", "B", "C"], "ABC harfi ish uchun kerak — qoladi").toContain(row.abc);
    }
  });

  it("sotuv buyurtmasi qatorida tannarx yuborilmaydi", async () => {
    const ownerItems = (await orderDetail(company.ownerCookie)).json().order.items as { costPrice: string | null }[];
    expect(ownerItems[0]!.costPrice).toBe("6000.0000");

    const seller = await addEmployee(app, company, "Savdo menejeri");
    const res = await orderDetail(seller.cookie);
    expect(res.statusCode, res.body).toBe(200);
    const items = res.json().order.items as { costPrice: string | null; unitPrice: string }[];
    expect(items[0]!.costPrice, "tannarx yashirilgan").toBeNull();
    expect(items[0]!.unitPrice, "sotuv narxi ish uchun kerak — ochiq").toBe("10000.0000");
  });

  it("ega ruxsatni bersa — xodim tannarxni ko'ra boshlaydi", async () => {
    const manager = await addEmployee(app, company, "Ishlab chiqarish menejeri");
    const before = ((await stock(manager.cookie)).json().stock as { avgCostPrice: string | null }[])[0]!;
    expect(before.avgCostPrice, "boshida yopiq").toBeNull();

    const roles = (await call(company.ownerCookie, "GET", "/api/company/roles")).json().roles as {
      id: string;
      name: string;
      permissions: string[];
    }[];
    const role = roles.find((item) => item.name === "Ishlab chiqarish menejeri")!;
    const updated = await call(company.ownerCookie, "PATCH", `/api/company/roles/${role.id}`, {
      permissions: [...role.permissions, "products.view_cost"],
    });
    expect(updated.statusCode, updated.body).toBe(200);

    const after = ((await stock(manager.cookie)).json().stock as { avgCostPrice: string | null }[])[0]!;
    expect(after.avgCostPrice, "ruxsatdan keyin ochiq").toBe("6000.0000");
  });
});
