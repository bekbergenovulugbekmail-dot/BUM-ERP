/**
 * OMBOR QOLDIG'INI EXCEL'DAN IMPORT QILISH (kirim) — 2026-09-26.
 *
 * Yangi parallel tizim EMAS: har qator mavjud qo'lda kirim yo'li (`recordManualMovement`, turi `receive`) orqali yoziladi —
 * birlik konversiyasi (`toBaseUnit`: 10 blok × 6 = 60 dona, bir marta), AVCO, tannarx ishonchliligi tekshiruvi, jurnal
 * (DR 1200 Tovar zaxirasi / CR 3000 Ustav kapitali — boshlang'ich qoldiq qoidasi), audit va backorder yopilishi xuddi
 * qo'lda kirimdagidek. Mahsulot YARATILMAYDI (mahsulot katalogi importi — alohida); topilmagan mahsulot yoki birlik — xato.
 *
 * Oqim: avval PREVIEW (`dryRun`) — har qator: topilgan mahsulot, birlik, asosiy birlikdagi miqdor, tannarx, qiymat, joriy va
 * keyingi qoldiq, xatolar. Keyin yozish — HAMMASI yoki HECH NARSA (bitta tranzaksiya; xato bo'lsa hech narsa yozilmaydi).
 * `importId` — takroriy yuklash (ikki marta bosish, qayta urinish) ikkinchi kirim yaratmaydi.
 * Sotuv narxi o'zgartirilmaydi — preview'da Excel va joriy narx farqi ko'rsatiladi (narx — mahsulot kartochkasi orqali).
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { badRequest } from "@bum/shared";
import { products, units } from "../../db/schema/catalog.js";
import { stockLevels, stockMovements } from "../../db/schema/inventory.js";
import type { Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { fromMinor, rescale, toMinor } from "../../shared/decimal.js";
import { unitFactorToBase } from "../catalog/conversions.js";
import { categoryScope, productScopeCondition } from "../catalog/category-scope.js";
import type { TenantContext } from "../company/tenant.js";
import { recordManualMovement } from "./stock.service.js";
import { assertWarehouseAccess, getWarehouse } from "./warehouses.service.js";

export type StockImportRow = {
  sku?: string | number | null;
  barcode?: string | number | null;
  name?: string | number | null;
  unit?: string | number | null;
  /** Excel'dagi "Ombor" ustuni (ixtiyoriy): tanlangan ombor nomi yoki kodi bo'lishi shart — aks holda qator BLOK. */
  warehouse?: string | number | null;
  quantity: string | number;
  costPrice?: string | number | null;
  salesPrice?: string | number | null;
};

export type StockImportLine = {
  row: number;
  productId: string | null;
  sku: string | null;
  barcode: string | null;
  name: string | null;
  unit: string | null;
  quantity: string;
  factor: string;
  baseUnit: string | null;
  baseQuantity: string;
  costPrice: string | null;
  baseCostPrice: string | null;
  value: string;
  currentQuantity: string;
  quantityAfter: string;
  salesPrice: string | null;
  excelSalesPrice: string | null;
  errors: string[];
  warnings: string[];
};

const clean = (value: unknown) => (value === null || value === undefined ? "" : String(value).trim());
const decimal = (value: unknown, scale: number) => {
  const text = clean(value).replace(/\s/g, "").replace(",", ".");
  if (!text) return null;
  if (!/^\d+(\.\d+)?$/.test(text)) return undefined;
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > scale && /[1-9]/.test(fraction.slice(scale))) return undefined;
  return `${whole}.${(fraction + "0".repeat(scale)).slice(0, scale)}`;
};

