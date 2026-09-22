/**
 * Backorder reyestri: mijozga va'da qilingan, lekin band qilinmagan tovar ko'rinadi; tovar kelganda
 * eng eski buyurtmadan boshlab avtomatik band qilinadi.
 *
 * Invariantlar har qadamdan keyin: `reserved_qty <= quantity`, `remaining >= 0`, ikki marta band
 * qilish yo'q, boshqa tenant qatorlariga tegilmaydi.
 */
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { stockLevels, warehouses } from "../src/db/schema/inventory.js";
import { salesOrderItems } from "../src/db/schema/sales.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { todayIso } from "../src/modules/finance/cash.service.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn, uniquePhone } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;
type Method = "GET" | "POST" | "PATCH";

let app: FastifyInstance;
let company: Company;
let other: Company;
let piece: string;
let cola: string;
let fanta: string;
let mainWh: string;
let secondWh: string;
let supplierId: string;
let customerA: string;
let customerB: string;

const call = (cookie: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

const money = (value: string | number | null | undefined) => Number(value ?? 0);
const shift = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** Qoldiq invarianti — har tekshiruvdan keyin. */
async function stockOf(productId: string, warehouseId = mainWh) {
  const [row] = await db
    .select({ quantity: stockLevels.quantity, reserved: stockLevels.reservedQty })
    .from(stockLevels)
    .where(and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, warehouseId)));
  const quantity = money(row?.quantity);
  const reserved = money(row?.reserved);
  expect(quantity, "qoldiq manfiy").toBeGreaterThanOrEqual(0);
  expect(reserved, "reserved_qty > quantity").toBeLessThanOrEqual(quantity);
  return { quantity, reserved };
}

const backorders = async (query = "") => (await call(company.ownerCookie, "GET", `/api/inventory/backorders${query}`)).json();

/** Qo'lda ERP buyurtmasi — `best_effort` siyosati (qoldiq yetmasa oldindan buyurtma). */
async function order(customerId: string, lines: { productId: string; quantity: string }[], orderDate = todayIso(), warehouseId = mainWh) {
  const created = await call(company.ownerCookie, "POST", "/api/sales/orders", {
    customerId,
    warehouseId,
    orderDate,
    items: lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
  });
  expect(created.statusCode, created.body).toBe(201);
  const orderId = created.json().order.id as string;
  const confirmed = await call(company.ownerCookie, "POST", `/api/sales/orders/${orderId}/confirm`);
  expect(confirmed.statusCode, confirmed.body).toBe(200);
  return orderId;
}

/** Xarid: hujjat → tasdiq → qabul (tovar keladi). */
async function receive(productId: string, quantity: string, warehouseId = mainWh) {
  const created = await call(company.ownerCookie, "POST", "/api/purchase/orders", {
    supplierId,
    warehouseId,
    orderDate: todayIso(),
    items: [{ productId, unitId: piece, orderedQty: quantity, unitPrice: "6000" }],
  });
  expect(created.statusCode, created.body).toBe(201);
  const purchase = created.json().order as { id: string; items: { id: string }[] };
  expect((await call(company.ownerCookie, "POST", `/api/purchase/orders/${purchase.id}/confirm`)).statusCode).toBe(200);
  const receipt = await call(company.ownerCookie, "POST", `/api/purchase/orders/${purchase.id}/receipts`, {
    receiptDate: todayIso(),
    items: [{ orderItemId: purchase.items[0]!.id, receivedQty: quantity }],
  });
  expect(receipt.statusCode, receipt.body).toBe(201);
  return purchase.id;
}

