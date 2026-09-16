/**
 * Xarid hujjatlari (purchase orders) CSV eksport va import.
 *
 * Muhim qoidalar: import hujjatni **qoralama** holatida ochadi — ta'minotchi qarzi, ombor qoldig'i va buxgalteriya
 * yozuvlari o'zgarmaydi; takroriy hujjat raqami bloklanadi; `dryRun` (preview) bazaga hech narsa yozmaydi;
 * ruxsatsiz rol va begona kompaniya ma'lumoti yopiq.
 */
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { journalEntries } from "../src/db/schema/finance.js";
import { stockLevels, warehouses } from "../src/db/schema/inventory.js";
import { purchaseOrderItems, purchaseOrders, suppliers } from "../src/db/schema/purchase.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
let adminCookie: string;
let piece: string;
let mainWh: string;
let warehouseName: string;
let supplierId: string;
let productId: string;

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

const call = (cookie: string, method: "GET" | "POST", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
const owner = () => company.ownerCookie;

const orderCount = async () =>
  (await db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(eq(purchaseOrders.companyId, company.companyId))).length;
const supplierDebt = async () =>
  (await db.select({ totalDebt: suppliers.totalDebt }).from(suppliers).where(eq(suppliers.id, supplierId)))[0]!.totalDebt;

beforeEach(async () => {
  await resetDatabase();
  await db.delete(units);
  await seedDefaultUnits(db);
  piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
  const admin = await signedIn(app, { isPlatformAdmin: true });
  adminCookie = admin.cookie;
  company = await createCompany(app, adminCookie, { name: "Xarid do'koni" });
  const [warehouse] = await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId));
  mainWh = warehouse!.id;
  warehouseName = warehouse!.name;

  supplierId = (await call(owner(), "POST", "/api/purchase/suppliers", { name: "Ta'minotchi A", code: "S-1" })).json().supplier.id;
  productId = (await call(owner(), "POST", "/api/catalog/products", { name: "Shakar", sku: "SHK-1", baseUnitId: piece })).json().product.id;
});

describe("Xaridlar CSV: eksport", () => {
  it("hujjat qatorlari sarlavha, BOM va asosiy ustunlar bilan chiqadi", async () => {
    const created = await call(owner(), "POST", "/api/purchase/orders", {
      supplierId,
      warehouseId: mainWh,
      orderDate: "2026-09-10",
      items: [{ productId, unitId: piece, orderedQty: "10", unitPrice: "12000" }],
    });
    expect(created.statusCode, created.body).toBe(201);

    const csv = await call(owner(), "GET", "/api/purchase/orders/export");
    expect(csv.statusCode, csv.body).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.body.startsWith("﻿")).toBe(true);
    const header = csv.body.replace("﻿", "").split("\r\n")[0]!;
    expect(header).toContain("Hujjat raqami");
    expect(header).toContain("To'lov usuli");
    expect(csv.body).toContain("Shakar");
    expect(csv.body).toContain("Ta'minotchi A");
    expect(csv.body).toContain("Qoralama");
    expect(csv.body).toContain("2026-09-10");
  });

  it("kassirda xarid eksporti yopiq", async () => {
    const kassir = await addEmployee(app, company, "Kassir");
    expect((await call(kassir.cookie, "GET", "/api/purchase/orders/export")).statusCode).toBe(403);
    expect((await call(kassir.cookie, "POST", "/api/purchase/orders/import", { rows: [{ product: "SHK-1" }] })).statusCode).toBe(403);
  });
});

