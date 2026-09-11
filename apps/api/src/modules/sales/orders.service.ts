/**
 * Savdo buyurtmalari (convex/sales/orders.ts).
 *
 * Holatlar: draft → confirmed → shipped → delivered (to'liq to'langan) → returned;
 * draft / confirmed → cancelled (to'lovsiz).
 *
 * Buxgalteriya modeli (savdo va POS uchun bir xil):
 *  - jo'natish (`dispatchOrder`): zaxira chiqimi (`moveStock`, AVCO shu lahzada),
 *    DR debitorlar / CR sotuv daromadi (jami), DR tovar tannarxi / CR tovar zaxirasi
 *  - to'lov (payments.service): DR kassa yoki bank / CR debitorlar
 *  - qaytarish: zaxira sotuvdagi tannarxda qaytadi, teskari yozuvlar; pul qaytarilsa
 *    DR debitorlar / CR kassa yoki bank
 *
 * Convex'dan farqlar:
 *  - `create` mijoz, mahsulot, birlik va POS smenasini tekshirmasdi (boshqa kompaniya mijozi
 *    ham ketardi); `isPOS` mijozdan kelardi va jurnal turini o'zgartirardi
 *  - narx va chegirma erkin edi — endi prays-list narxi va mijoz chegirmasi, o'zgartirish `sales.edit`
 *  - soliq stavkasi mijozdan kelardi va doim ustiga qo'shilardi — endi mahsulotdan, `taxIncluded`
 *    bo'lsa narx ichidan ajratiladi (narxi soliq bilan belgilangan mahsulotda mijoz ortiqcha to'lardi)
 *  - tannarx buyurtma YARATILGANDA olinardi — endi jo'natish lahzasidagi AVCO
 *  - zaxira birlik konversiyasisiz yechilardi
 *  - kredit limiti tekshirilmasdi; mijozsiz to'lanmagan buyurtma jo'natilardi (qarz hech kimga yozilmasdi)
 *  - yetkazilgan (to'langan) buyurtmani bekor qilish mumkin edi — zaxira va tushum qolardi;
 *    endi jo'natilgani faqat qaytarish orqali (Convex'da qaytarish yo'q edi)
 *  - `confirm` / `ship` / `cancel` to'xtatilgan kompaniyada ham yozardi; raqam parallel takrorlanardi;
 *    statistika oxirgi 500 ta buyurtmadan
 */
import { and, asc, desc, eq, getTableColumns, gte, ilike, inArray, lt, lte, or, sql } from "drizzle-orm";
import { badRequest, forbidden, notFound } from "@bum/shared";
import { products, units } from "../../db/schema/catalog.js";
import { warehouses } from "../../db/schema/inventory.js";
import { customerPayments, customers, posShifts, salesOrderItems, salesOrders } from "../../db/schema/sales.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { UUID_RE, decodeCursor, encodeCursor } from "../../shared/cursor.js";
import { fromMinor, mulDivRound, rescale, toMinor } from "../../shared/decimal.js";
import { computeLine } from "../../shared/line-amounts.js";
import { nextDocumentNumber } from "../../shared/numbering.js";
import { unitFactorToBase } from "../catalog/conversions.js";
import { effectivePermissions, type TenantContext } from "../company/tenant.js";
import { companyCurrency } from "../finance/accounts.service.js";
import {
  ledgerAccountFor,
  recordCashTransaction,
  resolvePaymentAccount,
  todayIso,
  type PaymentMethod,
} from "../finance/cash.service.js";
import { postJournalEntry, requireAccountBySubtype } from "../finance/journal.service.js";
import { moveStock } from "../inventory/stock.service.js";
import { assertWarehouseAccess } from "../inventory/warehouses.service.js";
import { salesAudit } from "./customers.service.js";