const reservedOf = async (orderId: string, productId: string) =>
  money(
    (
      await db
        .select({ reserved: salesOrderItems.reservedQty })
        .from(salesOrderItems)
        .where(and(eq(salesOrderItems.orderId, orderId), eq(salesOrderItems.productId, productId)))
    )[0]!.reserved,
  );

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
}, 120_000);

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
  company = await createCompany(app, admin.cookie, { name: "BACKORDER-CO" });
  other = await createCompany(app, admin.cookie, { name: "BACKORDER-OUTSIDER" });
  expect((await call(company.ownerCookie, "POST", "/api/finance/setup")).statusCode).toBe(200);

  mainWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  secondWh = (await call(company.ownerCookie, "POST", "/api/inventory/warehouses", { name: "Ikkinchi ombor", code: "WH2" })).json().warehouse.id;

  cola = (
    await call(company.ownerCookie, "POST", "/api/catalog/products", { name: "Cola 1L", sku: "COLA", baseUnitId: piece, salesPrice: "10000", taxRate: "0" })
  ).json().product.id;
  fanta = (
    await call(company.ownerCookie, "POST", "/api/catalog/products", { name: "Fanta 1L", sku: "FANTA", baseUnitId: piece, salesPrice: "9000", taxRate: "0" })
  ).json().product.id;

  supplierId = (await call(company.ownerCookie, "POST", "/api/purchase/suppliers", { name: "Ta'minotchi", phone: uniquePhone("94") })).json().supplier.id;
  customerA = (await call(company.ownerCookie, "POST", "/api/sales/customers", { name: "Mijoz A", phone: uniquePhone("95"), creditLimit: "0" })).json().customer.id;
  customerB = (await call(company.ownerCookie, "POST", "/api/sales/customers", { name: "Mijoz B", phone: uniquePhone("95"), creditLimit: "0" })).json().customer.id;
});

