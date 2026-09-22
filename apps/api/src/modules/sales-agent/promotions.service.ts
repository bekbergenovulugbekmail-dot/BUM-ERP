/**
 * Aksiyalar: supervayzer yoki menejer (`promotions.manage`) mahsulotga aksiya belgilaydi, agent faol, yaqinlashayotgan va
 * tugayotganlarini ko'radi. Hisoblash faqat serverda — mijoz yuborgan bepul miqdor yoki chegirmaga ishonilmaydi:
 *  - `buy_x_get_y`: har `minQuantity` uchun `freeQuantity` bepul (10 → 1, 20 → 2); bepul miqdor narxsiz alohida qator
 *  - `percent_discount`: `minQuantity` va undan ko'p olinsa qatorga foiz chegirma (mijoz chegirmasidan kattasi)
 * Bir mahsulotga bir nechta aksiya bo'lsa — mijoz uchun eng foydalisi. Qo'llangan qoida buyurtmada nusxa sifatida saqlanadi.
 */
import { and, asc, desc, eq, gt, gte, inArray, lt, lte, or } from "drizzle-orm";
import { badRequest, conflict, notFound } from "@bum/shared";
import { products } from "../../db/schema/catalog.js";
import { customers } from "../../db/schema/sales.js";
import { orderPromotions, promotions, type PromotionRule } from "../../db/schema/sales-agent.js";
import { agreedPricesFor } from "../sales/customer-prices.service.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import { fromMinor, rescale, toMinor } from "../../shared/decimal.js";
import type { TenantContext } from "../company/tenant.js";
import { todayIso } from "../finance/cash.service.js";
import { currencyRate } from "../finance/currencies.service.js";
import type { SalesItemInput } from "../sales/orders.service.js";

export type PromotionType = (typeof promotions.type.enumValues)[number];
export const ENDING_SOON_DAYS = 3;

const DAY_MS = 86_400_000;
const shiftDate = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

const promotionFields = {
  id: promotions.id,
  name: promotions.name,
  description: promotions.description,
  type: promotions.type,
  productId: promotions.productId,
  productName: products.name,
  minQuantity: promotions.minQuantity,
  freeQuantity: promotions.freeQuantity,
  discountPercent: promotions.discountPercent,
  startsAt: promotions.startsAt,
  endsAt: promotions.endsAt,
  isActive: promotions.isActive,
  createdAt: promotions.createdAt,
  updatedAt: promotions.updatedAt,
};

const activeOn = (date: string) =>
  and(eq(promotions.isActive, true), lte(promotions.startsAt, date), gte(promotions.endsAt, date));

function selectPromotions(conn: DbOrTx) {
  return conn.select(promotionFields).from(promotions).innerJoin(products, eq(products.id, promotions.productId));
}

export type PromotionView = Awaited<ReturnType<ReturnType<typeof selectPromotions>["limit"]>>[number];

export function listPromotions(conn: DbOrTx, tenant: TenantContext, status: "active" | "upcoming" | "ended" | "all") {
  const today = todayIso();
  const filter =
    status === "active"
      ? activeOn(today)
      : status === "upcoming"
        ? and(eq(promotions.isActive, true), gt(promotions.startsAt, today))
        : status === "ended"
          ? or(lt(promotions.endsAt, today), eq(promotions.isActive, false))
          : undefined;
  return selectPromotions(conn)
    .where(and(eq(promotions.companyId, tenant.company.id), filter))
    .orderBy(desc(promotions.startsAt), asc(promotions.name))
    .limit(500);
}

/** Agent ro'yxati: faol, yaqinlashayotgan yoki tugayotgan (3 kun ichida). */
export function agentPromotions(conn: DbOrTx, tenant: TenantContext, filter: "active" | "upcoming" | "ending_soon") {
  const today = todayIso();
  if (filter === "upcoming") {
    return selectPromotions(conn)
      .where(and(eq(promotions.companyId, tenant.company.id), eq(promotions.isActive, true), gt(promotions.startsAt, today)))
      .orderBy(asc(promotions.startsAt), asc(promotions.name))
      .limit(200);
  }
  return selectPromotions(conn)
    .where(
      and(
        eq(promotions.companyId, tenant.company.id),
        activeOn(today),
        filter === "ending_soon" ? lte(promotions.endsAt, shiftDate(today, ENDING_SOON_DAYS)) : undefined,
      ),
    )
    .orderBy(asc(promotions.endsAt), asc(promotions.name))
    .limit(200);
}

/** Mahsulotlar bo'yicha shu kuni amaldagi aksiyalar. */
export async function activePromotions(conn: DbOrTx, companyId: string, date: string, productIds: string[]) {
  const byProduct = new Map<string, PromotionView[]>();
  if (productIds.length === 0) return byProduct;
  const rows = await selectPromotions(conn)
    .where(and(eq(promotions.companyId, companyId), activeOn(date), inArray(promotions.productId, productIds)))
    .orderBy(asc(promotions.endsAt));
  for (const row of rows) byProduct.set(row.productId, [...(byProduct.get(row.productId) ?? []), row]);
  return byProduct;
}

