/**
 * Kassada qaytarish uchun chekni raqam bo'yicha topish (boshqa kassa yoki web'da sotilgan chek ham) — faqat qurilma
 * omboridagi sotuv. Qatorlar qaytarilgan miqdori bilan: qurilma qolganini qaytara oladi.
 */
import { and, asc, desc, eq, gte, lt, lte, or } from "drizzle-orm";
import { badRequest, notFound } from "@bum/shared";
import { products, units } from "../../db/schema/catalog.js";
import { users } from "../../db/schema/platform.js";
import { posDevices } from "../../db/schema/pos.js";
import { purchaseOrderItems, purchaseOrders, suppliers } from "../../db/schema/purchase.js";
import { customers, salesOrderItems, salesOrders } from "../../db/schema/sales.js";
import type { DbOrTx } from "../../db/transaction.js";
import { UUID_RE, decodeCursor, encodeCursor } from "../../shared/cursor.js";
import type { DeviceContext } from "./device-auth.js";

/** Ta'minotchiga qaytarish uchun xarid (raqam bo'yicha, qurilma omboridagi): qabul va qaytarilgan miqdorlar bilan. */
export async function findDevicePurchase(conn: DbOrTx, context: DeviceContext, number: string) {
  const [order] = await conn
    .select({
      id: purchaseOrders.id,
      number: purchaseOrders.number,
      status: purchaseOrders.status,
      supplierId: purchaseOrders.supplierId,
      supplierName: suppliers.name,
      totalAmount: purchaseOrders.totalAmount,
      paidAmount: purchaseOrders.paidAmount,
      createdAt: purchaseOrders.createdAt,
    })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(
      and(
        eq(purchaseOrders.companyId, context.company.id),
        eq(purchaseOrders.number, number),
        eq(purchaseOrders.warehouseId, context.device.warehouseId),
      ),
    )
    .limit(1);
  if (!order) throw notFound("Xarid topilmadi");

  const items = await conn
    .select({
      id: purchaseOrderItems.id,
      productId: purchaseOrderItems.productId,
      productName: products.name,
      unitId: purchaseOrderItems.unitId,
      unitName: units.shortName,
      orderedQty: purchaseOrderItems.orderedQty,
      receivedQty: purchaseOrderItems.receivedQty,
      returnedQty: purchaseOrderItems.returnedQty,
      unitPrice: purchaseOrderItems.unitPrice,
      lineTotal: purchaseOrderItems.lineTotal,
      currency: purchaseOrderItems.currency,
    })
    .from(purchaseOrderItems)
    .innerJoin(products, eq(products.id, purchaseOrderItems.productId))
    .innerJoin(units, eq(units.id, purchaseOrderItems.unitId))
    .where(eq(purchaseOrderItems.orderId, order.id))
    .orderBy(asc(purchaseOrderItems.createdAt), asc(purchaseOrderItems.id));

  return { ...order, items };
}

/** Sotuv tarixi (internet bilan): qurilma omboridagi barcha kassa cheklari — boshqa kassalar va web ham. */
export async function listDeviceSales(conn: DbOrTx, context: DeviceContext, options: { from?: string; to?: string; limit: number; cursor?: string }) {
  let after: { at: Date; id: string } | null = null;
  if (options.cursor) {
    const [iso, id] = decodeCursor(options.cursor, 2) as [string, string];
    const at = new Date(iso);
    if (Number.isNaN(at.getTime()) || !UUID_RE.test(id)) throw badRequest("Kursor noto'g'ri");
    after = { at, id };
  }
  const rows = await conn
    .select({
      id: salesOrders.id,
      number: salesOrders.number,
      status: salesOrders.status,
      orderDate: salesOrders.orderDate,
      totalAmount: salesOrders.totalAmount,
      paidAmount: salesOrders.paidAmount,
      createdAt: salesOrders.createdAt,
      customerName: customers.name,
      deviceCode: posDevices.code,
      cashierName: users.name,
    })
    .from(salesOrders)
    .leftJoin(customers, eq(customers.id, salesOrders.customerId))
    .leftJoin(posDevices, eq(posDevices.id, salesOrders.deviceId))
    .leftJoin(users, eq(users.id, salesOrders.createdBy))
    .where(
      and(
        eq(salesOrders.companyId, context.company.id),
        eq(salesOrders.warehouseId, context.device.warehouseId),
        eq(salesOrders.isPos, true),
        options.from ? gte(salesOrders.orderDate, options.from) : undefined,
        options.to ? lte(salesOrders.orderDate, options.to) : undefined,
        after ? or(lt(salesOrders.createdAt, after.at), and(eq(salesOrders.createdAt, after.at), lt(salesOrders.id, after.id))) : undefined,
      ),
    )
    .orderBy(desc(salesOrders.createdAt), desc(salesOrders.id))
    .limit(options.limit + 1);
  const page = rows.slice(0, options.limit);
  const last = page.at(-1);
  return { sales: page, nextCursor: rows.length > options.limit && last ? encodeCursor([last.createdAt.toISOString(), last.id]) : null };
}

export async function findDeviceReceipt(conn: DbOrTx, context: DeviceContext, number: string) {
  const [order] = await conn
    .select({
      id: salesOrders.id,
      number: salesOrders.number,
      status: salesOrders.status,
      isPos: salesOrders.isPos,
      deviceId: salesOrders.deviceId,
      customerId: salesOrders.customerId,
      customerName: customers.name,
      customerPhone: customers.phone,
      currency: salesOrders.currency,
      subtotal: salesOrders.subtotal,
      taxAmount: salesOrders.taxAmount,
      discountAmount: salesOrders.discountAmount,
      totalAmount: salesOrders.totalAmount,
      paidAmount: salesOrders.paidAmount,
      createdAt: salesOrders.createdAt,
    })
    .from(salesOrders)
    .leftJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(
      and(
        eq(salesOrders.companyId, context.company.id),
        eq(salesOrders.number, number),
        eq(salesOrders.warehouseId, context.device.warehouseId),
      ),
    )
    .limit(1);
  if (!order) throw notFound("Chek topilmadi");

  const items = await conn
    .select({
      id: salesOrderItems.id,
      productId: salesOrderItems.productId,
      productName: products.name,
      productSku: products.sku,
      unitId: salesOrderItems.unitId,
      unitName: units.shortName,
      quantity: salesOrderItems.quantity,
      returnedQty: salesOrderItems.returnedQty,
      unitPrice: salesOrderItems.unitPrice,
      discountPercent: salesOrderItems.discountPercent,
      taxRate: salesOrderItems.taxRate,
      lineTotal: salesOrderItems.lineTotal,
      priceCurrency: salesOrderItems.priceCurrency,
      currencyTotal: salesOrderItems.currencyTotal,
    })
    .from(salesOrderItems)
    .innerJoin(products, eq(products.id, salesOrderItems.productId))
    .innerJoin(units, eq(units.id, salesOrderItems.unitId))
    .where(eq(salesOrderItems.orderId, order.id))
    .orderBy(asc(salesOrderItems.createdAt), asc(salesOrderItems.id));

  return { ...order, items };
}
