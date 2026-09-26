/**
 * Ombor qoldig'ini Excel'dan import qilish (2026-09-26): preview → yozish, birlik konversiyasi (bir marta), AVCO va
 * jurnal (1200 = Σ qoldiq × o'rtacha tannarx), takroriy yuklash, begona tenant / ruxsatsiz ombor bloki.
 *
 * Haqiqiy test: A = 10 blok (1 blok = 6 dona) → 60 dona; B = 100 dona; C = 20 pachka (1 pachka = 10 dona) → 200 dona.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { units } from "../src/db/schema/catalog.js";
import { accounts } from "../src/db/schema/finance.js";
import { stockLevels, stockMovements, warehouses } from "../src/db/schema/inventory.js";
import { buildServer } from "../src/server.js";
import { resetUnits } from "./delivery-setup.js";
import { addEmployee, createCompany, resetDatabase, signedIn } from "./helpers.js";

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
let app: FastifyInstance;
const call = (cookie: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

const S = { owner: "", companyId: "", wh: "", wh2: "", storekeeper: "", foreign: "", foreignWh: "", p: {} as Record<string, string> };
const n = (value: unknown) => Number(value ?? 0);

const rows = [
  { sku: "IMP-A", name: "Product A", unit: "bl", quantity: "10", costPrice: "60000", salesPrice: "15000" },
  { barcode: "4780000000022", name: "Product B", unit: "d", quantity: 100, costPrice: "5000", salesPrice: "8000" },
  { name: "Product C", unit: "Pachka", quantity: "20", costPrice: "30000" },
];

async function level(productId: string, warehouseId = S.wh) {
  const [row] = await db.select().from(stockLevels).where(and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, warehouseId)));
  return row;
}

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
  await resetDatabase();
  await resetUnits();
  const admin = (await signedIn(app, { isPlatformAdmin: true })).cookie;
  const company = await createCompany(app, admin, { name: "IMPORT-CO" });
  const foreign = await createCompany(app, admin, { name: "IMPORT-FOREIGN" });
  S.owner = company.ownerCookie;
  S.companyId = company.companyId;
  S.foreign = foreign.ownerCookie;
  S.wh = (await db.select().from(warehouses).where(eq(warehouses.companyId, company.companyId)))[0]!.id;
  S.foreignWh = (await db.select().from(warehouses).where(eq(warehouses.companyId, foreign.companyId)))[0]!.id;
  const wh2 = await call(S.owner, "POST", "/api/inventory/warehouses", { name: "Ikkinchi ombor", code: "WH-2" });
  expect(wh2.statusCode, wh2.body).toBe(201);
  S.wh2 = wh2.json().warehouse.id;

  const piece = (await db.select().from(units).where(eq(units.shortName, "d")))[0]!.id;
  const block = (await db.select().from(units).where(eq(units.shortName, "bl")))[0]!.id;
  const packRes = await call(admin, "POST", "/api/catalog/units", { name: "Pachka", shortName: "pch", isBase: false });
  const pack = packRes.json().unit.id as string;
  for (const [key, sku, barcode, price] of [["A", "IMP-A", "4780000000011", "12000"], ["B", "IMP-B", "4780000000022", "8000"], ["C", "IMP-C", "4780000000033", "4000"]] as const) {
    const res = await call(S.owner, "POST", "/api/catalog/products", { name: `Product ${key}`, sku, barcode, baseUnitId: piece, salesPrice: price, taxRate: "0" });
    expect(res.statusCode, res.body).toBe(201);
    S.p[key] = res.json().product.id;
  }
  for (const [productId, unitId, factor] of [[S.p.A!, block, "6"], [S.p.C!, pack, "10"]] as const) {
    const conv = await call(S.owner, "POST", "/api/catalog/unit-conversions", { productId, fromUnitId: unitId, toUnitId: piece, factor });
    expect([200, 201], conv.body).toContain(conv.statusCode);
  }
  // Omborchi faqat ikkinchi omborga ruxsatli
  const keeper = await addEmployee(app, company, "Omborchi");
  const patch = await call(S.owner, "PATCH", `/api/company/employees/${keeper.id}`, { allowedWarehouseIds: [S.wh2] });
  expect(patch.statusCode, patch.body).toBe(200);
  S.storekeeper = keeper.cookie;
}, 120_000);

afterAll(async () => {
  await app.close();
  await closeDb();
});

describe("Ombor Excel import", () => {
  it("preview: birlik konversiyasi, qiymat, xato yo'q — bazaga hech narsa yozilmaydi", async () => {
    const res = await call(S.owner, "POST", "/api/inventory/stock/import", { warehouseId: S.wh, rows, dryRun: true });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.applied).toBe(false);
    expect(body.totals).toMatchObject({ rows: 3, valid: 3, invalid: 0, products: 3 });
    const [a, b, c] = body.lines;
    expect(a).toMatchObject({ productId: S.p.A, factor: "6.0000", baseQuantity: "60.0000", baseCostPrice: "10000.0000", value: "600000.00", currentQuantity: "0.0000", quantityAfter: "60.0000", errors: [] });
    expect(a.warnings.join()).toContain("Sotuv narxi");
    expect(b).toMatchObject({ productId: S.p.B, baseQuantity: "100.0000", value: "500000.00" });
    expect(c).toMatchObject({ productId: S.p.C, factor: "10.0000", baseQuantity: "200.0000", baseCostPrice: "3000.0000", value: "600000.00" });
    expect(body.totals.value).toBe("1700000.00");
    expect(await level(S.p.A!)).toBeUndefined();
  });

  it("xatolar: noma'lum mahsulot/birlik, konversiyasiz birlik, takroriy qator, manfiy miqdor — yozishda hammasi rad", async () => {
    const bad = [
      ...rows,
      { sku: "NOPE", quantity: "1" },
      { sku: "IMP-B", unit: "kilogramm-yoq", quantity: "1" },
      { sku: "IMP-B", unit: "bl", quantity: "1" },
      { sku: "IMP-A", unit: "bl", quantity: "2" },
      { sku: "IMP-C", quantity: "-5" },
      { sku: "IMP-C", unit: "d", quantity: "1", warehouse: "Ikkinchi ombor" },
    ];
    const preview = (await call(S.owner, "POST", "/api/inventory/stock/import", { warehouseId: S.wh, rows: bad, dryRun: true })).json();
    expect(preview.totals).toMatchObject({ rows: 9, valid: 3, invalid: 6 });
    const errs = preview.lines.slice(3).map((line: { errors: string[] }) => line.errors.join(" "));
    expect(errs[0]).toContain("Mahsulot topilmadi");
    expect(errs[1]).toContain("birligi topilmadi");
    expect(errs[2].length).toBeGreaterThan(0);
    expect(errs[3]).toContain("Takrorlangan");
    expect(errs[4]).toContain("Miqdor");
    expect(errs[5]).toContain("Ombor mos emas");
    const apply = await call(S.owner, "POST", "/api/inventory/stock/import", { warehouseId: S.wh, rows: bad, importId: randomUUID() });
    expect(apply.statusCode).toBe(400);
    expect(await level(S.p.A!), "xato bo'lsa hech narsa yozilmaydi").toBeUndefined();
  });

  it("xavfsizlik: begona tenant ombori, ruxsatsiz ombor, companyId body'da, ruxsatsiz rol — BLOK", async () => {
    expect((await call(S.owner, "POST", "/api/inventory/stock/import", { warehouseId: S.foreignWh, rows, dryRun: true })).statusCode).toBe(404);
    expect((await call(S.foreign, "POST", "/api/inventory/stock/import", { warehouseId: S.wh, rows, dryRun: true })).statusCode).toBe(404);
    expect((await call(S.storekeeper, "POST", "/api/inventory/stock/import", { warehouseId: S.wh, rows, dryRun: true })).statusCode).toBe(403);
    expect((await call(S.owner, "POST", "/api/inventory/stock/import", { warehouseId: S.wh, rows, dryRun: true, companyId: randomUUID() })).statusCode).toBe(400);
    // Begona tenant mahsuloti SKU bo'yicha ham topilmaydi (o'z katalogida yo'q)
    const foreignPreview = (await call(S.foreign, "POST", "/api/inventory/stock/import", { warehouseId: S.foreignWh, rows, dryRun: true })).json();
    expect(foreignPreview.totals.invalid).toBe(3);
    const cashier = await addEmployee(app, { ownerCookie: S.owner }, "Kassir");
    expect((await call(cashier.cookie, "POST", "/api/inventory/stock/import", { warehouseId: S.wh, rows, dryRun: true })).statusCode).toBe(403);
    // Ruxsatli ombordagi omborchi — preview ishlaydi
    expect((await call(S.storekeeper, "POST", "/api/inventory/stock/import", { warehouseId: S.wh2, rows, dryRun: true })).statusCode).toBe(200);
  });

  it("yozish: Excel = DB qoldiq (60 / 100 / 200), AVCO, 1200 = Σ qoldiq × tannarx; takroriy import — no-op", async () => {
    const importId = randomUUID();
    const res = await call(S.owner, "POST", "/api/inventory/stock/import", { warehouseId: S.wh, rows, importId });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ applied: true, duplicate: false });
    expect(n((await level(S.p.A!))!.quantity), "10 blok × 6 = 60 dona (bir marta)").toBe(60);
    expect(n((await level(S.p.B!))!.quantity)).toBe(100);
    expect(n((await level(S.p.C!))!.quantity), "20 pachka × 10 = 200 dona").toBe(200);
    expect(n((await level(S.p.A!))!.avgCostPrice)).toBe(10000);
    expect(n((await level(S.p.C!))!.avgCostPrice)).toBe(3000);

    const again = await call(S.owner, "POST", "/api/inventory/stock/import", { warehouseId: S.wh, rows, importId });
    expect(again.statusCode).toBe(200);
    expect(again.json().duplicate).toBe(true);
    expect(n((await level(S.p.A!))!.quantity), "takroriy import ikkinchi kirim yaratmaydi").toBe(60);
    const movements = await db.select().from(stockMovements).where(and(eq(stockMovements.referenceType, "stock_import"), eq(stockMovements.referenceId, importId)));
    expect(movements).toHaveLength(3);

    // Qiymat: /stock/export (A4 hisobot manbai) = Σ qoldiq × AVCO = jurnal 1200
    const exp = (await call(S.owner, "GET", `/api/inventory/stock/export?warehouseId=${S.wh}&inStockOnly=true`)).json();
    const value = exp.rows.reduce((sum: number, row: { quantity: string; avgCostPrice: string }) => sum + n(row.quantity) * n(row.avgCostPrice), 0);
    expect(value).toBe(1_700_000);
    const [ledger] = await db.select({ balance: accounts.balance }).from(accounts).where(and(eq(accounts.companyId, S.companyId), eq(accounts.code, "1200")));
    expect(n(ledger!.balance)).toBe(1_700_000);
    const [sum] = await db
      .select({ value: sql<string>`sum(${stockLevels.quantity} * ${stockLevels.avgCostPrice})::numeric(18,2)` })
      .from(stockLevels)
      .where(eq(stockLevels.companyId, S.companyId));
    expect(n(sum!.value)).toBe(1_700_000);
  });

  it("parallel ikki marta yuborish — bitta kirim", async () => {
    const importId = randomUUID();
    const one = [{ sku: "IMP-B", quantity: "5", costPrice: "5000" }];
    const [x, y] = await Promise.all([
      call(S.owner, "POST", "/api/inventory/stock/import", { warehouseId: S.wh, rows: one, importId }),
      call(S.owner, "POST", "/api/inventory/stock/import", { warehouseId: S.wh, rows: one, importId }),
    ]);
    expect([x.statusCode, y.statusCode]).toEqual([200, 200]);
    expect([x.json().duplicate, y.json().duplicate].sort()).toEqual([false, true]);
    expect(n((await level(S.p.B!))!.quantity)).toBe(105);
  });
});
