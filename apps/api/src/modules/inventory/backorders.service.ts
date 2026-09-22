/**
 * BACKORDER REYESTRI — mijozga va'da qilingan, lekin omborda hali band qilinmagan tovar.
 *
 * YANGI JADVAL YO'Q: reyestr mavjud `sales_order_items` dan hosil qilinadi.
 *   ordered  — qator miqdori (asosiy birlikda)
 *   reserved — `sales_order_items.reserved_qty` (haqiqatda band qilingani)
 *   backorder = ordered − reserved
 *
 * Qayerdan paydo bo'ladi: `best_effort` band qilish siyosati (qo'lda kiritilgan, import qilingan va
 * bot buyurtmalari) — qoldiq yetmasa buyurtma tasdiqlanadi, bor miqdorgina band qilinadi, qolgani
 * "tovar kelgach beramiz" bo'lib qoladi. Ilgari bu faqat qator ichida ko'rinardi va ro'yxati yo'q edi.
 *
 * Holat mavjud hujjat hayot sikliga tayanadi (parallel status YO'Q):
 *   open                 — hech narsa band qilinmagan
 *   partially_allocated  — qisman band qilingan
 *   (to'liq band bo'lgan yoki jo'natilgan qator reyestrdan chiqadi — "fulfilled")
 *
 * Tovar kelganda: `allocateBackorders` ochiq qatorlarni eng eski buyurtmadan boshlab band qiladi.
 * `reserved_qty <= quantity` invarianti shu yerda ham baza sharti bilan himoyalangan (0073 dagi kabi).
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { products } from "../../db/schema/catalog.js";
import { stockLevels, warehouses } from "../../db/schema/inventory.js";
import { purchaseOrderItems, purchaseOrders } from "../../db/schema/purchase.js";
import { customers, salesOrderItems, salesOrders } from "../../db/schema/sales.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { fromMinor, rescale, toMinor } from "../../shared/decimal.js";
import type { TenantContext } from "../company/tenant.js";
import { unitFactorToBase } from "../catalog/conversions.js";

const SCALE = 4;

export type BackorderStatus = "open" | "partially_allocated";

/** Qator miqdori asosiy birlikda (`quantity` qator birligida saqlanadi). */
const baseQtySql = sql<string>`(${salesOrderItems.quantity} * coalesce((
  select c."factor" from "unit_conversions" c
   where c."company_id" = ${salesOrderItems.companyId}
     and c."from_unit_id" = ${salesOrderItems.unitId}
     and c."to_unit_id" = ${products.baseUnitId}
     and (c."product_id" = ${salesOrderItems.productId} or c."product_id" is null)
   order by c."product_id" nulls last limit 1
), case when ${salesOrderItems.unitId} = ${products.baseUnitId} then 1 else null end))::numeric(18,4)`;

/**
 * Ochiq backorder qatori: buyurtma TASDIQLANGAN (jo'natilmagan, bekor qilinmagan) va band qilingan
 * miqdor buyurtma miqdoridan kam.
 */
const openCondition = and(eq(salesOrders.status, "confirmed"), sql`${salesOrderItems.reservedQty} < ${baseQtySql}`);

export type BackorderRow = {
  orderItemId: string;
  orderId: string;
  orderNumber: string;
  orderDate: string;
  customerId: string | null;
  customerName: string | null;
  productId: string;
  productName: string;
  sku: string;
  unitId: string;
  warehouseId: string;
  warehouseName: string;
  ordered: string;
  reserved: string;
  remaining: string;
  status: BackorderStatus;
  /** Yo'ldagi tasdiqlangan xarid qoldig'i (mahsulot + ombor bo'yicha); yo'q bo'lsa "0.0000". */
  inbound: string;
};

