/**
 * AUD-025 — hisobotlarda tushum va qarz bitta ta'rifda: faqat yakunlangan sotuv, qaytarilgani chegirilgan.
 *  Yakunlangan 3 × 10 000 (to'lanmagan), 1 tasi qaytarildi (balansga) → sof 20 000, qarz 20 000.
 *  Qoralama 5 × 10 000 va tasdiqlangan (jo'natilmagan) 2 × 10 000 — tushum ham, qarz ham EMAS.
 *  Tekshiriladi: moliya dashboardi (oy savdosi), Telegram kunlik xulosa va qarzdorlar hisoboti; qarz = mijoz keshi.
 *  Valyutali kassa: analitika dashboardi 100 $ ni kurs bilan (1 250 000) qo'shadi — moliya dashboardi bilan teng.
 */
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { customers } from "../src/db/schema/sales.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { todayIso } from "../src/modules/finance/cash.service.js";
import { dailySummary, debtorsReport } from "../src/modules/telegram/owner-reports.service.js";
import { buildServer } from "../src/server.js";
import { createCompany, resetDatabase, signedIn } from "./helpers.js";

let app: FastifyInstance;
let company: Awaited<ReturnType<typeof createCompany>>;
let piece: string;
let mainWh: string;

const call = (method: "GET" | "POST" | "PUT", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie: company.ownerCookie }, ...(payload ? { payload } : {}) });

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
  company = await createCompany(app, admin.cookie, { name: "Hisobot ta'rifi" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
});

describe("AUD-025 hisobot ta'riflari", () => {
  it("qoralama/tasdiqlangan tushum va qarz emas; qisman qaytarish chegiriladi", async () => {
    const today = todayIso();
    const productId = (await call("POST", "/api/catalog/products", { name: "Choy", sku: "CH", baseUnitId: piece, salesPrice: "10000", taxRate: "0" })).json().product.id as string;
    await call("POST", "/api/inventory/stock/movements", { type: "receive", productId, warehouseId: mainWh, quantity: "20", costPrice: "6000" });
    const customerId = (await call("POST", "/api/sales/customers", { name: "Qarzdor" })).json().customer.id as string;
    const order = async (quantity: string) =>
      (await call("POST", "/api/sales/orders", { customerId, warehouseId: mainWh, orderDate: today, items: [{ productId, quantity }] })).json().order as { id: string; items: { id: string }[] };

    const sold = await order("3");
    expect((await call("POST", `/api/sales/orders/${sold.id}/confirm`)).statusCode).toBe(200);
    expect((await call("POST", `/api/sales/orders/${sold.id}/ship`)).statusCode).toBe(200);
    const back = await call("POST", `/api/sales/orders/${sold.id}/return-items`, { items: [{ orderItemId: sold.items[0]!.id, quantity: "1" }], refundMethod: "balance" });
    expect(back.statusCode, back.body).toBeLessThan(300);
    await order("5");
    const confirmed = await order("2");
    expect((await call("POST", `/api/sales/orders/${confirmed.id}/confirm`)).statusCode).toBe(200);

    const [row] = await db.select().from(customers).where(and(eq(customers.companyId, company.companyId), eq(customers.id, customerId)));
    expect(row!.totalDebt, "mijoz keshi").toBe("20000.00");

    const dashboard = (await call("GET", "/api/finance/dashboard")).json();
    expect(dashboard.monthSalesTotal, "oy savdosi — faqat yakunlangan, sof").toBe("20000.00");

    const summary = await dailySummary(db, company.companyId, new Date(`${today}T12:00:00Z`));
    expect(summary).toMatch(/Savdo: <b>20\D000 so'm<\/b> · 1 ta chek/);
    expect(summary).toMatch(/qarzga: 20\D000 so'm/);

    const debtors = await debtorsReport(db, company.companyId);
    expect(debtors).toMatch(/jami 20\D000 so'm/);
    expect(debtors).toMatch(/Qarzdor — 20\D000 so'm/);
  });

  it("valyutali kassa analitika dashboardida kurs bilan qo'shiladi", async () => {
    const rate = await call("PUT", "/api/finance/currencies", { cbuEnabled: false, currencies: [{ code: "USD", rate: "12500", source: "manual", isActive: true }] });
    expect(rate.statusCode, rate.body).toBe(200);
    const usd = await call("POST", "/api/finance/cash-accounts", { name: "Dollar kassa", type: "cash", currency: "USD", openingBalance: "100" });
    expect(usd.statusCode, usd.body).toBe(201);

    const analytics = (await call("GET", "/api/analytics/dashboard")).json();
    const finance = (await call("GET", "/api/finance/dashboard")).json();
    expect(analytics.cashBalance, "100 $ × 12 500").toBe("1250000.00");
    expect(analytics.cashBalance).toBe(finance.totalCash);
  });
});
