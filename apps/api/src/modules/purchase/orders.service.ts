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
  purchaseOrderItems,
  purchaseOrders,
  purchaseReceiptItems,
  purchaseReceipts,
  supplierPayments,
  suppliers,
} from "../../db/schema/purchase.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { UUID_RE, decodeCursor, encodeCursor } from "../../shared/cursor.js";
import { fromMinor, mulDivRound, rescale, toMinor } from "../../shared/decimal.js";
import { computeLine } from "../../shared/line-amounts.js";
import { nextDocumentNumber } from "../../shared/numbering.js";
import { unitFactorToBase } from "../catalog/conversions.js";
import type { TenantContext } from "../company/tenant.js";
import { companyCurrency } from "../finance/accounts.service.js";
import { todayIso } from "../finance/cash.service.js";
import { postJournalEntry, requireAccountBySubtype } from "../finance/journal.service.js";
import { moveStock } from "../inventory/stock.service.js";
import { assertWarehouseAccess } from "../inventory/warehouses.service.js";
import { purchaseAudit } from "./suppliers.service.js";

const { legacyId: _l1, companyId: _c1, ...orderFields } = getTableColumns(purchaseOrders);
const { legacyId: _l2, companyId: _c2, ...itemFields } = getTableColumns(purchaseOrderItems);
const { legacyId: _l3, companyId: _c3, ...receiptFields } = getTableColumns(purchaseReceipts);
const { legacyId: _l4, companyId: _c4, ...receiptItemFields } = getTableColumns(purchaseReceiptItems);
const { legacyId: _l5, companyId: _c5, ...paymentFields } = getTableColumns(supplierPayments);

export type PurchaseOrderStatus = (typeof purchaseOrders.status.enumValues)[number];

export type OrderItemInput = {
  productId: string;
  unitId: string;
  orderedQty: string;
  unitPrice: string;
  taxRate?: string;
  discountPercent?: string;
  notes?: string | null;
};

export type OrderInput = {
  supplierId: string;
  warehouseId: string;
  orderDate: string;
  expectedDate?: string | null;
  notes?: string | null;
  items: OrderItemInput[];
};

