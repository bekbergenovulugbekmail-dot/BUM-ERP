/**
 * Xarid hujjatlarini (purchase orders) CSV orqali eksport va import qilish.
 *
 * Import **mavjud biznes mantiq orqali** ishlaydi: har hujjat `createOrder` bilan **qoralama** (`draft`) holatida
 * ochiladi — raw SQL bulk insert yo'q. Qoralama zaxirani, ta'minotchi qarzini va buxgalteriyani o'zgartirmaydi:
 * ular faqat qabul (`receiveGoods`) va to'lovda harakatlanadi. Ya'ni import bilan pul yoki qoldiq yashirin o'zgarmaydi.
 *
 * Fayl qatori = hujjat qatori (mahsulot). Bir xil "Hujjat raqami" li qatorlar bitta hujjatga birlashadi; raqam bo'sh
 * bo'lsa har qator alohida hujjat bo'ladi. `dryRun` — faqat tekshirish (preview): bazaga hech narsa yozilmaydi.
 */
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { units } from "../../db/schema/catalog.js";
import { products } from "../../db/schema/catalog.js";
import { warehouses } from "../../db/schema/inventory.js";
import { purchaseOrderItems, purchaseOrders, suppliers } from "../../db/schema/purchase.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import {
  MAX_EXPORT_ROWS,
  cleanNumber,
  csvDocument,
  optionalText,
  parseIsoDate,
  type ImportError,
  type ImportOutcome,
} from "../../shared/csv.js";
import { createProduct } from "../catalog/products.service.js";
import { effectivePermissions, type TenantContext } from "../company/tenant.js";
import { createOrder } from "./orders.service.js";

const CSV_HEADER = [
  "Sana",
  "Hujjat raqami",
  "Holati",
  "Ta'minotchi",
  "Ta'minotchi kodi",
  "Ombor",
  "Mahsulot",
  "SKU",
  "Miqdor",
  "Birlik",
  "Narx",
  "Chegirma %",
  "Soliq %",
  "Qator jami",
  "Valyuta",
  "Hujjat jami",
  "To'langan",
  "To'lov usuli",
  "Kutilgan sana",
  "Izoh",
];

const STATUS_LABEL: Record<string, string> = {
  draft: "Qoralama",
  confirmed: "Tasdiqlangan",
  partial: "Qisman qabul",
  received: "Qabul qilingan",
  invoiced: "Hisob-faktura",
  paid: "To'langan",
  cancelled: "Bekor qilingan",
};

const METHOD_LABEL: Record<string, string> = {
  cash: "Naqd",
  bank: "Bank",
  card: "Karta",
  transfer: "O'tkazma",
  balance: "Balansdan",
  cashback: "Keshbekdan",
};

const methodLabels = (value: string) =>
  value
    .split(", ")
    .filter(Boolean)
    .map((method) => METHOD_LABEL[method] ?? method)
    .join(", ");

export type PurchaseExportFilters = {
  supplierId?: string;
  status?: "draft" | "confirmed" | "partial" | "received" | "invoiced" | "paid" | "cancelled";
  dateFrom?: string;
  dateTo?: string;
};

