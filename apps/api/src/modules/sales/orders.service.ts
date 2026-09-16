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
import { and, asc, desc, eq, getTableColumns, gte, ilike, inArray, lt, lte, ne, or, sql } from "drizzle-orm";
import { AppError, activePromoPrice, badRequest, forbidden, notFound } from "@bum/shared";
import { products, units } from "../../db/schema/catalog.js";
import { warehouses } from "../../db/schema/inventory.js";
import {
  customerCashbackTransactions,
  customerPayments,
  customers,
  posShifts,
  salesOrderItems,
  salesOrders,
  salesReturns,
} from "../../db/schema/sales.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { UUID_RE, decodeCursor, encodeCursor } from "../../shared/cursor.js";
import { fromMinor, mulDivRound, rescale, toMinor } from "../../shared/decimal.js";
import { computeLine } from "../../shared/line-amounts.js";
import { nextDocumentNumber } from "../../shared/numbering.js";
import { unitFactorToBase } from "../catalog/conversions.js";
import { effectivePermissions, type TenantContext } from "../company/tenant.js";
import { companyCurrency } from "../finance/accounts.service.js";
import { currencyRate } from "../finance/currencies.service.js";
import {
  ledgerAccountFor,
  recordCashTransaction,
  resolvePaymentAccount,
  todayIso,
  type PaymentMethod,
} from "../finance/cash.service.js";
import { postJournalEntry, requireAccountBySubtype } from "../finance/journal.service.js";
import { moveStock } from "../inventory/stock.service.js";
import { earnOrderCashback, reverseOrderCashback } from "./cashback.service.js";
import { refundToBalance } from "./customer-balance.service.js";
import { addCurrencyAmounts } from "./shift-totals.js";
import { allowedWarehouses, assertWarehouseAccess } from "../inventory/warehouses.service.js";
import { assertProductsInScope, categoryScope, documentHasScopedItem } from "../catalog/category-scope.js";
import { salesAudit } from "./customers.service.js";
import { getSalesPolicy } from "./sales-policy.service.js";
import { COMPLETED_STATUSES, isCompletedSale, paymentStatusSql } from "./sale-status.js";

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
  /** Yetkazib berish kerakmi (null — dostavka siyosati bo'yicha); tasdiqlanganda yetkazma yaratiladi. */
  deliveryRequired?: boolean | null;
  notes?: string | null;
  items: SalesItemInput[];
  /** Sotuv valyutalari (POS bilan bir xil qoida); standart — asosiy valyuta. */
  saleCurrencies?: string[];
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

export type PricingOptions = {
  /** Narx va chegirmani server o'zi hisoblagan (masalan, aksiya) — `sales.edit` talab qilinmaydi. */
  trustedPricing?: boolean;
  /** Offline kassa: sotuv lahzasidagi kurslar (joriy kurs o'rniga). */
  rates?: Record<string, string>;
  /** Kassa (POS): shu sanada amaldagi aksiya narxi (`promoPrice`, `promoPriceEnd` gacha) prays-list narxi hisoblanadi. */
  promoDate?: string;
};

/** `sales.edit` ruxsatisiz, lekin ishonchli narxlashda prays-listdan farq qilgan qator (offline kassa nomuvofiqligi). */
export type PriceChange = {
  productId: string;
  name: string;
  unitPrice: string;
  listPrice: string;
  discountPercent: string;
  customerDiscount: string;
};