describe("Backorder reyestri", () => {
  it("qoldiq yetarli — backorder yo'q", async () => {
    expect(
      (await call(company.ownerCookie, "POST", "/api/inventory/stock/movements", { type: "receive", productId: cola, warehouseId: mainWh, quantity: "100", costPrice: "6000" }))
        .statusCode,
    ).toBe(201);
    const orderId = await order(customerA, [{ productId: cola, quantity: "40" }]);

    expect((await backorders()).items, "hammasi band qilindi").toHaveLength(0);
    expect(await reservedOf(orderId, cola)).toBe(40);
    expect(await stockOf(cola)).toMatchObject({ quantity: 100, reserved: 40 });
  });

  it("qoldiq yetmaydi — qolgani backorder bo'lib ko'rinadi", async () => {
    expect(
      (await call(company.ownerCookie, "POST", "/api/inventory/stock/movements", { type: "receive", productId: cola, warehouseId: mainWh, quantity: "60", costPrice: "6000" }))
        .statusCode,
    ).toBe(201);
    const orderId = await order(customerA, [{ productId: cola, quantity: "100" }]);

    const report = await backorders();
    expect(report.items).toHaveLength(1);
    expect(report.items[0]).toMatchObject({
      orderId,
      productId: cola,
      customerId: customerA,
      ordered: "100.0000",
      reserved: "60.0000",
      remaining: "40.0000",
      status: "partially_allocated",
      warehouseId: mainWh,
    });
    expect(report.totals).toMatchObject({ lines: 1, remaining: "40.0000" });
    await stockOf(cola);

    // Umuman qoldiq yo'q mahsulot — `open`
    await order(customerB, [{ productId: fanta, quantity: "25" }]);
    const withFanta = await backorders();
    expect(withFanta.items.find((row: { productId: string }) => row.productId === fanta)).toMatchObject({
      reserved: "0.0000",
      remaining: "25.0000",
      status: "open",
    });
    expect((await backorders("?status=open")).items).toHaveLength(1);
    expect((await backorders(`?productId=${cola}`)).items).toHaveLength(1);
    expect((await backorders(`?customerId=${customerB}`)).items).toHaveLength(1);
  });

  it("yo'ldagi xarid ko'rsatiladi — soxta ETA yo'q", async () => {
    await order(customerA, [{ productId: cola, quantity: "50" }]);
    expect((await backorders()).items[0].inbound, "ochiq xarid yo'q").toBe("0.0000");

    const created = await call(company.ownerCookie, "POST", "/api/purchase/orders", {
      supplierId,
      warehouseId: mainWh,
      orderDate: todayIso(),
      items: [{ productId: cola, unitId: piece, orderedQty: "200", unitPrice: "6000" }],
    });
    const purchaseId = created.json().order.id as string;
    expect((await backorders()).items[0].inbound, "qoralama hisoblanmaydi").toBe("0.0000");
    expect((await call(company.ownerCookie, "POST", `/api/purchase/orders/${purchaseId}/confirm`)).statusCode).toBe(200);
    expect((await backorders()).items[0].inbound, "tasdiqlangan xarid ko'rinadi").toBe("200.0000");
  });

  it("tovar kelganda eng eski buyurtmadan boshlab avtomatik band qilinadi", async () => {
    const oldest = await order(customerA, [{ productId: cola, quantity: "60" }], shift(-3));
    const newest = await order(customerB, [{ productId: cola, quantity: "50" }], shift(-1));
    expect((await backorders()).totals.remaining).toBe("110.0000");

    // 80 dona keldi: eng eskisiga 60, keyingisiga 20
    await receive(cola, "80");

    expect(await reservedOf(oldest, cola), "eng eski to'liq").toBe(60);
    expect(await reservedOf(newest, cola), "keyingisi qisman").toBe(20);
    expect(await stockOf(cola)).toMatchObject({ quantity: 80, reserved: 80 });

    const after = await backorders();
    expect(after.items, "faqat qolgan qator").toHaveLength(1);
    expect(after.items[0]).toMatchObject({ orderId: newest, remaining: "30.0000", status: "partially_allocated" });

    // Qolgani kelganda yopiladi
    await receive(cola, "30");
    expect(await reservedOf(newest, cola)).toBe(50);
    expect((await backorders()).items, "backorder yopildi").toHaveLength(0);
    expect(await stockOf(cola)).toMatchObject({ quantity: 110, reserved: 110 });
  });

  it("qo'lda kirim ham backorderni yopadi va takroriy band qilmaydi", async () => {
    const orderId = await order(customerA, [{ productId: fanta, quantity: "30" }]);
    expect(
      (await call(company.ownerCookie, "POST", "/api/inventory/stock/movements", { type: "receive", productId: fanta, warehouseId: mainWh, quantity: "30", costPrice: "5000" }))
        .statusCode,
    ).toBe(201);
    expect(await reservedOf(orderId, fanta)).toBe(30);
    expect((await backorders()).items).toHaveLength(0);

    // Qayta taqsimlash — ikkinchi marta band qilmaydi
    const again = await call(company.ownerCookie, "POST", "/api/inventory/backorders/allocate", { warehouseId: mainWh });
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json().allocations, "taqsimlanadigan qator yo'q").toHaveLength(0);
    expect(await stockOf(fanta)).toMatchObject({ quantity: 30, reserved: 30 });
  });

  it("omborlar aralashmaydi", async () => {
    const mainOrder = await order(customerA, [{ productId: cola, quantity: "40" }], todayIso(), mainWh);
    const secondOrder = await order(customerB, [{ productId: cola, quantity: "25" }], todayIso(), secondWh);

    await receive(cola, "100", secondWh);
    expect(await reservedOf(secondOrder, cola), "ikkinchi ombor buyurtmasi band qilindi").toBe(25);
    expect(await reservedOf(mainOrder, cola), "asosiy ombor buyurtmasiga tegilmadi").toBe(0);

    expect((await backorders(`?warehouseId=${mainWh}`)).items).toHaveLength(1);
    expect((await backorders(`?warehouseId=${secondWh}`)).items).toHaveLength(0);
    await stockOf(cola, secondWh);
  });

  it("bekor qilingan buyurtma reyestrdan chiqadi va zaxirani bo'shatadi", async () => {
    expect(
      (await call(company.ownerCookie, "POST", "/api/inventory/stock/movements", { type: "receive", productId: cola, warehouseId: mainWh, quantity: "30", costPrice: "6000" }))
        .statusCode,
    ).toBe(201);
    const orderId = await order(customerA, [{ productId: cola, quantity: "100" }]);
    expect((await backorders()).items).toHaveLength(1);
    expect(await stockOf(cola)).toMatchObject({ reserved: 30 });

    const cancelled = await call(company.ownerCookie, "POST", `/api/sales/orders/${orderId}/cancel`, { reason: "Mijoz voz kechdi" });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect((await backorders()).items, "bekor qilingan reyestrda yo'q").toHaveLength(0);
    expect(await stockOf(cola), "zaxira bo'shadi").toMatchObject({ quantity: 30, reserved: 0 });
  });

  it("jo'natilgan buyurtma reyestrda qolmaydi", async () => {
    expect(
      (await call(company.ownerCookie, "POST", "/api/inventory/stock/movements", { type: "receive", productId: cola, warehouseId: mainWh, quantity: "50", costPrice: "6000" }))
        .statusCode,
    ).toBe(201);
    const orderId = await order(customerA, [{ productId: cola, quantity: "50" }]);
    expect((await call(company.ownerCookie, "POST", `/api/sales/orders/${orderId}/ship`)).statusCode).toBe(200);
    expect((await backorders()).items).toHaveLength(0);
    expect(await stockOf(cola)).toMatchObject({ quantity: 0, reserved: 0 });
  });

  it("xavfsizlik: tenant izolyatsiyasi va ruxsat", async () => {
    await order(customerA, [{ productId: cola, quantity: "40" }]);

    expect((await call(other.ownerCookie, "GET", "/api/inventory/backorders")).json().items, "begona tenant ko'rmaydi").toHaveLength(0);
    expect((await call(other.ownerCookie, "GET", `/api/inventory/backorders?customerId=${customerA}`)).json().items).toHaveLength(0);
    expect(
      (await call(other.ownerCookie, "POST", "/api/inventory/backorders/allocate", { warehouseId: mainWh })).statusCode,
      "begona ombor",
    ).toBeGreaterThanOrEqual(400);

    // Kassirda `warehouse.view` bor — reyestrni ko'radi, lekin band qilish (`warehouse.receive`) yo'q
    const cashier = await addEmployee(app, company, "Kassir");
    expect((await call(cashier.cookie, "GET", "/api/inventory/backorders")).statusCode).toBe(200);
    expect((await call(cashier.cookie, "POST", "/api/inventory/backorders/allocate", { warehouseId: mainWh })).statusCode, "band qilish ruxsati yo'q").toBe(403);

    // Ruxsatsiz rol umuman ko'rmaydi
    const hr = await addEmployee(app, company, "HR menejeri");
    expect((await call(hr.cookie, "GET", "/api/inventory/backorders")).statusCode).toBe(403);

    expect((await call(company.ownerCookie, "POST", "/api/inventory/backorders/allocate", { warehouseId: mainWh, companyId: other.companyId })).statusCode).toBe(400);
    expect((await call(company.ownerCookie, "GET", "/api/inventory/backorders?warehouseId=not-a-uuid")).statusCode).toBe(400);

    // Begona tenantdagi tovar kelishi bu kompaniyaning backorderiga tegmaydi
    const [before] = await db
      .select({ total: sql<string>`coalesce(sum(${salesOrderItems.reservedQty}), 0)::numeric(18,4)` })
      .from(salesOrderItems)
      .where(eq(salesOrderItems.companyId, company.companyId));
    const foreignProduct = (
      await call(other.ownerCookie, "POST", "/api/catalog/products", { name: "Begona", sku: "X1", baseUnitId: piece, salesPrice: "1000", taxRate: "0" })
    ).json().product.id;
    const foreignWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, other.companyId)))[0]!.id;
    expect(
      (await call(other.ownerCookie, "POST", "/api/inventory/stock/movements", { type: "receive", productId: foreignProduct, warehouseId: foreignWh, quantity: "500", costPrice: "100" }))
        .statusCode,
    ).toBe(201);
    const [after] = await db
      .select({ total: sql<string>`coalesce(sum(${salesOrderItems.reservedQty}), 0)::numeric(18,4)` })
      .from(salesOrderItems)
      .where(eq(salesOrderItems.companyId, company.companyId));
    expect(after!.total, "begona kirim bizning zaxiraga tegmaydi").toBe(before!.total);
  });
});
