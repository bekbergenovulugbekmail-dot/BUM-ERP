/**
 * TANNARX VA NARX TAKLIFLARI — mavjud manbalardan o'qiladi, yangi narx tizimi yaratilmaydi.
 *
 * Manbalar (source of truth):
 *   - joriy kirim/sotuv narxi → `products.purchase_price` / `products.sales_price` (asosiy birlik uchun);
 *   - o'rtacha tannarx        → `stock_levels.avg_cost_price` (AVCO, qoldiqqa tortilgan);
 *   - oxirgi/o'rtacha xarid narxi → `purchase_order_items` (faqat tovar kelgan hujjatlar);
 *   - oxirgi sotuv narxi      → `sales_order_items` (faqat yakunlangan savdolar).
 *
 * Ikki normallashtirish MAJBURIY, aks holda raqamlar solishtirib bo'lmaydigan bo'ladi:
 *   1) valyuta — xarid qatori o'z valyutasida (`unit_price × exchange_rate` → asosiy valyuta);
 *   2) o'lchov birligi — "quti"dagi narx "dona"dagi narx bilan qo'shilmasin (`unitFactorsToBase`).
 *
 * Hammasi kompaniya bo'yicha qat'iy chegaralangan: boshqa biznesning narxi hech qachon qaytmaydi.
 * Ruxsat: `products.view_cost` — marshrutda tekshiriladi.
 */
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { badRequest, notFound } from "@bum/shared";
import { products, units } from "../../db/schema/catalog.js";
import { purchaseOrderItems, purchaseOrders, suppliers } from "../../db/schema/purchase.js";
import { salesOrderItems, salesOrders } from "../../db/schema/sales.js";
import type { DbOrTx } from "../../db/transaction.js";
import type { TenantContext } from "../company/tenant.js";
import { COMPLETED_STATUSES } from "../sales/sale-status.js";
import { unitFactorsToBase } from "./conversions.js";

/** Tovar haqiqatan kelgan hujjatlar; qoralama, tasdiqlangan-yu kelmagan va bekor qilingan hisobga olinmaydi. */
const RECEIVED_STATUSES = ["partial", "received", "invoiced", "paid"] as const;

/** O'rtacha xarid narxi shuncha oxirgi qator bo'yicha hisoblanadi (eski, ahamiyatsiz narxlar o'rtachani buzmasin). */
const AVG_WINDOW = 20;

const fixed = (value: number) => value.toFixed(4);

export type PriceSuggestion = {
  productId: string;
  /** Narxlar shu birlik uchun (so'ralgan birlik yoki mahsulotning asosiy birligi). */
  unitId: string;
  unitName: string;
  /** Oxirgi xarid: narx, sana va ta'minotchi; hech qachon xarid qilinmagan bo'lsa — null. */
  lastPurchase: { price: string; date: string; supplierName: string | null } | null;
  /** Oxirgi {AVG_WINDOW} xarid qatori bo'yicha miqdorga tortilgan o'rtacha. */
  avgPurchasePrice: string | null;
  /** Oxirgi yakunlangan savdodagi narx. */
  lastSalesPrice: string | null;
  /** Mahsulot kartochkasidagi joriy narxlar — solishtirish uchun. */
  currentPurchasePrice: string;
  currentSalesPrice: string;
};

/**
 * Xarid hujjatini to'ldirishda narx tavsiyalari.
 *
 * Tavsiya — faqat MA'LUMOT: bu yerda hech narsa yozilmaydi va qaytgan qiymat avtomatik
 * qo'llanmaydi; foydalanuvchi kerakli raqamni o'zi tanlaydi.
 */