export async function prepareSalesItems(
  tx: Tx,
  tenant: TenantContext,
  items: SalesItemInput[],
  customerDiscount: string,
  options: PricingOptions = {},
) {
  if (items.length === 0) throw badRequest("Kamida bitta mahsulot bo'lishi kerak");
  // Savdo buyurtmasi va POS cheki: cheklangan xodim faqat o'z kategoriyalaridagi mahsulotni sotadi
  await assertProductsInScope(tx, tenant, items.map((i) => i.productId));
  const companyId = tenant.company.id;

  const rows = await tx
    .select({
      id: products.id,
      name: products.name,
      baseUnitId: products.baseUnitId,
      salesPrice: products.salesPrice,
      salesCurrency: products.salesCurrency,
      promoPrice: products.promoPrice,
      promoPriceEnd: products.promoPriceEnd,
      taxRate: products.taxRate,
      taxIncluded: products.taxIncluded,
      isActive: products.isActive,
      isSaleable: products.isSaleable,
    })
    .from(products)
    .where(and(eq(products.companyId, companyId), inArray(products.id, [...new Set(items.map((i) => i.productId))])));
  const byId = new Map(rows.map((p) => [p.id, p]));
  const permissions = await effectivePermissions(tx, tenant);
  const canOverride = permissions.includes("sales.edit");
  // Savdo siyosati: qo'lda berilgan chegirma chegaradan oshsa — rahbar (sales.approve); mijozning o'z chegirmasi cheklanmaydi
  const { maxDiscountPercent } = await getSalesPolicy(tx, companyId);
  const discountCeiling = maxDiscountPercent === null ? null : toMinor(maxDiscountPercent, 2);
  const canExceedDiscount = permissions.includes("sales.approve");
  const discountOverLimit: { productId: string; name: string; discountPercent: string; maxDiscountPercent: string }[] = [];

  // Narxi boshqa valyutada belgilangan mahsulot — joriy kurs bilan asosiy valyutada sotiladi
  const rates = new Map<string, string>();
  const basePrice = async (salesPrice: string, currency: string | null) => {
    if (!currency) return salesPrice;
    if (!rates.has(currency)) rates.set(currency, options.rates?.[currency] ?? (await currencyRate(tx, companyId, currency)));
    return fromMinor(rescale(toMinor(salesPrice, 4) * toMinor(rates.get(currency)!, 4), 8, 4), 4);
  };

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
  const priceChanges: PriceChange[] = [];

  for (const item of items) {
    const product = byId.get(item.productId);
    if (!product) throw badRequest("Mahsulot topilmadi");
    if (!product.isActive || !product.isSaleable) throw badRequest(`${product.name}: mahsulot sotilmaydi`);

    const unitId = item.unitId ?? product.baseUnitId;
    const factor = await unitFactorToBase(tx, companyId, product, unitId);
    // Aksiya narxini server hisoblaydi — kassa ko'rsatgan narx faqat taqqoslanadi
    const promo = options.promoDate ? activePromoPrice(product, options.promoDate) : null;
    const unitBasePrice = await basePrice(promo ?? product.salesPrice, product.salesCurrency);
    const listPrice = fromMinor(rescale(toMinor(unitBasePrice, 4) * toMinor(factor, 4), 8, 4), 4);
    const unitPrice = item.unitPrice ?? listPrice;
    const discountPercent = item.discountPercent ?? customerDiscount;
    const changed =
      toMinor(unitPrice, 4) !== toMinor(listPrice, 4) || toMinor(discountPercent, 2) !== toMinor(customerDiscount, 2);
    if (changed && !canOverride && !options.trustedPricing) {
      throw forbidden("Narx yoki chegirmani o'zgartirish uchun ruxsat yo'q: sales.edit");
    }
    // Qurilma (offline kassa) narxi prays-listdan farq qilsa — kassirda sales.edit bo'lsa ham rahbar ko'radigan nomuvofiqlik:
    // qurilma kassir nomini o'zi yuboradi, ruxsatga tayanib jim qabul qilinmaydi
    if (changed && options.trustedPricing) {
      priceChanges.push({ productId: product.id, name: product.name, unitPrice, listPrice, discountPercent, customerDiscount });
    }
    const discount = toMinor(discountPercent, 2);
    if (discountCeiling !== null && discount > discountCeiling && discount !== toMinor(customerDiscount, 2)) {
      // Offline kassa cheki qurilmada yopilgan — rad etilmaydi, rahbar ko'radigan nomuvofiqlik
      if (options.trustedPricing) discountOverLimit.push({ productId: product.id, name: product.name, discountPercent, maxDiscountPercent: maxDiscountPercent! });
      else if (!canExceedDiscount) {
        throw new AppError("FORBIDDEN", `Chegirma ${maxDiscountPercent}% dan oshmasin — kattaroq chegirmani rahbar (sales.approve) beradi`, {
          reason: "discount_limit",
          maxDiscountPercent,
        });
      }
    }

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
    priceChanges,
    /** Ishonchli narxlashda (offline kassa) chegaradan oshgan chegirmalar — chaqiruvchi nomuvofiqlik sifatida yozadi. */
    discountOverLimit,
  };
}

/** Qator + (POS sotuv valyutalarida) chek valyutasi, kurs va valyutadagi summa. */
export type SalesItemRow = Awaited<ReturnType<typeof prepareSalesItems>>["items"][number] & {
  /** Offline kassa: qurilmada yaratilgan qator ID'si (qaytarishda shunga bog'lanadi). */
  id?: string;
  priceCurrency?: string | null;
  priceRate?: string;
  currencyTotal?: string;
};

export async function insertSalesItems(tx: Tx, companyId: string, orderId: string, items: SalesItemRow[]) {
  await tx.insert(salesOrderItems).values(items.map((item) => ({ ...item, companyId, orderId })));
}

export type SaleBucket = { currency: string; rate: string; total: bigint; base: bigint };

