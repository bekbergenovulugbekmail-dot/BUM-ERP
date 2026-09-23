/**
 * IMPORT AUDITI: dona / blok / pachka va narxlar Excel'dan aniq tushishi kerak.
 *
 * Eng xavfli xato — son formati: "10,500" ni 10.5 deb o'qish narxni 1000 barobar buzadi.
 * Ikkinchisi — qadoq: 10 blokni 10 dona qilib yuborish. Uchinchisi — konversiyaning ikki marta
 * qo'llanishi. Shu uchtasi va butun zanjir (import → xarid → qoldiq → tannarx → sotuv → marja)
 * shu yerda tekshiriladi.
 */
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { products, unitConversions, units } from "../src/db/schema/catalog.js";
import { cashAccounts } from "../src/db/schema/finance.js";
import { stockLevels, warehouses } from "../src/db/schema/inventory.js";
import { salesOrderItems } from "../src/db/schema/sales.js";
import { seedDefaultUnits } from "../src/modules/catalog/units.service.js";
import { todayIso } from "../src/modules/finance/cash.service.js";
import { cleanNumber } from "../src/shared/csv.js";
import { buildServer } from "../src/server.js";
import { addEmployee, createCompany, resetDatabase, signedIn, uniquePhone } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;
type Method = "GET" | "POST" | "PATCH";

let app: FastifyInstance;
let company: Company;
let other: Company;
let piece: string;
let box: string;
let pack: string;
let warehouseId: string;
let cashAccountId: string;
let supplierId: string;

const call = (cookie: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

const money = (value: string | number | null | undefined) => Number(value ?? 0);

const importProducts = (rows: object[], extra: object = {}, cookie = company.ownerCookie) =>
  call(cookie, "POST", "/api/catalog/products/import", { rows, ...extra });

const importPurchases = (rows: object[], extra: object = {}, cookie = company.ownerCookie) =>
  call(cookie, "POST", "/api/purchase/orders/import", { rows, ...extra });

const productBySku = async (sku: string) => {
  const [row] = await db.select().from(products).where(and(eq(products.companyId, company.companyId), eq(products.sku, sku)));
  return row;
};

const conversionsOf = async (productId: string) =>
  db.select().from(unitConversions).where(eq(unitConversions.productId, productId));

async function stockOf(productId: string) {
  const [row] = await db
    .select({ quantity: stockLevels.quantity, avgCost: stockLevels.avgCostPrice, reserved: stockLevels.reservedQty })
    .from(stockLevels)
    .where(and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, warehouseId)));
  const quantity = money(row?.quantity);
  expect(quantity, "qoldiq manfiy").toBeGreaterThanOrEqual(0);
  expect(money(row?.reserved), "reserved_qty > quantity").toBeLessThanOrEqual(quantity);
  return { quantity, avgCost: money(row?.avgCost) };
}

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
  box = (await db.select().from(units).where(eq(units.shortName, "bl")))[0]!.id;
  pack = (await db.select().from(units).where(eq(units.shortName, "qt")))[0]!.id;

  const admin = await signedIn(app, { isPlatformAdmin: true });
  company = await createCompany(app, admin.cookie, { name: "IMPORT-CO" });
  other = await createCompany(app, admin.cookie, { name: "IMPORT-OUTSIDER" });
  warehouseId = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  expect((await call(company.ownerCookie, "POST", "/api/finance/setup")).statusCode).toBe(200);
  cashAccountId = (await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId))).find((row) => row.type === "cash")!.id;
  supplierId = (await call(company.ownerCookie, "POST", "/api/purchase/suppliers", { name: "TA'MINOTCHI", phone: uniquePhone("94") })).json().supplier.id;
});