const { legacyId: _l1, companyId: _c1, ...orderFields } = getTableColumns(salesOrders);
const { legacyId: _l2, companyId: _c2, ...itemFields } = getTableColumns(salesOrderItems);
const { legacyId: _l3, companyId: _c3, ...paymentFields } = getTableColumns(customerPayments);

export type SalesOrderStatus = (typeof salesOrders.status.enumValues)[number];

export type SalesItemInput = {
  productId: string;
  /** Standart — mahsulotning asosiy birligi. */
  unitId?: string;
  quantity: string;
  /** Standart — prays-list narxi (birlik konversiyasi bilan). */
  unitPrice?: string;
  /** Standart — mijoz chegirmasi. */
  discountPercent?: string;
  notes?: string | null;
};

export type SalesOrderInput = {
  customerId?: string | null;
  warehouseId: string;
  orderDate: string;
  deliveryDate?: string | null;
  notes?: string | null;
  items: SalesItemInput[];
};

export type DispatchableOrder = {
  id: string;
  number: string;
  customerId: string | null;
  warehouseId: string;
  totalAmount: string;
  paidAmount: string;
  isPos: boolean;
};

// ─── Qatorlar ────────────────────────────────────────────────────────────────

export async function prepareSalesItems(tx: Tx, tenant: TenantContext, items: SalesItemInput[], customerDiscount: string) {
  if (items.length === 0) throw badRequest("Kamida bitta mahsulot bo'lishi kerak");
  const companyId = tenant.company.id;

  const rows = await tx
    .select({
      id: products.id,
      name: products.name,
      baseUnitId: products.baseUnitId,
      salesPrice: products.salesPrice,
      taxRate: products.taxRate,
      taxIncluded: products.taxIncluded,
      isActive: products.isActive,
      isSaleable: products.isSaleable,
    })
    .from(products)
    .where(and(eq(products.companyId, companyId), inArray(products.id, [...new Set(items.map((i) => i.productId))])));
  const byId = new Map(rows.map((p) => [p.id, p]));
  const canOverride = (await effectivePermissions(tx, tenant)).includes("sales.edit");

  let subtotal = 0n;
  let taxAmount = 0n;
  let discountAmount = 0n;
  const prepared: {
    productId: string;
    unitId: string;
    quantity: string;
    unitPrice: string;
    taxRate: string;
    discountPercent: string;
    lineTotal: string;
    notes: string | null;
  }[] = [];

  for (const item of items) {
    const product = byId.get(item.productId);
    if (!product) throw badRequest("Mahsulot topilmadi");
    if (!product.isActive || !product.isSaleable) throw badRequest(`${product.name}: mahsulot sotilmaydi`);

    const unitId = item.unitId ?? product.baseUnitId;
    const factor = await unitFactorToBase(tx, companyId, product, unitId);
    const listPrice = fromMinor(rescale(toMinor(product.salesPrice, 4) * toMinor(factor, 4), 8, 4), 4);
    const unitPrice = item.unitPrice ?? listPrice;
    const discountPercent = item.discountPercent ?? customerDiscount;
    const changed =
      toMinor(unitPrice, 4) !== toMinor(listPrice, 4) || toMinor(discountPercent, 2) !== toMinor(customerDiscount, 2);
    if (changed && !canOverride) throw forbidden("Narx yoki chegirmani o'zgartirish uchun ruxsat yo'q: sales.edit");

    const amounts = computeLine({
      quantity: item.quantity,
      unitPrice,
      discountPercent,
      taxRate: product.taxRate,
      taxIncluded: product.taxIncluded,
    });
    subtotal += amounts.net;
    taxAmount += amounts.tax;
    discountAmount += amounts.discount;
    prepared.push({
      productId: product.id,
      unitId,
      quantity: item.quantity,
      unitPrice,
      taxRate: product.taxRate,
      discountPercent,
      lineTotal: fromMinor(amounts.lineTotal),
      notes: item.notes ?? null,
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

export async function insertSalesItems(
  tx: Tx,
  companyId: string,
  orderId: string,
  items: Awaited<ReturnType<typeof prepareSalesItems>>["items"],
) {
  await tx.insert(salesOrderItems).values(items.map((item) => ({ ...item, companyId, orderId })));
}

async function customerDiscountFor(tx: Tx, companyId: string, customerId: string | null | undefined) {
  if (!customerId) return "0";
  const [customer] = await tx
    .select({ discountPercent: customers.discountPercent, isActive: customers.isActive })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.companyId, companyId)))
    .limit(1);
  if (!customer) throw badRequest("Mijoz topilmadi");
  if (!customer.isActive) throw badRequest("Mijoz faol emas");
  return customer.discountPercent;
}

async function assertWarehouse(tx: Tx, tenant: TenantContext, warehouseId: string) {
  const [warehouse] = await tx
    .select({ isActive: warehouses.isActive })
    .from(warehouses)
    .where(and(eq(warehouses.id, warehouseId), eq(warehouses.companyId, tenant.company.id)))
    .limit(1);
  if (!warehouse) throw badRequest("Ombor topilmadi");
  if (!warehouse.isActive) throw badRequest("Ombor faol emas");
  assertWarehouseAccess(tenant, warehouseId);
}

async function lockOrder(tx: Tx, tenant: TenantContext, orderId: string) {
  const [order] = await tx
    .select(orderFields)
    .from(salesOrders)
    .where(and(eq(salesOrders.id, orderId), eq(salesOrders.companyId, tenant.company.id)))
    .limit(1)
    .for("update");
  if (!order) throw notFound("Buyurtma topilmadi");
  return order;
}

// ─── O'qish ──────────────────────────────────────────────────────────────────

const balanceSql = sql<string>`(${salesOrders.totalAmount} - ${salesOrders.paidAmount})::numeric(18,2)`;

export async function getOrder(conn: DbOrTx, tenant: TenantContext, orderId: string) {
  const [order] = await conn
    .select({
      ...orderFields,
      customerName: customers.name,
      customerPhone: customers.phone,
      warehouseName: warehouses.name,
      balance: balanceSql,
    })
    .from(salesOrders)
    .leftJoin(customers, eq(customers.id, salesOrders.customerId))
    .innerJoin(warehouses, eq(warehouses.id, salesOrders.warehouseId))
    .where(and(eq(salesOrders.id, orderId), eq(salesOrders.companyId, tenant.company.id)))
    .limit(1);
  if (!order) throw notFound("Buyurtma topilmadi");

  const items = await conn
    .select({ ...itemFields, productName: products.name, productSku: products.sku, unitName: units.shortName })
    .from(salesOrderItems)
    .innerJoin(products, eq(products.id, salesOrderItems.productId))
    .innerJoin(units, eq(units.id, salesOrderItems.unitId))
    .where(eq(salesOrderItems.orderId, orderId))
    .orderBy(asc(products.name), asc(salesOrderItems.id));

  const payments = await conn
    .select(paymentFields)
    .from(customerPayments)
    .where(eq(customerPayments.orderId, orderId))
    .orderBy(asc(customerPayments.createdAt));

  return { ...order, items, payments };
}

export async function listOrders(
  conn: DbOrTx,
  tenant: TenantContext,
  options: {
    status?: SalesOrderStatus;
    customerId?: string;
    warehouseId?: string;
    isPos?: boolean;
    shiftId?: string;
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
      customerName: customers.name,
      warehouseName: warehouses.name,
      itemCount: sql<number>`(select count(*)::int from ${salesOrderItems} where ${salesOrderItems.orderId} = ${salesOrders.id})`,
      balance: balanceSql,
    })
    .from(salesOrders)
    .leftJoin(customers, eq(customers.id, salesOrders.customerId))
    .innerJoin(warehouses, eq(warehouses.id, salesOrders.warehouseId))
    .where(
      and(
        eq(salesOrders.companyId, tenant.company.id),
        options.status ? eq(salesOrders.status, options.status) : undefined,
        options.customerId ? eq(salesOrders.customerId, options.customerId) : undefined,
        options.warehouseId ? eq(salesOrders.warehouseId, options.warehouseId) : undefined,
        options.isPos !== undefined ? eq(salesOrders.isPos, options.isPos) : undefined,
        options.shiftId ? eq(salesOrders.posShiftId, options.shiftId) : undefined,
        options.dateFrom ? gte(salesOrders.orderDate, options.dateFrom) : undefined,
        options.dateTo ? lte(salesOrders.orderDate, options.dateTo) : undefined,
        pattern ? or(ilike(salesOrders.number, pattern), ilike(customers.name, pattern)) : undefined,
        after
          ? or(lt(salesOrders.orderDate, after.date), and(eq(salesOrders.orderDate, after.date), lt(salesOrders.id, after.id)))
          : undefined,
      ),
    )
    .orderBy(desc(salesOrders.orderDate), desc(salesOrders.id))
    .limit(options.limit + 1);

  const page = rows.slice(0, options.limit);
  const last = page.at(-1);
  return {
    orders: page,
    nextCursor: rows.length > options.limit && last ? encodeCursor([last.orderDate, last.id]) : null,
  };
}