/**
 * Qatorlarga sotuv valyutasini beradi: mahsulot narx valyutasi tanlanganlar ichida bo'lsa — o'sha, aks holda
 * birinchi tanlangan valyuta. Valyutadagi summa = asosiy summa / kurs (tiyinga yaxlitlab). Valyuta bo'yicha
 * asosiy qiymat — qatorlar yig'indisi: valyutadagi jami to'liq to'lansa aynan shu yopiladi.
 */
export async function assignSaleCurrencies(
  tx: Tx,
  companyId: string,
  baseCurrency: string,
  saleCurrencies: string[],
  items: SalesItemRow[],
  /** Offline kassa: sotuv lahzasidagi kurslar. */
  rateOverrides?: Record<string, string>,
) {
  const rates = new Map<string, string>([[baseCurrency, "1.0000"]]);
  for (const code of saleCurrencies) {
    if (!rates.has(code)) rates.set(code, rateOverrides?.[code] ?? (await currencyRate(tx, companyId, code)));
  }
  const productRows = await tx
    .select({ id: products.id, salesCurrency: products.salesCurrency })
    .from(products)
    .where(inArray(products.id, [...new Set(items.map((item) => item.productId))]));
  const ownCurrency = new Map(productRows.map((row) => [row.id, row.salesCurrency ?? baseCurrency]));

  const buckets = new Map<string, SaleBucket>();
  for (const item of items) {
    const own = ownCurrency.get(item.productId) ?? baseCurrency;
    const code = saleCurrencies.includes(own) ? own : saleCurrencies[0]!;
    const rate = rates.get(code)!;
    const baseLine = toMinor(item.lineTotal);
    const currencyLine = code === baseCurrency ? baseLine : mulDivRound(baseLine, 10_000n, toMinor(rate, 4));
    item.priceCurrency = code === baseCurrency ? null : code;
    item.priceRate = rate;
    item.currencyTotal = fromMinor(currencyLine);
    const bucket = buckets.get(code) ?? { currency: code, rate, total: 0n, base: 0n };
    bucket.total += currencyLine;
    bucket.base += baseLine;
    buckets.set(code, bucket);
  }
  return buckets;
}

export type OrderCurrencyBucket = SaleBucket & {
  /** To'langani valyutada va asosiy qiymatda. */
  paid: bigint;
  paidBase: bigint;
};

/**
 * Buyurtma valyuta bo'yicha: jami — qatorlardan (valyutada va asosiy qiymatda), to'langani — to'lovlardan.
 * Asosiy valyutadagi to'lovlar (naqd, balans, keshbek) avval asosiy qismni yopadi, ortig'i chet valyuta
 * qismlariga asosiy qiymatda o'tadi (POS bilan bir xil). Buyurtmada yo'q valyutadagi to'lov — asosiy qiymati bilan.
 */