export async function importStock(
  tx: Tx,
  tenant: TenantContext,
  input: { warehouseId: string; rows: StockImportRow[]; dryRun?: boolean; importId?: string | null },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  assertWarehouseAccess(tenant, input.warehouseId);
  const warehouse = await getWarehouse(tx, tenant, input.warehouseId);
  if (!warehouse.isActive) throw badRequest("Ombor faol emas");

  if (input.importId && !input.dryRun) {
    // Bir xil import parallel ikki marta kelsa — ikkinchisi birinchisi tugashini kutadi va uni ko'radi
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`stock_import:${input.importId}`}))`);
    const [done] = await tx
      .select({ companyId: stockMovements.companyId })
      .from(stockMovements)
      .where(and(eq(stockMovements.referenceType, "stock_import"), eq(stockMovements.referenceId, input.importId)))
      .limit(1);
    if (done) {
      if (done.companyId !== companyId) throw badRequest("Import kaliti boshqa hujjatga tegishli");
      return { importId: input.importId, duplicate: true as const, applied: false, lines: [] as StockImportLine[], totals: null };
    }
  }

  // Mahsulotlar (faqat shu kompaniya va xodimning kategoriya doirasi) va birliklar
  const scope = await categoryScope(tx, tenant);
  const catalog = await tx
    .select({ id: products.id, name: products.name, sku: products.sku, barcode: products.barcode, baseUnitId: products.baseUnitId, salesPrice: products.salesPrice, isActive: products.isActive })
    .from(products)
    .where(and(eq(products.companyId, companyId), productScopeCondition(scope)));
  const bySku = new Map(catalog.filter((row) => row.sku).map((row) => [row.sku!.toLowerCase(), row]));
  const byBarcode = new Map(catalog.filter((row) => row.barcode).map((row) => [row.barcode!, row]));
  const byName = new Map<string, typeof catalog>();
  for (const row of catalog) byName.set(row.name.toLowerCase(), [...(byName.get(row.name.toLowerCase()) ?? []), row]);
  const unitList = await tx.select({ id: units.id, name: units.name, shortName: units.shortName }).from(units);
  const unitByText = new Map<string, (typeof unitList)[number]>();
  for (const unit of unitList) {
    unitByText.set(unit.shortName.toLowerCase(), unit);
    unitByText.set(unit.name.toLowerCase(), unit);
  }
  const unitName = (id: string) => unitList.find((unit) => unit.id === id)?.shortName ?? null;

  const productIds = [...new Set(catalog.map((row) => row.id))];
  const levels = productIds.length
    ? await tx
        .select({ productId: stockLevels.productId, quantity: stockLevels.quantity })
        .from(stockLevels)
        .where(and(eq(stockLevels.companyId, companyId), eq(stockLevels.warehouseId, input.warehouseId), inArray(stockLevels.productId, productIds)))
    : [];
  const currentOf = new Map(levels.map((row) => [row.productId, toMinor(row.quantity, 4)]));

  const seen = new Map<string, number>();
  const plannedAdd = new Map<string, bigint>();
  const lines: StockImportLine[] = [];
  for (const [index, raw] of input.rows.entries()) {
    const rowNo = index + 2; // Excel: 1-qator — sarlavha
    const errors: string[] = [];
    const warnings: string[] = [];
    const sku = clean(raw.sku) || null;
    const barcode = clean(raw.barcode) || null;
    const name = clean(raw.name) || null;
    const warehouseText = clean(raw.warehouse).toLowerCase();
    if (warehouseText && warehouseText !== warehouse.name.trim().toLowerCase() && warehouseText !== warehouse.code.trim().toLowerCase()) {
      errors.push(`Ombor mos emas: "${clean(raw.warehouse)}" (tanlangan: ${warehouse.name}) — boshqa omborga import alohida qilinadi`);
    }
    let product = (sku ? bySku.get(sku.toLowerCase()) : undefined) ?? (barcode ? byBarcode.get(barcode) : undefined);
    if (!product && name) {
      const matches = byName.get(name.toLowerCase()) ?? [];
      if (matches.length === 1) product = matches[0];
      else if (matches.length > 1) errors.push(`"${name}" nomli ${matches.length} ta mahsulot — SKU yoki shtrix-kod kiriting`);
    }
    if (!product && errors.length === 0) errors.push(`Mahsulot topilmadi: ${sku ?? barcode ?? name ?? "—"} (avval mahsulotlar katalogiga qo'shing)`);
    if (product && !product.isActive) errors.push(`${product.name}: arxivdagi mahsulot`);

    const quantity = decimal(raw.quantity, 4);
    if (quantity === null || quantity === undefined || toMinor(quantity, 4) <= 0n) errors.push("Miqdor musbat son bo'lishi kerak");
    const cost = decimal(raw.costPrice, 4);
    if (cost === undefined) errors.push("Tannarx noto'g'ri");
    const excelPrice = decimal(raw.salesPrice, 2);
    if (excelPrice === undefined) errors.push("Sotuv narxi noto'g'ri");

    const unitText = clean(raw.unit).toLowerCase();
    let unitId: string | null = null;
    let factor = "1";
    if (product) {
      if (!unitText) unitId = product.baseUnitId;
      else {
        const unit = unitByText.get(unitText);
        if (!unit) errors.push(`O'lchov birligi topilmadi: ${clean(raw.unit)}`);
        else unitId = unit.id;
      }
      if (unitId) {
        try {
          factor = await unitFactorToBase(tx, companyId, product, unitId);
        } catch (error) {
          errors.push(error instanceof Error ? error.message : "Birlik konversiyasi yo'q");
          unitId = null;
        }
      }
      const key = `${product.id}|${unitId ?? ""}`;
      if (seen.has(key)) errors.push(`Takrorlangan qator (${seen.get(key)}-qator bilan bir xil mahsulot va birlik)`);
      else seen.set(key, rowNo);
    }

    const factorMinor = toMinor(factor, 4);
    const baseQty = quantity && errors.length === 0 ? rescale(toMinor(quantity, 4) * factorMinor, 8, 4) : 0n;
    const baseCost = cost ? rescale((toMinor(cost, 4) * 10_000n) / factorMinor, 4, 4) : null;
    const value = baseCost !== null ? rescale(baseQty * baseCost, 8, 2) : 0n;
    const current = product ? (currentOf.get(product.id) ?? 0n) : 0n;
    if (product && errors.length === 0) plannedAdd.set(product.id, (plannedAdd.get(product.id) ?? 0n) + baseQty);
    if (product && excelPrice && toMinor(excelPrice) !== toMinor(product.salesPrice ?? "0")) {
      warnings.push(`Sotuv narxi Excel'da ${excelPrice}, katalogda ${product.salesPrice ?? "0"} — import narxni o'zgartirmaydi`);
    }
    if (!cost) warnings.push("Tannarx berilmagan — mahsulotning xarid narxi ishlatiladi");

    lines.push({
      row: rowNo,
      productId: product?.id ?? null,
      sku: product?.sku ?? sku,
      barcode: product?.barcode ?? barcode,
      name: product?.name ?? name,
      unit: unitId ? unitName(unitId) : clean(raw.unit) || null,
      quantity: quantity ?? clean(raw.quantity),
      factor: fromMinor(factorMinor, 4),
      baseUnit: product ? unitName(product.baseUnitId) : null,
      baseQuantity: fromMinor(baseQty, 4),
      costPrice: cost ?? null,
      baseCostPrice: baseCost !== null ? fromMinor(baseCost, 4) : null,
      value: fromMinor(value),
      currentQuantity: fromMinor(current, 4),
      quantityAfter: fromMinor(current, 4),
      salesPrice: product?.salesPrice ?? null,
      excelSalesPrice: excelPrice ?? null,
      errors,
      warnings,
    });
  }
  // Keyingi qoldiq — shu importdagi barcha qatorlar hisobga olingan holda
  for (const line of lines) {
    if (line.productId) line.quantityAfter = fromMinor((currentOf.get(line.productId) ?? 0n) + (plannedAdd.get(line.productId) ?? 0n), 4);
  }

  const valid = lines.filter((line) => line.errors.length === 0);
  const totals = {
    rows: lines.length,
    valid: valid.length,
    invalid: lines.length - valid.length,
    products: new Set(valid.map((line) => line.productId)).size,
    value: fromMinor(valid.reduce((sum, line) => sum + toMinor(line.value), 0n)),
  };
  if (input.dryRun) return { importId: input.importId ?? null, duplicate: false as const, applied: false, lines, totals, warehouse: { id: warehouse.id, name: warehouse.name } };
  if (totals.invalid > 0) throw badRequest(`${totals.invalid} ta qatorda xato — tuzatib qayta yuklang (hech narsa yozilmadi)`, { lines: lines.filter((line) => line.errors.length > 0) });
  if (!input.importId) throw badRequest("Import kaliti (importId) kerak");

  for (const line of valid) {
    const productRow = catalog.find((row) => row.id === line.productId)!;
    const unitId = unitByText.get((line.unit ?? "").toLowerCase())?.id ?? productRow.baseUnitId;
    await recordManualMovement(
      tx,
      tenant,
      {
        type: "receive",
        productId: productRow.id,
        warehouseId: input.warehouseId,
        quantity: line.quantity,
        unitId,
        costPrice: line.costPrice,
        notes: `Excel import (${line.row}-qator)`,
        source: { type: "stock_import", id: input.importId },
      },
      meta,
    );
  }
  return { importId: input.importId, duplicate: false as const, applied: true, lines, totals, warehouse: { id: warehouse.id, name: warehouse.name } };
}