export async function salesStats(conn: DbOrTx, tenant: TenantContext) {
  const today = todayIso();
  const monthStart = `${today.slice(0, 7)}-01`;
  const [stats] = await conn
    .select({
      totalThisMonth: sql<string>`coalesce(sum(${salesOrders.totalAmount}) filter (where ${salesOrders.orderDate} >= ${monthStart} and ${salesOrders.status} not in ('draft', 'cancelled', 'returned')), 0)::numeric(18,2)`,
      countThisMonth: sql<number>`(count(*) filter (where ${salesOrders.orderDate} >= ${monthStart} and ${salesOrders.status} not in ('draft', 'cancelled', 'returned')))::int`,
      todayCount: sql<number>`(count(*) filter (where ${salesOrders.orderDate} = ${today} and ${salesOrders.status} not in ('draft', 'cancelled')))::int`,
      pendingPayment: sql<number>`(count(*) filter (where ${salesOrders.totalAmount} > ${salesOrders.paidAmount} and ${salesOrders.status} in ('confirmed', 'shipped')))::int`,
      totalDebt: sql<string>`coalesce(sum(${salesOrders.totalAmount} - ${salesOrders.paidAmount}) filter (where ${salesOrders.status} = 'shipped'), 0)::numeric(18,2)`,
    })
    .from(salesOrders)
    .where(eq(salesOrders.companyId, tenant.company.id));
  return stats!;
}