export function orderCurrencyBuckets(
  baseCurrency: string,
  items: { priceCurrency: string | null; priceRate: string; currencyTotal: string; lineTotal: string }[],
  payments: { currency: string; amount: string; foreignAmount: string }[],
): OrderCurrencyBucket[] {
  const buckets = new Map<string, OrderCurrencyBucket>();
  for (const item of items) {
    const code = item.priceCurrency ?? baseCurrency;
    const bucket = buckets.get(code) ?? {
      currency: code,
      rate: item.priceCurrency ? item.priceRate : "1.0000",
      total: 0n,
      base: 0n,
      paid: 0n,
      paidBase: 0n,
    };
    bucket.total += toMinor(item.priceCurrency ? item.currencyTotal : item.lineTotal);
    bucket.base += toMinor(item.lineTotal);
    buckets.set(code, bucket);
  }

  let basePaid = 0n;
  for (const payment of payments) {
    const bucket = payment.currency === baseCurrency ? undefined : buckets.get(payment.currency);
    if (bucket) {
      bucket.paid += toMinor(payment.foreignAmount);
      bucket.paidBase += toMinor(payment.amount);
    } else {
      basePaid += toMinor(payment.amount);
    }
  }

  let overflow = basePaid;
  const base = buckets.get(baseCurrency);
  if (base) {
    const applied = overflow < base.total ? overflow : base.total;
    base.paid += applied;
    base.paidBase += applied;
    overflow -= applied;
  }
  for (const bucket of buckets.values()) {
    if (bucket.currency === baseCurrency || overflow <= 0n) continue;
    const remainingBase = bucket.base - bucket.paidBase;
    if (remainingBase <= 0n) continue;
    const applied = overflow < remainingBase ? overflow : remainingBase;
    bucket.paid += applied === remainingBase ? bucket.total - bucket.paid : mulDivRound(applied, 10_000n, toMinor(bucket.rate, 4));
    bucket.paidBase += applied;
    overflow -= applied;
  }
  return [...buckets.values()];
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

/** Cheklangan xodim: buyurtmadagi barcha mahsulotlar uning kategoriyalarida bo'lishi kerak. */
async function assertOrderInScope(tx: Tx, tenant: TenantContext, orderId: string) {
  const rows = await tx
    .select({ productId: salesOrderItems.productId })
    .from(salesOrderItems)
    .where(eq(salesOrderItems.orderId, orderId));
  await assertProductsInScope(tx, tenant, rows.map((r) => r.productId));
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
      paymentStatus: paymentStatusSql,
    })
    .from(salesOrders)
    .leftJoin(customers, eq(customers.id, salesOrders.customerId))
    .innerJoin(warehouses, eq(warehouses.id, salesOrders.warehouseId))
    .where(and(eq(salesOrders.id, orderId), eq(salesOrders.companyId, tenant.company.id)))
    .limit(1);
  if (!order) throw notFound("Buyurtma topilmadi");
  // A'zo faqat ruxsat berilgan omborlar buyurtmalarini ko'radi
  assertWarehouseAccess(tenant, order.warehouseId);

  const items = await conn
    .select({
      ...itemFields,
      productName: products.name,
      productSku: products.sku,
      productCategoryId: products.categoryId,
      unitName: units.shortName,
    })
    .from(salesOrderItems)
    .innerJoin(products, eq(products.id, salesOrderItems.productId))
    .innerJoin(units, eq(units.id, salesOrderItems.unitId))
    .where(eq(salesOrderItems.orderId, orderId))
    .orderBy(asc(products.name), asc(salesOrderItems.id));

  // Cheklangan xodim o'z kategoriyasidagi mahsulot qatnashmagan buyurtmani ko'rmaydi
  const scope = await categoryScope(conn, tenant);
  if (scope !== null && items.length > 0 && !items.some((i) => i.productCategoryId && scope.includes(i.productCategoryId))) {
    throw notFound("Buyurtma topilmadi");
  }

  const payments = await conn
    .select(paymentFields)
    .from(customerPayments)
    .where(eq(customerPayments.orderId, orderId))
    .orderBy(asc(customerPayments.createdAt));

  // Valyuta bo'yicha jami va to'langan — chet valyuta qatnashgan buyurtmada
  const hasForeign = items.some((item) => item.priceCurrency) || payments.some((payment) => payment.currency !== order.currency);
  const currencyTotals = hasForeign
    ? orderCurrencyBuckets(order.currency, items, payments).map((bucket) => ({
        currency: bucket.currency,
        totalAmount: fromMinor(bucket.total),
        paidAmount: fromMinor(bucket.paid < bucket.total ? bucket.paid : bucket.total),
      }))
    : [];

  const [earned] = await conn
    .select({ total: sql<string>`coalesce(sum(${customerCashbackTransactions.amount}), 0)::numeric(18,2)` })
    .from(customerCashbackTransactions)
    .where(and(eq(customerCashbackTransactions.orderId, orderId), eq(customerCashbackTransactions.type, "earn")));

  const returns = await conn
    .select({
      id: salesReturns.id,
      number: salesReturns.number,
      totalAmount: salesReturns.totalAmount,
      refundMethod: salesReturns.refundMethod,
      refundAmount: salesReturns.refundAmount,
      reason: salesReturns.reason,
      createdAt: salesReturns.createdAt,
    })
    .from(salesReturns)
    .where(eq(salesReturns.orderId, orderId))
    .orderBy(asc(salesReturns.createdAt));

  return { ...order, currencyTotals, cashbackEarned: earned!.total, items, payments, returns };
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
  const scope = await categoryScope(conn, tenant);
  // Ombor cheklovi bor a'zo faqat ruxsat berilgan omborlar buyurtmalarini ko'radi
  if (options.warehouseId) assertWarehouseAccess(tenant, options.warehouseId);
  const allowed = allowedWarehouses(tenant);

  const rows = await conn
    .select({
      ...orderFields,
      customerName: customers.name,
      warehouseName: warehouses.name,
      itemCount: sql<number>`(select count(*)::int from ${salesOrderItems} where ${salesOrderItems.orderId} = ${salesOrders.id})`,
      balance: balanceSql,
      paymentStatus: paymentStatusSql,
    })
    .from(salesOrders)
    .leftJoin(customers, eq(customers.id, salesOrders.customerId))
    .innerJoin(warehouses, eq(warehouses.id, salesOrders.warehouseId))
    .where(
      and(
        eq(salesOrders.companyId, tenant.company.id),
        allowed ? inArray(salesOrders.warehouseId, allowed) : undefined,
        // "Yakunlangan" filtri eski `shipped`/`delivered` yozuvlarni ham qamrab oladi
        options.status
          ? options.status === "completed"
            ? inArray(salesOrders.status, [...COMPLETED_STATUSES])
            : eq(salesOrders.status, options.status)
          : undefined,
        options.customerId ? eq(salesOrders.customerId, options.customerId) : undefined,
        options.warehouseId ? eq(salesOrders.warehouseId, options.warehouseId) : undefined,
        options.isPos !== undefined ? eq(salesOrders.isPos, options.isPos) : undefined,
        options.shiftId ? eq(salesOrders.posShiftId, options.shiftId) : undefined,
        options.dateFrom ? gte(salesOrders.orderDate, options.dateFrom) : undefined,
        options.dateTo ? lte(salesOrders.orderDate, options.dateTo) : undefined,
        pattern ? or(ilike(salesOrders.number, pattern), ilike(customers.name, pattern)) : undefined,
        documentHasScopedItem(
          scope,
          sql`${salesOrderItems}`,
          sql`${salesOrderItems.orderId}`,
          sql`${salesOrderItems.productId}`,
          sql`${salesOrders.id}`,
        ),
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
      pendingPayment: sql<number>`(count(*) filter (where ${salesOrders.totalAmount} > ${salesOrders.paidAmount} and ${salesOrders.status} in ('confirmed', 'completed', 'shipped', 'delivered')))::int`,
      // Qarz — yakunlangan sotuvning to'lanmagan qoldig'i (holat emas, summalar farqi)
      totalDebt: sql<string>`coalesce(sum(${salesOrders.totalAmount} - ${salesOrders.paidAmount}) filter (where ${salesOrders.status} in ('completed', 'shipped', 'delivered') and ${salesOrders.totalAmount} > ${salesOrders.paidAmount}), 0)::numeric(18,2)`,
    })
    .from(salesOrders)
    .where(eq(salesOrders.companyId, tenant.company.id));
  return stats!;
}

