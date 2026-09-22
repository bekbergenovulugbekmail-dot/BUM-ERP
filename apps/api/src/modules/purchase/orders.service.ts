/**
 * Xarid buyurtmalari va tovar qabuli (convex/purchase/orders.ts).
 *
 * Holatlar: draft → confirmed → partial → received → paid; draft / confirmed → cancelled.
 *
 * Qabul bitta tranzaksiyada: qabul hujjati, buyurtma qatorlari, zaxira (`moveStock`, AVCO),
 * partiya, ta'minotchi qarzi, jurnal (DR tovar zaxirasi / CR kreditorlar).
 *
 * Convex'dan farqlar:
 *  - qabulda mahsulot, birlik va narx mijozdan olinardi (boshqa mahsulotni istalgan narxda
 *    "qabul qilish" mumkin edi), qator boshqa buyurtmaniki ekani va ortiqcha qabul
 *    tekshirilmasdi — endi hammasi buyurtma qatoridan, qoldiqdan ortiq qabul taqiqlangan
 *  - tovar tannarxi chegirma va soliqsiz narxda edi — endi tannarx va qarz buyurtma qatori
 *    summasidan (chegirma va soliq bilan); oxirgi qabul tiyin qoldig'ini yopadi
 *  - o'lchov birligi konversiyasi qo'llanadi ("quti" "dona" bo'lib tushmaydi)
 *  - summalar float emas, butun sonlarda
 *  - qisman qabul qilingan yoki to'lov qilingan buyurtmani bekor qilib bo'lmaydi
 *  - `create` mahsulot/birlik/ombor ruxsatini tekshirmasdi, to'xtatilgan kompaniyada ham yozardi;
 *    raqam parallel yaratishda takrorlanardi; `list` / `getById` ruxsat tekshirmasdi
 */
import { and, asc, desc, eq, getTableColumns, gte, ilike, inArray, lt, lte, or, sql } from "drizzle-orm";
import { badRequest, notFound } from "@bum/shared";
import { batches, products, units } from "../../db/schema/catalog.js";
import { warehouses } from "../../db/schema/inventory.js";
import {
  purchaseOrderCurrencies,
  purchaseOrderItems,
  purchaseOrders,
  purchaseReceiptItems,
  purchaseReceipts,
  purchaseReturns,
  supplierPayments,
  suppliers,
} from "../../db/schema/purchase.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { UUID_RE, decodeCursor, encodeCursor } from "../../shared/cursor.js";
import { fromMinor, mulDivRound, rescale, toMinor } from "../../shared/decimal.js";
import { computeLine } from "../../shared/line-amounts.js";
import { effectiveTaxRate, isTaxEnabled } from "../company/tax-settings.service.js";
import { nextDocumentNumber } from "../../shared/numbering.js";
import { unitFactorToBase } from "../catalog/conversions.js";
import { effectivePermissions, type TenantContext } from "../company/tenant.js";
import { companyCurrency } from "../finance/accounts.service.js";
import { todayIso } from "../finance/cash.service.js";
import { currencyRate } from "../finance/currencies.service.js";
import { postJournalEntry, requireAccountBySubtype } from "../finance/journal.service.js";
import { moveStock } from "../inventory/stock.service.js";
import { allocateBackorders } from "../inventory/backorders.service.js";
import { allowedWarehouses, assertWarehouseAccess } from "../inventory/warehouses.service.js";
import { assertProductsInScope, categoryScope, documentHasScopedItem } from "../catalog/category-scope.js";
import { applySupplierBalance } from "./supplier-balances.service.js";
import { purchaseAudit } from "./suppliers.service.js";

const { legacyId: _l1, companyId: _c1, ...orderFields } = getTableColumns(purchaseOrders);
const { legacyId: _l2, companyId: _c2, ...itemFields } = getTableColumns(purchaseOrderItems);
const { legacyId: _l3, companyId: _c3, ...receiptFields } = getTableColumns(purchaseReceipts);
const { legacyId: _l4, companyId: _c4, ...receiptItemFields } = getTableColumns(purchaseReceiptItems);
const { legacyId: _l5, companyId: _c5, ...paymentFields } = getTableColumns(supplierPayments);

export type PurchaseOrderStatus = (typeof purchaseOrders.status.enumValues)[number];