export async function listBackorders(
  conn: DbOrTx,
  tenant: TenantContext,
  options: { customerId?: string; productId?: string; warehouseId?: string; status?: BackorderStatus; dateFrom?: string; dateTo?: string; limit?: number } = {},
) {
  const companyId = tenant.company.id;
  const rows = await conn
    .select({
      orderItemId: salesOrderItems.id,
      orderId: salesOrders.id,
      orderNumber: salesOrders.number,
      orderDate: salesOrders.orderDate,
      customerId: salesOrders.customerId,
      customerName: customers.name,
      productId: salesOrderItems.productId,
      productName: products.name,
      sku: products.sku,
      unitId: salesOrderItems.unitId,
      warehouseId: salesOrders.warehouseId,
      warehouseName: warehouses.name,
      ordered: baseQtySql,
      reserved: salesOrderItems.reservedQty,
    })
    .from(salesOrderItems)
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderItems.orderId))
    .innerJoin(products, eq(products.id, salesOrderItems.productId))
    .innerJoin(warehouses, eq(warehouses.id, salesOrders.warehouseId))
    .leftJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(
      and(
        eq(salesOrderItems.companyId, companyId),
        openCondition,
        options.customerId ? eq(salesOrders.customerId, options.customerId) : undefined,
        options.productId ? eq(salesOrderItems.productId, options.productId) : undefined,
        options.warehouseId ? eq(salesOrders.warehouseId, options.warehouseId) : undefined,
        options.dateFrom ? sql`${salesOrders.orderDate} >= ${options.dateFrom}::date` : undefined,
        options.dateTo ? sql`${salesOrders.orderDate} <= ${options.dateTo}::date` : undefined,
      ),
    )
    .orderBy(asc(salesOrders.orderDate), asc(salesOrders.createdAt), asc(salesOrderItems.id))
    .limit(Math.min(options.limit ?? 200, 1000));

  // Yo'ldagi xarid: tasdiqlangan/qisman qabul qilingan hujjatlarning qolgan miqdori (soxta ETA emas —
  // faqat haqiqatda ochiq xarid hujjati bo'lsa ko'rsatiladi)
  const keys = [...new Set(rows.map((row) => `${row.productId}|${row.warehouseId}`))];
  const inbound = new Map<string, bigint>();
  if (keys.length > 0) {
    const inboundRows = await conn
      .select({
        productId: purchaseOrderItems.productId,
        warehouseId: purchaseOrders.warehouseId,
        pending: sql<string>`sum(${purchaseOrderItems.orderedQty} - ${purchaseOrderItems.receivedQty})::numeric(18,4)`,
      })
      .from(purchaseOrderItems)
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderItems.orderId))
      .where(
        and(
          eq(purchaseOrderItems.companyId, companyId),
          inArray(purchaseOrderItems.productId, [...new Set(rows.map((row) => row.productId))]),
          sql`${purchaseOrders.status} in ('confirmed', 'partial')`,
          sql`${purchaseOrderItems.orderedQty} > ${purchaseOrderItems.receivedQty}`,
        ),
      )
      .groupBy(purchaseOrderItems.productId, purchaseOrders.warehouseId);
    for (const row of inboundRows) inbound.set(`${row.productId}|${row.warehouseId}`, toMinor(row.pending, SCALE));
  }

  const items: BackorderRow[] = [];
  let totalRemaining = 0n;
  for (const row of rows) {
    const ordered = toMinor(row.ordered, SCALE);
    const reserved = toMinor(row.reserved, SCALE);
    const remaining = ordered > reserved ? ordered - reserved : 0n;
    if (remaining <= 0n) continue;
    const status: BackorderStatus = reserved > 0n ? "partially_allocated" : "open";
    if (options.status && status !== options.status) continue;
    totalRemaining += remaining;
    items.push({
      ...row,
      ordered: fromMinor(ordered, SCALE),
      reserved: fromMinor(reserved, SCALE),
      remaining: fromMinor(remaining, SCALE),
      status,
      inbound: fromMinor(inbound.get(`${row.productId}|${row.warehouseId}`) ?? 0n, SCALE),
    });
  }
  return { items, totals: { lines: items.length, remaining: fromMinor(totalRemaining, SCALE) } };
}

export type Allocation = { orderItemId: string; orderId: string; orderNumber: string; productId: string; allocated: string };