// ─── Hayot sikli ─────────────────────────────────────────────────────────────

export async function createOrder(
  tx: Tx,
  tenant: TenantContext,
  input: SalesOrderInput,
  meta: RequestMeta,
  options: PricingOptions = {},
) {
  const companyId = tenant.company.id;
  const customerDiscount = await customerDiscountFor(tx, companyId, input.customerId);
  await assertWarehouse(tx, tenant, input.warehouseId);
  const { items, totals } = await prepareSalesItems(tx, tenant, input.items, customerDiscount, options);
  const baseCurrency = await companyCurrency(tx, companyId);
  if (input.saleCurrencies?.length) {
    await assignSaleCurrencies(tx, companyId, baseCurrency, [...new Set(input.saleCurrencies)], items);
  }

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
      deliveryRequired: input.deliveryRequired ?? null,
      notes: input.notes ?? null,
      currency: baseCurrency,
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
  options: PricingOptions = {},
) {
  const companyId = tenant.company.id;
  const order = await lockOrder(tx, tenant, orderId);
  if (order.status !== "draft" || order.isPos) throw badRequest("Faqat qoralama buyurtmani tahrirlash mumkin");
  await assertOrderInScope(tx, tenant, orderId);

  const customerId = patch.customerId !== undefined ? patch.customerId : order.customerId;
  const warehouseId = patch.warehouseId ?? order.warehouseId;
  const customerDiscount = await customerDiscountFor(tx, companyId, customerId);
  if (patch.warehouseId) await assertWarehouse(tx, tenant, warehouseId);

  let totals = {};
  if (patch.items) {
    const prepared = await prepareSalesItems(tx, tenant, patch.items, customerDiscount, options);
    if (patch.saleCurrencies?.length) {
      const baseCurrency = await companyCurrency(tx, companyId);
      await assignSaleCurrencies(tx, companyId, baseCurrency, [...new Set(patch.saleCurrencies)], prepared.items);
    }
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
      ...(patch.deliveryRequired !== undefined ? { deliveryRequired: patch.deliveryRequired } : {}),
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
  await assertOrderInScope(tx, tenant, orderId);

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
  await assertOrderInScope(tx, tenant, orderId);

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
export type DispatchOptions = {
  /** Offline kassa sinxroni: qoldiq yetmasa ham chiqim (manfiy qoldiq) — `shortages` da qaytadi. */
  allowNegativeStock?: boolean;
  /** Offline kassa sinxroni: kredit limitidan oshsa ham — `creditLimit` da qaytadi. */
  skipCreditLimit?: boolean;
  /** Zaxira harakati vaqti (offline chek yopilgan vaqt). */
  occurredAt?: Date;
};

export type StockShortage = { productId: string; name: string; requested: string; available: string };

export async function dispatchOrder(
  tx: Tx,
  tenant: TenantContext,
  order: DispatchableOrder,
  entryDate: string,
  upcomingPayment = 0n,
  options: DispatchOptions = {},
) {
  const companyId = tenant.company.id;
  const total = toMinor(order.totalAmount);
  let creditLimit: { limit: string; debtAfter: string } | null = null;

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
      if (!options.skipCreditLimit) {
        throw badRequest(`Mijoz kredit limitidan oshadi (limit ${fromMinor(limit)}, qarz ${fromMinor(debtAfter)})`);
      }
      creditLimit = { limit: fromMinor(limit), debtAfter: fromMinor(debtAfter) };
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
  const shortages: StockShortage[] = [];
  for (const item of items) {
    const product = productById.get(item.productId)!;
    const factor = toMinor(await unitFactorToBase(tx, companyId, product, item.unitId), 4);
    const quantity = toMinor(item.quantity, 4);
    const baseQty = rescale(quantity * factor, 8, 4);

    const { movement, level } = await moveStock(tx, companyId, tenant.user.id, {
      type: "issue",
      productId: product.id,
      warehouseId: order.warehouseId,
      quantity: fromMinor(baseQty, 4),
      referenceType: order.isPos ? "pos_sale" : "sales_order",
      referenceId: order.id,
      notes: `Sotuv: ${order.number}`,
      allowNegative: options.allowNegativeStock,
      occurredAt: options.occurredAt,
    });
    const after = toMinor(level.quantity, 4);
    if (after < 0n) {
      const before = after + baseQty;
      shortages.push({
        productId: product.id,
        name: product.name,
        requested: fromMinor(baseQty, 4),
        available: fromMinor(before > 0n ? before : 0n, 4),
      });
    }
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
  return { cogs: fromMinor(cogs), shortages, creditLimit };
}

export async function shipOrder(tx: Tx, tenant: TenantContext, orderId: string, meta: RequestMeta) {
  const order = await lockOrder(tx, tenant, orderId);
  if (order.status !== "confirmed" || order.isPos) throw badRequest("Faqat tasdiqlangan buyurtma jo'natiladi");
  assertWarehouseAccess(tenant, order.warehouseId);
  await assertOrderInScope(tx, tenant, orderId);

  const { cogs } = await dispatchOrder(tx, tenant, order, todayIso());
  // Jo'natildi = sotuv yakunlandi. To'langan-to'lanmagani summalardan, yetkazilgani esa yetkazma hujjatidan o'qiladi
  const status: SalesOrderStatus = "completed";
  await tx.update(salesOrders).set({ status, updatedAt: new Date() }).where(eq(salesOrders.id, orderId));
  // Keshbek: sozlama "total" — jo'natilganda, "paid" — to'liq to'langan bo'lsa
  const cashbackEarned = await earnOrderCashback(tx, tenant, orderId);

  await salesAudit(tx, tenant, meta, {
    action: "SALES_ORDER_SHIPPED",
    resource: "sales_orders",
    resourceId: orderId,
    details: { number: order.number, totalAmount: order.totalAmount, cogs, status, cashbackEarned: fromMinor(cashbackEarned) },
  });
  return getOrder(tx, tenant, orderId);
}

/**
 * Chekning asosiy valyutadagi naqd/karta/bank/o'tkazma to'lovlari tarkibi, `total` ga moslangan (farq bo'lsa — ulush
 * bo'yicha, qoldig'i oxirgisiga). To'lov yozuvi yo'q bo'lsa — hammasi naqd.
 */
async function basePaymentComposition(
  tx: Tx,
  orderId: string,
  currency: string,
  total: bigint,
): Promise<{ method: PaymentMethod; amount: bigint; cashAccountId: string | null }[]> {
  if (total <= 0n) return [];
  // Usul va asl hisob bo'yicha (masalan, UZCARD — A bank, HUMO — B bank): pul qaysi hisobga tushgan bo'lsa, o'sha hisobdan qaytadi
  const rows = await tx
    .select({
      method: customerPayments.method,
      cashAccountId: customerPayments.cashAccountId,
      amount: sql<string>`coalesce(sum(${customerPayments.amount}), 0)::numeric(18,2)`,
    })
    .from(customerPayments)
    .where(
      and(
        eq(customerPayments.orderId, orderId),
        eq(customerPayments.currency, currency),
        inArray(customerPayments.method, ["cash", "card", "bank", "transfer"]),
      ),
    )
    .groupBy(customerPayments.method, customerPayments.cashAccountId)
    .orderBy(customerPayments.method, customerPayments.cashAccountId);
  // So'rov faqat naqd/karta/bank/o'tkazmani oladi (inArray) — tip shunga toraytiriladi
  const parts = rows
    .map((row) => ({ method: row.method as PaymentMethod, amount: toMinor(row.amount), cashAccountId: row.cashAccountId }))
    .filter((part) => part.amount > 0n);
  if (parts.length === 0) return [{ method: "cash", amount: total, cashAccountId: null }];
  const sum = parts.reduce((acc, part) => acc + part.amount, 0n);
  if (sum === total) return parts;
  let left = total;
  return parts.map((part, index) => {
    const amount = index === parts.length - 1 ? left : (total * part.amount) / sum;
    left -= amount;
    return { ...part, amount };
  });
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
  if (!isCompletedSale(order.status)) throw badRequest("Faqat jo'natilgan buyurtma qaytariladi");
  assertWarehouseAccess(tenant, order.warehouseId);
  await assertOrderInScope(tx, tenant, orderId);
  const partial = await tx.$count(salesReturns, eq(salesReturns.orderId, orderId));
  if (partial > 0) throw badRequest("Chek qisman qaytarilgan — qolgan mahsulotlarni qisman qaytarish orqali qaytaring");

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

  // Mijoz balansi va keshbekidan to'langan qismlar naqd emas — o'z hisobiga qaytadi; qolgani tanlangan usulda
  const [nonCash] = order.customerId
    ? await tx
        .select({
          balance: sql<string>`coalesce(sum(${customerPayments.amount}) filter (where ${customerPayments.method} = 'balance'), 0)::numeric(18,2)`,
          cashback: sql<string>`coalesce(sum(${customerPayments.amount}) filter (where ${customerPayments.method} = 'cashback'), 0)::numeric(18,2)`,
        })
        .from(customerPayments)
        .where(eq(customerPayments.orderId, orderId))
    : [{ balance: "0", cashback: "0" }];
  const balancePaid = toMinor(nonCash!.balance);
  const cashbackPaid = toMinor(nonCash!.cashback);
  // Chet valyutada naqd to'langanlar (POS sotuv valyutalari) — o'z valyutasidagi kassaga qaytariladi
  const foreignPayments = await tx
    .select({
      id: customerPayments.id,
      amount: customerPayments.amount,
      foreignAmount: customerPayments.foreignAmount,
      currency: customerPayments.currency,
      method: customerPayments.method,
      cashAccountId: customerPayments.cashAccountId,
    })
    .from(customerPayments)
    .where(and(eq(customerPayments.orderId, orderId), ne(customerPayments.currency, order.currency)));
  const foreignPaid = foreignPayments.reduce((sum, payment) => sum + toMinor(payment.amount), 0n);
  const cashPaid = paid - balancePaid - cashbackPaid - foreignPaid;
  // Asosiy valyutadagi pul: usul ko'rsatilsa — shu usulda; aks holda asl to'lov tarkibi bo'yicha (aralash to'lovli chek:
  // naqd — kassaga, karta va bank — bankdan). Asl sotuv hujjati o'zgarmaydi, har qism — alohida kassa harakati va jurnal
  // Asl to'lov tarkibidan farqli usul yoki boshqa hisobdan qaytarish (masalan, karta to'lovini naqd) — moliya ruxsati kerak
  if (refund && cashPaid > 0n && (input.method || input.cashAccountId)) {
    const original = await basePaymentComposition(tx, orderId, order.currency, cashPaid);
    // Chekda tanlangan usuldan boshqa usuldagi to'lov bor bo'lsa (masalan, 50% karta + 50% naqd, hammasi naqd) — farqli qaytarish
    const differs = Boolean(input.cashAccountId) || original.some((part) => part.amount > 0n && part.method !== input.method);
    if (differs && !(await effectivePermissions(tx, tenant)).includes("finance.manage")) {
      throw forbidden("Pul asl to'lov usulidan boshqacha qaytariladi — moliya ruxsati kerak (usulni tanlamang: asl tarkib bo'yicha qaytadi)");
    }
  }
  const baseParts = input.method
    ? [{ method: input.method, amount: cashPaid, cashAccountId: null }]
    : await basePaymentComposition(tx, orderId, order.currency, cashPaid);

  let cashRefunded = 0n;
  let refundAccountId: string | null = null;
  const refundedByMethod = new Map<string, bigint>();
  const methodPieces = new Map<string, number>();
  if (refund) {
    for (const part of baseParts) {
      if (part.amount <= 0n) continue;
      const amount = fromMinor(part.amount);
      const nth = methodPieces.get(part.method) ?? 0;
      methodPieces.set(part.method, nth + 1);
      const suffix = baseParts.length > 1 ? `_${part.method}${nth > 0 ? `_${nth + 1}` : ""}` : "";
      const { account } = await recordCashTransaction(tx, companyId, tenant.user.id, {
        cashAccountId: input.method
          ? await resolvePaymentAccount(tx, companyId, part.method, input.cashAccountId)
          : (part.cashAccountId ?? (await resolvePaymentAccount(tx, companyId, part.method))),
        type: "out",
        amount,
        txDate: today,
        description: `Qaytarish: ${order.number}`,
        category: "sales_refund",
        referenceType: `sales_refund${suffix}`,
        referenceId: order.id,
      });
      await postJournalEntry(tx, companyId, tenant.user.id, {
        entryDate: today,
        description: `Pul qaytarish: ${order.number}`,
        referenceType: `sales_refund${suffix}`,
        referenceId: order.id,
        lines: [
          { accountId: await requireAccountBySubtype(tx, companyId, "receivable", "asset", "Debitorlar"), debit: amount },
          { accountId: await ledgerAccountFor(tx, companyId, account), credit: amount },
        ],
      });
      if (order.customerId) {
        await tx
          .update(customers)
          .set({ totalDebt: sql`${customers.totalDebt} + ${amount}::numeric`, updatedAt: new Date() })
          .where(eq(customers.id, order.customerId));
      }
      cashRefunded += part.amount;
      const key = part.method === "transfer" ? "bank" : part.method;
      refundedByMethod.set(key, (refundedByMethod.get(key) ?? 0n) + part.amount);
      refundAccountId ??= account.id;
    }
  }
  if (refund && balancePaid > 0n) {
    await refundToBalance(
      tx,
      tenant,
      {
        customerId: order.customerId!,
        orderId,
        orderNumber: order.number,
        amount: fromMinor(balancePaid),
        posShiftId: order.posShiftId,
        date: today,
      },
      meta,
    );
  }
  let foreignRefunded = 0n;
  if (refund) {
    for (const payment of foreignPayments) {
      if (!payment.cashAccountId) continue;
      const description = `Qaytarish: ${order.number} (${payment.currency})`;
      const { account } = await recordCashTransaction(tx, companyId, tenant.user.id, {
        cashAccountId: payment.cashAccountId,
        type: "out",
        amount: payment.foreignAmount,
        currency: payment.currency,
        txDate: today,
        description,
        category: "sales_refund",
        referenceType: "sales_refund_fx",
        referenceId: payment.id,
      });
      await postJournalEntry(tx, companyId, tenant.user.id, {
        entryDate: today,
        description,
        referenceType: "sales_refund_fx",
        referenceId: payment.id,
        lines: [
          { accountId: await requireAccountBySubtype(tx, companyId, "receivable", "asset", "Debitorlar"), debit: payment.amount },
          { accountId: await ledgerAccountFor(tx, companyId, account), credit: payment.amount },
        ],
      });
      if (order.customerId) {
        await tx
          .update(customers)
          .set({ totalDebt: sql`${customers.totalDebt} + ${payment.amount}::numeric`, updatedAt: new Date() })
          .where(eq(customers.id, order.customerId));
      }
      // Ochiq smenada valyuta tushumidan ayriladi (naqd — kassa sanog'i, karta — alohida)
      if (order.posShiftId) {
        const amounts = new Map([[payment.currency, -toMinor(payment.foreignAmount)]]);
        await tx
          .update(posShifts)
          .set({
            ...(payment.method === "card"
              ? { foreignCard: addCurrencyAmounts(posShifts.foreignCard, amounts) }
              : { foreignCash: addCurrencyAmounts(posShifts.foreignCash, amounts) }),
            updatedAt: new Date(),
          })
          .where(and(eq(posShifts.id, order.posShiftId), eq(posShifts.status, "open")));
      }
      foreignRefunded += toMinor(payment.amount);
    }
  }
  // Keshbek: ishlatilgani qaytadi (pul qaytarilganda), shu chekdan berilgani bekor qilinadi
  if (order.customerId) {
    await reverseOrderCashback(
      tx,
      tenant,
      { customerId: order.customerId, orderId, orderNumber: order.number, redeemed: refund ? cashbackPaid : 0n, date: today },
      meta,
    );
  }
  const refunded = cashRefunded + foreignRefunded + (refund ? balancePaid + cashbackPaid : 0n);

  // Ochiq smenada qaytarish kassir yig'indisidan ayriladi — smena yopilishida kassa farqi to'g'ri chiqsin
  if (order.posShiftId) {
    const out = (key: string) => refundedByMethod.get(key) ?? 0n;
    await tx
      .update(posShifts)
      .set({
        totalSales: sql`${posShifts.totalSales} - ${order.totalAmount}::numeric`,
        ...(out("cash") > 0n ? { totalCash: sql`${posShifts.totalCash} - ${fromMinor(out("cash"))}::numeric` } : {}),
        ...(out("card") > 0n ? { totalCard: sql`${posShifts.totalCard} - ${fromMinor(out("card"))}::numeric` } : {}),
        ...(out("bank") > 0n ? { totalBank: sql`${posShifts.totalBank} - ${fromMinor(out("bank"))}::numeric` } : {}),
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
