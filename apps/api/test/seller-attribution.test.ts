/**
 * SOTUVCHI (2026-09-27): chekda sotuvchi xodim — kassir (created_by), kassa, qurilmadan alohida; bir kassada ko'p sotuvchi.
 * Tekshiriladi: saqlanadi, begona/faol bo'lmagan xodim — rad, qaytarish sotuvchi sof savdosidan ayiriladi, KPI Rule Builder
 * `seller_*` ko'rsatkichlari mustaqil hisoblangan qiymatga teng, bonus qoidadan (qattiq kodsiz).
 */
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { employees } from "../src/db/schema/hr.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { users } from "../src/db/schema/platform.js";
import { salesOrders } from "../src/db/schema/sales.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;
type Method = "GET" | "POST" | "PUT" | "PATCH";

let app: FastifyInstance;
let company: Company;
let other: Company;
let mainWh: string;
let productId: string;

const call = (cookie: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
const n = (value: string | null | undefined) => Number(value ?? 0);
const month = () => new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 7);

async function employeeOf(companyId: string, phone: string) {
  const [row] = await db
    .select({ id: employees.id, userId: employees.userId })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .where(and(eq(employees.companyId, companyId), eq(users.phone, phone)));
  return row!;
}

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
  const piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "Bonnu Market" });
  other = await createCompany(app, admin.cookie, { name: "Begona" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  const product = await call(company.ownerCookie, "POST", "/api/catalog/products", { name: "Choy", sku: "CHOY", baseUnitId: piece, salesPrice: "10000", taxRate: "0" });
  productId = product.json().product.id;
  await call(company.ownerCookie, "POST", "/api/inventory/stock/movements", { type: "receive", productId, warehouseId: mainWh, quantity: "100", costPrice: "6000" });
});

describe("Sotuvchi", () => {
  it("chekda sotuvchi ≠ kassir, qaytarish ayiriladi, KPI qoidasi builder orqali", async () => {
    const ozoda = await addEmployee(app, company, "Kassir");
    const ali = await addEmployee(app, company, "Kassir");
    const sardor = await addEmployee(app, company, "Kassir");
    const [aliEmp, sardorEmp, ozodaEmp] = [await employeeOf(company.companyId, ali.phone), await employeeOf(company.companyId, sardor.phone), await employeeOf(company.companyId, ozoda.phone)];
    const shift = (await call(company.ownerCookie, "POST", "/api/sales/pos/shifts", { warehouseId: mainWh })).json().shift.id as string;

    const sellers = (await call(ozoda.cookie, "GET", "/api/sales/pos/sellers")).json().sellers as { id: string }[];
    expect(sellers.map((s) => s.id)).toEqual(expect.arrayContaining([aliEmp.id, sardorEmp.id]));

    const sell = (qty: string, seller?: string, discount?: string) =>
      call(company.ownerCookie, "POST", "/api/sales/pos/sales", {
        shiftId: shift,
        items: [{ productId, quantity: qty, ...(discount ? { discountPercent: discount } : {}) }],
        paymentMethod: "cash",
        amountPaid: String(Number(qty) * 10000),
        ...(seller ? { sellerEmployeeId: seller } : {}),
      });
    // Ali: 3 dona + 2 dona (10% chegirma), Sardor: 1 dona, sotuvchisiz: 1 dona
    const a1 = await sell("3", aliEmp.id);
    expect(a1.statusCode, a1.body).toBe(201);
    const a2 = await sell("2", aliEmp.id, "10");
    expect(a2.statusCode, a2.body).toBe(201);
    expect((await sell("1", sardorEmp.id)).statusCode).toBe(201);
    expect((await sell("1")).statusCode).toBe(201);

    // Kassir va sotuvchi alohida
    const [order] = await db.select().from(salesOrders).where(eq(salesOrders.id, a1.json().order.id));
    expect(order!.sellerEmployeeId).toBe(aliEmp.id);
    expect(order!.createdBy, "kassir — smenani ochgan rahbar, sotuvchi emas").toBe(company.owner.id);
    expect(ozodaEmp.id).not.toBe(aliEmp.id);

    // Begona kompaniya xodimi — 404
    const stranger = await addEmployee(app, other, "Kassir");
    const strangerEmp = await employeeOf(other.companyId, stranger.phone);
    expect((await sell("1", strangerEmp.id)).statusCode).toBe(404);

    // Qaytarish: Ali'ning birinchi chekidan 1 dona
    const detail = (await call(company.ownerCookie, "GET", `/api/sales/orders/${a1.json().order.id}`)).json();
    const itemId = (detail.order?.items ?? detail.items)[0].id as string;
    const ret = await call(company.ownerCookie, "POST", `/api/sales/orders/${a1.json().order.id}/return-items`, { items: [{ orderItemId: itemId, quantity: "1" }], refundMethod: "cash", shiftId: shift });
    expect([200, 201], ret.body).toContain(ret.statusCode);

    // Mustaqil hisob: Ali sotuv = 30 000 + 18 000 = 48 000, qaytarish 10 000, sof 38 000; tannarx (5−1)×6 000 = 24 000; YF 14 000
    const kpiRule = await call(company.ownerCookie, "PUT", "/api/hr/kpi/rules", {
      employeeId: aliEmp.id,
      metric: "seller_sales_amount",
      bonusType: "tiered",
      tiers: [{ fromValue: "0", toValue: null, rate: "2" }],
    });
    expect(kpiRule.statusCode, kpiRule.body).toBe(200);
    expect((await call(company.ownerCookie, "PUT", "/api/hr/kpi/rules", { employeeId: aliEmp.id, metric: "seller_gross_profit", bonusType: "tiered", tiers: [{ fromValue: "0", toValue: null, rate: "10" }] })).statusCode).toBe(200);
    expect((await call(company.ownerCookie, "PUT", "/api/hr/kpi/rules", { employeeId: aliEmp.id, metric: "seller_receipt_count", bonusType: "tiered", tiers: [{ fromValue: "0", toValue: null, rate: "500" }] })).statusCode).toBe(200);
    const preview = await call(company.ownerCookie, "GET", `/api/hr/kpi/preview?month=${month()}&employeeId=${aliEmp.id}`);
    expect(preview.statusCode, preview.body).toBe(200);
    const row = preview.json().employees[0] as { total: string; lines: { metric: string; metricValue: string; amount: string }[] };
    const line = (metric: string) => row.lines.find((l) => l.metric === metric)!;
    expect(n(line("seller_sales_amount").metricValue)).toBe(38000);
    expect(n(line("seller_sales_amount").amount)).toBe(760);
    expect(n(line("seller_gross_profit").metricValue)).toBe(14000);
    expect(n(line("seller_gross_profit").amount)).toBe(1400);
    expect(n(line("seller_receipt_count").metricValue)).toBe(2);
    expect(n(line("seller_receipt_count").amount)).toBe(1000);
    expect(n(row.total)).toBe(3160);

    // Sardor — boshqa sotuvchi, Ali'ning chekiga aralashmaydi
    await call(company.ownerCookie, "PUT", "/api/hr/kpi/rules", { employeeId: sardorEmp.id, metric: "seller_sales_amount", bonusType: "tiered", tiers: [{ fromValue: "0", toValue: null, rate: "1" }] });
    const sardorPreview = (await call(company.ownerCookie, "GET", `/api/hr/kpi/preview?month=${month()}&employeeId=${sardorEmp.id}`)).json().employees[0];
    expect(n(sardorPreview.lines[0].metricValue)).toBe(10000);
  });
});
