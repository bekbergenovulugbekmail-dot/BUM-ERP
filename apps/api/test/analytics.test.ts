import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
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
  company = await createCompany(app, admin.cookie, { name: "Tahlil kompaniyasi" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
});

const call = async (method: "GET" | "POST", url: string, payload?: object, cookie = company.ownerCookie) => {
  const res = await app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  return res;
};
const ok = async (method: "GET" | "POST", url: string, payload?: object) => {
  const res = await call(method, url, payload);
  expect(res.statusCode, `${method} ${url}: ${res.body}`).toBeLessThan(300);
  return res.json();
};

/**
 * Olma: 10 dona × 6000 kirim, minimal 8.
 * Anvarga 3 dona jo'natildi (30 000, 10 000 to'langan), mijozsiz 1 dona (10 000, to'liq).
 * Xarid buyurtmasi 5 000 (tasdiqlangan), xarajat 2 000 tasdiqlangan + 500 kutilmoqda, 1 xodim.
 */
async function seedBusiness() {
  const productId = (await ok("POST", "/api/catalog/products", {
    name: "Olma",
    sku: "OLMA",
    baseUnitId: piece,
    salesPrice: "10000",
    taxRate: "0",
    minStock: "8",
  })).product.id;
  await ok("POST", "/api/inventory/stock/movements", { type: "receive", productId, warehouseId: mainWh, quantity: "10", costPrice: "6000" });

  const customerId = (await ok("POST", "/api/sales/customers", { name: "Anvar" })).customer.id;
  const first = (await ok("POST", "/api/sales/orders", { customerId, warehouseId: mainWh, orderDate: today, items: [{ productId, quantity: "3" }] })).order.id;
  await ok("POST", `/api/sales/orders/${first}/confirm`);
  await ok("POST", `/api/sales/orders/${first}/ship`);
  await ok("POST", "/api/sales/payments", { orderId: first, amount: "10000" });

  const walkIn = (await ok("POST", "/api/sales/orders", { warehouseId: mainWh, orderDate: today, items: [{ productId, quantity: "1" }] })).order.id;
  await ok("POST", `/api/sales/orders/${walkIn}/confirm`);
  await ok("POST", "/api/sales/payments", { orderId: walkIn, amount: "10000" });
  await ok("POST", `/api/sales/orders/${walkIn}/ship`);

  const supplierId = (await ok("POST", "/api/purchase/suppliers", { name: "Bog'", code: "BOG" })).supplier.id;
  const purchase = (await ok("POST", "/api/purchase/orders", {
    supplierId,
    warehouseId: mainWh,
    orderDate: today,
    items: [{ productId, unitId: piece, orderedQty: "1", unitPrice: "5000" }],
  })).order.id;
  await ok("POST", `/api/purchase/orders/${purchase}/confirm`);

  const rent = (await ok("POST", "/api/finance/expenses", { category: "ijara", description: "Ijara", amount: "2000", expenseDate: today })).expense.id;
  await ok("POST", `/api/finance/expenses/${rent}/status`, { status: "approved" });
  await ok("POST", "/api/finance/expenses", { category: "boshqa", description: "Kutilmoqda", amount: "500", expenseDate: today });
  await ok("POST", "/api/hr/employees", { name: "Xodim", hireDate: "2020-01-01", baseSalary: "1000000", salaryType: "monthly" });
  return { productId, customerId };
}

describe("Bosh sahifa va hisobotlar", () => {
  it("ko'rsatkichlar faqat jo'natilgan savdodan, SQL yig'indilari bilan; ruxsat", async () => {
    await seedBusiness();

    const dashboard = await ok("GET", "/api/analytics/dashboard");
    expect(dashboard).toMatchObject({
      todaySalesCount: 2,
      todaySalesTotal: "40000.00",
      todayReceipts: "20000.00",
      monthRevenue: "40000.00",
      cogs: "24000.00",
      grossProfit: "16000.00",
      stockValue: "36000.00",
      lowStockCount: 1,
      supplierDebt: "0.00",
      customerDebt: "20000.00",
      cashBalance: "20000.00",
      bankBalance: "0.00",
    });
    expect(dashboard.lowStockItems[0]).toMatchObject({ productName: "Olma", quantity: "6.0000", minStock: "8.0000", unit: "d" });
    expect(dashboard.recentSales).toHaveLength(2);
    expect(dashboard.recentPurchases).toHaveLength(1);
    expect(dashboard.weeklyRevenue).toHaveLength(7);
    expect(dashboard.weeklyRevenue[6]).toEqual({ date: today, revenue: "40000.00" });

    const sales = await ok("GET", "/api/analytics/reports/sales?days=30");
    expect(sales).toMatchObject({ totalOrders: 2, totalRevenue: "40000.00", paidRevenue: "20000.00" });
    expect(sales.topProducts[0]).toMatchObject({ name: "Olma", quantity: "4.0000", revenue: "40000.00" });

    const stock = await ok("GET", "/api/analytics/reports/stock");
    expect(stock).toMatchObject({ totalProducts: 1, totalValue: "36000.00", lowStock: 1, outOfStock: 0 });
    expect(stock.abcData[0]).toMatchObject({ name: "Olma", abc: "A" });

    expect(await ok("GET", "/api/analytics/reports/expenses?days=30")).toEqual({
      total: "2000.00",
      byCategory: [{ category: "ijara", amount: "2000.00" }],
    });
    expect(await ok("GET", "/api/analytics/reports/purchases?days=30")).toMatchObject({
      totalOrders: 1,
      totalAmount: "5000.00",
      debtAmount: "5000.00",
    });
    expect(await ok("GET", "/api/analytics/reports/overview?days=30")).toMatchObject({
      revenue: "40000.00",
      cogs: "24000.00",
      grossProfit: "16000.00",
      expenses: "2000.00",
      netProfit: "14000.00",
      grossMargin: "40.00",
      orderCount: 2,
      customerCount: 1,
      employeeCount: 1,
      stockValue: "36000.00",
    });
    expect((await ok("GET", "/api/analytics/reports/top-customers?days=30&limit=5")).customers).toEqual([
      expect.objectContaining({ name: "Anvar", amount: "30000.00", orders: 1 }),
    ]);
    expect((await ok("GET", "/api/analytics/reports/stock-velocity?days=30")).products[0]).toMatchObject({
      stock: "6.0000",
      soldQty: "4.0000",
      daysOfStock: 45,
      velocity: "slow",
    });

    const kassir = await addEmployee(app, company, "Kassir");
    expect((await call("GET", "/api/analytics/dashboard", undefined, kassir.cookie)).statusCode).toBe(403);
    expect((await call("GET", "/api/analytics/reports/sales?days=0")).statusCode).toBe(400);
  });
});
