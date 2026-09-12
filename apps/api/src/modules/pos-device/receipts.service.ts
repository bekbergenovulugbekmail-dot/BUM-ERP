/**
 * Kassada qaytarish uchun chekni raqam bo'yicha topish (boshqa kassa yoki web'da sotilgan chek ham) — faqat qurilma
 * omboridagi sotuv. Qatorlar qaytarilgan miqdori bilan: qurilma qolganini qaytara oladi.
 */
import { and, asc, eq } from "drizzle-orm";
import { notFound } from "@bum/shared";
import { products, units } from "../../db/schema/catalog.js";
import { customers, salesOrderItems, salesOrders } from "../../db/schema/sales.js";
import type { DbOrTx } from "../../db/transaction.js";
import type { DeviceContext } from "./device-auth.js";

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