// ─── Boshqarish ──────────────────────────────────────────────────────────────

export type PromotionInput = {
  name: string;
  description?: string | null;
  type: PromotionType;
  productId: string;
  minQuantity: string;
  freeQuantity?: string | null;
  discountPercent?: string | null;
  startsAt: string;
  endsAt: string;
  isActive?: boolean;
};

async function normalize(conn: DbOrTx, tenant: TenantContext, input: PromotionInput) {
  if (input.endsAt < input.startsAt) throw badRequest("Tugash sanasi boshlanish sanasidan oldin bo'lmaydi");
  if (toMinor(input.minQuantity, 4) <= 0n) throw badRequest("Minimal miqdor noldan katta bo'lishi kerak");
  if (input.type === "buy_x_get_y" && (!input.freeQuantity || toMinor(input.freeQuantity, 4) <= 0n)) {
    throw badRequest("Bepul miqdorni kiriting");
  }
  if (input.type === "percent_discount" && (!input.discountPercent || toMinor(input.discountPercent, 2) <= 0n)) {
    throw badRequest("Chegirma foizini kiriting");
  }
  const [product] = await conn
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.id, input.productId), eq(products.companyId, tenant.company.id)))
    .limit(1);
  if (!product) throw badRequest("Mahsulot topilmadi");
  return {
    name: input.name.trim(),
    description: input.description?.trim() || null,
    type: input.type,
    productId: input.productId,
    minQuantity: input.minQuantity,
    freeQuantity: input.type === "buy_x_get_y" ? (input.freeQuantity ?? null) : null,
    discountPercent: input.type === "percent_discount" ? (input.discountPercent ?? null) : null,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    isActive: input.isActive ?? true,
  };
}

function audit(tx: Tx, tenant: TenantContext, meta: RequestMeta, action: string, resourceId: string, details: Record<string, unknown>) {
  return writeAuditLog(
    { userId: tenant.user.id, userName: tenant.user.name, companyId: tenant.company.id, action, resource: "promotions", resourceId, details, ...meta },
    tx,
  );
}

async function promotionById(conn: DbOrTx, companyId: string, promotionId: string) {
  const [row] = await selectPromotions(conn)
    .where(and(eq(promotions.id, promotionId), eq(promotions.companyId, companyId)))
    .limit(1);
  if (!row) throw notFound("Aksiya topilmadi");
  return row;
}

export async function createPromotion(tx: Tx, tenant: TenantContext, input: PromotionInput, meta: RequestMeta) {
  const values = await normalize(tx, tenant, input);
  const [created] = await tx
    .insert(promotions)
    .values({ ...values, companyId: tenant.company.id, createdBy: tenant.user.id })
    .returning({ id: promotions.id });
  await audit(tx, tenant, meta, "PROMOTION_CREATED", created!.id, { name: values.name, type: values.type, productId: values.productId });
  return promotionById(tx, tenant.company.id, created!.id);
}

export async function updatePromotion(tx: Tx, tenant: TenantContext, promotionId: string, patch: Partial<PromotionInput>, meta: RequestMeta) {
  const [existing] = await tx
    .select()
    .from(promotions)
    .where(and(eq(promotions.id, promotionId), eq(promotions.companyId, tenant.company.id)))
    .limit(1)
    .for("update");
  if (!existing) throw notFound("Aksiya topilmadi");
  const values = await normalize(tx, tenant, {
    name: existing.name,
    description: existing.description,
    type: existing.type,
    productId: existing.productId,
    minQuantity: existing.minQuantity,
    freeQuantity: existing.freeQuantity,
    discountPercent: existing.discountPercent,
    startsAt: existing.startsAt,
    endsAt: existing.endsAt,
    isActive: existing.isActive,
    ...patch,
  });
  await tx.update(promotions).set({ ...values, updatedAt: new Date() }).where(eq(promotions.id, promotionId));
  await audit(tx, tenant, meta, "PROMOTION_UPDATED", promotionId, { changes: Object.keys(patch) });
  return promotionById(tx, tenant.company.id, promotionId);
}

export async function deletePromotion(tx: Tx, tenant: TenantContext, promotionId: string, meta: RequestMeta) {
  const existing = await promotionById(tx, tenant.company.id, promotionId);
  if ((await tx.$count(orderPromotions, eq(orderPromotions.promotionId, promotionId))) > 0) {
    throw conflict("Aksiya buyurtmalarda qo'llangan — o'chirish o'rniga faolsizlantiring");
  }
  await tx.delete(promotions).where(eq(promotions.id, promotionId));
  await audit(tx, tenant, meta, "PROMOTION_DELETED", promotionId, { name: existing.name });
}

// ─── Hisoblash ───────────────────────────────────────────────────────────────