describe("Son formati (`cleanNumber`)", () => {
  it("mingliklar va kasr aniq ajratiladi — narx 1000 barobar buzilmaydi", () => {
    // Noaniq holat: bitta ajratgich + aynan 3 raqam → MINGLIKLAR
    expect(cleanNumber("10,500")).toBe("10500");
    expect(cleanNumber("10.500")).toBe("10500");
    expect(cleanNumber("10 500")).toBe("10500");
    expect(cleanNumber("10 500")).toBe("10500"); // bo'linmas probel

    // Kasr: 1, 2 yoki 4+ raqam
    expect(cleanNumber("10.5")).toBe("10.5");
    expect(cleanNumber("10000.50")).toBe("10000.50");
    expect(cleanNumber("12500,50")).toBe("12500.50");
    expect(cleanNumber("1.2345")).toBe("1.2345");

    // Ikkala ajratgich — oxirgisi kasr
    expect(cleanNumber("1.234,56")).toBe("1234.56");
    expect(cleanNumber("1,234.56")).toBe("1234.56");
    expect(cleanNumber("1.234.567")).toBe("1234567");
    expect(cleanNumber("1,234,567")).toBe("1234567");

    // Oddiy sonlar va bo'shlik
    expect(cleanNumber("10000")).toBe("10000");
    expect(cleanNumber(10000)).toBe("10000");
    expect(cleanNumber("")).toBe("0");
    expect(cleanNumber(null)).toBe("0");
    expect(cleanNumber("-5,5")).toBe("-5.5");

    // Yaroqsiz — bo'sh satr (sxema rad etadi)
    for (const bad of ["abc", "12abc", "1-2", "NaN", "Infinity", "--5", "."]) {
      expect(cleanNumber(bad), `${bad} yaroqsiz bo'lishi kerak`).toBe("");
    }
  });
});