// ─── Hayot sikli ─────────────────────────────────────────────────────────────

export async function createOrder(tx: Tx, tenant: TenantContext, input: SalesOrderInput, meta: RequestMeta) {
  const companyId = tenant.company.id;
  const customerDiscount = await customerDiscountFor(tx, companyId, input.customerId);
  await assertWarehouse(tx, tenant, input.warehouseId);
  const { items, totals } = await prepareSalesItems(tx, tenant, input.items, customerDiscount);

  const number = await nextDocumentNumber(tx, {
    table: salesOrders,
    column: salesOrders.number,
    companyColumn: salesOrders.companyId,
    companyId,
    prefix: `SO-${input.orderDate.slice(0, 4)}-`,
    width: 4,
  });

  const [order] = await tx
    .insert(salesOrders)
    .values({
      companyId,
      number,
      customerId: input.customerId ?? null,
      warehouseId: input.warehouseId,
      orderDate: input.orderDate,
      deliveryDate: input.deliveryDate ?? null,
      notes: input.notes ?? null,
      currency: await companyCurrency(tx, companyId),
      ...totals,
      createdBy: tenant.user.id,
    })
    .returning({ id: salesOrders.id });
  await insertSalesItems(tx, companyId, order!.id, items);

  await salesAudit(tx, tenant, meta, {
    action: "SALES_ORDER_CREATED",
    resource: "sales_orders",
    resourceId: order!.id,
    details: { number, customerId: input.customerId ?? null, totalAmount: totals.totalAmount },
  });
  return getOrder(tx, tenant, order!.id);
}