export type AppliedPromotion = {
  promotionId: string;
  productId: string;
  rule: PromotionRule;
  paidQuantity: string;
  freeQuantity: string;
  discountAmount: string;
};

/**
 * Dona narxi asosiy valyutada (sotuv buyurtmasi bilan bir xil konversiya).
 * Mijoz bilan kelishilgan narx bo'lsa — o'sha: aksiya qiymati (bepul tovar bahosi, chegirma summasi)
 * buyurtmada haqiqatda qo'llanadigan narxdan hisoblanadi, prays-listdan emas.
 */
async function piecePrices(conn: DbOrTx, companyId: string, customerId: string, productIds: string[]) {
  const rows = await conn
    .select({ id: products.id, baseUnitId: products.baseUnitId, salesPrice: products.salesPrice, salesCurrency: products.salesCurrency })
    .from(products)
    .where(and(eq(products.companyId, companyId), inArray(products.id, productIds)));
  const agreed = await agreedPricesFor(conn, companyId, customerId, rows.map((row) => ({ productId: row.id, unitId: row.baseUnitId })));
  const rates = new Map<string, string>();
  const prices = new Map<string, bigint>();
  for (const row of rows) {
    const agreedPrice = agreed.get(`${row.id}|${row.baseUnitId}`);
    if (agreedPrice) {
      prices.set(row.id, toMinor(agreedPrice, 4));
      continue;
    }
    let price = toMinor(row.salesPrice, 4);
    if (row.salesCurrency) {
      if (!rates.has(row.salesCurrency)) rates.set(row.salesCurrency, await currencyRate(conn, companyId, row.salesCurrency));
      price = rescale(price * toMinor(rates.get(row.salesCurrency)!, 4), 8, 4);
    }
    prices.set(row.id, price);
  }
  return prices;
}

/**
 * Qatorlarga aksiya: bepul miqdor — narxsiz qo'shimcha qator, foiz — qator chegirmasi. Qaytadi: sotuv qatorlari
 * (server hisoblagan narx/chegirma bilan) va qo'llangan qoidalar.
 */
export async function applyPromotions(conn: DbOrTx, companyId: string, customerId: string, items: SalesItemInput[], date = todayIso()) {
  const productIds = [...new Set(items.map((item) => item.productId))];
  const byProduct = await activePromotions(conn, companyId, date, productIds);
  if (byProduct.size === 0) return { items, applied: [] as AppliedPromotion[] };

  const [customer] = await conn
    .select({ discountPercent: customers.discountPercent })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  const customerDiscount = customer?.discountPercent ?? "0";
  const prices = await piecePrices(conn, companyId, customerId, productIds);

  const result: SalesItemInput[] = [];
  const applied: AppliedPromotion[] = [];
  for (const item of items) {
    const quantity = toMinor(item.quantity, 4);
    const price = prices.get(item.productId) ?? 0n;
    let best: { promotion: PromotionView; free: bigint; value: bigint } | null = null;
    for (const promotion of byProduct.get(item.productId) ?? []) {
      const min = toMinor(promotion.minQuantity, 4);
      if (min <= 0n || quantity < min) continue;
      const free = promotion.type === "buy_x_get_y" ? (quantity / min) * toMinor(promotion.freeQuantity ?? "0", 4) : 0n;
      const value =
        promotion.type === "buy_x_get_y"
          ? rescale(free * price, 8, 2)
          : rescale(quantity * price * toMinor(promotion.discountPercent ?? "0", 2), 12, 2);
      if (!best || value > best.value) best = { promotion, free, value };
    }
    if (!best) {
      result.push(item);
      continue;
    }

    const { promotion, free, value } = best;
    if (promotion.type === "percent_discount") {
      const percent = toMinor(promotion.discountPercent!, 2) > toMinor(customerDiscount, 2) ? promotion.discountPercent! : customerDiscount;
      result.push({ ...item, discountPercent: percent });
    } else {
      result.push(item);
      if (free > 0n) {
        result.push({
          productId: item.productId,
          unitId: item.unitId,
          quantity: fromMinor(free, 4),
          unitPrice: "0",
          discountPercent: "0",
          notes: `Aksiya: ${promotion.name}`,
        });
      }
    }
    applied.push({
      promotionId: promotion.id,
      productId: item.productId,
      rule: {
        name: promotion.name,
        type: promotion.type,
        minQuantity: promotion.minQuantity,
        freeQuantity: promotion.freeQuantity,
        discountPercent: promotion.discountPercent,
      },
      paidQuantity: item.quantity,
      freeQuantity: fromMinor(free, 4),
      discountAmount: fromMinor(value),
    });
  }
  return { items: result, applied };
}

export async function saveOrderPromotions(tx: Tx, companyId: string, orderId: string, applied: AppliedPromotion[]) {
  await tx.delete(orderPromotions).where(eq(orderPromotions.orderId, orderId));
  if (applied.length > 0) {
    await tx.insert(orderPromotions).values(applied.map((promotion) => ({ ...promotion, companyId, orderId })));
  }
}