async function prepareItems(tx: Tx, companyId: string, items: OrderItemInput[]) {
  if (items.length === 0) throw badRequest("Buyurtmada kamida bitta mahsulot bo'lishi kerak");

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
  const prepared: (OrderItemInput & { taxRate: string; discountPercent: string; lineTotal: string })[] = [];
  for (const item of items) {
    const product = byId.get(item.productId);
    if (!product) throw badRequest("Mahsulot topilmadi");
    if (!product.isActive || !product.isPurchaseable) throw badRequest(`${product.name}: mahsulot xarid qilinmaydi`);
    if (toMinor(item.orderedQty, 4) <= 0n) throw badRequest(`${product.name}: miqdor musbat bo'lishi kerak`);
    await unitFactorToBase(tx, companyId, product, item.unitId);

    // Ta'minotchi narxi soliqsiz — soliq ustiga qo'shiladi
    const amounts = computeLine({ ...item, quantity: item.orderedQty });
    subtotal += amounts.net;
    taxAmount += amounts.tax;
    discountAmount += amounts.discount;
    prepared.push({
      ...item,
      taxRate: item.taxRate ?? "0",
      discountPercent: item.discountPercent ?? "0",
      lineTotal: fromMinor(amounts.lineTotal),
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
  };
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
      companyId,
      orderId,
      productId: item.productId,
      unitId: item.unitId,
      orderedQty: item.orderedQty,
      unitPrice: item.unitPrice,
      taxRate: item.taxRate,
      discountPercent: item.discountPercent,
      lineTotal: item.lineTotal,
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
  return order;
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

  const items = await conn
    .select({
      ...itemFields,
      productName: products.name,
      productSku: products.sku,
      unitName: units.shortName,
      pendingQty: sql<string>`(${purchaseOrderItems.orderedQty} - ${purchaseOrderItems.receivedQty})::numeric(18,4)`,
    })
    .from(purchaseOrderItems)
    .innerJoin(products, eq(products.id, purchaseOrderItems.productId))
    .innerJoin(units, eq(units.id, purchaseOrderItems.unitId))
    .where(eq(purchaseOrderItems.orderId, orderId))
    .orderBy(asc(products.name), asc(purchaseOrderItems.id));

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

  return {
    ...order,
    items,
    receipts: receipts.map((r) => ({ ...r, items: receiptItems.filter((i) => i.receiptId === r.id) })),
    payments,
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
        options.supplierId ? eq(purchaseOrders.supplierId, options.supplierId) : undefined,
        options.status ? eq(purchaseOrders.status, options.status) : undefined,
        options.dateFrom ? gte(purchaseOrders.orderDate, options.dateFrom) : undefined,
        options.dateTo ? lte(purchaseOrders.orderDate, options.dateTo) : undefined,
        pattern ? or(ilike(purchaseOrders.number, pattern), ilike(suppliers.name, pattern)) : undefined,
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

export async function createOrder(tx: Tx, tenant: TenantContext, input: OrderInput, meta: RequestMeta) {
  const companyId = tenant.company.id;
  await assertSupplierAndWarehouse(tx, tenant, input.supplierId, input.warehouseId);
  const { items, totals } = await prepareItems(tx, companyId, input.items);

  const number = await nextDocumentNumber(tx, {
    table: purchaseOrders,
    column: purchaseOrders.number,
    companyColumn: purchaseOrders.companyId,
    companyId,
    prefix: `PO-${input.orderDate.slice(0, 4)}-`,
    width: 4,
  });

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
    })
    .returning({ id: purchaseOrders.id });
  await insertItems(tx, companyId, order!.id, items);

  await purchaseAudit(tx, tenant, meta, {
    action: "PURCHASE_ORDER_CREATED",
    resource: "purchase_orders",
    resourceId: order!.id,
    details: { number, supplierId: input.supplierId, totalAmount: totals.totalAmount },
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

  const supplierId = patch.supplierId ?? order.supplierId;
  const warehouseId = patch.warehouseId ?? order.warehouseId;
  if (patch.supplierId || patch.warehouseId) await assertSupplierAndWarehouse(tx, tenant, supplierId, warehouseId);

  let totals = {};
  if (patch.items) {
    const prepared = await prepareItems(tx, companyId, patch.items);
    await tx.delete(purchaseOrderItems).where(eq(purchaseOrderItems.orderId, orderId));
    await insertItems(tx, companyId, orderId, prepared.items);
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

export async function receiveGoods(tx: Tx, tenant: TenantContext, orderId: string, input: ReceiptInput, meta: RequestMeta) {
  const companyId = tenant.company.id;
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

    const factor = await unitFactorToBase(tx, companyId, product, orderItem.unitId);
    const baseQty = rescale(received * toMinor(factor, 4), 8, 4);
    if (baseQty <= 0n) throw badRequest(`${product.name}: miqdor juda kichik`);
    const costPerBase = fromMinor(mulDivRound(value, 1_000_000n, baseQty), 4);

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
      unitPrice: fromMinor(mulDivRound(value, 1_000_000n, received), 4),
      lineTotal: fromMinor(value),
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
    });
    total += value;
  }

  const allReceived = orderItems.every((i) => toMinor(i.receivedQty, 4) >= toMinor(i.orderedQty, 4));
  const fullyPaid = toMinor(order.paidAmount) >= toMinor(order.totalAmount);
  const status: PurchaseOrderStatus = allReceived ? (fullyPaid ? "paid" : "received") : "partial";
  await tx.update(purchaseOrders).set({ status, updatedAt: new Date() }).where(eq(purchaseOrders.id, orderId));

  const totalText = fromMinor(total);
  await tx
    .update(suppliers)
    .set({
      totalDebt: sql`${suppliers.totalDebt} + ${totalText}::numeric`,
      totalPurchased: sql`${suppliers.totalPurchased} + ${totalText}::numeric`,
      updatedAt: new Date(),
    })
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

  await purchaseAudit(tx, tenant, meta, {
    action: "PURCHASE_GOODS_RECEIVED",
    resource: "purchase_receipts",
    resourceId: receipt!.id,
    details: { orderId, number: order.number, total: totalText, status },
  });
  return { receipt: receipt!, total: totalText, status };
}
