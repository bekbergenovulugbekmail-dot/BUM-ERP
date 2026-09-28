/**
 * KPI va qaytarish (egasi qarori, 2026-09-28): KPI real sof natija bo'yicha.
 *   Sotuvchi / kassir / agent summasi = amalga oshgan sotuv − qaytarish; yetkazuvchi summasi = yetkazilgan − rad/qaytarish.
 *   Qaytarish QAYSI OYDA bo'lsa, shu oyda ayiriladi (asl sotuv o'tgan oyda bo'lsa ham) — o'tgan oy qiymati o'zgarmaydi.
 *   Qoralama/tasdiqlangan/bekor qilingan hujjat sotuv emas. Yig'ilgan to'lov — alohida, qaytarish ayirilmaydi.
 *   Hujjatsiz to'liq qaytarish (`returnOrder`) ham ayiriladi (avval sotuvchi KPI da ayirilmas edi).
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { employees } from "../src/db/schema/hr.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { agentOrders } from "../src/db/schema/sales-agent.js";
import { salesOrders } from "../src/db/schema/sales.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { todayIso } from "../src/modules/finance/cash.service.js";
import { employeeLinks, metricValue, type KpiMetric } from "../src/modules/hr/kpi.service.js";
import { buildServer } from "../src/server.js";
import { NO_PROOFS, agentAction, arrivedTask, deliveryAgent, deliveryCompany, near, resetUnits, setPolicy, startShift } from "./delivery-setup.js";
import { addEmployee, createCompany, resetDatabase, salesRepOf, signedIn } from "./helpers.js";

let app: FastifyInstance;
let company: Awaited<ReturnType<typeof createCompany>>;
let mainWh: string;
let productId: string;

const call = (method: "GET" | "POST" | "PATCH", url: string, payload?: object, cookie = company.ownerCookie) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
const month = () => todayIso().slice(0, 7);
const previousMonth = () => {
  const [y, m] = month().split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

async function employeeOf(companyId: string, userId: string) {
  const [row] = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.companyId, companyId), eq(employees.userId, userId)));
  return row!.id;
}
async function kpi(companyId: string, employeeId: string, metric: KpiMetric, forMonth = month()) {
  const [links] = await employeeLinks(db, companyId, [employeeId]);
  return Number(await metricValue(db, companyId, links!, metric, forMonth)) / 10_000;
}

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await closeDb();
});

describe("KPI — sof natija, qaytarish oyida", () => {
  beforeEach(async () => {
    await resetDatabase();
    await db.delete(units);
    await seedDefaultUnits(db);
    const piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
    const admin = await signedIn(app, { isPlatformAdmin: true });
    company = await createCompany(app, admin.cookie, { name: "KPI sof" });
    mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
    productId = (await call("POST", "/api/catalog/products", { name: "Non", sku: "NON", baseUnitId: piece, salesPrice: "5000", taxRate: "0" })).json().product.id;
    await call("POST", "/api/inventory/stock/movements", { type: "receive", productId, warehouseId: mainWh, quantity: "100", costPrice: "3000" });
  });

  it("kassir: sof summa (qisman va to'liq qaytarish ayiriladi), chek soni — amalga oshgan cheklar; o'tgan oy sotuvi qaytarilsa — joriy oyda", async () => {
    const cashier = await addEmployee(app, company, "Kassir");
    const employeeId = await employeeOf(company.companyId, cashier.id);
    const shift = (await call("POST", "/api/sales/pos/shifts", { warehouseId: mainWh }, cashier.cookie)).json().shift.id as string;
    const sell = async (quantity: string) => {
      const sale = await call("POST", "/api/sales/pos/sales", { shiftId: shift, items: [{ productId, quantity }], paymentMethod: "cash", amountPaid: String(Number(quantity) * 5000) }, cashier.cookie);
      expect(sale.statusCode, sale.body).toBe(201);
      return sale.json().order as { id: string; items: { id: string }[] };
    };
    const first = await sell("4"); // 20 000
    const second = await sell("2"); // 10 000
    const old = await sell("1"); // 5 000 — o'tgan oy sotuvi (sana o'zgartiriladi)
    await db.update(salesOrders).set({ orderDate: `${previousMonth()}-15` }).where(eq(salesOrders.id, old.id));
    expect(await kpi(company.companyId, employeeId, "cashier_sales_amount")).toBe(30_000);
    expect(await kpi(company.companyId, employeeId, "cashier_sales_amount", previousMonth())).toBe(5_000);

    // Qisman qaytarish 1 dona (5 000), to'liq qaytarish (10 000), o'tgan oy chekini joriy oyda qaytarish (5 000)
    expect((await call("POST", `/api/sales/orders/${first.id}/return-items`, { items: [{ orderItemId: first.items[0]!.id, quantity: "1" }], refundMethod: "cash" })).statusCode).toBeLessThan(300);
    expect((await call("POST", `/api/sales/orders/${second.id}/return`, { refund: true })).statusCode).toBe(200);
    expect((await call("POST", `/api/sales/orders/${old.id}/return`, { refund: true })).statusCode).toBe(200);

    expect(await kpi(company.companyId, employeeId, "cashier_sales_amount"), "30 000 − 5 000 − 10 000 − 5 000").toBe(10_000);
    expect(await kpi(company.companyId, employeeId, "cashier_receipt_count"), "amalga oshgan cheklar soni").toBe(2);
    expect(await kpi(company.companyId, employeeId, "cashier_sales_amount", previousMonth()), "o'tgan oy o'zgarmaydi").toBe(5_000);
  });

  it("sotuvchi: hujjatsiz to'liq qaytarish ham ayiriladi (sof savdo va yalpi foyda)", async () => {
    const seller = await addEmployee(app, company, "Kassir");
    const sellerEmployeeId = await employeeOf(company.companyId, seller.id);
    const shift = (await call("POST", "/api/sales/pos/shifts", { warehouseId: mainWh })).json().shift.id as string;
    const sale = async (quantity: string) =>
      (await call("POST", "/api/sales/pos/sales", { shiftId: shift, sellerEmployeeId, items: [{ productId, quantity }], paymentMethod: "cash", amountPaid: String(Number(quantity) * 5000) })).json().order as { id: string };
    await sale("3"); // 15 000, foyda 6 000
    const returned = await sale("2"); // 10 000, foyda 4 000
    expect(await kpi(company.companyId, sellerEmployeeId, "seller_sales_amount")).toBe(25_000);
    expect((await call("POST", `/api/sales/orders/${returned.id}/return`, { refund: true })).statusCode).toBe(200);
    expect(await kpi(company.companyId, sellerEmployeeId, "seller_sales_amount")).toBe(15_000);
    expect(await kpi(company.companyId, sellerEmployeeId, "seller_gross_profit")).toBe(6_000);
  });

  it("agent: qoralama/tasdiqlangan sotuv emas; to'liq qaytarish summa va sondan ayiriladi, qisman — faqat summadan; to'lov — alohida", async () => {
    const agent = await addEmployee(app, company, "Sotuv agenti");
    const repId = await salesRepOf(app, company.ownerCookie, agent.id);
    const employeeId = await employeeOf(company.companyId, agent.id);
    const customerId = (await call("POST", "/api/sales/customers", { name: "Do'kon" })).json().customer.id as string;
    const agentOrder = async (quantity: string, stage: "draft" | "confirmed" | "shipped") => {
      const order = (await call("POST", "/api/sales/orders", { customerId, warehouseId: mainWh, orderDate: todayIso(), items: [{ productId, quantity }] })).json().order as { id: string; items: { id: string }[] };
      await db.insert(agentOrders).values({ orderId: order.id, companyId: company.companyId, salesRepId: repId, customerId, clientRequestId: randomUUID() });
      if (stage !== "draft") expect((await call("POST", `/api/sales/orders/${order.id}/confirm`)).statusCode).toBe(200);
      if (stage === "shipped") expect((await call("POST", `/api/sales/orders/${order.id}/ship`)).statusCode).toBe(200);
      return order;
    };
    await agentOrder("10", "draft");
    await agentOrder("10", "confirmed");
    const a = await agentOrder("4", "shipped"); // 20 000
    const b = await agentOrder("2", "shipped"); // 10 000
    expect(await kpi(company.companyId, employeeId, "agent_sales_amount"), "faqat jo'natilgan").toBe(30_000);
    expect(await kpi(company.companyId, employeeId, "agent_order_count")).toBe(2);

    expect((await call("POST", `/api/sales/orders/${a.id}/return-items`, { items: [{ orderItemId: a.items[0]!.id, quantity: "1" }], refundMethod: "balance" })).statusCode).toBeLessThan(300);
    expect((await call("POST", `/api/sales/orders/${b.id}/return`, { refund: false })).statusCode).toBe(200);
    expect(await kpi(company.companyId, employeeId, "agent_sales_amount"), "30 000 − 5 000 − 10 000").toBe(15_000);
    expect(await kpi(company.companyId, employeeId, "agent_order_count"), "to'liq qaytarilgan buyurtma sondan chiqadi").toBe(1);
  });
});

describe("KPI — yetkazuvchi sof summasi", () => {
  it("10 dona buyurtma, 6 tasi topshirildi, 4 tasi rad: yetkazilgan summa 30 000 (50 000 − 20 000), son 1", async () => {
    await resetDatabase();
    await resetUnits();
    const admin = (await signedIn(app, { isPlatformAdmin: true })).cookie;
    const dc = await deliveryCompany(app, admin, "Yetkazish KPI");
    await setPolicy(app, dc.ownerCookie, NO_PROOFS);
    const agent = await deliveryAgent(app, dc);
    await startShift(app, agent.cookie);
    const { taskId } = await arrivedTask(app, dc, agent, "10");
    await agentAction(app, agent.cookie, taskId, "delivering");
    const view = await app.inject({ method: "GET", url: `/api/delivery/agent/tasks/${taskId}`, headers: { cookie: agent.cookie } });
    const item = (view.json().task.items as { id: string }[])[0]!;
    expect((await agentAction(app, agent.cookie, taskId, "confirm", { ...near(20), items: [{ taskItemId: item.id, deliveredQty: "6" }] })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/api/delivery/tasks/${taskId}/return`, headers: { cookie: dc.ownerCookie }, payload: { refundMethod: "balance", reason: "4 tasi olinmadi" } })).statusCode).toBe(200);

    const employeeId = await employeeOf(dc.companyId, agent.userId ?? agent.id);
    expect(await kpi(dc.companyId, employeeId, "delivery_amount")).toBe(30_000);
    expect(await kpi(dc.companyId, employeeId, "delivery_count")).toBe(1);
  });
});