describe("Mahsulot importi: birlik, qadoq va narx", () => {
  it("A. dona — eng oddiy holat", async () => {
    const res = await importProducts([{ name: "Suv 1L", sku: "SUV", unit: "dona", purchasePrice: "8 000", salesPrice: "10 000" }]);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().created).toBe(1);

    const product = await productBySku("SUV");
    expect(product!.baseUnitId).toBe(piece);
    expect(product!.purchasePrice).toBe("8000.0000");
    expect(product!.salesPrice).toBe("10000.0000");
    expect(await conversionsOf(product!.id), "qadoq yo'q — konversiya ham yo'q").toHaveLength(0);
  });

  it("B/C. blok va pachka — konversiya yoziladi", async () => {
    const res = await importProducts([
      { name: "Suv blokda", sku: "SUV-BL", unit: "dona", purchaseUnit: "bl", unitsPerPackage: "6", purchasePrice: "60 000", salesPrice: "12 000" },
      { name: "Pechenye pachkada", sku: "PECH-QT", unit: "dona", purchaseUnit: "qt", unitsPerPackage: "12", purchasePrice: "24 000", salesPrice: "2 500" },
    ]);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().created).toBe(2);

    const suv = await productBySku("SUV-BL");
    expect(suv!.purchaseUnitId, "xarid birligi blok").toBe(box);
    const suvConversions = await conversionsOf(suv!.id);
    expect(suvConversions, "1 blok = 6 dona").toHaveLength(1);
    expect(suvConversions[0]).toMatchObject({ fromUnitId: box, toUnitId: piece, factor: "6.0000" });

    const pech = await productBySku("PECH-QT");
    expect((await conversionsOf(pech!.id))[0]).toMatchObject({ fromUnitId: pack, toUnitId: piece, factor: "12.0000" });
  });

  it("D/E/F. aralash birliklar bitta faylda", async () => {
    const res = await importProducts([
      { name: "Faqat dona", sku: "M-1", unit: "dona", purchasePrice: "1 000", salesPrice: "1 500" },
      { name: "Dona + blok", sku: "M-2", unit: "dona", purchaseUnit: "bl", unitsPerPackage: "6", purchasePrice: "6 000", salesPrice: "1 200" },
      { name: "Dona + pachka", sku: "M-3", unit: "dona", purchaseUnit: "qt", unitsPerPackage: "12", purchasePrice: "12 000", salesPrice: "1 100" },
      { name: "Xarid blok, sotuv dona", sku: "M-4", unit: "dona", purchaseUnit: "bl", saleUnit: "dona", unitsPerPackage: "10", purchasePrice: "50 000", salesPrice: "6 000" },
    ]);
    expect(res.json().created).toBe(4);
    expect(await conversionsOf((await productBySku("M-1"))!.id)).toHaveLength(0);
    expect(await conversionsOf((await productBySku("M-2"))!.id)).toHaveLength(1);
    expect(await conversionsOf((await productBySku("M-4"))!.id), "sotuv birligi asosiy — bitta konversiya").toHaveLength(1);
  });

  it("I. xarid birligi sotuv birligidan farq qiladi — ikkala konversiya", async () => {
    const res = await importProducts([
      { name: "Blokda olamiz, pachkada sotamiz", sku: "MIX", unit: "dona", purchaseUnit: "bl", saleUnit: "qt", unitsPerPackage: "6", purchasePrice: "60 000", salesPrice: "15 000" },
    ]);
    expect(res.statusCode, res.body).toBe(200);
    const product = await productBySku("MIX");
    expect(product!.purchaseUnitId).toBe(box);
    expect(product!.salesUnitId).toBe(pack);
    const rows = await conversionsOf(product!.id);
    expect(rows.map((row) => row.fromUnitId).sort(), "ikkala qadoq uchun konversiya").toEqual([box, pack].sort());
  });

  it("N. qadoq birligi bor, lekin nechtaligi yo'q — XATO (10 blok 10 dona bo'lib ketmaydi)", async () => {
    const res = await importProducts([
      { name: "Konversiyasiz blok", sku: "BAD-BL", unit: "dona", purchaseUnit: "bl", purchasePrice: "60 000", salesPrice: "12 000" },
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.json().created, "yozilmadi").toBe(0);
    expect(res.json().errors[0].message).toContain("qadoqdagi miqdor");
    expect(await productBySku("BAD-BL")).toBeUndefined();
  });

  it("G/H/K. narxlar: noaniq format previewda normallashtirilib ko'rsatiladi", async () => {
    const preview = await importProducts(
      [
        { name: "Narx testi", sku: "PRICE-1", unit: "dona", purchaseUnit: "bl", unitsPerPackage: "6", purchasePrice: "60,000", salesPrice: "12.000" },
        { name: "Kasrli", sku: "PRICE-2", unit: "dona", purchasePrice: "10000.50", salesPrice: "12500,75" },
      ],
      { dryRun: true },
    );
    expect(preview.statusCode, preview.body).toBe(200);
    const rows = preview.json().preview as Record<string, string>[];
    expect(rows).toHaveLength(2);

    expect(rows[0]).toMatchObject({
      status: "new",
      // Faylda yozilgani va tizim tushungani — ikkalasi ham ko'rinadi
      purchasePriceRaw: "60,000",
      purchasePrice: "60000",
      salesPriceRaw: "12.000",
      salesPrice: "12000",
      purchaseUnit: "bl",
      unitsPerPackage: "6",
      // 60 000 / 6 = 10 000 — bitta donaga tushadigan tannarx (4 kasrgacha)
      unitCost: "10000.0000",
    });
    // Sxema qiymatni me'yorlashtiradi (ortiqcha nol tushadi) — ma'nosi o'zgarmaydi
    expect(rows[1]).toMatchObject({ purchasePrice: "10000.5", salesPrice: "12500.75", unitCost: "10000.5" });

    // Preview hech narsa yozmaydi
    expect(await productBySku("PRICE-1")).toBeUndefined();
  });

  it("L/M. takroriy SKU va shtrix-kod: previewda alohida holat, yozilmaydi", async () => {
    expect((await importProducts([{ name: "Bor", sku: "DUP", unit: "dona", purchasePrice: "1000", salesPrice: "2000" }])).json().created).toBe(1);

    const again = await importProducts([
      { name: "Yana", sku: "DUP", unit: "dona", purchasePrice: "9999", salesPrice: "9999" },
      { name: "Yangi", sku: "NEW-1", unit: "dona", purchasePrice: "1000", salesPrice: "2000" },
    ]);
    expect(again.json().created, "faqat yangisi").toBe(1);
    expect(again.json().duplicates).toHaveLength(1);
    const preview = again.json().preview as { row: number; status: string }[];
    expect(preview.find((row) => row.status === "duplicate"), "dublikat previewda").toBeTruthy();
    expect(preview.find((row) => row.status === "new"), "yangi previewda").toBeTruthy();

    // Mavjud mahsulot narxi o'zgarmadi (jim ustiga yozish yo'q)
    expect((await productBySku("DUP"))!.salesPrice).toBe("2000.0000");
  });

  it("O/P/Q. noto'g'ri narx va miqdor rad etiladi", async () => {
    const res = await importProducts([
      { name: "Harfli narx", sku: "E-1", unit: "dona", purchasePrice: "abc", salesPrice: "1000" },
      { name: "Manfiy narx", sku: "E-2", unit: "dona", purchasePrice: "-500", salesPrice: "1000" },
      { name: "Noma'lum birlik", sku: "E-3", unit: "qop-qop", purchasePrice: "1000", salesPrice: "2000" },
      { name: "", sku: "E-4", unit: "dona", purchasePrice: "1000", salesPrice: "2000" },
      { name: "Nol qadoq", sku: "E-5", unit: "dona", purchaseUnit: "bl", unitsPerPackage: "0", purchasePrice: "1000", salesPrice: "2000" },
    ]);
    expect(res.json().created, "hech biri yozilmadi").toBe(0);
    expect(res.json().errors.length).toBe(5);
    for (const sku of ["E-1", "E-2", "E-3", "E-4", "E-5"]) {
      expect(await productBySku(sku), `${sku} yozilmasligi kerak`).toBeUndefined();
    }
  });

  it("J/R. kasrli va katta miqdor", async () => {
    const res = await importProducts([
      { name: "Kilogramm", sku: "KG-1", unit: "kg", purchasePrice: "12 500,50", salesPrice: "15 000,25", minStock: "2,5" },
      { name: "Katta", sku: "BIG-1", unit: "dona", purchasePrice: "1 000 000", salesPrice: "1 500 000", minStock: "100000" },
    ]);
    expect(res.json().created).toBe(2);
    expect((await productBySku("KG-1"))!.purchasePrice).toBe("12500.5000");
    expect((await productBySku("KG-1"))!.minStock).toBe("2.5000");
    expect((await productBySku("BIG-1"))!.salesPrice).toBe("1500000.0000");
  });

  it("S/T/U. xavfsizlik: tenant, ruxsat va soxta ID", async () => {
    // Tanadagi companyId — strict sxema rad etadi
    const spoof = await call(company.ownerCookie, "POST", "/api/catalog/products/import", {
      rows: [{ name: "X", sku: "SP-1", unit: "dona", purchasePrice: "1", salesPrice: "2" }],
      companyId: other.companyId,
    });
    expect(spoof.statusCode).toBe(400);

    // Import qilingan mahsulot faqat o'z kompaniyasida
    expect((await importProducts([{ name: "Meniki", sku: "MINE", unit: "dona", purchasePrice: "1000", salesPrice: "2000" }])).json().created).toBe(1);
    const foreignList = (await call(other.ownerCookie, "GET", "/api/catalog/products?search=MINE")).json().products as unknown[];
    expect(foreignList, "begona tenant ko'rmaydi").toHaveLength(0);

    // Ruxsatsiz rol import qila olmaydi
    const cashier = await addEmployee(app, company, "Kassir");
    expect((await importProducts([{ name: "Y", sku: "NO-1", unit: "dona", purchasePrice: "1", salesPrice: "2" }], {}, cashier.cookie)).statusCode).toBe(403);
  });
});