export type OrderItemInput = {
  /** Faqat kassada xarid (offline): qurilmada yaratilgan qator ID'si — qaytarish shunga bog'lanadi. */
  id?: string;
  productId: string;
  unitId: string;
  orderedQty: string;
  unitPrice: string;
  taxRate?: string;
  discountPercent?: string;
  notes?: string | null;
  /** Qator valyutasi; null/asosiy — asosiy valyuta. Narx shu valyutada. */
  currency?: string | null;
  /** Qabulda mahsulotga yoziladigan sotuv narxi (asosiy birlik uchun) va valyutasi. */
  salesPrice?: string | null;
  salesCurrency?: string | null;
};

export type OrderInput = {
  supplierId: string;
  warehouseId: string;
  orderDate: string;
  expectedDate?: string | null;
  notes?: string | null;
  items: OrderItemInput[];
};

async function prepareItems(tx: Tx, companyId: string, items: OrderItemInput[], rateOverrides?: Record<string, string>) {
  if (items.length === 0) throw badRequest("Buyurtmada kamida bitta mahsulot bo'lishi kerak");

  const baseCurrency = await companyCurrency(tx, companyId);
  const rates = new Map<string, string>([[baseCurrency, "1.0000"]]);
  const rateOf = async (code: string) => {
    if (!rates.has(code)) rates.set(code, rateOverrides?.[code] ?? (await currencyRate(tx, companyId, code)));
    return rates.get(code)!;
  };

  const rows = await tx
    .select({
      id: products.id,
      name: products.name,
      baseUnitId: products.baseUnitId,
      isActive: products.isActive,
      isPurchaseable: products.isPurchaseable,
    })
    .from(products)
    .where(and(eq(products.companyId, companyId), inArray(products.id, [...new Set(items.map((i) => i.productId))])));
  const byId = new Map(rows.map((p) => [p.id, p]));

  let subtotal = 0n;
  let taxAmount = 0n;
  let discountAmount = 0n;
  const currencyTotals = new Map<string, bigint>();
  const prepared: (OrderItemInput & {
    currency: string | null;
    exchangeRate: string;
    taxRate: string;
    discountPercent: string;
    lineTotal: string;
    salesPrice: string | null;
    salesCurrency: string | null;
  })[] = [];
  const taxOn = await isTaxEnabled(tx, companyId);
  for (const item of items) {
    const product = byId.get(item.productId);
    if (!product) throw badRequest("Mahsulot topilmadi");
    if (!product.isActive || !product.isPurchaseable) throw badRequest(`${product.name}: mahsulot xarid qilinmaydi`);
    if (toMinor(item.orderedQty, 4) <= 0n) throw badRequest(`${product.name}: miqdor musbat bo'lishi kerak`);
    await unitFactorToBase(tx, companyId, product, item.unitId);

    const code = item.currency ?? baseCurrency;
    const rate = await rateOf(code);
    const salesCurrency = item.salesCurrency && item.salesCurrency !== baseCurrency ? item.salesCurrency : null;
    if (salesCurrency) await rateOf(salesCurrency);

    // Ta'minotchi narxi soliqsiz — soliq ustiga qo'shiladi; qator summasi o'z valyutasida,
    // buyurtma jami asosiy valyutada (buyurtma kunidagi kurs bilan)
    // Soliq kompaniya sozlamasida o'chirilgan bo'lsa — stavka 0
    const taxRate = effectiveTaxRate(item.taxRate ?? "0", taxOn);
    const amounts = computeLine({ ...item, taxRate, quantity: item.orderedQty });
    const inBase = (minor: bigint) => rescale(minor * toMinor(rate, 4), 6, 2);
    subtotal += inBase(amounts.net);
    taxAmount += inBase(amounts.tax);
    discountAmount += inBase(amounts.discount);
    currencyTotals.set(code, (currencyTotals.get(code) ?? 0n) + amounts.lineTotal);
    prepared.push({
      ...item,
      currency: code === baseCurrency ? null : code,
      exchangeRate: rate,
      taxRate,
      discountPercent: item.discountPercent ?? "0",
      lineTotal: fromMinor(amounts.lineTotal),
      salesPrice: item.salesPrice ?? null,
      salesCurrency: item.salesPrice ? salesCurrency : null,
    });
  }

  return {
    items: prepared,
    totals: {
      subtotal: fromMinor(subtotal),
      taxAmount: fromMinor(taxAmount),
      discountAmount: fromMinor(discountAmount),
      totalAmount: fromMinor(subtotal + taxAmount),
    },
    currencyTotals: [...currencyTotals].map(([currency, total]) => ({ currency, totalAmount: fromMinor(total) })),
  };
}

