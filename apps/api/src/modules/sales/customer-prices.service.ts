/**
 * Mijoz bilan kelishilgan narx (mijoz × mahsulot × birlik).
 *
 * PARALLEL NARX MOTORI EMAS: narx hal qilish markazi avvalgidek `orders.service.ts` dagi
 * `prepareSalesItems` — bu modul faqat kelishilgan narxni topib beradi, uni ERP, kassa va savdo
 * agenti bitta joyda ishlatadi.
 *
 * Ustuvorlik (`prepareSalesItems` da):
 *   1. qo'lda berilgan narx (`sales.edit` bo'lsa yoki ishonchli narxlashda)
 *   2. KELISHILGAN NARX (shu modul) — mijoz uchun shartnoma narxi
 *   3. aksiya narxi (`products.promo_price`, muddati ichida)
 *   4. prays-list (`products.sales_price`)
 * Aksiya kelishilgan narxdan YUQORI turmaydi: kelishilgan narx — mijoz bilan alohida shartnoma,
 * aksiya esa umumiy prays-listga beriladigan vaqtinchalik chegirma. Miqdorga bog'liq aksiya
 * (`promotions`) esa qator chegirmasi sifatida kelishilgan narx USTIGA qo'llanadi — u narxni emas,
 * chegirmani o'zgartiradi.
 *
 * Narx ASOSIY valyutada saqlanadi va kurs bilan qayta hisoblanmaydi — kelishilgan summa o'zgarmaydi.
 */
import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { AppError, badRequest, notFound } from "@bum/shared";
import { products, units } from "../../db/schema/catalog.js";
import { customerPrices, customers } from "../../db/schema/sales.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import type { TenantContext } from "../company/tenant.js";
import { todayIso } from "../finance/cash.service.js";
import { salesAudit } from "./customers.service.js";

export type CustomerPriceInput = {
  customerId: string;
  productId: string;
  unitId: string;
  price: string;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  notes?: string | null;
};

/** Sanada amaldagi narx: `effective_from <= date` va (`effective_to` yo'q yoki `>= date`). */
const activeOn = (date: string) =>
  and(
    eq(customerPrices.isActive, true),
    sql`${customerPrices.effectiveFrom} <= ${date}::date`,
    or(isNull(customerPrices.effectiveTo), sql`${customerPrices.effectiveTo} >= ${date}::date`),
  );

/**
 * Buyurtma qatorlari uchun kelishilgan narxlar: kalit `productId|unitId`.
 * Bitta so'rov — qatorlar soni qancha bo'lsa ham.
 */
export async function agreedPricesFor(
  conn: DbOrTx,
  companyId: string,
  customerId: string | null | undefined,
  lines: readonly { productId: string; unitId: string }[],
  date = todayIso(),
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (!customerId || lines.length === 0) return result;

  const wanted = new Set(lines.map((line) => `${line.productId}|${line.unitId}`));
  const rows = await conn
    .select({ productId: customerPrices.productId, unitId: customerPrices.unitId, price: customerPrices.price, effectiveFrom: customerPrices.effectiveFrom })
    .from(customerPrices)
    .where(and(eq(customerPrices.companyId, companyId), eq(customerPrices.customerId, customerId), activeOn(date)))
    // Kech boshlangani ustun: bir sanaga ikkita narx to'g'ri kelsa yangisi qo'llanadi
    .orderBy(asc(customerPrices.effectiveFrom), asc(customerPrices.createdAt));

  for (const row of rows) {
    const key = `${row.productId}|${row.unitId}`;
    if (wanted.has(key)) result.set(key, row.price);
  }
  return result;
}

/** Bitta mahsulot-birlik uchun amaldagi kelishilgan narx (katalog ko'rinishi uchun). */
export async function agreedPriceOf(conn: DbOrTx, companyId: string, customerId: string, productId: string, unitId: string, date = todayIso()) {
  return (await agreedPricesFor(conn, companyId, customerId, [{ productId, unitId }], date)).get(`${productId}|${unitId}`) ?? null;
}

const listFields = {
  id: customerPrices.id,
  customerId: customerPrices.customerId,
  customerName: customers.name,
  productId: customerPrices.productId,
  productName: products.name,
  sku: products.sku,
  unitId: customerPrices.unitId,
  unitName: units.shortName,
  price: customerPrices.price,
  effectiveFrom: customerPrices.effectiveFrom,
  effectiveTo: customerPrices.effectiveTo,
  isActive: customerPrices.isActive,
  notes: customerPrices.notes,
  createdAt: customerPrices.createdAt,
  updatedAt: customerPrices.updatedAt,
};

export async function listCustomerPrices(
  conn: DbOrTx,
  tenant: TenantContext,
  options: { customerId?: string; productId?: string; activeOnly?: boolean; limit?: number } = {},
) {
  const today = todayIso();
  const rows = await conn
    .select(listFields)
    .from(customerPrices)
    .innerJoin(customers, eq(customers.id, customerPrices.customerId))
    .innerJoin(products, eq(products.id, customerPrices.productId))
    .innerJoin(units, eq(units.id, customerPrices.unitId))
    .where(
      and(
        eq(customerPrices.companyId, tenant.company.id),
        options.customerId ? eq(customerPrices.customerId, options.customerId) : undefined,
        options.productId ? eq(customerPrices.productId, options.productId) : undefined,
        options.activeOnly ? activeOn(today) : undefined,
      ),
    )
    .orderBy(asc(customers.name), asc(products.name), desc(customerPrices.effectiveFrom))
    .limit(Math.min(options.limit ?? 200, 1000));
  return { prices: rows };
}