describe("Xarid importi va to'liq zanjir", () => {
  it("X/Y. blokda xarid → qoldiq donada, tannarx donaga bo'linadi", async () => {
    // 1 blok = 6 dona
    expect(
      (await importProducts([
        { name: "Product X", sku: "PX", unit: "dona", purchaseUnit: "bl", unitsPerPackage: "6", purchasePrice: "60 000", salesPrice: "12 000" },
      ])).json().created,
    ).toBe(1);
    const product = (await productBySku("PX"))!;

    // 10 blok × 60 000 — hujjat blok birligida
    const imported = await importPurchases([
      { supplier: "TA'MINOTCHI", warehouse: "Asosiy ombor", orderDate: todayIso(), product: "PX", unit: "bl", quantity: "10", price: "60 000" },
    ]);
    expect(imported.statusCode, imported.body).toBe(200);
    expect(imported.json().created, "bitta qator").toBe(1);

    // Hujjatni qabul qilamiz — tovar omborga tushadi
    const orders = (await call(company.ownerCookie, "GET", "/api/purchase/orders?limit=10")).json().orders as { id: string }[];
    const orderId = orders[0]!.id;
    const detail = (await call(company.ownerCookie, "GET", `/api/purchase/orders/${orderId}`)).json().order as { items: { id: string }[] };
    expect((await call(company.ownerCookie, "POST", `/api/purchase/orders/${orderId}/confirm`)).statusCode).toBe(200);
    const receipt = await call(company.ownerCookie, "POST", `/api/purchase/orders/${orderId}/receipts`, {
      receiptDate: todayIso(),
      items: [{ orderItemId: detail.items[0]!.id, receivedQty: "10" }],
    });
    expect(receipt.statusCode, receipt.body).toBe(201);

    // 10 blok = 60 dona, tannarx 60 000 / 6 = 10 000 / dona
    const stock = await stockOf(product.id);
    expect(stock.quantity, "10 blok = 60 dona").toBe(60);
    expect(stock.avgCost, "tannarx donaga").toBe(10_000);
  });

  it("Z. to'liq zanjir: import → xarid → qoldiq → tannarx → sotuv → marja", async () => {
    expect(
      (await importProducts([
        { name: "Product X", sku: "PX", unit: "dona", purchaseUnit: "bl", unitsPerPackage: "6", purchasePrice: "60 000", salesPrice: "12 000" },
      ])).json().created,
    ).toBe(1);
    const product = (await productBySku("PX"))!;

    await importPurchases([
      { supplier: "TA'MINOTCHI", warehouse: "Asosiy ombor", orderDate: todayIso(), product: "PX", unit: "bl", quantity: "10", price: "60 000" },
    ]);
    const orderId = ((await call(company.ownerCookie, "GET", "/api/purchase/orders?limit=10")).json().orders as { id: string }[])[0]!.id;
    const detail = (await call(company.ownerCookie, "GET", `/api/purchase/orders/${orderId}`)).json().order as { items: { id: string }[] };
    await call(company.ownerCookie, "POST", `/api/purchase/orders/${orderId}/confirm`);
    await call(company.ownerCookie, "POST", `/api/purchase/orders/${orderId}/receipts`, {
      receiptDate: todayIso(),
      items: [{ orderItemId: detail.items[0]!.id, receivedQty: "10" }],
    });
    expect(await stockOf(product.id)).toMatchObject({ quantity: 60, avgCost: 10_000 });

    const customerId = (
      await call(company.ownerCookie, "POST", "/api/sales/customers", { name: "Mijoz", phone: uniquePhone("95"), creditLimit: "0" })
    ).json().customer.id as string;

    /** Sotuv: yaratish → tasdiq → jo'natish; qator narxi va tannarxini qaytaradi. */
    const sell = async (quantity: string, unitId?: string) => {
      const created = await call(company.ownerCookie, "POST", "/api/sales/orders", {
        customerId,
        warehouseId,
        orderDate: todayIso(),
        items: [{ productId: product.id, quantity, ...(unitId ? { unitId } : {}) }],
      });
      expect(created.statusCode, created.body).toBe(201);
      const id = created.json().order.id as string;
      expect((await call(company.ownerCookie, "POST", `/api/sales/orders/${id}/confirm`)).statusCode).toBe(200);
      expect((await call(company.ownerCookie, "POST", `/api/sales/orders/${id}/ship`)).statusCode).toBe(200);
      const [line] = await db
        .select({ quantity: salesOrderItems.quantity, unitPrice: salesOrderItems.unitPrice, lineTotal: salesOrderItems.lineTotal, costPrice: salesOrderItems.costPrice })
        .from(salesOrderItems)
        .where(eq(salesOrderItems.orderId, id));
      return line!;
    };

    // 1 dona × 12 000: tannarx 10 000, marja 2 000
    const single = await sell("1");
    expect(money(single.unitPrice)).toBe(12_000);
    expect(money(single.lineTotal)).toBe(12_000);
    expect(money(single.costPrice), "tannarx asosiy birlikda").toBe(10_000);
    expect(money(single.lineTotal) - money(single.costPrice) * money(single.quantity), "marja").toBe(2_000);
    expect((await stockOf(product.id)).quantity).toBe(59);

    // 1 blok sotuv: qoldiq 6 dona kamayadi, tannarx 6 × 10 000 = 60 000
    const boxSale = await sell("1", box);
    expect(money(boxSale.unitPrice), "blok narxi = 6 × 12 000 (konversiya bilan)").toBe(72_000);
    expect((await stockOf(product.id)).quantity, "1 blok = 6 dona chiqdi").toBe(53);
    const boxCogs = money(boxSale.costPrice) * money(boxSale.quantity);
    expect(boxCogs, "1 blok tannarxi = 60 000").toBe(60_000);
    expect(money(boxSale.lineTotal) - boxCogs, "blok marjasi").toBe(12_000);
  });

  it("konversiya ikki marta qo'llanmaydi (10 blok 600 dona emas, 60 dona)", async () => {
    expect(
      (await importProducts([
        { name: "Product X", sku: "PX", unit: "dona", purchaseUnit: "bl", unitsPerPackage: "6", purchasePrice: "60 000", salesPrice: "12 000" },
      ])).json().created,
    ).toBe(1);
    const product = (await productBySku("PX"))!;
    expect(await conversionsOf(product.id), "bitta konversiya yozuvi").toHaveLength(1);

    await importPurchases([
      { supplier: "TA'MINOTCHI", warehouse: "Asosiy ombor", orderDate: todayIso(), product: "PX", unit: "bl", quantity: "10", price: "60 000" },
    ]);
    const orderId = ((await call(company.ownerCookie, "GET", "/api/purchase/orders?limit=10")).json().orders as { id: string }[])[0]!.id;
    const detail = (await call(company.ownerCookie, "GET", `/api/purchase/orders/${orderId}`)).json().order as { items: { id: string }[] };
    await call(company.ownerCookie, "POST", `/api/purchase/orders/${orderId}/confirm`);
    await call(company.ownerCookie, "POST", `/api/purchase/orders/${orderId}/receipts`, {
      receiptDate: todayIso(),
      items: [{ orderItemId: detail.items[0]!.id, receivedQty: "10" }],
    });

    const stock = await stockOf(product.id);
    expect(stock.quantity, "aynan 60 — 600 ham, 10 ham emas").toBe(60);
    expect(stock.avgCost, "tannarx 10 000 — 1 666.67 ham, 60 000 ham emas").toBe(10_000);
  });

  it("V/W. mavjud mahsulotga xarid: yangi mahsulot ochilmaydi", async () => {
    expect(
      (await importProducts([{ name: "Bor mahsulot", sku: "EXIST", unit: "dona", purchasePrice: "5 000", salesPrice: "7 000" }])).json().created,
    ).toBe(1);
    const before = await db.$count(products, eq(products.companyId, company.companyId));

    const imported = await importPurchases([
      { supplier: "TA'MINOTCHI", warehouse: "Asosiy ombor", orderDate: todayIso(), product: "EXIST", unit: "dona", quantity: "100", price: "5 000" },
    ]);
    expect(imported.statusCode, imported.body).toBe(200);
    expect(await db.$count(products, eq(products.companyId, company.companyId)), "yangi mahsulot ochilmadi").toBe(before);
  });

  it("T/U. xarid importi: begona ombor va ta'minotchi qabul qilinmaydi", async () => {
    const res = await importPurchases([
      { supplier: "YO'Q TA'MINOTCHI", warehouse: "Asosiy ombor", orderDate: todayIso(), product: "PX", unit: "dona", quantity: "1", price: "1000" },
      { supplier: "TA'MINOTCHI", warehouse: "YO'Q OMBOR", orderDate: todayIso(), product: "PX", unit: "dona", quantity: "1", price: "1000" },
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.json().errors.length, "ikkala qator ham xato").toBeGreaterThanOrEqual(2);
    expect(res.json().created).toBe(0);

    // Begona tenant bizning ta'minotchimizga hujjat yoza olmaydi
    const foreign = await importPurchases(
      [{ supplier: "TA'MINOTCHI", warehouse: "Asosiy ombor", orderDate: todayIso(), product: "PX", unit: "dona", quantity: "1", price: "1000" }],
      {},
      other.ownerCookie,
    );
    expect(foreign.statusCode).toBe(200);
    expect(foreign.json().created, "begona tenantda bu ta'minotchi yo'q").toBe(0);
  });

  it("xarid narxi sotuv narxi bilan aralashmaydi", async () => {
    expect(
      (await importProducts([
        { name: "Narx ajratish", sku: "SEP", unit: "dona", purchaseUnit: "bl", unitsPerPackage: "6", purchasePrice: "60 000", salesPrice: "12 000" },
      ])).json().created,
    ).toBe(1);
    const product = (await productBySku("SEP"))!;
    expect(money(product.purchasePrice), "kirim narxi — blok uchun yozilgani").toBe(60_000);
    expect(money(product.salesPrice), "sotuv narxi — dona uchun").toBe(12_000);

    // Xarid hujjati sotuv narxini o'zgartirmaydi
    await importPurchases([
      { supplier: "TA'MINOTCHI", warehouse: "Asosiy ombor", orderDate: todayIso(), product: "SEP", unit: "bl", quantity: "5", price: "66 000" },
    ]);
    expect(money((await productBySku("SEP"))!.salesPrice), "sotuv narxi tegilmadi").toBe(12_000);
  });

  it("preview xatoni oldindan ko'rsatadi va hech narsa yozmaydi", async () => {
    const preview = await importProducts(
      [
        { name: "Yaxshi", sku: "OK-1", unit: "dona", purchasePrice: "1 000", salesPrice: "2 000" },
        { name: "Qadoqsiz blok", sku: "BAD-1", unit: "dona", purchaseUnit: "bl", purchasePrice: "1 000", salesPrice: "2 000" },
      ],
      { dryRun: true },
    );
    expect(preview.json().valid).toBe(1);
    expect(preview.json().errors).toHaveLength(1);
    const rows = preview.json().preview as { row: number; status: string; message: string | null }[];
    expect(rows.find((row) => row.status === "error")!.message).toContain("qadoqdagi miqdor");
    expect(await db.$count(products, eq(products.companyId, company.companyId)), "preview yozmaydi").toBe(0);

    const [conversionCount] = await db.select({ count: sql<number>`count(*)::int` }).from(unitConversions);
    expect(conversionCount!.count, "konversiya ham yozilmadi").toBe(0);
  });
});

/**
 * XARID IMPORTIDA QADOQ BIRLIGI ("blok", "pachka").
 *
 * Zaxira doim ASOSIY birlikda yuritiladi, shuning uchun qatordagi birlik asosiy birlikdan farq
 * qilsa koeffitsient shart. Ilgari bu faqat TOVAR QABUL QILINAYOTGANDA tekshirilardi: fayl
 * muvaffaqiyatli import bo'lib, xato eng oxirida — "to'g'ridan-to'g'ri qabul" bosilganda chiqardi.
 * Endi xato aynan o'sha QATORDA, tekshirish (dryRun) bosqichidayoq ko'rinadi.
 */
describe("Xarid importi: qadoq birligi va konversiya", () => {
  /** Asosiy birligi "dona" bo'lgan mahsulot — xaridda "blok" ishlatiladi. */
  async function pieceProduct(sku: string) {
    const res = await importProducts([{ name: `Mahsulot ${sku}`, sku, baseUnit: "Dona", salesPrice: "10000" }]);
    expect(res.statusCode, res.body).toBe(200);
    const product = await productBySku(sku);
    expect(product!.baseUnitId).toBe(piece);
    return product!;
  }

  const purchaseRow = (product: { name: string }, extra: object) => ({
    supplier: "TA'MINOTCHI",
    warehouse: "Asosiy ombor",
    orderDate: todayIso(),
    product: product.name,
    quantity: "10",
    price: "120000",
    ...extra,
  });

  it("konversiyasiz blok — xato AYNAN QATORDA, hujjat yaratilmaydi", async () => {
    const product = await pieceProduct("PKG-1");

    const res = await importPurchases([purchaseRow(product, { unit: "Blok" })]);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.created, "hujjat yaratilmadi").toBe(0);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].message).toMatch(/konversiya yo'q/i);
    expect(body.errors[0].message).toMatch(/Birlikdagi dona/i);
    expect(await conversionsOf(product.id), "konversiya ochilmadi").toHaveLength(0);
  });

  it("\"Birlikdagi dona\" berilsa — konversiya ochiladi va qabulda 10 blok 120 dona bo'ladi", async () => {
    const product = await pieceProduct("PKG-2");

    // Avval tekshirish: bazaga hech narsa yozilmaydi, lekin nima ochilishi aytiladi
    const preview = await importPurchases([purchaseRow(product, { unit: "Blok", unitsPerPackage: "12" })], { dryRun: true });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().errors).toHaveLength(0);
    expect((preview.json().warnings as { message: string }[]).some((item) => /Konversiya ochiladi/i.test(item.message))).toBe(true);
    expect(await conversionsOf(product.id), "dryRun bazaga yozmaydi").toHaveLength(0);

    // Haqiqiy import
    const res = await importPurchases([purchaseRow(product, { unit: "Blok", unitsPerPackage: "12" })]);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().created).toBe(1);
    const conversions = await conversionsOf(product.id);
    expect(conversions).toHaveLength(1);
    expect(conversions[0]).toMatchObject({ fromUnitId: box, toUnitId: piece });
    expect(money(conversions[0]!.factor)).toBe(12);

    // Hujjatni yakunlash: 10 blok → 120 dona qoldiq (konversiya bir marta qo'llanadi)
    const orderId = (await call(company.ownerCookie, "GET", "/api/purchase/orders?limit=1")).json().orders[0].id as string;
    const done = await call(company.ownerCookie, "POST", `/api/purchase/orders/${orderId}/complete`);
    expect(done.statusCode, done.body).toBe(201);
    expect((await stockOf(product.id)).quantity, "10 blok × 12 = 120 dona").toBe(120);
  });

  it("konversiya allaqachon bor — fayl uni takrorlamaydi va ikkilantirmaydi", async () => {
    // Mahsulot importi konversiyani o'zi ochadi (blok = 24 dona)
    expect(
      (await importProducts([{ name: "Mahsulot PKG-3", sku: "PKG-3", baseUnit: "Dona", purchaseUnit: "Blok", unitsPerPackage: "24", salesPrice: "5000" }]))
        .statusCode,
    ).toBe(200);
    const product = (await productBySku("PKG-3"))!;
    expect(await conversionsOf(product.id)).toHaveLength(1);

    // Xarid faylida "Birlikdagi dona" umuman yo'q — mavjud konversiya ishlatiladi
    const res = await importPurchases([purchaseRow(product, { unit: "Blok" })]);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().errors, res.body).toHaveLength(0);
    expect(res.json().created).toBe(1);
    expect(await conversionsOf(product.id), "konversiya ikkilanmadi").toHaveLength(1);

    const orderId = (await call(company.ownerCookie, "GET", "/api/purchase/orders?limit=1")).json().orders[0].id as string;
    expect((await call(company.ownerCookie, "POST", `/api/purchase/orders/${orderId}/complete`)).statusCode).toBe(201);
    expect((await stockOf(product.id)).quantity, "10 blok × 24 = 240 dona").toBe(240);
  });
});