export async function updateOrder(
  tx: Tx,
  tenant: TenantContext,
  orderId: string,
  patch: Partial<SalesOrderInput>,
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const order = await lockOrder(tx, tenant, orderId);
  if (order.status !== "draft" || order.isPos) throw badRequest("Faqat qoralama buyurtmani tahrirlash mumkin");

  const customerId = patch.customerId !== undefined ? patch.customerId : order.customerId;
  const warehouseId = patch.warehouseId ?? order.warehouseId;
  const customerDiscount = await customerDiscountFor(tx, companyId, customerId);
  if (patch.warehouseId) await assertWarehouse(tx, tenant, warehouseId);

  let totals = {};
  if (patch.items) {
    const prepared = await prepareSalesItems(tx, tenant, patch.items, customerDiscount);
    await tx.delete(salesOrderItems).where(eq(salesOrderItems.orderId, orderId));
    await insertSalesItems(tx, companyId, orderId, prepared.items);
    totals = prepared.totals;
  }

  await tx
    .update(salesOrders)
    .set({
      customerId,
      warehouseId,
      ...(patch.orderDate ? { orderDate: patch.orderDate } : {}),
      ...(patch.deliveryDate !== undefined ? { deliveryDate: patch.deliveryDate } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...totals,
      updatedAt: new Date(),
    })
    .where(eq(salesOrders.id, orderId));

  await salesAudit(tx, tenant, meta, {
    action: "SALES_ORDER_UPDATED",
    resource: "sales_orders",
    resourceId: orderId,
    details: { number: order.number, changes: Object.keys(patch) },
  });
  return getOrder(tx, tenant, orderId);
}

export async function confirmOrder(tx: Tx, tenant: TenantContext, orderId: string, meta: RequestMeta) {
  const order = await lockOrder(tx, tenant, orderId);
  if (order.status !== "draft") throw badRequest("Faqat qoralama buyurtmani tasdiqlash mumkin");

  await tx.update(salesOrders).set({ status: "confirmed", updatedAt: new Date() }).where(eq(salesOrders.id, orderId));
  await salesAudit(tx, tenant, meta, {
    action: "SALES_ORDER_CONFIRMED",
    resource: "sales_orders",
    resourceId: orderId,
    details: { number: order.number },
  });
  return getOrder(tx, tenant, orderId);
}

export async function cancelOrder(tx: Tx, tenant: TenantContext, orderId: string, reason: string | null, meta: RequestMeta) {
  const order = await lockOrder(tx, tenant, orderId);
  if (order.status !== "draft" && order.status !== "confirmed") {
    throw badRequest("Jo'natilgan buyurtma bekor qilinmaydi — qaytarish orqali");
  }
  if (toMinor(order.paidAmount) > 0n) throw badRequest("To'lov qilingan buyurtmani bekor qilib bo'lmaydi");

  await tx
    .update(salesOrders)
    .set({ status: "cancelled", notes: reason ?? order.notes, updatedAt: new Date() })
    .where(eq(salesOrders.id, orderId));
  await salesAudit(tx, tenant, meta, {
    action: "SALES_ORDER_CANCELLED",
    resource: "sales_orders",
    resourceId: orderId,
    details: { number: order.number, reason },
  });
  return getOrder(tx, tenant, orderId);
}

/**
 * Zaxira chiqimi, tannarx, mijoz qarzi va sotuv jurnali. `upcomingPayment` — shu
 * tranzaksiyada keyin yoziladigan to'lov (POS cheki): kredit limiti va mijozsiz sotuv shunga qarab tekshiriladi.
 */
export async function dispatchOrder(
  tx: Tx,
  tenant: TenantContext,
  order: DispatchableOrder,
  entryDate: string,
  upcomingPayment = 0n,
) {
  const companyId = tenant.company.id;
  const total = toMinor(order.totalAmount);

  if (order.customerId) {
    const [customer] = await tx
      .select({ totalDebt: customers.totalDebt, creditLimit: customers.creditLimit })
      .from(customers)
      .where(eq(customers.id, order.customerId))
      .limit(1)
      .for("update");
    const limit = toMinor(customer!.creditLimit);
    const debtAfter = toMinor(customer!.totalDebt) + total - upcomingPayment;
    if (limit > 0n && debtAfter > limit) {
      throw badRequest(`Mijoz kredit limitidan oshadi (limit ${fromMinor(limit)}, qarz ${fromMinor(debtAfter)})`);
    }
  } else if (toMinor(order.paidAmount) + upcomingPayment < total) {
    throw badRequest("Mijozsiz sotuv jo'natishdan oldin to'liq to'lanishi kerak");
  }

  const items = await tx
    .select({ id: salesOrderItems.id, productId: salesOrderItems.productId, unitId: salesOrderItems.unitId, quantity: salesOrderItems.quantity })
    .from(salesOrderItems)
    .where(eq(salesOrderItems.orderId, order.id))
    .for("update");
  const productRows = await tx
    .select({ id: products.id, name: products.name, baseUnitId: products.baseUnitId })
    .from(products)
    .where(inArray(products.id, [...new Set(items.map((i) => i.productId))]));
  const productById = new Map(productRows.map((p) => [p.id, p]));

  let cogs = 0n;
  for (const item of items) {
    const product = productById.get(item.productId)!;
    const factor = toMinor(await unitFactorToBase(tx, companyId, product, item.unitId), 4);
    const quantity = toMinor(item.quantity, 4);
    const baseQty = rescale(quantity * factor, 8, 4);

    const { movement } = await moveStock(tx, companyId, tenant.user.id, {
      type: "issue",
      productId: product.id,
      warehouseId: order.warehouseId,
      quantity: fromMinor(baseQty, 4),
      referenceType: order.isPos ? "pos_sale" : "sales_order",
      referenceId: order.id,
      notes: `Sotuv: ${order.number}`,
    });
    const unitCost = rescale(toMinor(movement.costPrice, 4) * factor, 8, 4);
    cogs += rescale(quantity * unitCost, 8, 2);
    await tx
      .update(salesOrderItems)
      .set({ costPrice: fromMinor(unitCost, 4), updatedAt: new Date() })
      .where(eq(salesOrderItems.id, item.id));
  }

  if (order.customerId) {
    await tx
      .update(customers)
      .set({
        totalDebt: sql`${customers.totalDebt} + ${order.totalAmount}::numeric`,
        totalPurchased: sql`${customers.totalPurchased} + ${order.totalAmount}::numeric`,
        updatedAt: new Date(),
      })
      .where(eq(customers.id, order.customerId));
  }

  const lines = [];
  if (total > 0n) {
    lines.push(
      { accountId: await requireAccountBySubtype(tx, companyId, "receivable", "asset", "Debitorlar"), debit: order.totalAmount },
      { accountId: await requireAccountBySubtype(tx, companyId, "sales", "income", "Sotuv daromadi"), credit: order.totalAmount },
    );
  }
  if (cogs > 0n) {
    lines.push(
      { accountId: await requireAccountBySubtype(tx, companyId, "cogs", "expense", "Tovar tannarxi"), debit: fromMinor(cogs) },
      { accountId: await requireAccountBySubtype(tx, companyId, "inventory", "asset", "Tovar zaxirasi"), credit: fromMinor(cogs) },
    );
  }
  if (lines.length > 0) {
    await postJournalEntry(tx, companyId, tenant.user.id, {
      entryDate,
      description: `Sotuv: ${order.number}`,
      referenceType: "sales_order",
      referenceId: order.id,
      lines,
    });
  }
  return { cogs: fromMinor(cogs) };
}

export async function shipOrder(tx: Tx, tenant: TenantContext, orderId: string, meta: RequestMeta) {
  const order = await lockOrder(tx, tenant, orderId);
  if (order.status !== "confirmed" || order.isPos) throw badRequest("Faqat tasdiqlangan buyurtma jo'natiladi");
  assertWarehouseAccess(tenant, order.warehouseId);

  const { cogs } = await dispatchOrder(tx, tenant, order, todayIso());
  const status: SalesOrderStatus = toMinor(order.paidAmount) >= toMinor(order.totalAmount) ? "delivered" : "shipped";
  await tx.update(salesOrders).set({ status, updatedAt: new Date() }).where(eq(salesOrders.id, orderId));

  await salesAudit(tx, tenant, meta, {
    action: "SALES_ORDER_SHIPPED",
    resource: "sales_orders",
    resourceId: orderId,
    details: { number: order.number, totalAmount: order.totalAmount, cogs, status },
  });
  return getOrder(tx, tenant, orderId);
}

export async function returnOrder(
  tx: Tx,
  tenant: TenantContext,
  orderId: string,
  input: { reason?: string | null; refund?: boolean; method?: PaymentMethod; cashAccountId?: string | null },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const order = await lockOrder(tx, tenant, orderId);
  if (order.status !== "shipped" && order.status !== "delivered") throw badRequest("Faqat jo'natilgan buyurtma qaytariladi");
  assertWarehouseAccess(tenant, order.warehouseId);

  const refund = input.refund ?? true;
  const paid = toMinor(order.paidAmount);
  const total = toMinor(order.totalAmount);
  if (!order.customerId && paid > 0n && !refund) throw badRequest("Mijozsiz sotuvda pul qaytarilishi shart");
  const today = todayIso();

  const items = await tx
    .select({
      productId: salesOrderItems.productId,
      unitId: salesOrderItems.unitId,
      quantity: salesOrderItems.quantity,
      costPrice: salesOrderItems.costPrice,
    })
    .from(salesOrderItems)
    .where(eq(salesOrderItems.orderId, orderId));
  const productRows = await tx
    .select({ id: products.id, name: products.name, baseUnitId: products.baseUnitId })
    .from(products)
    .where(inArray(products.id, [...new Set(items.map((i) => i.productId))]));
  const productById = new Map(productRows.map((p) => [p.id, p]));

  // Tovar sotuvdagi tannarxda qaytadi — tannarx yozuvi aynan teskari bo'ladi
  let cogs = 0n;
  for (const item of items) {
    const product = productById.get(item.productId)!;
    const quantity = toMinor(item.quantity, 4);
    const baseQty = rescale(quantity * toMinor(await unitFactorToBase(tx, companyId, product, item.unitId), 4), 8, 4);
    const lineCogs = rescale(quantity * toMinor(item.costPrice, 4), 8, 2);
    await moveStock(tx, companyId, tenant.user.id, {
      type: "return_in",
      productId: product.id,
      warehouseId: order.warehouseId,
      quantity: fromMinor(baseQty, 4),
      costPrice: fromMinor(mulDivRound(lineCogs, 1_000_000n, baseQty), 4),
      referenceType: "sales_return",
      referenceId: order.id,
      notes: `Qaytarish: ${order.number}`,
    });
    cogs += lineCogs;
  }

  const lines = [];
  if (total > 0n) {
    lines.push(
      { accountId: await requireAccountBySubtype(tx, companyId, "sales", "income", "Sotuv daromadi"), debit: order.totalAmount },
      { accountId: await requireAccountBySubtype(tx, companyId, "receivable", "asset", "Debitorlar"), credit: order.totalAmount },
    );
  }
  if (cogs > 0n) {
    lines.push(
      { accountId: await requireAccountBySubtype(tx, companyId, "inventory", "asset", "Tovar zaxirasi"), debit: fromMinor(cogs) },
      { accountId: await requireAccountBySubtype(tx, companyId, "cogs", "expense", "Tovar tannarxi"), credit: fromMinor(cogs) },
    );
  }
  if (lines.length > 0) {
    await postJournalEntry(tx, companyId, tenant.user.id, {
      entryDate: today,
      description: `Qaytarish: ${order.number}`,
      referenceType: "sales_return",
      referenceId: order.id,
      lines,
    });
  }

  if (order.customerId) {
    await tx
      .update(customers)
      .set({
        totalDebt: sql`${customers.totalDebt} - ${order.totalAmount}::numeric`,
        totalPurchased: sql`${customers.totalPurchased} - ${order.totalAmount}::numeric`,
        updatedAt: new Date(),
      })
      .where(eq(customers.id, order.customerId));
  }

  let refunded = 0n;
  let refundAccountId: string | null = null;
  const method = input.method ?? "cash";
  if (refund && paid > 0n) {
    const amount = fromMinor(paid);
    const { account } = await recordCashTransaction(tx, companyId, tenant.user.id, {
      cashAccountId: await resolvePaymentAccount(tx, companyId, method, input.cashAccountId),
      type: "out",
      amount,
      txDate: today,
      description: `Qaytarish: ${order.number}`,
      category: "sales_refund",
      referenceType: "sales_refund",
      referenceId: order.id,
    });
    await postJournalEntry(tx, companyId, tenant.user.id, {
      entryDate: today,
      description: `Pul qaytarish: ${order.number}`,
      referenceType: "sales_refund",
      referenceId: order.id,
      lines: [
        { accountId: await requireAccountBySubtype(tx, companyId, "receivable", "asset", "Debitorlar"), debit: amount },
        { accountId: await ledgerAccountFor(tx, companyId, account.type), credit: amount },
      ],
    });
    if (order.customerId) {
      await tx
        .update(customers)
        .set({ totalDebt: sql`${customers.totalDebt} + ${amount}::numeric`, updatedAt: new Date() })
        .where(eq(customers.id, order.customerId));
    }
    refunded = paid;
    refundAccountId = account.id;
  }

  // Ochiq smenada qaytarish kassir yig'indisidan ayriladi — smena yopilishida kassa farqi to'g'ri chiqsin
  if (order.posShiftId) {
    const refundedText = fromMinor(refunded);
    await tx
      .update(posShifts)
      .set({
        totalSales: sql`${posShifts.totalSales} - ${order.totalAmount}::numeric`,
        ...(method === "cash" ? { totalCash: sql`${posShifts.totalCash} - ${refundedText}::numeric` } : {}),
        ...(method === "card" ? { totalCard: sql`${posShifts.totalCard} - ${refundedText}::numeric` } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(posShifts.id, order.posShiftId), eq(posShifts.status, "open")));
  }

  await tx
    .update(salesOrders)
    .set({
      status: "returned",
      paidAmount: fromMinor(paid - refunded),
      notes: input.reason ?? order.notes,
      updatedAt: new Date(),
    })
    .where(eq(salesOrders.id, orderId));

  await salesAudit(tx, tenant, meta, {
    action: "SALES_ORDER_RETURNED",
    resource: "sales_orders",
    resourceId: orderId,
    details: { number: order.number, totalAmount: order.totalAmount, cogs: fromMinor(cogs), refunded: fromMinor(refunded), reason: input.reason ?? null },
  });
  return { order: await getOrder(tx, tenant, orderId), refunded: fromMinor(refunded), refundAccountId };
}