/** Mijoz, mahsulot va birlik shu kompaniyanikimi — begona id bilan narx yozib bo'lmaydi. */
async function assertScope(tx: Tx, companyId: string, input: { customerId: string; productId: string; unitId: string }) {
  const [customer] = await tx
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(and(eq(customers.id, input.customerId), eq(customers.companyId, companyId)))
    .limit(1);
  if (!customer) throw notFound("Mijoz topilmadi");

  const [product] = await tx
    .select({ id: products.id, name: products.name, baseUnitId: products.baseUnitId })
    .from(products)
    .where(and(eq(products.id, input.productId), eq(products.companyId, companyId)))
    .limit(1);
  if (!product) throw notFound("Mahsulot topilmadi");

  const [unit] = await tx.select({ id: units.id, shortName: units.shortName }).from(units).where(eq(units.id, input.unitId)).limit(1);
  if (!unit) throw notFound("O'lchov birligi topilmadi");
  return { customer, product, unit };
}

/**
 * Kelishilgan narx qo'shadi. Shu mijoz-mahsulot-birlik uchun ochiq narx bo'lsa, u avval
 * yopiladi (`effective_to` = yangi narx boshlanishidan bir kun oldin) — TARIX SAQLANADI,
 * eski qator o'chirilmaydi.
 */
export async function setCustomerPrice(tx: Tx, tenant: TenantContext, input: CustomerPriceInput, meta: RequestMeta) {
  const companyId = tenant.company.id;
  const { customer, product, unit } = await assertScope(tx, companyId, input);
  const from = input.effectiveFrom ?? todayIso();
  if (input.effectiveTo && input.effectiveTo < from) throw badRequest("Tugash sanasi boshlanishdan oldin bo'lmaydi");

  const scope = and(
    eq(customerPrices.companyId, companyId),
    eq(customerPrices.customerId, input.customerId),
    eq(customerPrices.productId, input.productId),
    eq(customerPrices.unitId, input.unitId),
  );

  const [open] = await tx
    .select({ id: customerPrices.id, effectiveFrom: customerPrices.effectiveFrom })
    .from(customerPrices)
    .where(and(scope, eq(customerPrices.isActive, true), isNull(customerPrices.effectiveTo)))
    .limit(1)
    .for("update");
  if (open) {
    if (open.effectiveFrom >= from) {
      throw new AppError("CONFLICT", "Amaldagi narx shu sanadan keyin boshlangan — avval uni bekor qiling", {
        reason: "price_overlap",
        effectiveFrom: open.effectiveFrom,
      });
    }
    await tx
      .update(customerPrices)
      .set({ effectiveTo: sql`${from}::date - 1`, updatedBy: tenant.user.id, updatedAt: new Date() })
      .where(eq(customerPrices.id, open.id));
  }

  const [created] = await tx
    .insert(customerPrices)
    .values({
      companyId,
      customerId: input.customerId,
      productId: input.productId,
      unitId: input.unitId,
      price: input.price,
      effectiveFrom: from,
      effectiveTo: input.effectiveTo ?? null,
      notes: input.notes ?? null,
      createdBy: tenant.user.id,
      updatedBy: tenant.user.id,
    })
    .returning({ id: customerPrices.id });

  await salesAudit(tx, tenant, meta, {
    action: "CUSTOMER_PRICE_SET",
    resource: "customer_prices",
    resourceId: created!.id,
    details: {
      customer: customer.name,
      product: product.name,
      unit: unit.shortName,
      price: input.price,
      effectiveFrom: from,
      effectiveTo: input.effectiveTo ?? null,
      ...(open ? { closedPriceId: open.id } : {}),
    },
  });
  return listCustomerPrices(tx, tenant, { customerId: input.customerId, productId: input.productId }).then((result) => ({
    price: result.prices.find((row) => row.id === created!.id)!,
  }));
}

/** Bekor qilish — qator o'chirilmaydi, faqat faolsizlantiriladi (tarix saqlanadi). */
export async function deactivateCustomerPrice(tx: Tx, tenant: TenantContext, priceId: string, meta: RequestMeta) {
  const [row] = await tx
    .update(customerPrices)
    .set({ isActive: false, effectiveTo: sql`coalesce(${customerPrices.effectiveTo}, ${todayIso()}::date)`, updatedBy: tenant.user.id, updatedAt: new Date() })
    .where(and(eq(customerPrices.id, priceId), eq(customerPrices.companyId, tenant.company.id)))
    .returning({ id: customerPrices.id, customerId: customerPrices.customerId, productId: customerPrices.productId, price: customerPrices.price });
  if (!row) throw notFound("Narx topilmadi");

  await salesAudit(tx, tenant, meta, {
    action: "CUSTOMER_PRICE_DEACTIVATED",
    resource: "customer_prices",
    resourceId: priceId,
    details: { customerId: row.customerId, productId: row.productId, price: row.price },
  });
  return { price: row };
}