export async function exportPurchaseOrdersCsv(conn: DbOrTx, tenant: TenantContext, filters: PurchaseExportFilters = {}) {
  const rows = await conn
    .select({
      orderDate: purchaseOrders.orderDate,
      number: purchaseOrders.number,
      status: purchaseOrders.status,
      supplierName: suppliers.name,
      supplierCode: suppliers.code,
      warehouseName: warehouses.name,
      productName: products.name,
      sku: products.sku,
      orderedQty: purchaseOrderItems.orderedQty,
      unitName: units.shortName,
      unitPrice: purchaseOrderItems.unitPrice,
      discountPercent: purchaseOrderItems.discountPercent,
      taxRate: purchaseOrderItems.taxRate,
      lineTotal: purchaseOrderItems.lineTotal,
      lineCurrency: purchaseOrderItems.currency,
      orderCurrency: purchaseOrders.currency,
      totalAmount: purchaseOrders.totalAmount,
      paidAmount: purchaseOrders.paidAmount,
      expectedDate: purchaseOrders.expectedDate,
      notes: purchaseOrders.notes,
      // To'lov usuli hujjatda emas — ta'minotchi to'lovlaridan yig'iladi
      paymentMethods: sql<string>`(select coalesce(string_agg(distinct sp."method"::text, ', '), '') from "supplier_payments" sp where sp."order_id" = ${purchaseOrders.id})`,
    })
    .from(purchaseOrderItems)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderItems.orderId))
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .innerJoin(warehouses, eq(warehouses.id, purchaseOrders.warehouseId))
    .innerJoin(products, eq(products.id, purchaseOrderItems.productId))
    .innerJoin(units, eq(units.id, purchaseOrderItems.unitId))
    .where(
      and(
        eq(purchaseOrders.companyId, tenant.company.id),
        filters.supplierId ? eq(purchaseOrders.supplierId, filters.supplierId) : undefined,
        filters.status ? eq(purchaseOrders.status, filters.status) : undefined,
        filters.dateFrom ? gte(purchaseOrders.orderDate, filters.dateFrom) : undefined,
        filters.dateTo ? lte(purchaseOrders.orderDate, filters.dateTo) : undefined,
      ),
    )
    .orderBy(desc(purchaseOrders.orderDate), asc(purchaseOrders.number), asc(purchaseOrderItems.createdAt))
    .limit(MAX_EXPORT_ROWS);

  return csvDocument(
    CSV_HEADER,
    rows.map((row) => [
      row.orderDate,
      row.number,
      STATUS_LABEL[row.status] ?? row.status,
      row.supplierName,
      row.supplierCode,
      row.warehouseName,
      row.productName,
      row.sku,
      row.orderedQty,
      row.unitName,
      row.unitPrice,
      row.discountPercent,
      row.taxRate,
      row.lineTotal,
      row.lineCurrency ?? row.orderCurrency,
      row.totalAmount,
      row.paidAmount,
      methodLabels(row.paymentMethods),
      row.expectedDate,
      row.notes,
    ]),
  );
}

export type PurchaseImportRow = {
  number?: string;
  /**
   * Hujjat raqamisiz qatorlarni bitta hujjatga bog'laydigan kalit ("Tezda qo'shish" yuboradi).
   * Hujjat raqami sifatida saqlanmaydi — raqamni tizim o'zi beradi.
   */
  docKey?: string;
  orderDate?: string;
  supplier?: string;
  warehouse?: string;
  product?: string;
  quantity?: string;
  unit?: string;
  price?: string;
  discountPercent?: string;
  taxRate?: string;
  expectedDate?: string;
  notes?: string;
};

type Group = { key: string; number: string | null; rows: { line: number; row: PurchaseImportRow }[] };

/**
 * Bir xil hujjat raqamli qatorlar — bitta hujjat; raqamsiz qator — alohida hujjat.
 * `docKey` berilgan bo'lsa (raqamsiz "Tezda qo'shish") shu kalit bo'yicha birlashadi.
 */
function groupRows(rows: PurchaseImportRow[]): Group[] {
  const groups = new Map<string, Group>();
  rows.forEach((row, index) => {
    const line = index + 1;
    const number = row.number?.trim() || null;
    const docKey = row.docKey?.trim() || null;
    const key = number ? `no:${number.toLowerCase()}` : docKey ? `key:${docKey}` : `row:${line}`;
    const group = groups.get(key) ?? { key, number, rows: [] };
    group.rows.push({ line, row });
    groups.set(key, group);
  });
  return [...groups.values()];
}

