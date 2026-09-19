/**
 * Zaxirani BAND QILISH (reservation): tasdiqlangan buyurtmadagi tovar omborda boshqa savdoga ochiq qolmaydi.
 *
 * Masalan omborda 50 dona kola bor: Bekzod agent 40 donaga buyurtma tasdiqlatsa, qolgan agentlarga 10 dona
 * ko'rinadi va 10 donadan ortig'ini sota olmaydi. Tovar jismonan chiqmaydi — faqat `stock_levels.reserved_qty`
 * oshadi, "mavjud" (`available`) esa `quantity - reserved_qty` bo'lib hisoblanadi.
 *
 * Band qilish qachon bekor bo'ladi:
 *  - buyurtma jo'natilganda (tovar haqiqatan chiqadi — band qilish o'rniga chiqim bo'ladi);
 *  - buyurtma bekor qilinganda.
 * Takroriy band qilish yoki bo'shatishdan `sales_orders.stock_reserved` belgisi saqlaydi.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { badRequest } from "@bum/shared";
import { products } from "../../db/schema/catalog.js";
import { stockLevels } from "../../db/schema/inventory.js";
import { salesOrderItems, salesOrders } from "../../db/schema/sales.js";
import type { Tx } from "../../db/transaction.js";
import { fromMinor, rescale, toMinor } from "../../shared/decimal.js";
import { unitFactorToBase } from "../catalog/conversions.js";

const SCALE = 4;

/** Buyurtma qatorlarini mahsulot bo'yicha asosiy birlikka yig'adi. */
async function baseQuantities(tx: Tx, companyId: string, orderId: string) {
  const items = await tx
    .select({ productId: salesOrderItems.productId, unitId: salesOrderItems.unitId, quantity: salesOrderItems.quantity })
    .from(salesOrderItems)
    .where(eq(salesOrderItems.orderId, orderId));
  if (items.length === 0) return new Map<string, { baseQty: bigint; name: string }>();

  const productRows = await tx
    .select({ id: products.id, name: products.name, baseUnitId: products.baseUnitId })
    .from(products)
    .where(inArray(products.id, [...new Set(items.map((item) => item.productId))]));
  const productById = new Map(productRows.map((product) => [product.id, product]));

  const totals = new Map<string, { baseQty: bigint; name: string }>();
  for (const item of items) {
    const product = productById.get(item.productId);
    if (!product) continue;
    const factor = toMinor(await unitFactorToBase(tx, companyId, product, item.unitId), SCALE);
    const baseQty = rescale(toMinor(item.quantity, SCALE) * factor, 8, SCALE);
    const current = totals.get(product.id);
    totals.set(product.id, { baseQty: (current?.baseQty ?? 0n) + baseQty, name: product.name });
  }
  return totals;
}

/**
 * Buyurtma tovarini band qiladi.
 *
 * Qoldiq qatori QULFLANADI (`for update`) — parallel tasdiqlashda band summasi yo'qolmaydi.
 * `requireAvailable: true` (agent buyurtmasi) bo'lsa mavjud miqdor AYNAN QULF OSTIDA qayta
 * tekshiriladi: ikki agent bir vaqtda yozsa ham jami band qoldiqdan oshmaydi. Aks holda (qo'lda
 * kiritilgan buyurtma) miqdor to'liq band qilinadi va "mavjud" manfiy bo'lib yetishmovchilikni
 * ko'rsatadi — tovar kelishidan oldin buyurtma tasdiqlash yo'li ochiq qoladi.
 *
 * Bir buyurtma ikki marta band qilinmaydi (`sales_orders.stock_reserved`).
 */
export async function reserveOrderStock(
  tx: Tx,
  companyId: string,
  order: { id: string; number: string; warehouseId: string; stockReserved: boolean },
  options: { requireAvailable?: boolean } = {},
) {
  if (order.stockReserved) return;
  const totals = await baseQuantities(tx, companyId, order.id);
  if (totals.size === 0) return;

  // Deadlock bo'lmasligi uchun qatorlar doim bir xil tartibda qulflanadi
  const ordered = [...totals.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  for (const [productId, { baseQty, name }] of ordered) {
    if (baseQty <= 0n) continue;
    const [level] = await tx
      .select({ id: stockLevels.id, quantity: stockLevels.quantity, reservedQty: stockLevels.reservedQty })
      .from(stockLevels)
      .where(
        and(
          eq(stockLevels.companyId, companyId),
          eq(stockLevels.productId, productId),
          eq(stockLevels.warehouseId, order.warehouseId),
        ),
      )
      .orderBy(asc(stockLevels.id))
      .limit(1)
      .for("update");

    if (options.requireAvailable) {
      const available = level ? toMinor(level.quantity, SCALE) - toMinor(level.reservedQty, SCALE) : 0n;
      if (baseQty > available) {
        const left = fromMinor(available > 0n ? available : 0n, SCALE);
        throw badRequest(`${name}: omborda yetarli emas (mavjud ${left})`, {
          reason: "out_of_stock",
          productId,
          available: left,
        });
      }
    }

    if (level) {
      await tx
        .update(stockLevels)
        .set({ reservedQty: sql`${stockLevels.reservedQty} + ${fromMinor(baseQty, SCALE)}::numeric`, updatedAt: new Date() })
        .where(eq(stockLevels.id, level.id));
    } else {
      // Qoldiq yozuvi yo'q: band qilish uchun ochiladi (miqdor 0, band — buyurtma miqdori)
      await tx
        .insert(stockLevels)
        .values({ companyId, productId, warehouseId: order.warehouseId, quantity: "0", reservedQty: fromMinor(baseQty, SCALE) });
    }
  }

  await tx.update(salesOrders).set({ stockReserved: true, updatedAt: new Date() }).where(eq(salesOrders.id, order.id));
}

/** Band qilishni bo'shatadi (jo'natish yoki bekor qilishda). Manfiy bo'lib ketmaydi. */
export async function releaseOrderStock(
  tx: Tx,
  companyId: string,
  order: { id: string; warehouseId: string; stockReserved: boolean },
) {
  if (!order.stockReserved) return;
  const totals = await baseQuantities(tx, companyId, order.id);

  for (const [productId, { baseQty }] of totals) {
    if (baseQty <= 0n) continue;
    await tx
      .update(stockLevels)
      .set({
        reservedQty: sql`greatest(0, ${stockLevels.reservedQty} - ${fromMinor(baseQty, SCALE)}::numeric)`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(stockLevels.companyId, companyId),
          eq(stockLevels.productId, productId),
          eq(stockLevels.warehouseId, order.warehouseId),
        ),
      );
  }

  await tx.update(salesOrders).set({ stockReserved: false, updatedAt: new Date() }).where(eq(salesOrders.id, order.id));
}
