/**
 * Zaxirani BAND QILISH (reservation): tasdiqlangan buyurtmadagi tovar omborda boshqa savdoga ochiq qolmaydi.
 *
 * Masalan omborda 50 dona kola bor: Bekzod agent 40 donaga buyurtma tasdiqlatsa, qolgan agentlarga 10 dona
 * ko'rinadi va 10 donadan ortig'ini sota olmaydi. Tovar jismonan chiqmaydi — faqat `stock_levels.reserved_qty`
 * oshadi, "mavjud" (`available`) esa `quantity - reserved_qty` bo'lib hisoblanadi.
 *
 * ASOSIY INVARIANT: `reserved_qty <= quantity` — band qilingan miqdor ombordagi qoldiqdan HECH QACHON
 * oshmaydi. Shuning uchun "mavjud" manfiy bo'lmaydi va uni ko'rsatishda yashirish (`greatest(...,0)`)
 * kerak emas. Invariant ikki qavat bilan himoyalangan:
 *   1) qoldiq qatori `for update` bilan qulflanadi — parallel tasdiqlashlar navbatga turadi;
 *   2) band qilish `UPDATE ... WHERE reserved + take <= quantity` sharti bilan yoziladi — qulf
 *      qandaydir sababga ko'ra ishlamasa ham baza qatori buzilmaydi.
 *
 * IKKI SIYOSAT (buyurtma manbasiga qarab, `orders.service.ts` tanlaydi):
 *   - `strict` — qoldiq yetmasa buyurtma TASDIQLANMAYDI (400 `out_of_stock`). Savdo agenti va kassa:
 *     agent bor tovarni sotadi, ikki agent bitta qoldiqni ikki marta sotolmaydi.
 *   - `best_effort` — qoldiq yetmasa buyurtma tasdiqlanadi, lekin BOR miqdorgina band qilinadi;
 *     yetmagan qismi band EMAS (bu oldindan buyurtma — tovar keyin keladi). Qo'lda kiritilgan,
 *     import qilingan va bot buyurtmalari shunday: "tovar kelishidan oldin buyurtma olish" —
 *     ataylab ochiq qoldirilgan biznes yo'li, lekin u band qilish deb HISOBLANMAYDI.
 *
 * Har qator uchun haqiqatda qancha band qilingani `sales_order_items.reserved_qty` da (asosiy
 * birlikda) saqlanadi — bo'shatish aynan shu miqdorda bajariladi va boshqa buyurtmalarning bandiga
 * tegmaydi.
 *
 * Band qilish qachon bo'shaydi:
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

/** `strict` — yetmasa xato; `best_effort` — bor miqdor band qilinadi, qolgani oldindan buyurtma. */
export type ReservationPolicy = "strict" | "best_effort";

type Line = { itemId: string; productId: string; productName: string; baseQty: bigint };

/** Buyurtma qatorlari asosiy birlikda (qator identifikatori saqlanadi — band qilish qator bo'yicha yoziladi). */
async function orderLines(tx: Tx, companyId: string, orderId: string): Promise<Line[]> {
  const items = await tx
    .select({ id: salesOrderItems.id, productId: salesOrderItems.productId, unitId: salesOrderItems.unitId, quantity: salesOrderItems.quantity })
    .from(salesOrderItems)
    .where(eq(salesOrderItems.orderId, orderId))
    .orderBy(asc(salesOrderItems.id));
  if (items.length === 0) return [];

  const productRows = await tx
    .select({ id: products.id, name: products.name, baseUnitId: products.baseUnitId })
    .from(products)
    .where(inArray(products.id, [...new Set(items.map((item) => item.productId))]));
  const productById = new Map(productRows.map((product) => [product.id, product]));

  const lines: Line[] = [];
  for (const item of items) {
    const product = productById.get(item.productId);
    if (!product) continue;
    const factor = toMinor(await unitFactorToBase(tx, companyId, product, item.unitId), SCALE);
    const baseQty = rescale(toMinor(item.quantity, SCALE) * factor, 8, SCALE);
    if (baseQty <= 0n) continue;
    lines.push({ itemId: item.id, productId: product.id, productName: product.name, baseQty });
  }
  return lines;
}

/**
 * Buyurtma tovarini band qiladi. Band qilingan miqdor qoldiqdan oshmaydi (yuqoridagi invariant).
 * Qaytaradi: haqiqatda band qilingan umumiy miqdor mavjudmi (`false` — oldindan buyurtma, hech narsa
 * band qilinmadi).
 */