export async function importPurchaseOrders(
  tx: Tx,
  tenant: TenantContext,
  rows: PurchaseImportRow[],
  meta: RequestMeta,
  options: { dryRun?: boolean } = {},
): Promise<ImportOutcome & { documents: number }> {
  const companyId = tenant.company.id;
  const dryRun = options.dryRun === true;

  const supplierRows = await tx
    .select({ id: suppliers.id, name: suppliers.name, code: suppliers.code, isActive: suppliers.isActive })
    .from(suppliers)
    .where(eq(suppliers.companyId, companyId));
  const supplierByName = new Map(supplierRows.map((row) => [row.name.trim().toLowerCase(), row]));
  const supplierByCode = new Map(supplierRows.map((row) => [row.code.trim().toLowerCase(), row]));

  const warehouseRows = await tx
    .select({ id: warehouses.id, name: warehouses.name, isActive: warehouses.isActive })
    .from(warehouses)
    .where(eq(warehouses.companyId, companyId));
  const warehouseByName = new Map(warehouseRows.map((row) => [row.name.trim().toLowerCase(), row]));

  const productRows = await tx
    .select({ id: products.id, name: products.name, sku: products.sku, baseUnitId: products.baseUnitId })
    .from(products)
    .where(eq(products.companyId, companyId));
  const productBySku = new Map(productRows.map((row) => [row.sku.trim().toLowerCase(), row]));
  const productByName = new Map(productRows.map((row) => [row.name.trim().toLowerCase(), row]));

  // Yangi mahsulot ochish uchun ruxsat bormi (bo'lmasa — tushunarli xato, import to'xtamaydi)
  const canCreateProducts = (await effectivePermissions(tx, tenant)).includes("products.create");
  const unitRows = await tx.select({ id: units.id, name: units.name, shortName: units.shortName }).from(units);
  /** Faylda birlik ko'rsatilmasa — "dona" (yoki birinchi birlik). */
  const defaultUnitId = unitRows.find((unit) => unit.shortName.trim().toLowerCase() === "d")?.id ?? unitRows[0]?.id ?? null;
  const unitByName = new Map<string, string>();
  for (const unit of unitRows) {
    unitByName.set(unit.shortName.trim().toLowerCase(), unit.id);
    unitByName.set(unit.name.trim().toLowerCase(), unit.id);
  }

  const groups = groupRows(rows);
  // Takroriy hujjat raqami: bazadagilar oldindan olinadi (INSERT xatosi tranzaksiyani yiqitmasin)
  const fileNumbers = groups.flatMap((group) => (group.number ? [group.number] : []));
  const takenNumbers = new Set(
    fileNumbers.length === 0
      ? []
      : (
          await tx
            .select({ number: purchaseOrders.number })
            .from(purchaseOrders)
            .where(and(eq(purchaseOrders.companyId, companyId), inArray(purchaseOrders.number, fileNumbers)))
        ).map((row) => row.number.toLowerCase()),
  );

  const errors: ImportError[] = [];
  const duplicates: ImportError[] = [];
  const warnings: ImportError[] = [];
  let created = 0;
  let documents = 0;

  for (const group of groups) {
    const first = group.rows[0]!;
    const fail = (line: number, message: string) => errors.push({ row: line, key: group.number ?? null, message });

    if (group.number && takenNumbers.has(group.number.toLowerCase())) {
      duplicates.push({ row: first.line, key: group.number, message: `"${group.number}" raqamli xarid hujjati allaqachon bor` });
      continue;
    }

    const supplierText = group.rows.map((item) => item.row.supplier?.trim()).find(Boolean);
    if (!supplierText) {
      fail(first.line, "Ta'minotchi majburiy");
      continue;
    }
    const supplier = supplierByCode.get(supplierText.toLowerCase()) ?? supplierByName.get(supplierText.toLowerCase());
    if (!supplier) {
      fail(first.line, `Ta'minotchi topilmadi: ${supplierText} (import yangi ta'minotchi ochmaydi)`);
      continue;
    }
    if (!supplier.isActive) {
      fail(first.line, `Ta'minotchi faol emas: ${supplierText}`);
      continue;
    }

    const warehouseText = group.rows.map((item) => item.row.warehouse?.trim()).find(Boolean);
    if (!warehouseText) {
      fail(first.line, "Ombor majburiy");
      continue;
    }
    const warehouse = warehouseByName.get(warehouseText.toLowerCase());
    if (!warehouse) {
      fail(first.line, `Ombor topilmadi: ${warehouseText}`);
      continue;
    }
    if (!warehouse.isActive) {
      fail(first.line, `Ombor faol emas: ${warehouseText}`);
      continue;
    }

    const dateText = group.rows.map((item) => item.row.orderDate?.trim()).find(Boolean);
    const orderDate = parseIsoDate(dateText);
    if (!orderDate) {
      fail(first.line, "Sana majburiy va YYYY-MM-DD ko'rinishida bo'lishi kerak");
      continue;
    }
    const expectedText = group.rows.map((item) => item.row.expectedDate?.trim()).find(Boolean);
    const expectedDate = expectedText ? parseIsoDate(expectedText) : null;
    if (expectedText && !expectedDate) {
      warnings.push({ row: first.line, key: group.number, message: "Kutilgan sana noto'g'ri — e'tiborsiz qoldirildi" });
    }

    const items: { productId: string; unitId: string; orderedQty: string; unitPrice: string; taxRate?: string; discountPercent?: string; notes?: string | null }[] = [];
    let broken = false;
    for (const { line, row } of group.rows) {
      const productText = row.product?.trim();
      if (!productText) {
        fail(line, "Mahsulot nomi majburiy");
        broken = true;
        continue;
      }
      // Avval nomi bo'yicha, keyin SKU bo'yicha: fayl odatda mahsulot NOMI bilan to'ldiriladi
      let product = productByName.get(productText.toLowerCase()) ?? productBySku.get(productText.toLowerCase());
      const unitText = row.unit?.trim();
      const rowUnitId = unitText ? unitByName.get(unitText.toLowerCase()) : undefined;
      if (unitText && !rowUnitId) {
        fail(line, `O'lchov birligi topilmadi: ${unitText}`);
        broken = true;
        continue;
      }

      // Yangi mahsulot: xaridda birinchi marta uchragan tovar avtomatik ochiladi (SKU o'zi beriladi)
      if (!product) {
        if (!canCreateProducts) {
          fail(line, `Mahsulot topilmadi: ${productText} (yangi mahsulot ochish uchun "products.create" ruxsati kerak)`);
          broken = true;
          continue;
        }
        const baseUnitId = rowUnitId ?? defaultUnitId;
        if (!baseUnitId) {
          fail(line, `O'lchov birligi aniqlanmadi: ${productText} — faylda birlik ustunini to'ldiring`);
          broken = true;
          continue;
        }
        if (dryRun) {
          // Tekshiruvda baza o'zgarmaydi — faqat nima ochilishini ko'rsatamiz
          warnings.push({ row: line, key: group.number, message: `Yangi mahsulot ochiladi: ${productText}` });
          product = { id: `dry-run:${productText.toLowerCase()}`, name: productText, sku: "", baseUnitId };
        } else {
          const createdProduct = await createProduct(
            tx,
            tenant,
            { name: productText, baseUnitId, purchasePrice: cleanNumber(row.price) || "0", salesPrice: "0" },
            meta,
          );
          product = { id: createdProduct.id, name: createdProduct.name, sku: createdProduct.sku, baseUnitId: createdProduct.baseUnitId };
          warnings.push({ row: line, key: group.number, message: `Yangi mahsulot ochildi: ${createdProduct.name} (SKU ${createdProduct.sku})` });
        }
        productByName.set(productText.toLowerCase(), product);
        if (product.sku) productBySku.set(product.sku.trim().toLowerCase(), product);
      }

      const unitId = rowUnitId ?? product.baseUnitId;
      const quantity = Number(cleanNumber(row.quantity));
      if (!Number.isFinite(quantity) || quantity <= 0) {
        fail(line, "Miqdor musbat son bo'lishi kerak");
        broken = true;
        continue;
      }
      const price = Number(cleanNumber(row.price));
      if (!Number.isFinite(price) || price < 0) {
        fail(line, "Narx noto'g'ri son");
        broken = true;
        continue;
      }
      const discount = Number(cleanNumber(row.discountPercent));
      const tax = Number(cleanNumber(row.taxRate));
      if (!Number.isFinite(discount) || discount < 0 || discount > 100 || !Number.isFinite(tax) || tax < 0 || tax > 100) {
        fail(line, "Chegirma yoki soliq 0–100 oralig'ida bo'lishi kerak");
        broken = true;
        continue;
      }

      items.push({
        productId: product.id,
        unitId,
        orderedQty: cleanNumber(row.quantity),
        unitPrice: cleanNumber(row.price),
        taxRate: cleanNumber(row.taxRate),
        discountPercent: cleanNumber(row.discountPercent),
        notes: optionalText(row.notes, 1000),
      });
    }
    if (broken || items.length === 0) continue;

    documents += 1;
    if (dryRun) continue;

    // Qoralama hujjat: zaxira, qarz va jurnal tegilmaydi — mavjud servis va uning tekshiruvlari bilan
    await createOrder(
      tx,
      tenant,
      {
        supplierId: supplier.id,
        warehouseId: warehouse.id,
        orderDate,
        expectedDate,
        notes: optionalText(group.rows.map((item) => item.row.notes).find(Boolean) ?? null, 2000),
        items,
      },
      meta,
      group.number ? { number: group.number } : {},
    );
    if (group.number) takenNumbers.add(group.number.toLowerCase());
    created += 1;
  }

  // `valid` — umumiy shakl (hujjatlar soni), `documents` — xaridga xos nom
  return { created, valid: documents, documents, errors, duplicates, warnings, dryRun };
}
