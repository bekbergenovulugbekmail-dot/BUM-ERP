/**
 * Mahsulot rentabelligi (2026-09-26, supermarket qabul testi — oldin yo'q edi).
 *
 * Yangi hisob-kitob EMAS — kanonik manbalar yig'indisi:
 *   - sotuv: yakunlangan (COGS yozilgan) buyurtma qatorlari — `sales_order_items` (miqdor × narx = yalpi, `line_total` =
 *     chegirmadan keyingi tushum, `quantity × cost_price` = sotuv paytidagi tannarx — jurnal 5000 bilan bir xil);
 *   - qaytarish: `sales_return_items` (`line_total` — tushum tuzatmasi, `cogs` — tannarx tuzatmasi), o'z sanasi bo'yicha.
 * Sof tushum = tushum − qaytarish; tannarx = sotuv tannarxi − qaytgan tannarx; yalpi foyda = sof tushum − tannarx.
 * Hamma summa tiyingacha (numeric) — float emas.
 */
import { and, eq, sql } from "drizzle-orm";
import { products } from "../../db/schema/catalog.js";
import { salesOrderItems, salesOrders, salesReturnItems, salesReturns } from "../../db/schema/sales.js";
import type { DbOrTx } from "../../db/transaction.js";
import { fromMinor, toMinor } from "../../shared/decimal.js";
import type { TenantContext } from "../company/tenant.js";
import { COMPLETED_STATUSES } from "../sales/sale-status.js";

/**
 * Sotuv yozilgan (tushum va COGS jurnalda) buyurtmalar: yakunlanganlar va TO'LIQ qaytarilganlar (`returned`) —
 * qaytarilgan buyurtmaning sotuvi ham bo'lgan, qaytarish esa alohida ayiriladi (aks holda qaytarish ikki marta ayirilardi).
 */
const completed = sql.raw(`(${[...COMPLETED_STATUSES, "returned"].map((status) => `'${status}'`).join(", ")})`);

export async function productProfitability(conn: DbOrTx, tenant: TenantContext, range: { from: string; to: string }) {
  const companyId = tenant.company.id;
  const sold = await conn
    .select({
      productId: salesOrderItems.productId,
      quantity: sql<string>`sum(${salesOrderItems.quantity})::numeric(18,4)::text`,
      gross: sql<string>`sum(round(${salesOrderItems.quantity} * ${salesOrderItems.unitPrice}, 2))::numeric(18,2)::text`,
      revenue: sql<string>`sum(${salesOrderItems.lineTotal})::numeric(18,2)::text`,
      cogs: sql<string>`sum(round(${salesOrderItems.quantity} * ${salesOrderItems.costPrice}, 2))::numeric(18,2)::text`,
    })
    .from(salesOrderItems)
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderItems.orderId))
    .where(
      and(
        eq(salesOrders.companyId, companyId),
        sql`${salesOrders.status} in ${completed}`,
        sql`${salesOrders.orderDate} between ${range.from}::date and ${range.to}::date`,
      ),
    )
    .groupBy(salesOrderItems.productId);
  const returned = await conn
    .select({
      productId: salesReturnItems.productId,
      quantity: sql<string>`sum(${salesReturnItems.quantity})::numeric(18,4)::text`,
      amount: sql<string>`sum(${salesReturnItems.lineTotal})::numeric(18,2)::text`,
      cogs: sql<string>`sum(${salesReturnItems.cogs})::numeric(18,2)::text`,
    })
    .from(salesReturnItems)
    .innerJoin(salesReturns, eq(salesReturns.id, salesReturnItems.returnId))
    .where(
      and(
        eq(salesReturns.companyId, companyId),
        sql`(${salesReturns.createdAt} at time zone 'Asia/Tashkent')::date between ${range.from}::date and ${range.to}::date`,
      ),
    )
    .groupBy(salesReturnItems.productId);

  const ids = [...new Set([...sold.map((row) => row.productId), ...returned.map((row) => row.productId)])];
  const names = ids.length
    ? await conn
        .select({ id: products.id, name: products.name, sku: products.sku })
        .from(products)
        .where(and(eq(products.companyId, companyId), sql`${products.id} = any(${sql.param(ids)}::uuid[])`))
    : [];

  const rows = ids.map((productId) => {
    const sale = sold.find((row) => row.productId === productId);
    const back = returned.find((row) => row.productId === productId);
    const gross = toMinor(sale?.gross ?? "0");
    const revenue = toMinor(sale?.revenue ?? "0");
    const returns = toMinor(back?.amount ?? "0");
    const netRevenue = revenue - returns;
    const cogs = toMinor(sale?.cogs ?? "0") - toMinor(back?.cogs ?? "0");
    const grossProfit = netRevenue - cogs;
    const product = names.find((row) => row.id === productId);
    return {
      productId,
      name: product?.name ?? "",
      sku: product?.sku ?? "",
      unitsSold: sale?.quantity ?? "0.0000",
      unitsReturned: back?.quantity ?? "0.0000",
      grossSales: fromMinor(gross),
      discount: fromMinor(gross - revenue),
      returns: fromMinor(returns),
      netRevenue: fromMinor(netRevenue),
      cogs: fromMinor(cogs),
      grossProfit: fromMinor(grossProfit),
      /** Yalpi foyda / sof tushum, % (tushum 0 bo'lsa null). */
      marginPercent: netRevenue !== 0n ? Number((grossProfit * 10_000n) / netRevenue) / 100 : null,
    };
  });
  rows.sort((a, b) => Number(toMinor(b.grossProfit) - toMinor(a.grossProfit)));
  const sum = (pick: (row: (typeof rows)[number]) => string) => fromMinor(rows.reduce((total, row) => total + toMinor(pick(row)), 0n));
  return {
    from: range.from,
    to: range.to,
    products: rows,
    totals: {
      grossSales: sum((row) => row.grossSales),
      discount: sum((row) => row.discount),
      returns: sum((row) => row.returns),
      netRevenue: sum((row) => row.netRevenue),
      cogs: sum((row) => row.cogs),
      grossProfit: sum((row) => row.grossProfit),
    },
  };
}