/**
 * Omborga tovar kelganda ochiq backorderlarni band qiladi — ENG ESKI buyurtmadan boshlab
 * (`order_date`, keyin `created_at`): birinchi kelgan mijoz birinchi oladi.
 *
 * Xavfsizlik:
 *   - qoldiq qatori `for update` bilan qulflanadi (parallel band qilish navbatga turadi);
 *   - yozish sharti `reserved + take <= quantity` — invariant bazada ham himoyalangan;
 *   - faqat shu kompaniya va shu ombor qatorlari ko'riladi (tenant izolyatsiyasi).
 *
 * Mavjud `reserveOrderStock` o'rnini bosmaydi: u tasdiqlashda ishlaydi, bu esa keyin kelgan tovarni
 * allaqachon tasdiqlangan qatorlarga tarqatadi.
 */
export async function allocateBackorders(
  tx: Tx,
  companyId: string,
  warehouseId: string,
  productIds: readonly string[],
): Promise<Allocation[]> {
  const unique = [...new Set(productIds)].sort();
  if (unique.length === 0) return [];
  const allocations: Allocation[] = [];

  for (const productId of unique) {
    const [level] = await tx
      .select({ id: stockLevels.id, quantity: stockLevels.quantity, reservedQty: stockLevels.reservedQty })
      .from(stockLevels)
      .where(and(eq(stockLevels.companyId, companyId), eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, warehouseId)))
      .limit(1)
      .for("update");
    if (!level) continue;
    let available = toMinor(level.quantity, SCALE) - toMinor(level.reservedQty, SCALE);
    if (available <= 0n) continue;

    const [product] = await tx
      .select({ id: products.id, name: products.name, baseUnitId: products.baseUnitId })
      .from(products)
      .where(and(eq(products.id, productId), eq(products.companyId, companyId)))
      .limit(1);
    if (!product) continue;

    const lines = await tx
      .select({
        itemId: salesOrderItems.id,
        orderId: salesOrders.id,
        orderNumber: salesOrders.number,
        unitId: salesOrderItems.unitId,
        quantity: salesOrderItems.quantity,
        reservedQty: salesOrderItems.reservedQty,
        stockReserved: salesOrders.stockReserved,
      })
      .from(salesOrderItems)
      .innerJoin(salesOrders, eq(salesOrders.id, salesOrderItems.orderId))
      .where(
        and(
          eq(salesOrderItems.companyId, companyId),
          eq(salesOrderItems.productId, productId),
          eq(salesOrders.warehouseId, warehouseId),
          eq(salesOrders.status, "confirmed"),
        ),
      )
      .orderBy(asc(salesOrders.orderDate), asc(salesOrders.createdAt), asc(salesOrderItems.id))
      .for("update", { of: salesOrderItems });

    for (const line of lines) {
      if (available <= 0n) break;
      const factor = await unitFactorToBase(tx, companyId, product, line.unitId);
      const needed = rescale(toMinor(line.quantity, SCALE) * toMinor(factor, SCALE), 8, SCALE) - toMinor(line.reservedQty, SCALE);
      if (needed <= 0n) continue;

      const take = needed < available ? needed : available;
      const amount = fromMinor(take, SCALE);
      const [updated] = await tx
        .update(stockLevels)
        .set({ reservedQty: sql`${stockLevels.reservedQty} + ${amount}::numeric`, updatedAt: new Date() })
        .where(and(eq(stockLevels.id, level.id), sql`${stockLevels.reservedQty} + ${amount}::numeric <= ${stockLevels.quantity}`))
        .returning({ id: stockLevels.id });
      if (!updated) break; // qoldiq yetmadi — keyingi mahsulotga

      await tx
        .update(salesOrderItems)
        .set({ reservedQty: sql`${salesOrderItems.reservedQty} + ${amount}::numeric`, updatedAt: new Date() })
        .where(eq(salesOrderItems.id, line.itemId));
      // Bo'shatish `stock_reserved` belgisiga qaraydi — qisman band qilingan buyurtmada ham yoqiladi
      if (!line.stockReserved) {
        await tx.update(salesOrders).set({ stockReserved: true, updatedAt: new Date() }).where(eq(salesOrders.id, line.orderId));
      }
      allocations.push({ orderItemId: line.itemId, orderId: line.orderId, orderNumber: line.orderNumber, productId, allocated: amount });
      available -= take;
    }
  }
  return allocations;
}