describe("Xaridlar CSV: import", () => {
  const rows = (overrides: Record<string, string> = {}) => [
    {
      number: "PO-IMPORT-1",
      orderDate: "2026-09-12",
      supplier: "Ta'minotchi A",
      warehouse: warehouseName,
      product: "SHK-1",
      quantity: "10",
      unit: "d",
      price: "12 000",
      ...overrides,
    },
    {
      number: "PO-IMPORT-1",
      orderDate: "2026-09-12",
      supplier: "Ta'minotchi A",
      warehouse: warehouseName,
      product: "Shakar",
      quantity: "5",
      price: "11500",
      ...overrides,
    },
  ];

  it("bir xil raqamli qatorlar bitta qoralama hujjatga birlashadi; pul va zaxira tegilmaydi", async () => {
    const journalsBefore = (await db.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.companyId, company.companyId))).length;

    const res = await call(owner(), "POST", "/api/purchase/orders/import", { rows: rows() });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ created: 1, documents: 1, dryRun: false });
    expect(res.json().errors).toHaveLength(0);

    const [order] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.companyId, company.companyId));
    expect(order).toMatchObject({ number: "PO-IMPORT-1", status: "draft", paidAmount: "0.00", orderDate: "2026-09-12" });
    const items = await db.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.orderId, order!.id));
    expect(items).toHaveLength(2);

    // Qoralama: qarz, ombor qoldig'i va jurnal o'zgarmaydi
    expect(await supplierDebt()).toBe("0.00");
    expect(await db.select().from(stockLevels).where(eq(stockLevels.companyId, company.companyId))).toHaveLength(0);
    const journalsAfter = (await db.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.companyId, company.companyId))).length;
    expect(journalsAfter).toBe(journalsBefore);
  });

  it("dryRun (preview): tekshiradi, lekin hech narsa yozmaydi", async () => {
    const before = await orderCount();
    const res = await call(owner(), "POST", "/api/purchase/orders/import", { rows: rows(), dryRun: true });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ created: 0, documents: 1, dryRun: true });
    expect(res.json().errors).toHaveLength(0);
    expect(await orderCount()).toBe(before);
  });

  it("takroriy hujjat raqami duplicate bo'lib qaytadi, yangi hujjat yaratilmaydi", async () => {
    expect((await call(owner(), "POST", "/api/purchase/orders/import", { rows: rows() })).json()).toMatchObject({ created: 1 });
    const before = await orderCount();

    const again = await call(owner(), "POST", "/api/purchase/orders/import", { rows: rows() });
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json()).toMatchObject({ created: 0 });
    expect(again.json().duplicates).toHaveLength(1);
    expect(again.json().duplicates[0].message).toContain("PO-IMPORT-1");
    expect(await orderCount()).toBe(before);
  });

  it("noma'lum ta'minotchi, ombor, mahsulot va noto'g'ri son — qator xatosi (yangi yozuv ochilmaydi)", async () => {
    const res = await call(owner(), "POST", "/api/purchase/orders/import", {
      rows: [
        { number: "A-1", orderDate: "2026-09-12", supplier: "Yo'q ta'minotchi", warehouse: warehouseName, product: "SHK-1", quantity: "1", price: "100" },
        { number: "A-2", orderDate: "2026-09-12", supplier: "Ta'minotchi A", warehouse: "Yo'q ombor", product: "SHK-1", quantity: "1", price: "100" },
        { number: "A-3", orderDate: "2026-09-12", supplier: "Ta'minotchi A", warehouse: warehouseName, product: "YO'Q-SKU", quantity: "1", price: "100" },
        { number: "A-4", orderDate: "2026-09-12", supplier: "Ta'minotchi A", warehouse: warehouseName, product: "SHK-1", quantity: "0", price: "100" },
        { number: "A-5", supplier: "Ta'minotchi A", warehouse: warehouseName, product: "SHK-1", quantity: "1", price: "100" },
      ],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ created: 0 });
    expect(res.json().errors).toHaveLength(5);
    expect(await orderCount()).toBe(0);
    // Import yangi ta'minotchi yoki mahsulot ochmaydi
    expect((await db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.companyId, company.companyId))).length).toBe(1);
  });

  it("begona kompaniya ta'minotchisi bilan import o'tmaydi", async () => {
    const other = await createCompany(app, adminCookie, { name: "Begona kompaniya" });
    expect((await call(other.ownerCookie, "POST", "/api/purchase/suppliers", { name: "Begona ta'minotchi", code: "B-1" })).statusCode).toBe(201);

    const res = await call(owner(), "POST", "/api/purchase/orders/import", {
      rows: [{ number: "X-1", orderDate: "2026-09-12", supplier: "Begona ta'minotchi", warehouse: warehouseName, product: "SHK-1", quantity: "1", price: "100" }],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ created: 0 });
    expect(res.json().errors[0].message).toContain("Ta'minotchi topilmadi");
    expect(await orderCount()).toBe(0);
  });

  it("raqamsiz qatorlar alohida hujjat bo'ladi", async () => {
    const res = await call(owner(), "POST", "/api/purchase/orders/import", {
      rows: [
        { orderDate: "2026-09-12", supplier: "S-1", warehouse: warehouseName, product: "SHK-1", quantity: "2", price: "500" },
        { orderDate: "2026-09-12", supplier: "S-1", warehouse: warehouseName, product: "SHK-1", quantity: "3", price: "500" },
      ],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ created: 2, documents: 2 });
    expect(await orderCount()).toBe(2);

    const all = await db
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.companyId, company.companyId), eq(purchaseOrders.status, "draft")));
    expect(all).toHaveLength(2);
  });
});