async function replaceOrderCurrencies(
  tx: Tx,
  companyId: string,
  orderId: string,
  totals: { currency: string; totalAmount: string }[],
) {
  await tx.delete(purchaseOrderCurrencies).where(eq(purchaseOrderCurrencies.orderId, orderId));
  if (totals.length > 0) {
    await tx
      .insert(purchaseOrderCurrencies)
      .values(totals.map((total) => ({ companyId, orderId, currency: total.currency, totalAmount: total.totalAmount })));
  }
}

/** Har valyuta bo'yicha to'liq to'langanmi. */
async function orderFullyPaid(tx: Tx, orderId: string) {
  const buckets = await tx
    .select({ totalAmount: purchaseOrderCurrencies.totalAmount, paidAmount: purchaseOrderCurrencies.paidAmount })
    .from(purchaseOrderCurrencies)
    .where(eq(purchaseOrderCurrencies.orderId, orderId));
  return buckets.length > 0 && buckets.every((b) => toMinor(b.paidAmount) >= toMinor(b.totalAmount));
}

async function assertSupplierAndWarehouse(tx: Tx, tenant: TenantContext, supplierId: string, warehouseId: string) {
  const [supplier] = await tx
    .select({ isActive: suppliers.isActive })
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.companyId, tenant.company.id)))
    .limit(1);
  if (!supplier) throw badRequest("Ta'minotchi topilmadi");
  if (!supplier.isActive) throw badRequest("Ta'minotchi faol emas");

  const [warehouse] = await tx
    .select({ isActive: warehouses.isActive })
    .from(warehouses)
    .where(and(eq(warehouses.id, warehouseId), eq(warehouses.companyId, tenant.company.id)))
    .limit(1);
  if (!warehouse) throw badRequest("Ombor topilmadi");
  if (!warehouse.isActive) throw badRequest("Ombor faol emas");
  assertWarehouseAccess(tenant, warehouseId);
}

async function insertItems(tx: Tx, companyId: string, orderId: string, items: Awaited<ReturnType<typeof prepareItems>>["items"]) {
  await tx.insert(purchaseOrderItems).values(
    items.map((item) => ({
      ...(item.id ? { id: item.id } : {}),
      companyId,
      orderId,
      productId: item.productId,
      unitId: item.unitId,
      orderedQty: item.orderedQty,
      unitPrice: item.unitPrice,
      taxRate: item.taxRate,
      discountPercent: item.discountPercent,
      lineTotal: item.lineTotal,
      currency: item.currency,
      exchangeRate: item.exchangeRate,
      salesPrice: item.salesPrice,
      salesCurrency: item.salesCurrency,
      notes: item.notes ?? null,
    })),
  );
}

async function lockOrder(tx: Tx, tenant: TenantContext, orderId: string) {
  const [order] = await tx
    .select(orderFields)
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, orderId), eq(purchaseOrders.companyId, tenant.company.id)))
    .limit(1)
    .for("update");
  if (!order) throw notFound("Buyurtma topilmadi");
  // Tahrir, tasdiq, bekor qilish, qabul — faqat ruxsat berilgan ombor buyurtmasi
  assertWarehouseAccess(tenant, order.warehouseId);
  return order;
}

/** Cheklangan xodim: buyurtmadagi barcha mahsulotlar uning kategoriyalarida bo'lishi kerak. */
async function assertOrderInScope(tx: Tx, tenant: TenantContext, orderId: string) {
  const rows = await tx
    .select({ productId: purchaseOrderItems.productId })
    .from(purchaseOrderItems)
    .where(eq(purchaseOrderItems.orderId, orderId));
  await assertProductsInScope(tx, tenant, rows.map((r) => r.productId));
}

// ─── O'qish ──────────────────────────────────────────────────────────────────

const balanceSql = sql<string>`(${purchaseOrders.totalAmount} - ${purchaseOrders.paidAmount})::numeric(18,2)`;