export async function priceSuggestions(
  conn: DbOrTx,
  tenant: TenantContext,
  input: { productId: string; unitId?: string },
): Promise<PriceSuggestion> {
  const companyId = tenant.company.id;

  const [product] = await conn
    .select({
      id: products.id,
      name: products.name,
      baseUnitId: products.baseUnitId,
      purchasePrice: products.purchasePrice,
      salesPrice: products.salesPrice,
    })
    .from(products)
    .where(and(eq(products.id, input.productId), eq(products.companyId, companyId)))
    .limit(1);
  if (!product) throw notFound("Mahsulot topilmadi");

  const factors = await unitFactorsToBase(conn, companyId, product);
  const targetUnitId = input.unitId ?? product.baseUnitId;
  const targetFactor = factors.get(targetUnitId);
  if (!targetFactor) throw badRequest(`${product.name}: bu o'lchov birligidan asosiy birlikka konversiya yo'q`);

  const [unit] = await conn.select({ shortName: units.shortName }).from(units).where(eq(units.id, targetUnitId)).limit(1);

  // ── Xarid tarixi (asosiy valyutada, asosiy birlik uchun) ───────────────────
  const purchaseRows = await conn
    .select({
      unitId: purchaseOrderItems.unitId,
      unitPrice: purchaseOrderItems.unitPrice,
      exchangeRate: purchaseOrderItems.exchangeRate,
      receivedQty: purchaseOrderItems.receivedQty,
      orderDate: purchaseOrders.orderDate,
      createdAt: purchaseOrders.createdAt,
      supplierName: suppliers.name,
    })
    .from(purchaseOrderItems)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderItems.orderId))
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(
      and(
        eq(purchaseOrderItems.companyId, companyId),
        eq(purchaseOrderItems.productId, product.id),
        inArray(purchaseOrders.status, [...RECEIVED_STATUSES]),
        gt(purchaseOrderItems.receivedQty, "0"),
      ),
    )
    .orderBy(desc(purchaseOrders.orderDate), desc(purchaseOrders.createdAt))
    .limit(AVG_WINDOW);

  // Konversiyasi yo'q birlikdagi eski qatorlar tashlab yuboriladi — narxni buzmasin
  const comparable = purchaseRows.flatMap((row) => {
    const factor = factors.get(row.unitId);
    if (!factor) return [];
    const qty = Number(row.receivedQty);
    const total = Number(row.unitPrice) * Number(row.exchangeRate) * qty;
    return [{ ...row, baseQty: qty * factor, total, basePrice: total / (qty * factor) }];
  });

  const first = comparable[0];
  const totalQty = comparable.reduce((sum, row) => sum + row.baseQty, 0);
  const totalCost = comparable.reduce((sum, row) => sum + row.total, 0);

  // ── Oxirgi sotuv narxi (sotuv qatori narxi doim asosiy valyutada) ──────────
  const salesRows = await conn
    .select({ unitId: salesOrderItems.unitId, unitPrice: salesOrderItems.unitPrice })
    .from(salesOrderItems)
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderItems.orderId))
    .where(
      and(
        eq(salesOrderItems.companyId, companyId),
        eq(salesOrderItems.productId, product.id),
        inArray(salesOrders.status, [...COMPLETED_STATUSES]),
      ),
    )
    .orderBy(desc(salesOrders.orderDate), desc(salesOrders.createdAt))
    .limit(5);
  const lastSale = salesRows.find((row) => factors.has(row.unitId));

  return {
    productId: product.id,
    unitId: targetUnitId,
    unitName: unit?.shortName ?? "",
    lastPurchase: first
      ? { price: fixed(first.basePrice * targetFactor), date: first.orderDate, supplierName: first.supplierName }
      : null,
    avgPurchasePrice: totalQty > 0 ? fixed((totalCost / totalQty) * targetFactor) : null,
    lastSalesPrice: lastSale ? fixed((Number(lastSale.unitPrice) / factors.get(lastSale.unitId)!) * targetFactor) : null,
    currentPurchasePrice: fixed(Number(product.purchasePrice) * targetFactor),
    currentSalesPrice: fixed(Number(product.salesPrice) * targetFactor),
  };
}

export type CostRow = {
  id: string;
  name: string;
  sku: string;
  unitName: string;
  /** Kartochkadagi kirim narxi. */
  currentCost: string;
  /** AVCO — ombor qoldig'iga tortilgan o'rtacha tannarx; qoldiq yo'q bo'lsa null. */
  avgCost: string | null;
  lastPurchasePrice: string | null;
  lastPurchaseDate: string | null;
  salesPrice: string;
  /** Marja = (sotuv − tannarx) / sotuv × 100; sotuv narxi 0 bo'lsa — null. */
  marginPercent: string | null;
};

/**
 * "Tannarx" sahifasi: mahsulot bo'yicha tannarx, oxirgi xarid va marja.
 *
 * Narxlar asosiy birlik uchun. Oxirgi xarid narxi hujjat birligidan asosiy birlikka
 * konversiya koeffitsienti bilan keltiriladi (`unit_conversions`), valyuta — kurs bilan.
 */