export async function reserveOrderStock(
  tx: Tx,
  companyId: string,
  order: { id: string; number: string; warehouseId: string; stockReserved: boolean },
  options: { policy: ReservationPolicy },
): Promise<boolean> {
  if (order.stockReserved) return true;
  const lines = await orderLines(tx, companyId, order.id);
  if (lines.length === 0) return false;

  // Deadlock bo'lmasligi uchun mahsulotlar doim bir xil tartibda qulflanadi
  const byProduct = new Map<string, Line[]>();
  for (const line of lines) byProduct.set(line.productId, [...(byProduct.get(line.productId) ?? []), line]);
  const productIds = [...byProduct.keys()].sort();

  /** Qator bo'yicha band qilingan miqdor (asosiy birlikda). */
  const reservedByItem = new Map<string, bigint>();
  let reservedTotal = 0n;

  for (const productId of productIds) {
    const productLines = byProduct.get(productId)!;
    const need = productLines.reduce((sum, line) => sum + line.baseQty, 0n);

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

    const onHand = level ? toMinor(level.quantity, SCALE) : 0n;
    const alreadyReserved = level ? toMinor(level.reservedQty, SCALE) : 0n;
    const available = onHand > alreadyReserved ? onHand - alreadyReserved : 0n;

    if (options.policy === "strict" && need > available) {
      throw badRequest(`${productLines[0]!.productName}: omborda yetarli emas (mavjud ${fromMinor(available, SCALE)})`, {
        reason: "out_of_stock",
        productId,
        available: fromMinor(available, SCALE),
      });
    }

    const take = need < available ? need : available;
    if (take <= 0n || !level) continue;

    // Invariant bazada ham: qulf ishlamay qolsa ham band qoldiqdan oshib ketmaydi
    const amount = fromMinor(take, SCALE);
    const [updated] = await tx
      .update(stockLevels)
      .set({ reservedQty: sql`${stockLevels.reservedQty} + ${amount}::numeric`, updatedAt: new Date() })
      .where(and(eq(stockLevels.id, level.id), sql`${stockLevels.reservedQty} + ${amount}::numeric <= ${stockLevels.quantity}`))
      .returning({ id: stockLevels.id });
    if (!updated) {
      throw badRequest(`${productLines[0]!.productName}: omborda yetarli emas`, { reason: "out_of_stock", productId });
    }

    // Band qilingan miqdor qatorlarga ketma-ket taqsimlanadi (birinchi qator to'liq, keyingisi qoldig'idan)
    let left = take;
    for (const line of productLines) {
      if (left <= 0n) break;
      const share = line.baseQty < left ? line.baseQty : left;
      reservedByItem.set(line.itemId, share);
      left -= share;
    }
    reservedTotal += take;
  }

  for (const [itemId, baseQty] of reservedByItem) {
    await tx.update(salesOrderItems).set({ reservedQty: fromMinor(baseQty, SCALE) }).where(eq(salesOrderItems.id, itemId));
  }

  if (reservedTotal > 0n) {
    await tx.update(salesOrders).set({ stockReserved: true, updatedAt: new Date() }).where(eq(salesOrders.id, order.id));
    return true;
  }
  return false;
}

/**
 * Band qilishni bo'shatadi (jo'natish yoki bekor qilishda) — AYNAN band qilingan miqdorda.
 *
 * Eski (0073 migratsiyasidan oldingi) buyurtmalarda qator bo'yicha miqdor 0 bo'ladi; bunday holatda
 * buyurtma miqdori bo'yicha bo'shatiladi (o'sha davrda aynan shuncha band qilingan edi).
 */
export async function releaseOrderStock(
  tx: Tx,
  companyId: string,
  order: { id: string; warehouseId: string; stockReserved: boolean },
) {
  if (!order.stockReserved) return;

  const rows = await tx
    .select({ id: salesOrderItems.id, productId: salesOrderItems.productId, reservedQty: salesOrderItems.reservedQty })
    .from(salesOrderItems)
    .where(eq(salesOrderItems.orderId, order.id));

  const stored = new Map<string, bigint>();
  for (const row of rows) {
    const qty = toMinor(row.reservedQty, SCALE);
    if (qty > 0n) stored.set(row.productId, (stored.get(row.productId) ?? 0n) + qty);
  }

  // Eski yozuvlar: qatorda band miqdori saqlanmagan — buyurtma miqdoridan hisoblanadi
  const totals =
    stored.size > 0
      ? stored
      : (await orderLines(tx, companyId, order.id)).reduce((map, line) => {
          map.set(line.productId, (map.get(line.productId) ?? 0n) + line.baseQty);
          return map;
        }, new Map<string, bigint>());

  for (const [productId, baseQty] of [...totals.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
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

  if (rows.length > 0) {
    await tx.update(salesOrderItems).set({ reservedQty: "0" }).where(eq(salesOrderItems.orderId, order.id));
  }
  await tx.update(salesOrders).set({ stockReserved: false, updatedAt: new Date() }).where(eq(salesOrders.id, order.id));
}