export async function getOrder(conn: DbOrTx, tenant: TenantContext, orderId: string) {
  const [order] = await conn
    .select({
      ...orderFields,
      supplierName: suppliers.name,
      supplierPhone: suppliers.phone,
      warehouseName: warehouses.name,
      balance: balanceSql,
    })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .innerJoin(warehouses, eq(warehouses.id, purchaseOrders.warehouseId))
    .where(and(eq(purchaseOrders.id, orderId), eq(purchaseOrders.companyId, tenant.company.id)))
    .limit(1);
  if (!order) throw notFound("Buyurtma topilmadi");
  assertWarehouseAccess(tenant, order.warehouseId);

  const items = await conn
    .select({
      ...itemFields,
      productName: products.name,
      productSku: products.sku,
      productCategoryId: products.categoryId,
      unitName: units.shortName,
      pendingQty: sql<string>`(${purchaseOrderItems.orderedQty} - ${purchaseOrderItems.receivedQty})::numeric(18,4)`,
    })
    .from(purchaseOrderItems)
    .innerJoin(products, eq(products.id, purchaseOrderItems.productId))
    .innerJoin(units, eq(units.id, purchaseOrderItems.unitId))
    .where(eq(purchaseOrderItems.orderId, orderId))
    .orderBy(asc(products.name), asc(purchaseOrderItems.id));

  // Cheklangan xodim o'z kategoriyasidagi mahsulot qatnashmagan buyurtmani ko'rmaydi
  const scope = await categoryScope(conn, tenant);
  if (scope !== null && items.length > 0 && !items.some((i) => i.productCategoryId && scope.includes(i.productCategoryId))) {
    throw notFound("Buyurtma topilmadi");
  }

  const receipts = await conn
    .select(receiptFields)
    .from(purchaseReceipts)
    .where(eq(purchaseReceipts.orderId, orderId))
    .orderBy(asc(purchaseReceipts.createdAt));
  const receiptItems = receipts.length
    ? await conn
        .select(receiptItemFields)
        .from(purchaseReceiptItems)
        .where(inArray(purchaseReceiptItems.receiptId, receipts.map((r) => r.id)))
    : [];

  const payments = await conn
    .select(paymentFields)
    .from(supplierPayments)
    .where(eq(supplierPayments.orderId, orderId))
    .orderBy(asc(supplierPayments.createdAt));

  const currencyTotals = await conn
    .select({
      currency: purchaseOrderCurrencies.currency,
      totalAmount: purchaseOrderCurrencies.totalAmount,
      paidAmount: purchaseOrderCurrencies.paidAmount,
    })
    .from(purchaseOrderCurrencies)
    .where(eq(purchaseOrderCurrencies.orderId, orderId))
    .orderBy(asc(purchaseOrderCurrencies.currency));

  const returns = await conn
    .select({
      id: purchaseReturns.id,
      number: purchaseReturns.number,
      returnDate: purchaseReturns.returnDate,
      totalAmount: purchaseReturns.totalAmount,
      refundMethod: purchaseReturns.refundMethod,
      refundAmount: purchaseReturns.refundAmount,
      reason: purchaseReturns.reason,
      createdAt: purchaseReturns.createdAt,
    })
    .from(purchaseReturns)
    .where(eq(purchaseReturns.orderId, orderId))
    .orderBy(asc(purchaseReturns.createdAt));

  return {
    ...order,
    currencyTotals,
    items,
    receipts: receipts.map((r) => ({ ...r, items: receiptItems.filter((i) => i.receiptId === r.id) })),
    payments,
    returns,
  };
}