export async function productCosts(
  conn: DbOrTx,
  tenant: TenantContext,
  options: { search?: string; limit?: number } = {},
): Promise<{ products: CostRow[] }> {
  const companyId = tenant.company.id;
  const limit = Math.min(options.limit ?? 100, 500);
  const search = options.search?.trim();

  const rows = await conn
    .select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      unitName: units.shortName,
      currentCost: products.purchasePrice,
      salesPrice: products.salesPrice,
      // AVCO: omborlar bo'yicha qoldiqqa tortilgan o'rtacha tannarx
      avgCost: sql<string | null>`(
        select case when sum(s."quantity") > 0
          then round(sum(s."avg_cost_price" * s."quantity") / sum(s."quantity"), 4)
          else null end
        from "stock_levels" s
        where s."product_id" = ${products.id} and s."company_id" = ${companyId}
      )`,
      // Oxirgi kelgan xarid qatori: narx asosiy valyuta va asosiy birlikka keltiriladi
      lastPurchasePrice: sql<string | null>`(
        select round(
          i."unit_price" * i."exchange_rate" / coalesce((
            select c."factor" from "unit_conversions" c
            where c."company_id" = ${companyId} and c."from_unit_id" = i."unit_id"
              and c."to_unit_id" = ${products.baseUnitId}
              and (c."product_id" = ${products.id} or c."product_id" is null)
            order by c."product_id" nulls last limit 1
          ), case when i."unit_id" = ${products.baseUnitId} then 1 else null end), 4)
        from "purchase_order_items" i
        join "purchase_orders" o on o."id" = i."order_id"
        where i."product_id" = ${products.id} and i."company_id" = ${companyId}
          and i."received_qty" > 0
          and o."status" in ('partial', 'received', 'invoiced', 'paid')
        order by o."order_date" desc, o."created_at" desc limit 1
      )`,
      lastPurchaseDate: sql<string | null>`(
        select o."order_date"::text
        from "purchase_order_items" i
        join "purchase_orders" o on o."id" = i."order_id"
        where i."product_id" = ${products.id} and i."company_id" = ${companyId}
          and i."received_qty" > 0
          and o."status" in ('partial', 'received', 'invoiced', 'paid')
        order by o."order_date" desc, o."created_at" desc limit 1
      )`,
    })
    .from(products)
    .innerJoin(units, eq(units.id, products.baseUnitId))
    .where(
      and(
        eq(products.companyId, companyId),
        eq(products.isActive, true),
        search ? sql`(${products.name} ilike ${`%${search}%`} or ${products.sku} ilike ${`%${search}%`})` : undefined,
      ),
    )
    .orderBy(products.name)
    .limit(limit);

  return {
    products: rows.map((row) => {
      const sales = Number(row.salesPrice);
      // Marja haqiqiy tannarxdan: qoldiq bor bo'lsa AVCO, aks holda kartochkadagi kirim narxi
      const cost = Number(row.avgCost ?? row.currentCost);
      return { ...row, marginPercent: sales > 0 ? (((sales - cost) / sales) * 100).toFixed(2) : null };
    }),
  };
}

export type CostHistoryRow = {
  orderId: string;
  number: string;
  date: string;
  supplierName: string;
  /** Hujjatdagi birlik va miqdor — narx qaysi birlik uchun bo'lganini ko'rsatadi. */
  unitName: string;
  quantity: string;
  /** Hujjat valyutasidagi narx va uning kodi. */
  unitPrice: string;
  currency: string;
  /** Asosiy valyuta va asosiy birlikka keltirilgan narx; konversiya yo'q bo'lsa null. */
  basePrice: string | null;
};

/** Bitta mahsulotning tannarx tarixi: tovar kelgan xarid hujjatlari, yangisidan eskisiga. */
export async function costHistory(
  conn: DbOrTx,
  tenant: TenantContext,
  productId: string,
  limit = 20,
): Promise<{ history: CostHistoryRow[] }> {
  const companyId = tenant.company.id;

  const [product] = await conn
    .select({ id: products.id, baseUnitId: products.baseUnitId })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.companyId, companyId)))
    .limit(1);
  if (!product) throw notFound("Mahsulot topilmadi");

  const factors = await unitFactorsToBase(conn, companyId, product);

  const rows = await conn
    .select({
      orderId: purchaseOrders.id,
      number: purchaseOrders.number,
      date: purchaseOrders.orderDate,
      supplierName: suppliers.name,
      unitId: purchaseOrderItems.unitId,
      unitName: units.shortName,
      quantity: purchaseOrderItems.receivedQty,
      unitPrice: purchaseOrderItems.unitPrice,
      exchangeRate: purchaseOrderItems.exchangeRate,
      currency: purchaseOrderItems.currency,
      orderCurrency: purchaseOrders.currency,
    })
    .from(purchaseOrderItems)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderItems.orderId))
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .innerJoin(units, eq(units.id, purchaseOrderItems.unitId))
    .where(
      and(
        eq(purchaseOrderItems.companyId, companyId),
        eq(purchaseOrderItems.productId, productId),
        inArray(purchaseOrders.status, [...RECEIVED_STATUSES]),
        gt(purchaseOrderItems.receivedQty, "0"),
      ),
    )
    .orderBy(desc(purchaseOrders.orderDate), desc(purchaseOrders.createdAt))
    .limit(Math.min(limit, 100));

  return {
    history: rows.map((row) => {
      const factor = factors.get(row.unitId);
      return {
        orderId: row.orderId,
        number: row.number,
        date: row.date,
        supplierName: row.supplierName,
        unitName: row.unitName,
        quantity: row.quantity,
        unitPrice: row.unitPrice,
        currency: row.currency ?? row.orderCurrency,
        basePrice: factor ? fixed((Number(row.unitPrice) * Number(row.exchangeRate)) / factor) : null,
      };
    }),
  };
}
