/**
 * Tezkor sotuv (kompaniya sozlamasi `pos.quickSale`): rahbar tanlagan mahsulotlar tartibi bilan. Qurilmalarga pull
 * `config.quickSale` bilan boradi. Tavsiya — oxirgi 7/30/90 kunda kassada eng ko'p sotilganlar (qaytarilgani ayirilgan).
 */
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  MAX_QUICK_SALE_ITEMS,
  POS_QUICK_SALE_KEY,
  activePromoPrice,
  badRequest,
  parsePosQuickSale,
  type PosQuickSale,
  type QuickSalePeriod,
} from "@bum/shared";
import { categories, products, units } from "../../db/schema/catalog.js";
import { settings } from "../../db/schema/platform.js";
import { salesOrderItems, salesOrders, salesReturnItems, salesReturns } from "../../db/schema/sales.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { upsertCompanySetting } from "../company/settings.service.js";
import type { TenantContext } from "../company/tenant.js";
import { todayIso } from "../finance/cash.service.js";

export async function getPosQuickSale(conn: DbOrTx, companyId: string): Promise<PosQuickSale> {
  const [row] = await conn
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.companyId, companyId), eq(settings.key, POS_QUICK_SALE_KEY)))
    .limit(1);
  return parsePosQuickSale(row?.value);
}

export type QuickSaleProduct = {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  categoryName: string | null;
  unitName: string | null;
  salesPrice: string;
  salesCurrency: string | null;
  /** Bugun amaldagi aksiya narxi (yo'q — null). */
  promoPrice: string | null;
  promoPriceEnd: string | null;
  hasImage: boolean;
  isActive: boolean;
  isSaleable: boolean;
};

async function productSummaries(conn: DbOrTx, companyId: string, ids: string[]): Promise<Map<string, QuickSaleProduct>> {
  if (ids.length === 0) return new Map();
  const rows = await conn
    .select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      barcode: products.barcode,
      categoryName: categories.name,
      unitName: units.shortName,
      salesPrice: products.salesPrice,
      salesCurrency: products.salesCurrency,
      promoPrice: products.promoPrice,
      promoPriceEnd: products.promoPriceEnd,
      hasImage: sql<boolean>`${products.imageKey} is not null`,
      isActive: products.isActive,
      isSaleable: products.isSaleable,
    })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(units, eq(units.id, products.baseUnitId))
    .where(and(eq(products.companyId, companyId), inArray(products.id, ids)));
  const today = todayIso();
  return new Map(
    rows.map((row) => {
      const promoPrice = activePromoPrice(row, today);
      return [row.id, { ...row, promoPrice, promoPriceEnd: promoPrice ? row.promoPriceEnd : null }];
    }),
  );
}

/** Joriy assortiment: o'chirilgan mahsulotlar tushib qoladi, tartib saqlanadi. */
export async function quickSaleAssortment(conn: DbOrTx, companyId: string) {
  const { productIds } = await getPosQuickSale(conn, companyId);
  const byId = await productSummaries(conn, companyId, productIds);
  const list = productIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  return { productIds: list.map((product) => product.id), products: list };
}

export async function savePosQuickSale(tx: Tx, tenant: TenantContext, input: { productIds: string[] }, meta: RequestMeta) {
  const productIds = [...new Set(input.productIds)];
  if (productIds.length > MAX_QUICK_SALE_ITEMS) throw badRequest(`Tezkor sotuvda ko'pi bilan ${MAX_QUICK_SALE_ITEMS} ta mahsulot`);
  if (productIds.length > 0) {
    const found = await tx
      .select({ id: products.id, name: products.name, isActive: products.isActive, isSaleable: products.isSaleable })
      .from(products)
      .where(and(eq(products.companyId, tenant.company.id), inArray(products.id, productIds)));
    if (found.length !== productIds.length) throw badRequest("Mahsulot topilmadi");
    const unsaleable = found.find((product) => !product.isActive || !product.isSaleable);
    if (unsaleable) throw badRequest(`${unsaleable.name}: mahsulot sotilmaydi`);
  }
  const value: PosQuickSale = { productIds };
  await upsertCompanySetting(
    tx,
    tenant,
    { key: POS_QUICK_SALE_KEY, value: JSON.stringify(value), group: "pos", description: "Tezkor sotuv assortimenti" },
    meta,
  );
  return value;
}

/**
 * Oxirgi `days` kunda kassa cheklarida eng ko'p sotilgan faol mahsulotlar: sotilgan miqdordan shu davrdagi qaytarishlar
 * ayiriladi; teng bo'lsa — ko'proq chekda uchragani oldin.
 */
export async function quickSaleSuggestions(conn: DbOrTx, companyId: string, input: { days: QuickSalePeriod; limit: number }) {
  const since = new Date(Date.now() - (input.days - 1) * 86_400_000).toISOString().slice(0, 10);
  const counted = sql`(${salesOrders.status} in ('shipped', 'delivered') or (${salesOrders.status} = 'returned' and exists (select 1 from ${salesReturns} sr where sr.order_id = ${salesOrders.id})))`;
  const returned = sql`coalesce((select sum(ri.quantity) from ${salesReturnItems} ri join ${salesReturns} r on r.id = ri.return_id where ri.product_id = ${salesOrderItems.productId} and r.company_id = ${companyId} and r.created_at >= ${since}::date), 0)`;
  const net = sql`(sum(${salesOrderItems.quantity}) - ${returned})`;
  const receipts = sql<number>`count(distinct ${salesOrders.id})::int`;
  const rows = await conn
    .select({
      productId: salesOrderItems.productId,
      quantity: sql<string>`${net}::text`,
      revenue: sql<string>`coalesce(sum(${salesOrderItems.lineTotal}), 0)::text`,
      receipts,
    })
    .from(salesOrderItems)
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderItems.orderId))
    .innerJoin(products, eq(products.id, salesOrderItems.productId))
    .where(
      and(
        eq(salesOrders.companyId, companyId),
        eq(salesOrders.isPos, true),
        gte(salesOrders.orderDate, since),
        counted,
        eq(products.isActive, true),
        eq(products.isSaleable, true),
      ),
    )
    .groupBy(salesOrderItems.productId)
    .having(sql`${net} > 0`)
    .orderBy(desc(net), desc(receipts))
    .limit(input.limit);
  const byId = await productSummaries(
    conn,
    companyId,
    rows.map((row) => row.productId),
  );
  return rows.flatMap((row) => {
    const product = byId.get(row.productId);
    return product ? [{ product, quantity: row.quantity, revenue: row.revenue, receipts: row.receipts }] : [];
  });
}