export async function listOrders(
  conn: DbOrTx,
  tenant: TenantContext,
  options: {
    supplierId?: string;
    status?: PurchaseOrderStatus;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
    limit: number;
    cursor?: string;
  },
) {
  let after: { date: string; id: string } | null = null;
  if (options.cursor) {
    const [date, id] = decodeCursor(options.cursor, 2) as [string, string];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !UUID_RE.test(id)) throw badRequest("Kursor noto'g'ri");
    after = { date, id };
  }
  const pattern = options.search ? `%${options.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const scope = await categoryScope(conn, tenant);

  const rows = await conn
    .select({
      ...orderFields,
      supplierName: suppliers.name,
      warehouseName: warehouses.name,
      itemCount: sql<number>`(select count(*)::int from ${purchaseOrderItems} where ${purchaseOrderItems.orderId} = ${purchaseOrders.id})`,
      balance: balanceSql,
    })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .innerJoin(warehouses, eq(warehouses.id, purchaseOrders.warehouseId))
    .where(
      and(
        eq(purchaseOrders.companyId, tenant.company.id),
        // Ombor cheklovi bor a'zo — faqat ruxsat berilgan omborlar xaridlari
        allowedWarehouses(tenant) ? inArray(purchaseOrders.warehouseId, allowedWarehouses(tenant)!) : undefined,
        options.supplierId ? eq(purchaseOrders.supplierId, options.supplierId) : undefined,
        options.status ? eq(purchaseOrders.status, options.status) : undefined,
        options.dateFrom ? gte(purchaseOrders.orderDate, options.dateFrom) : undefined,
        options.dateTo ? lte(purchaseOrders.orderDate, options.dateTo) : undefined,
        pattern ? or(ilike(purchaseOrders.number, pattern), ilike(suppliers.name, pattern)) : undefined,
        documentHasScopedItem(
          scope,
          sql`${purchaseOrderItems}`,
          sql`${purchaseOrderItems.orderId}`,
          sql`${purchaseOrderItems.productId}`,
          sql`${purchaseOrders.id}`,
        ),
        after
          ? or(
              lt(purchaseOrders.orderDate, after.date),
              and(eq(purchaseOrders.orderDate, after.date), lt(purchaseOrders.id, after.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(purchaseOrders.orderDate), desc(purchaseOrders.id))
    .limit(options.limit + 1);

  const page = rows.slice(0, options.limit);
  const last = page.at(-1);
  return {
    orders: page,
    nextCursor: rows.length > options.limit && last ? encodeCursor([last.orderDate, last.id]) : null,
  };
}

// ─── Buyurtma hayot sikli ────────────────────────────────────────────────────

/** Kassada xarid (desktop kassa, offline): qurilmadagi ID, raqam (`K01-P000001`), qurilma, vaqt va kurslar. */
export type DirectOrderOptions = {
  id?: string;
  number?: string;
  deviceId?: string;
  createdAt?: Date;
  rates?: Record<string, string>;
  /** Tasdiqlangan holda yaratish (kassada xarid darhol qabul qilinadi). */
  confirmed?: boolean;
};

export async function createOrder(tx: Tx, tenant: TenantContext, input: OrderInput, meta: RequestMeta, options: DirectOrderOptions = {}) {
  const companyId = tenant.company.id;
  await assertSupplierAndWarehouse(tx, tenant, input.supplierId, input.warehouseId);
  await assertProductsInScope(tx, tenant, input.items.map((i) => i.productId));
  const { items, totals, currencyTotals } = await prepareItems(tx, companyId, input.items, options.rates);

  const number =
    options.number ??
    (await nextDocumentNumber(tx, {
      table: purchaseOrders,
      column: purchaseOrders.number,
      companyColumn: purchaseOrders.companyId,
      companyId,
      prefix: `PO-${input.orderDate.slice(0, 4)}-`,
      width: 4,
    }));

  const [order] = await tx
    .insert(purchaseOrders)
    .values({
      companyId,
      number,
      supplierId: input.supplierId,
      warehouseId: input.warehouseId,
      orderDate: input.orderDate,
      expectedDate: input.expectedDate ?? null,
      notes: input.notes ?? null,
      currency: await companyCurrency(tx, companyId),
      ...totals,
      createdBy: tenant.user.id,
      ...(options.id ? { id: options.id } : {}),
      ...(options.deviceId ? { deviceId: options.deviceId } : {}),
      ...(options.createdAt ? { createdAt: options.createdAt } : {}),
      ...(options.confirmed ? { status: "confirmed" as const } : {}),
    })
    .returning({ id: purchaseOrders.id });
  await insertItems(tx, companyId, order!.id, items);
  await replaceOrderCurrencies(tx, companyId, order!.id, currencyTotals);

  await purchaseAudit(tx, tenant, meta, {
    action: "PURCHASE_ORDER_CREATED",
    resource: "purchase_orders",
    resourceId: order!.id,
    details: {
      number,
      supplierId: input.supplierId,
      totalAmount: totals.totalAmount,
      ...(options.deviceId ? { deviceId: options.deviceId, confirmed: !!options.confirmed } : {}),
    },
  });
  return getOrder(tx, tenant, order!.id);
}

export async function updateOrder(
  tx: Tx,
  tenant: TenantContext,
  orderId: string,
  patch: Partial<OrderInput>,
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const order = await lockOrder(tx, tenant, orderId);
  if (order.status !== "draft") throw badRequest("Faqat qoralama buyurtmani tahrirlash mumkin");
  await assertOrderInScope(tx, tenant, orderId);
  if (patch.items) await assertProductsInScope(tx, tenant, patch.items.map((i) => i.productId));

  const supplierId = patch.supplierId ?? order.supplierId;
  const warehouseId = patch.warehouseId ?? order.warehouseId;
  if (patch.supplierId || patch.warehouseId) await assertSupplierAndWarehouse(tx, tenant, supplierId, warehouseId);

  let totals = {};
  if (patch.items) {
    const prepared = await prepareItems(tx, companyId, patch.items);
    await tx.delete(purchaseOrderItems).where(eq(purchaseOrderItems.orderId, orderId));
    await insertItems(tx, companyId, orderId, prepared.items);
    await replaceOrderCurrencies(tx, companyId, orderId, prepared.currencyTotals);
    totals = prepared.totals;
  }

  await tx
    .update(purchaseOrders)
    .set({
      supplierId,
      warehouseId,
      ...(patch.orderDate ? { orderDate: patch.orderDate } : {}),
      ...(patch.expectedDate !== undefined ? { expectedDate: patch.expectedDate } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...totals,
      updatedAt: new Date(),
    })
    .where(eq(purchaseOrders.id, orderId));

  await purchaseAudit(tx, tenant, meta, {
    action: "PURCHASE_ORDER_UPDATED",
    resource: "purchase_orders",
    resourceId: orderId,
    details: { number: order.number, changes: Object.keys(patch) },
  });
  return getOrder(tx, tenant, orderId);
}

export async function confirmOrder(tx: Tx, tenant: TenantContext, orderId: string, meta: RequestMeta) {
  const order = await lockOrder(tx, tenant, orderId);
  if (order.status !== "draft") throw badRequest("Faqat qoralama buyurtmani tasdiqlash mumkin");
  await assertOrderInScope(tx, tenant, orderId);

  await tx
    .update(purchaseOrders)
    .set({ status: "confirmed", updatedAt: new Date() })
    .where(eq(purchaseOrders.id, orderId));
  await purchaseAudit(tx, tenant, meta, {
    action: "PURCHASE_ORDER_CONFIRMED",
    resource: "purchase_orders",
    resourceId: orderId,
    details: { number: order.number },
  });
  return getOrder(tx, tenant, orderId);
}

export async function cancelOrder(tx: Tx, tenant: TenantContext, orderId: string, reason: string | null, meta: RequestMeta) {
  const order = await lockOrder(tx, tenant, orderId);
  if (order.status !== "draft" && order.status !== "confirmed") {
    throw badRequest("Tovar qabul qilingan yoki yakunlangan buyurtmani bekor qilib bo'lmaydi");
  }
  if (toMinor(order.paidAmount) > 0n) throw badRequest("To'lov qilingan buyurtmani bekor qilib bo'lmaydi");
  await assertOrderInScope(tx, tenant, orderId);

  await tx
    .update(purchaseOrders)
    .set({ status: "cancelled", notes: reason ?? order.notes, updatedAt: new Date() })
    .where(eq(purchaseOrders.id, orderId));
  await purchaseAudit(tx, tenant, meta, {
    action: "PURCHASE_ORDER_CANCELLED",
    resource: "purchase_orders",
    resourceId: orderId,
    details: { number: order.number, reason },
  });
  return getOrder(tx, tenant, orderId);
}

// ─── Tovar qabuli ────────────────────────────────────────────────────────────

export type ReceiptInput = {
  receiptDate?: string;
  notes?: string | null;
  items: { orderItemId: string; receivedQty: string; batchNumber?: string | null; expiryDate?: string | null }[];
};

/** Kassada xarid qabuli: qurilmadagi kurslar (tannarx va qarz shu kursda) va qabul vaqti. */
export type ReceiveOptions = { rates?: Record<string, string>; occurredAt?: Date };

export async function receiveGoods(
  tx: Tx,
  tenant: TenantContext,
  orderId: string,
  input: ReceiptInput,
  meta: RequestMeta,
  options: ReceiveOptions = {},
) {
  const companyId = tenant.company.id;
  // Xarid qatoridagi sotuv narxi mahsulotga faqat qabul qiluvchida `products.edit` bo'lsa yoziladi (xarid ruxsati bilan
  // chakana narxni o'zgartirib bo'lmaydi); bo'lmasa narx o'zgarmaydi, tovar baribir qabul qilinadi
  let productsEditable: boolean | null = null;
  const canEditProducts = async () => (productsEditable ??= (await effectivePermissions(tx, tenant)).includes("products.edit"));
  const order = await lockOrder(tx, tenant, orderId);
  if (order.status !== "confirmed" && order.status !== "partial" && order.status !== "paid") {
    throw badRequest("Faqat tasdiqlangan buyurtma bo'yicha tovar qabul qilinadi");
  }
  assertWarehouseAccess(tenant, order.warehouseId);

  const orderItems = await tx
    .select(itemFields)
    .from(purchaseOrderItems)
    .where(eq(purchaseOrderItems.orderId, orderId))
    .for("update");
  const itemById = new Map(orderItems.map((i) => [i.id, i]));
  await assertProductsInScope(
    tx,
    tenant,
    input.items.map((line) => itemById.get(line.orderItemId)?.productId).filter((id): id is string => Boolean(id)),
  );
  if (new Set(input.items.map((i) => i.orderItemId)).size !== input.items.length) {
    throw badRequest("Bir qator ikki marta kiritilgan");
  }

  const productRows = await tx
    .select({
      id: products.id,
      name: products.name,
      baseUnitId: products.baseUnitId,
      trackBatch: products.trackBatch,
      trackExpiry: products.trackExpiry,
    })
    .from(products)
    .where(inArray(products.id, [...new Set(orderItems.map((i) => i.productId))]));
  const productById = new Map(productRows.map((p) => [p.id, p]));

  const receiptDate = input.receiptDate ?? todayIso();
  const [receipt] = await tx
    .insert(purchaseReceipts)
    .values({
      companyId,
      orderId,
      supplierId: order.supplierId,
      warehouseId: order.warehouseId,
      receiptDate,
      notes: input.notes ?? null,
      createdBy: tenant.user.id,
    })
    .returning(receiptFields);

  const baseCurrency = await companyCurrency(tx, companyId);
  // Valyuta bo'yicha: ta'minotchi qarzi (o'z valyutasida) va kitob qiymati (asosiy valyutada)
  const byCurrency = new Map<string, { foreign: bigint; base: bigint }>();
  let total = 0n;
  for (const line of input.items) {
    const orderItem = itemById.get(line.orderItemId);
    if (!orderItem) throw badRequest("Buyurtma qatori topilmadi");
    const product = productById.get(orderItem.productId)!;

    const received = toMinor(line.receivedQty, 4);
    const ordered = toMinor(orderItem.orderedQty, 4);
    const remaining = ordered - toMinor(orderItem.receivedQty, 4);
    if (received <= 0n) throw badRequest(`${product.name}: miqdor musbat bo'lishi kerak`);
    if (received > remaining) {
      throw badRequest(`${product.name}: buyurtmadan ortiq qabul qilib bo'lmaydi (qolgan ${fromMinor(remaining, 4)})`);
    }
    if (product.trackBatch && !line.batchNumber) throw badRequest(`${product.name}: partiya raqami kiritilishi shart`);
    if (product.trackExpiry && !line.expiryDate) throw badRequest(`${product.name}: yaroqlilik muddati kiritilishi shart`);

    // Qiymat qator summasidan ulush; oxirgi qabul oldingilardan qolganini to'liq oladi
    const lineTotal = toMinor(orderItem.lineTotal);
    let value: bigint;
    if (received === remaining) {
      const [prior] = await tx
        .select({ sum: sql<string>`coalesce(sum(${purchaseReceiptItems.lineTotal}), 0)::numeric(18,2)` })
        .from(purchaseReceiptItems)
        .where(eq(purchaseReceiptItems.orderItemId, orderItem.id));
      value = lineTotal - toMinor(prior!.sum);
    } else {
      value = mulDivRound(received, lineTotal, ordered);
    }

    // Qiymat qator valyutasida; tannarx va kreditorlar asosiy valyutada — qabul kunidagi (joriy) kurs bilan
    const lineCurrency = orderItem.currency ?? baseCurrency;
    const rate = orderItem.currency ? (options.rates?.[orderItem.currency] ?? (await currencyRate(tx, companyId, orderItem.currency))) : "1.0000";
    const baseValue = orderItem.currency ? rescale(value * toMinor(rate, 4), 6, 2) : value;

    const factor = await unitFactorToBase(tx, companyId, product, orderItem.unitId);
    const baseQty = rescale(received * toMinor(factor, 4), 8, 4);
    if (baseQty <= 0n) throw badRequest(`${product.name}: miqdor juda kichik`);
    const costPerBase = fromMinor(mulDivRound(baseValue, 1_000_000n, baseQty), 4);

    let batchId: string | null = null;
    if (line.batchNumber) {
      const [batch] = await tx
        .insert(batches)
        .values({
          companyId,
          productId: product.id,
          batchNumber: line.batchNumber,
          supplierId: order.supplierId,
          warehouseId: order.warehouseId,
          expiryDate: line.expiryDate ?? null,
          quantity: fromMinor(baseQty, 4),
          unitId: product.baseUnitId,
          costPrice: costPerBase,
        })
        .returning({ id: batches.id });
      batchId = batch!.id;
    }

    await tx.insert(purchaseReceiptItems).values({
      companyId,
      receiptId: receipt!.id,
      orderItemId: orderItem.id,
      productId: product.id,
      unitId: orderItem.unitId,
      receivedQty: fromMinor(received, 4),
      unitPrice: fromMinor(mulDivRound(baseValue, 1_000_000n, received), 4),
      lineTotal: fromMinor(baseValue),
      currency: orderItem.currency,
      exchangeRate: rate,
      foreignTotal: fromMinor(value),
      batchNumber: line.batchNumber ?? null,
      expiryDate: line.expiryDate ?? null,
    });
    await tx
      .update(purchaseOrderItems)
      .set({ receivedQty: sql`${purchaseOrderItems.receivedQty} + ${fromMinor(received, 4)}::numeric`, updatedAt: new Date() })
      .where(eq(purchaseOrderItems.id, orderItem.id));
    orderItem.receivedQty = fromMinor(ordered - remaining + received, 4);

    await moveStock(tx, companyId, tenant.user.id, {
      type: "receive",
      productId: product.id,
      warehouseId: order.warehouseId,
      quantity: fromMinor(baseQty, 4),
      costPrice: costPerBase,
      batchId,
      referenceType: "purchase_receipt",
      referenceId: receipt!.id,
      notes: `Xarid: ${order.number}`,
      occurredAt: options.occurredAt,
    });

    // Xaridda belgilangan yangi sotuv narxi mahsulotga yoziladi
    if (orderItem.salesPrice !== null && (await canEditProducts())) {
      await tx
        .update(products)
        .set({ salesPrice: orderItem.salesPrice, salesCurrency: orderItem.salesCurrency, updatedAt: new Date() })
        .where(eq(products.id, product.id));
    }

    total += baseValue;
    const bucket = byCurrency.get(lineCurrency) ?? { foreign: 0n, base: 0n };
    bucket.foreign += value;
    bucket.base += baseValue;
    byCurrency.set(lineCurrency, bucket);
  }

  const allReceived = orderItems.every((i) => toMinor(i.receivedQty, 4) >= toMinor(i.orderedQty, 4));
  const fullyPaid = await orderFullyPaid(tx, orderId);
  const status: PurchaseOrderStatus = allReceived ? (fullyPaid ? "paid" : "received") : "partial";
  await tx.update(purchaseOrders).set({ status, updatedAt: new Date() }).where(eq(purchaseOrders.id, orderId));

  const totalText = fromMinor(total);
  await tx
    .update(suppliers)
    .set({ totalPurchased: sql`${suppliers.totalPurchased} + ${totalText}::numeric`, updatedAt: new Date() })
    .where(eq(suppliers.id, order.supplierId));

  if (total > 0n) {
    await postJournalEntry(tx, companyId, tenant.user.id, {
      entryDate: receiptDate,
      description: `Tovar qabul: ${order.number}`,
      referenceType: "purchase_receipt",
      referenceId: receipt!.id,
      lines: [
        { accountId: await requireAccountBySubtype(tx, companyId, "inventory", "asset", "Tovar zaxirasi"), debit: totalText },
        { accountId: await requireAccountBySubtype(tx, companyId, "payable", "liability", "Kreditorlar"), credit: totalText },
      ],
    });
  }

  // Ta'minotchi qarzi valyuta bo'yicha; `total_debt` kitob qiymati bilan birga yangilanadi
  for (const [currency, amounts] of byCurrency) {
    await applySupplierBalance(tx, {
      companyId,
      userId: tenant.user.id,
      supplierId: order.supplierId,
      currency,
      debtDelta: amounts.foreign,
      bookDelta: amounts.base,
      date: receiptDate,
      description: order.number,
    });
  }

  // Tovar keldi — mijozga va'da qilingan (backorder) qatorlar shu tranzaksiyada band qilinadi:
  // eng eski buyurtmadan boshlab. Zaxira invarianti (`reserved_qty <= quantity`) saqlanadi.
  const allocations = await allocateBackorders(tx, companyId, order.warehouseId, orderItems.map((item) => item.productId));

  await purchaseAudit(tx, tenant, meta, {
    action: "PURCHASE_GOODS_RECEIVED",
    resource: "purchase_receipts",
    resourceId: receipt!.id,
    details: { orderId, number: order.number, total: totalText, status, ...(allocations.length > 0 ? { backorderAllocations: allocations } : {}) },
  });
  return { receipt: receipt!, total: totalText, status, allocations };
}
