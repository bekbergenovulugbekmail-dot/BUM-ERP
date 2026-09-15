import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { auditLogs } from "../src/db/schema/platform.js";
import { posSyncConflicts } from "../src/db/schema/pos.js";
import { salesOrderItems, salesOrders } from "../src/db/schema/sales.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
let other: Company;
let piece: string;
let mainWh: string;

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
  company = await createCompany(app, admin.cookie, { name: "Do'kon" });
  other = await createCompany(app, admin.cookie, { name: "Boshqa do'kon" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
});

const call = (cookie: string, method: "GET" | "PUT" | "POST", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

type Change = { code: string; oldRate: string | null; rate: string; source: string; createdByName: string | null; deviceName: string | null };

describe("Valyuta kurslari: ruxsatlar, tarix, eski hujjat kursi, kassa sinxroni", () => {
  it("kursni o'zgartirish (currency_rates.manage), tarix (eski → yangi, kim), audit, eski savdo kursi o'zgarmaydi", async () => {
    const kassir = await addEmployee(app, company, "Kassir");
    const buxgalter = await addEmployee(app, company, "Buxgalter");
    expect((await call(company.ownerCookie, "PUT", "/api/finance/currencies", { cbuEnabled: false, currencies: [{ code: "USD", rate: "12500", source: "manual", isActive: true }] })).statusCode).toBe(200);

    // USD narxli mahsulot, birinchi savdo — kurs 12 500
    const product = await call(company.ownerCookie, "POST", "/api/catalog/products", {
      name: "Kofe",
      sku: "KOFE",
      baseUnitId: piece,
      salesPrice: "10",
      salesCurrency: "USD",
      taxRate: "0",
    });
    expect(product.statusCode).toBe(201);
    const productId = product.json().product.id as string;
    await call(company.ownerCookie, "POST", "/api/inventory/stock/movements", { type: "receive", productId, warehouseId: mainWh, quantity: "5", costPrice: "100000" });
    const shift = await call(company.ownerCookie, "POST", "/api/sales/pos/shifts", { warehouseId: mainWh, openingCash: "0" });
    const sell = async () => {
      const res = await call(company.ownerCookie, "POST", "/api/sales/pos/sales", { shiftId: shift.json().shift.id, items: [{ productId, quantity: "1" }], paymentMethod: "cash", amountPaid: "200000" });
      expect(res.statusCode).toBe(201);
      const [item] = await db.select().from(salesOrderItems).where(eq(salesOrderItems.orderId, res.json().order.id));
      return item!;
    };
    // 10 USD × 12 500 — sotuv lahzasidagi kurs bilan asosiy valyutada saqlanadi
    const first = await sell();
    expect(first).toMatchObject({ lineTotal: "125000.00" });

    // Ruxsatlar: kassir — faqat ko'radi; buxgalter — o'zgartiradi
    expect((await call(kassir.cookie, "PUT", "/api/finance/currencies/USD/rate", { rate: "12700" })).statusCode).toBe(403);
    const changed = await call(buxgalter.cookie, "PUT", "/api/finance/currencies/usd/rate", { rate: "12700" });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().currency).toMatchObject({ code: "USD", rate: "12700.0000", source: "manual" });
    expect((await call(buxgalter.cookie, "PUT", "/api/finance/currencies/UZS/rate", { rate: "2" })).statusCode).toBe(400);
    expect((await call(buxgalter.cookie, "PUT", "/api/finance/currencies/EUR/rate", { rate: "14000" })).statusCode).toBe(404);
    expect((await call(buxgalter.cookie, "PUT", "/api/finance/currencies/USD/rate", { rate: "0" })).statusCode).toBe(400);
    // Xuddi shu kurs — tarixga ikkinchi marta yozilmaydi
    expect((await call(buxgalter.cookie, "PUT", "/api/finance/currencies/USD/rate", { rate: "12700.0000" })).statusCode).toBe(200);

    const history = await call(kassir.cookie, "GET", "/api/finance/currencies/history?code=USD");
    expect(history.statusCode).toBe(200);
    expect(history.json().history as Change[]).toEqual([
      expect.objectContaining({ code: "USD", oldRate: "12500.0000", rate: "12700.0000", source: "manual", createdByName: "Buxgalter xodim", deviceName: null }),
      expect.objectContaining({ code: "USD", oldRate: null, rate: "12500.0000" }),
    ]);
    expect((await call(other.ownerCookie, "GET", "/api/finance/currencies/history")).json().history).toEqual([]);
    const [audit] = await db.select().from(auditLogs).where(and(eq(auditLogs.companyId, company.companyId), eq(auditLogs.action, "CURRENCY_RATE_CHANGED")));
    expect(audit!.details).toMatchObject({ code: "USD", oldRate: "12500.0000", newRate: "12700.0000" });

    // Yangi savdo — yangi kurs; eski savdo — o'z kursi (qayta hisoblanmaydi)
    expect(await sell()).toMatchObject({ lineTotal: "127000.00" });
    const [stillFirst] = await db.select().from(salesOrderItems).where(eq(salesOrderItems.id, first.id));
    expect(stillFirst).toMatchObject({ lineTotal: first.lineTotal, unitPrice: first.unitPrice });
    expect(await db.select().from(salesOrders).where(eq(salesOrders.companyId, company.companyId))).toHaveLength(2);
  });

  it("kassa: pull'da manba va kim o'zgartirgan; currency.rate (from/to) qo'llanadi yoki nomuvofiqlik; ruxsatsiz rad", async () => {
    const kassir = await addEmployee(app, company, "Kassir");
    await call(company.ownerCookie, "PUT", "/api/finance/currencies", { cbuEnabled: false, currencies: [{ code: "USD", rate: "12500", source: "manual", isActive: true }] });
    const registered = await app.inject({
      method: "POST",
      url: "/api/pos-device/setup/register",
      payload: { phone: company.owner.phone, password: company.owner.password, warehouseId: mainWh, name: "Kassa 1" },
    });
    const token = (registered.json() as { token: string }).token;
    const device = (method: "GET" | "POST", url: string, payload?: object) =>
      app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });
    // Ega kassada parol bilan kiradi (qurilma amallari bog'langan kassir nomidan)
    expect((await device("POST", "/api/pos-device/cashiers/login", { phone: company.owner.phone, password: company.owner.password })).statusCode).toBe(200);

    const pulled = await device("POST", "/api/pos-device/pull", {});
    expect(pulled.json().entities.currencies.rows).toEqual([
      expect.objectContaining({ code: "USD", rate: "12500.0000", source: "manual", updatedByName: company.owner.name, updatedAt: expect.any(String) }),
    ]);

    const op = (cashierId: string, from: string, to: string) => ({
      opId: randomUUID(),
      type: "currency.rate",
      cashierId,
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      payload: { code: "USD", from, to },
    });
    const push = async (ops: object[]) => (await device("POST", "/api/pos-device/push", { ops })).json().results as { status: string; result?: Record<string, unknown>; error?: { code: string } }[];

    const [applied] = await push([op(company.owner.id, "12500.0000", "12800")]);
    expect(applied).toMatchObject({ status: "applied", result: { code: "USD", applied: true, conflicts: [] } });
    // Orada web'da boshqa kurs qo'yilgan — server kursi qoladi, nomuvofiqlik
    const [stale] = await push([op(company.owner.id, "12500", "12900")]);
    expect(stale).toMatchObject({ status: "applied", result: { applied: false, conflicts: ["record_changed"] } });
    const [denied] = await push([op(kassir.id, "12800", "13000")]);
    expect(denied).toMatchObject({ status: "rejected", error: { code: "FORBIDDEN" } });

    expect((await call(company.ownerCookie, "GET", "/api/finance/currencies")).json().currencies[0]).toMatchObject({ rate: "12800.0000" });
    const conflicts = await db.select().from(posSyncConflicts).where(eq(posSyncConflicts.companyId, company.companyId));
    expect(conflicts).toEqual([expect.objectContaining({ kind: "record_changed", referenceType: "company_currency" })]);

    // Kassadagi tarix: kassir ruxsati bilan; qurilma nomi ko'rinadi. Kassir shu qurilmada parol bilan kirmagan — 403
    expect((await device("GET", `/api/pos-device/currencies/history?cashierId=${kassir.id}&code=USD`)).statusCode).toBe(403);
    expect((await device("POST", "/api/pos-device/cashiers/login", { phone: kassir.phone, password: "xodim-parol-123" })).statusCode).toBe(200);
    const deviceHistory = await device("GET", `/api/pos-device/currencies/history?cashierId=${kassir.id}&code=USD`);
    expect(deviceHistory.statusCode).toBe(200);
    expect(deviceHistory.json().history[0]).toMatchObject({ oldRate: "12500.0000", rate: "12800.0000", deviceName: "Kassa 1" });
  });
});
