/**
 * Ta'minotchi qarzi yoshi (aging) — kreditorlar subhisobidan FIFO. Mustaqil hisob:
 *  A (to'lov muddati 10 kun): qabul 60 kun oldin 100 000, 20 kun oldin 50 000, bugun 30 000; buyurtmasiz to'lov 120 000 va
 *  bugungi qabul to'liq qaytarildi (30 000) → kamayish jami 150 000 FIFO: 100 000 + 50 000 yopildi →
 *  ochiq: 30 000 (bugun → muddati kelmagan).
 *  B: tasdiqlangan (qabul qilinmagan) buyurtmaga 5 000 to'lov → avans 5 000.
 *  Invariant: guruhlar jami − avans = 2000 (kreditorlar) qoldig'i; boshqa kompaniya ma'lumoti ko'rinmaydi.
 */
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { accounts, cashAccounts } from "../src/db/schema/finance.js";
import { warehouses } from "../src/db/schema/inventory.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;
type Method = "GET" | "POST";
let app: FastifyInstance;
let company: Company;
let other: Company;
let piece: string;
let mainWh: string;

const call = (cookie: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
const n = (value: string | null | undefined) => Number(value ?? 0);
const today = () => new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);
const daysAgo = (days: number) => new Date(Date.now() + 5 * 3_600_000 - days * 86_400_000).toISOString().slice(0, 10);

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
  company = await createCompany(app, admin.cookie, { name: "Aging do'kon" });
  other = await createCompany(app, admin.cookie, { name: "Begona" });
  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  // Ta'minotchiga to'lash uchun kassaga kapitaldan naqd
  const cash = (await db.select().from(cashAccounts).where(and(eq(cashAccounts.companyId, company.companyId), eq(cashAccounts.isDefault, true))))[0]!.id;
  const capital = (await db.select().from(accounts).where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, "3000"))))[0]!.id;
  await call(company.ownerCookie, "POST", "/api/finance/cash-transactions", { cashAccountId: cash, type: "in", amount: "1000000", description: "Ochilish", counterAccountId: capital });
});

async function receiveAt(supplierId: string, productId: string, amount: number, date: string) {
  const created = await call(company.ownerCookie, "POST", "/api/purchase/orders", {
    supplierId,
    warehouseId: mainWh,
    orderDate: date,
    items: [{ productId, unitId: piece, orderedQty: "10", unitPrice: String(amount / 10), taxRate: "0" }],
  });
  expect(created.statusCode, created.body).toBe(201);
  const order = created.json().order as { id: string; items: { id: string }[] };
  expect((await call(company.ownerCookie, "POST", `/api/purchase/orders/${order.id}/confirm`)).statusCode).toBe(200);
  const received = await call(company.ownerCookie, "POST", `/api/purchase/orders/${order.id}/receipts`, { receiptDate: date, items: [{ orderItemId: order.items[0]!.id, receivedQty: "10" }] });
  expect(received.statusCode, received.body).toBe(201);
  return order;
}

describe("Ta'minotchi aging", () => {
  it("FIFO: to'lov va qaytarish eng eski qabulni yopadi; muddat bo'yicha guruh; avans; jami = 2000 qoldig'i; tenant", async () => {
    const product = (await call(company.ownerCookie, "POST", "/api/catalog/products", { name: "Un", sku: "UN", baseUnitId: piece, salesPrice: "20000", taxRate: "0" })).json().product.id as string;
    const a = (await call(company.ownerCookie, "POST", "/api/purchase/suppliers", { name: "A ta'minotchi", code: "A", paymentTermDays: 10 })).json().supplier.id as string;
    const b = (await call(company.ownerCookie, "POST", "/api/purchase/suppliers", { name: "B ta'minotchi", code: "B" })).json().supplier.id as string;

    await receiveAt(a, product, 100_000, daysAgo(60));
    await receiveAt(a, product, 50_000, daysAgo(20));
    const recent = await receiveAt(a, product, 30_000, today());
    const payA = await call(company.ownerCookie, "POST", "/api/purchase/payments", { supplierId: a, amount: "120000", method: "cash" });
    expect(payA.statusCode, payA.body).toBe(201);
    const back = await call(company.ownerCookie, "POST", `/api/purchase/orders/${recent.id}/returns`, { items: [{ orderItemId: recent.items[0]!.id, quantity: "10" }], reason: "Qaytarildi" });
    expect(back.statusCode, back.body).toBe(201);
    // 30 000 lik qabul to'liq qaytarildi (10 dona) — kamayish jami 150 000: 100 000 + 50 000 → A da ochiq 30 000 (bugun)
    // B: avans faqat buyurtmaga (tasdiqlangan, hali qabul qilinmagan)
    const orderB = await call(company.ownerCookie, "POST", "/api/purchase/orders", { supplierId: b, warehouseId: mainWh, orderDate: today(), items: [{ productId: product, unitId: piece, orderedQty: "1", unitPrice: "5000", taxRate: "0" }] });
    expect((await call(company.ownerCookie, "POST", `/api/purchase/orders/${orderB.json().order.id}/confirm`)).statusCode).toBe(200);
    const payB = await call(company.ownerCookie, "POST", "/api/purchase/payments", { supplierId: b, orderId: orderB.json().order.id, amount: "5000", method: "cash" });
    expect(payB.statusCode, payB.body).toBe(201);

    const res = await call(company.ownerCookie, "GET", "/api/purchase/suppliers-aging");
    expect(res.statusCode, res.body).toBe(200);
    const report = res.json() as { totals: Record<string, string>; suppliers: { id: string; current: string; d8_30: string; d31_60: string; total: string; advance: string; net: string }[] };
    const rowA = report.suppliers.find((row) => row.id === a)!;
    expect(rowA).toMatchObject({ current: "30000.00", d8_30: "0.00", d31_60: "0.00", total: "30000.00", advance: "0.00" });
    const rowB = report.suppliers.find((row) => row.id === b)!;
    expect(rowB).toMatchObject({ total: "0.00", advance: "5000.00", net: "-5000.00" });

    const payable = (await db.select().from(accounts).where(and(eq(accounts.companyId, company.companyId), eq(accounts.code, "2000"))))[0]!;
    expect(n(report.totals.net), "aging netto = 2000 qoldig'i").toBe(n(payable.balance));
    expect(n(report.totals.net)).toBe(25_000);

    // Tarixiy sana: 30 kun oldin — faqat 60 kunlik qabul (muddatdan 20 kun o'tgan)
    const past = (await call(company.ownerCookie, "GET", `/api/purchase/suppliers-aging?asOf=${daysAgo(30)}`)).json() as { suppliers: { id: string; d8_30: string; total: string }[] };
    expect(past.suppliers.find((row) => row.id === a)).toMatchObject({ d8_30: "100000.00", total: "100000.00" });

    // Begona kompaniya va ruxsatsiz xodim
    expect((await call(other.ownerCookie, "GET", "/api/purchase/suppliers-aging")).json().suppliers).toEqual([]);
    const cashier = await addEmployee(app, company, "Kassir");
    expect((await call(cashier.cookie, "GET", "/api/purchase/suppliers-aging")).statusCode).toBe(403);
  });
});
