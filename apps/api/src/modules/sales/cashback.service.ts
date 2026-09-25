/**
 * Keshbek: sozlamalar, POS chekida hisoblash, ishlatish va qaytarish.
 *
 * Mijozning keshbek hisobi pul balansidan (hamyon) alohida: `customers.cashback_balance`
 * + `customer_cashback_transactions`. Sozlama `settings` jadvalida (`loyalty.cashback`).
 *
 * Buxgalteriya:
 *   Hisoblash:  DR 5600 Keshbek xarajatlari / CR 2400 Keshbek majburiyati
 *   Ishlatish:  DR 2400 / CR 1100 Debitorlar (+ customer_payments, method = cashback)
 *   Qaytarish:  ishlatilgani qaytadi (DR 1100 / CR 2400); shu chekdan berilgani bekor qilinadi
 *               (DR 2400 / CR 5600) — mijoz allaqachon sarflagan bo'lsa, qolgan keshbek miqdorida
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  CASHBACK_LIMITS,
  DEFAULT_CASHBACK_SETTINGS,
  badRequest,
  notFound,
  type CashbackSettings,
} from "@bum/shared";
import { categories, products } from "../../db/schema/catalog.js";
import { settings } from "../../db/schema/platform.js";
import {
  customerCashbackTransactions,
  customerPayments,
  customers,
  salesOrderItems,
  salesOrders,
} from "../../db/schema/sales.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { fromMinor, toMinor } from "../../shared/decimal.js";
import { upsertCompanySetting } from "../company/settings.service.js";
import type { TenantContext } from "../company/tenant.js";
import { companyCurrency } from "../finance/accounts.service.js";
import { todayIso } from "../finance/cash.service.js";
import { assertPeriodOpen, ensureAccountBySubtype, postJournalEntry, requireAccountBySubtype } from "../finance/journal.service.js";
import { salesAudit } from "./customers.service.js";
import { isCompletedSale, isPayableSale } from "./sale-status.js";

const { companyId: _companyId, ...cashbackTxFields } = getTableColumns(customerCashbackTransactions);

export const CASHBACK_SETTING_KEY = "loyalty.cashback";

// ─── Sozlamalar ──────────────────────────────────────────────────────────────

const percentSchema = z.number().min(0).max(100);

const cashbackShape = {
  enabled: z.boolean(),
  accrualBase: z.enum(["paid", "total"]),
  maxUsagePercent: percentSchema,
  tiers: z
    .array(
      z.strictObject({
        // Tiyindan mayda summa (0.001, 1e-7) keyin pulga o'tkazishda 500 bermasin — 2 xonagacha
        minAmount: z
          .number()
          .min(0)
          .max(CASHBACK_LIMITS.maxMinAmount)
          .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, "Summa ko'pi bilan 2 xonali kasr bo'lishi kerak"),
        percent: percentSchema,
      }),
    )
    .max(CASHBACK_LIMITS.maxTiers),
  categoryRates: z
    .array(z.strictObject({ categoryId: z.uuid(), percent: percentSchema }))
    .max(CASHBACK_LIMITS.maxCategoryRates),
} satisfies Record<keyof CashbackSettings, z.ZodType>;

export const cashbackSettingsSchema = z.strictObject(cashbackShape).superRefine((value, ctx) => {
  if (new Set(value.tiers.map((tier) => tier.minAmount)).size !== value.tiers.length) {
    ctx.addIssue({ code: "custom", message: "Pog'ona summalari takrorlanmasligi kerak", path: ["tiers"] });
  }
  if (new Set(value.categoryRates.map((rate) => rate.categoryId)).size !== value.categoryRates.length) {
    ctx.addIssue({ code: "custom", message: "Kategoriya ikki marta ko'rsatilgan", path: ["categoryRates"] });
  }
});

const storedCashbackSchema = z.object(cashbackShape).partial();

export async function getCashbackSettings(conn: DbOrTx, companyId: string): Promise<CashbackSettings> {
  const [row] = await conn
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.companyId, companyId), eq(settings.key, CASHBACK_SETTING_KEY)))
    .limit(1);
  if (!row) return DEFAULT_CASHBACK_SETTINGS;
  let json: unknown;
  try {
    json = JSON.parse(row.value);
  } catch {
    return DEFAULT_CASHBACK_SETTINGS;
  }
  const stored = storedCashbackSchema.safeParse(json);
  if (!stored.success) return DEFAULT_CASHBACK_SETTINGS;
  const merged = cashbackSettingsSchema.safeParse({ ...DEFAULT_CASHBACK_SETTINGS, ...stored.data });
  return merged.success ? merged.data : DEFAULT_CASHBACK_SETTINGS;
}

export async function saveCashbackSettings(tx: Tx, tenant: TenantContext, input: CashbackSettings, meta: RequestMeta) {
  const categoryIds = [...new Set(input.categoryRates.map((rate) => rate.categoryId))];
  if (categoryIds.length > 0) {
    const found = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.companyId, tenant.company.id), inArray(categories.id, categoryIds)));
    if (found.length !== categoryIds.length) throw badRequest("Kategoriya topilmadi");
  }
  const value: CashbackSettings = { ...input, tiers: [...input.tiers].sort((a, b) => a.minAmount - b.minAmount) };
  await upsertCompanySetting(
    tx,
    tenant,
    { key: CASHBACK_SETTING_KEY, value: JSON.stringify(value), group: "loyalty", description: "Keshbek sozlamalari" },
    meta,
  );
  return value;
}

// ─── Hisoblash ───────────────────────────────────────────────────────────────

/** 1% = 100 bazis punkt; hisob butun sonlarda. */
// Float ko'paytmasiz: 2.675 * 100 = 267.49999… → 267 bo'lardi; o'nlik satr orqali half-up → 268
const basisPoints = (percent: number) => (toMinor(percent.toFixed(4), 4) + 50n) / 100n;

/** Chekni keshbek bilan to'lash chegarasi (tiyinda). */
export function maxCashbackUsage(cashback: CashbackSettings, totalMinor: bigint) {
  return (totalMinor * basisPoints(cashback.maxUsagePercent)) / 10_000n;
}

/**
 * Chekdan beriladigan keshbek (tiyinda). Har qator: summa × (asos / chek) × foiz, tiyinga pastga yaxlitlanadi.
 * Foiz — mahsulot kategoriyasi (yoki eng yaqin ota kategoriya) foizi, bo'lmasa chek summasi pog'onasi.
 */
export async function computeCashback(
  conn: DbOrTx,
  companyId: string,
  cashback: CashbackSettings,
  lines: { productId: string; lineTotal: string }[],
  totalMinor: bigint,
  baseMinor: bigint,
): Promise<bigint> {
  if (!cashback.enabled || totalMinor <= 0n || baseMinor <= 0n) return 0n;

  const tier = [...cashback.tiers]
    .sort((a, b) => b.minAmount - a.minAmount)
    .find((candidate) => totalMinor >= toMinor(String(candidate.minAmount)));
  const tierRate = tier ? basisPoints(tier.percent) : 0n;

  const rates = new Map(cashback.categoryRates.map((rate) => [rate.categoryId, basisPoints(rate.percent)]));
  let productCategory = new Map<string, string | null>();
  let parentOf = new Map<string, string | null>();
  if (rates.size > 0) {
    const productRows = await conn
      .select({ id: products.id, categoryId: products.categoryId })
      .from(products)
      .where(and(eq(products.companyId, companyId), inArray(products.id, [...new Set(lines.map((l) => l.productId))])));
    productCategory = new Map(productRows.map((row) => [row.id, row.categoryId]));
    const categoryRows = await conn
      .select({ id: categories.id, parentId: categories.parentId })
      .from(categories)
      .where(eq(categories.companyId, companyId));
    parentOf = new Map(categoryRows.map((row) => [row.id, row.parentId]));
  }

  const rateFor = (productId: string) => {
    let categoryId = productCategory.get(productId) ?? null;
    for (let depth = 0; categoryId && depth < 50; depth++) {
      const rate = rates.get(categoryId);
      if (rate !== undefined) return rate;
      categoryId = parentOf.get(categoryId) ?? null;
    }
    return tierRate;
  };

  let earned = 0n;
  for (const line of lines) {
    const rate = rateFor(line.productId);
    if (rate === 0n) continue;
    earned += (toMinor(line.lineTotal) * baseMinor * rate) / (totalMinor * 10_000n);
  }
  return earned;
}

// ─── Harakatlar ──────────────────────────────────────────────────────────────

async function lockCustomer(tx: Tx, companyId: string, customerId: string) {
  const [customer] = await tx
    .select({ id: customers.id, name: customers.name, cashbackBalance: customers.cashbackBalance })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.companyId, companyId)))
    .limit(1)
    .for("update");
  if (!customer) throw notFound("Mijoz topilmadi");
  return customer;
}

async function insertCashbackTx(
  tx: Tx,
  tenant: TenantContext,
  values: Omit<typeof customerCashbackTransactions.$inferInsert, "companyId" | "createdBy" | "createdAt" | "updatedAt">,
) {
  const [row] = await tx
    .insert(customerCashbackTransactions)
    .values({ ...values, companyId: tenant.company.id, createdBy: tenant.user.id, createdAt: new Date() })
    .returning(cashbackTxFields);
  return row!;
}

/** Chekdan hisoblangan keshbekni mijoz hisobiga yozadi. */
export async function earnCashback(
  tx: Tx,
  tenant: TenantContext,
  input: { customerId: string; orderId: string; orderNumber: string; amount: bigint; date?: string },
) {
  if (input.amount <= 0n) return null;
  const companyId = tenant.company.id;
  const customer = await lockCustomer(tx, companyId, input.customerId);

  const id = randomUUID();
  const amount = fromMinor(input.amount);
  const { entry } = await postJournalEntry(tx, companyId, tenant.user.id, {
    party: { type: "customer", id: customer.id },
    entryDate: input.date ?? todayIso(),
    description: `Keshbek: ${input.orderNumber}`,
    referenceType: "cashback",
    referenceId: id,
    lines: [
      { accountId: await ensureAccountBySubtype(tx, companyId, "cashback_expense"), debit: amount },
      { accountId: await ensureAccountBySubtype(tx, companyId, "cashback_liability"), credit: amount },
    ],
  });

  const balanceAfter = toMinor(customer.cashbackBalance) + input.amount;
  await tx
    .update(customers)
    .set({ cashbackBalance: fromMinor(balanceAfter), updatedAt: new Date() })
    .where(eq(customers.id, customer.id));
  return insertCashbackTx(tx, tenant, {
    id,
    customerId: customer.id,
    type: "earn",
    amount,
    balanceAfter: fromMinor(balanceAfter),
    orderId: input.orderId,
    journalEntryId: entry.id,
  });
}

/**
 * Oddiy savdo buyurtmasi (POS emas) uchun keshbek — bir marta: sozlama "total" bo'lsa jo'natilganda,
 * "paid" bo'lsa jo'natilgan va to'liq to'langanda (keshbek bilan to'langan qismi asosdan chiqariladi).
 * Chaqiruvchi buyurtma qatorini qulflagan bo'lishi kerak (jo'natish yoki to'lov tranzaksiyasi).
 */
export async function earnOrderCashback(tx: Tx, tenant: TenantContext, orderId: string): Promise<bigint> {
  const companyId = tenant.company.id;
  const cashback = await getCashbackSettings(tx, companyId);
  if (!cashback.enabled) return 0n;

  const [order] = await tx
    .select({
      id: salesOrders.id,
      number: salesOrders.number,
      customerId: salesOrders.customerId,
      status: salesOrders.status,
      isPos: salesOrders.isPos,
      totalAmount: salesOrders.totalAmount,
      paidAmount: salesOrders.paidAmount,
    })
    .from(salesOrders)
    .where(and(eq(salesOrders.id, orderId), eq(salesOrders.companyId, companyId)))
    .limit(1);
  if (!order || order.isPos || !order.customerId) return 0n;
  const total = toMinor(order.totalAmount);
  if (total <= 0n || !isCompletedSale(order.status)) return 0n;
  if (cashback.accrualBase === "paid" && toMinor(order.paidAmount) < total) return 0n;

  const [existing] = await tx
    .select({ id: customerCashbackTransactions.id })
    .from(customerCashbackTransactions)
    .where(and(eq(customerCashbackTransactions.orderId, order.id), eq(customerCashbackTransactions.type, "earn")))
    .limit(1);
  if (existing) return 0n;

  const lines = await tx
    .select({ productId: salesOrderItems.productId, lineTotal: salesOrderItems.lineTotal })
    .from(salesOrderItems)
    .where(eq(salesOrderItems.orderId, order.id));
  let base = total;
  if (cashback.accrualBase === "paid") {
    const [redeemed] = await tx
      .select({
        total: sql<string>`coalesce(sum(${customerPayments.amount}) filter (where ${customerPayments.method} = 'cashback'), 0)::numeric(18,2)`,
      })
      .from(customerPayments)
      .where(and(eq(customerPayments.orderId, order.id), eq(customerPayments.status, "posted")));
    base = total - toMinor(redeemed!.total);
  }
  const amount = await computeCashback(tx, companyId, cashback, lines, total, base);
  await earnCashback(tx, tenant, { customerId: order.customerId, orderId: order.id, orderNumber: order.number, amount });
  return amount;
}

/** Chekni keshbek bilan to'lash: kassaga pul tushmaydi — majburiyat debitorlik bilan yopiladi. */
export async function redeemCashback(
  tx: Tx,
  tenant: TenantContext,
  input: { customerId: string; orderId: string; amount: string; date?: string },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const amount = toMinor(input.amount);
  if (amount <= 0n) throw badRequest("Summa musbat bo'lishi kerak");

  const [order] = await tx
    .select({
      id: salesOrders.id,
      number: salesOrders.number,
      customerId: salesOrders.customerId,
      status: salesOrders.status,
      totalAmount: salesOrders.totalAmount,
      paidAmount: salesOrders.paidAmount,
    })
    .from(salesOrders)
    .where(and(eq(salesOrders.id, input.orderId), eq(salesOrders.companyId, companyId)))
    .limit(1)
    .for("update");
  if (!order) throw notFound("Buyurtma topilmadi");
  if (order.customerId !== input.customerId) throw badRequest("Buyurtma boshqa mijozniki");
  if (!isPayableSale(order.status)) throw badRequest("Bu holatdagi buyurtmaga to'lov qabul qilinmaydi");
  const due = toMinor(order.totalAmount) - toMinor(order.paidAmount);
  if (amount > due) throw badRequest(`To'lov buyurtma qoldig'idan ortiq (qoldiq ${fromMinor(due)})`);

  const customer = await lockCustomer(tx, companyId, input.customerId);
  const balance = toMinor(customer.cashbackBalance);
  if (amount > balance) throw badRequest(`Mijozning keshbeki yetarli emas (keshbek ${fromMinor(balance)})`);

  const date = input.date ?? todayIso();
  const [payment] = await tx
    .insert(customerPayments)
    .values({
      companyId,
      customerId: customer.id,
      orderId: order.id,
      amount: fromMinor(amount),
      currency: await companyCurrency(tx, companyId),
      paymentDate: date,
      method: "cashback",
      createdBy: tenant.user.id,
    })
    .returning({ id: customerPayments.id });
  const { entry } = await postJournalEntry(tx, companyId, tenant.user.id, {
    party: { type: "customer", id: customer.id },
    entryDate: date,
    description: `Keshbekdan to'lov: ${order.number}`,
    referenceType: "customer_payment",
    referenceId: payment!.id,
    lines: [
      { accountId: await ensureAccountBySubtype(tx, companyId, "cashback_liability"), debit: fromMinor(amount) },
      { accountId: await requireAccountBySubtype(tx, companyId, "receivable", "asset", "Debitorlar"), credit: fromMinor(amount) },
    ],
  });
  await tx
    .update(customerPayments)
    .set({ journalEntryId: entry.id, updatedAt: new Date() })
    .where(eq(customerPayments.id, payment!.id));

  const paid = toMinor(order.paidAmount) + amount;
  // Keshbek bilan to'lash ham sotuv holatini o'zgartirmaydi — faqat to'langan summani oshiradi
  await tx
    .update(salesOrders)
    .set({ paidAmount: fromMinor(paid), updatedAt: new Date() })
    .where(eq(salesOrders.id, order.id));

  const balanceAfter = balance - amount;
  await tx
    .update(customers)
    .set({
      cashbackBalance: fromMinor(balanceAfter),
      totalDebt: sql`${customers.totalDebt} - ${fromMinor(amount)}::numeric`,
      updatedAt: new Date(),
    })
    .where(eq(customers.id, customer.id));
  const transaction = await insertCashbackTx(tx, tenant, {
    customerId: customer.id,
    type: "redeem",
    amount: fromMinor(-amount),
    balanceAfter: fromMinor(balanceAfter),
    orderId: order.id,
    paymentId: payment!.id,
    journalEntryId: entry.id,
  });

  await salesAudit(tx, tenant, meta, {
    action: "CUSTOMER_CASHBACK_REDEEMED",
    resource: "customers",
    resourceId: customer.id,
    details: { amount: fromMinor(amount), orderId: order.id, balanceAfter: fromMinor(balanceAfter) },
  });
  return { paymentId: payment!.id, transaction };
}

/**
 * Qaytarilgan chek: ishlatilgan keshbek qaytadi (`redeemed` — pul qaytarilganda), shu chekdan berilgani
 * bekor qilinadi. Mijoz berilgan keshbekni allaqachon sarflagan bo'lsa — qolgan keshbek miqdorida.
 */
export async function reverseOrderCashback(
  tx: Tx,
  tenant: TenantContext,
  input: { customerId: string; orderId: string; orderNumber: string; redeemed: bigint; date?: string },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const [earnedRow] = await tx
    .select({ total: sql<string>`coalesce(sum(${customerCashbackTransactions.amount}), 0)::numeric(18,2)` })
    .from(customerCashbackTransactions)
    .where(
      and(
        eq(customerCashbackTransactions.companyId, companyId),
        eq(customerCashbackTransactions.orderId, input.orderId),
        eq(customerCashbackTransactions.type, "earn"),
      ),
    );
  const earned = toMinor(earnedRow!.total);
  return reverseCashback(
    tx,
    tenant,
    { customerId: input.customerId, orderId: input.orderId, label: input.orderNumber, restore: input.redeemed, reverse: earned, date: input.date },
    meta,
  );
}

/**
 * Keshbekni qaytarish (to'liq va qisman qaytarishda umumiy): `restore` — chekda ishlatilgan keshbek mijozga qaytadi;
 * `reverse` — chekdan berilgan keshbek bekor qilinadi, mijoz sarflagan bo'lsa qolgan keshbek miqdorida.
 */
export async function reverseCashback(
  tx: Tx,
  tenant: TenantContext,
  input: { customerId: string; orderId: string; label: string; restore: bigint; reverse: bigint; date?: string },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  if (input.reverse <= 0n && input.restore <= 0n) return { redeemedRefunded: 0n, earnedReversed: 0n };

  const customer = await lockCustomer(tx, companyId, input.customerId);
  const date = input.date ?? todayIso();
  const liability = await ensureAccountBySubtype(tx, companyId, "cashback_liability");
  let balance = toMinor(customer.cashbackBalance);

  if (input.restore > 0n) {
    const id = randomUUID();
    const amount = fromMinor(input.restore);
    const { entry } = await postJournalEntry(tx, companyId, tenant.user.id, {
      party: { type: "customer", id: customer.id },
      entryDate: date,
      description: `Keshbek qaytarildi: ${input.label}`,
      referenceType: "cashback",
      referenceId: id,
      lines: [
        { accountId: await requireAccountBySubtype(tx, companyId, "receivable", "asset", "Debitorlar"), debit: amount },
        { accountId: liability, credit: amount },
      ],
    });
    balance += input.restore;
    await tx
      .update(customers)
      .set({ totalDebt: sql`${customers.totalDebt} + ${amount}::numeric`, updatedAt: new Date() })
      .where(eq(customers.id, customer.id));
    await insertCashbackTx(tx, tenant, {
      id,
      customerId: customer.id,
      type: "redeem_refund",
      amount,
      balanceAfter: fromMinor(balance),
      orderId: input.orderId,
      journalEntryId: entry.id,
    });
  }

  const reversible = input.reverse < balance ? input.reverse : balance;
  if (reversible > 0n) {
    const id = randomUUID();
    const amount = fromMinor(reversible);
    const { entry } = await postJournalEntry(tx, companyId, tenant.user.id, {
      party: { type: "customer", id: customer.id },
      entryDate: date,
      description: `Keshbek bekor qilindi: ${input.label}`,
      referenceType: "cashback",
      referenceId: id,
      lines: [
        { accountId: liability, debit: amount },
        { accountId: await ensureAccountBySubtype(tx, companyId, "cashback_expense"), credit: amount },
      ],
    });
    balance -= reversible;
    await insertCashbackTx(tx, tenant, {
      id,
      customerId: customer.id,
      type: "earn_reversal",
      amount: fromMinor(-reversible),
      balanceAfter: fromMinor(balance),
      orderId: input.orderId,
      journalEntryId: entry.id,
    });
  }

  await tx
    .update(customers)
    .set({ cashbackBalance: fromMinor(balance), updatedAt: new Date() })
    .where(eq(customers.id, customer.id));
  await salesAudit(tx, tenant, meta, {
    action: "CUSTOMER_CASHBACK_REVERSED",
    resource: "customers",
    resourceId: customer.id,
    details: {
      orderId: input.orderId,
      redeemedRefunded: fromMinor(input.restore),
      earnedReversed: fromMinor(reversible),
      balanceAfter: fromMinor(balance),
    },
  });
  return { redeemedRefunded: input.restore, earnedReversed: reversible };
}

/**
 * Keshbek hisobini to'g'rilash: noto'g'ri bo'lsa to'g'ri qiymatga o'rnatiladi. Farq 5600 "Keshbek xarajatlari" (hisob
 * oshsa) yoki "Boshqa daromadlar" (kamaysa) bilan 2400 majburiyatga yoziladi va keshbek tarixida `adjustment` qatori
 * bo'lib ko'rinadi. Sabab majburiy, audit jurnaliga tushadi; yopilgan davrga tuzatish kiritilmaydi.
 */
export async function setCustomerCashback(
  tx: Tx,
  tenant: TenantContext,
  input: { customerId: string; cashback: string; reason: string; date?: string },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const reason = input.reason.trim();
  if (reason.length < 3) throw badRequest("To'g'rilash sababi ko'rsatilishi kerak");
  const target = toMinor(input.cashback);
  if (target < 0n) throw badRequest("Keshbek manfiy bo'lmaydi");

  const date = input.date ?? todayIso();
  await assertPeriodOpen(tx, companyId, date);
  const customer = await lockCustomer(tx, companyId, input.customerId);
  const delta = target - toMinor(customer.cashbackBalance);
  if (delta === 0n) return null;

  const id = randomUUID();
  const amount = fromMinor(delta > 0n ? delta : -delta);
  const liability = await ensureAccountBySubtype(tx, companyId, "cashback_liability");
  const { entry } = await postJournalEntry(tx, companyId, tenant.user.id, {
    party: { type: "customer", id: customer.id },
    entryDate: date,
    description: `Keshbek to'g'rilandi: ${customer.name} — ${reason}`,
    referenceType: "cashback",
    referenceId: id,
    lines:
      delta > 0n
        ? [
            { accountId: await ensureAccountBySubtype(tx, companyId, "cashback_expense"), debit: amount },
            { accountId: liability, credit: amount },
          ]
        : [
            { accountId: liability, debit: amount },
            { accountId: await requireAccountBySubtype(tx, companyId, "other", "income", "Boshqa daromadlar"), credit: amount },
          ],
  });
  await tx
    .update(customers)
    .set({ cashbackBalance: fromMinor(target), updatedAt: new Date() })
    .where(eq(customers.id, customer.id));
  const transaction = await insertCashbackTx(tx, tenant, {
    id,
    customerId: customer.id,
    type: "adjustment",
    amount: fromMinor(delta),
    balanceAfter: fromMinor(target),
    journalEntryId: entry.id,
    notes: reason,
  });

  await salesAudit(tx, tenant, meta, {
    action: "CUSTOMER_CASHBACK_ADJUSTED",
    resource: "customers",
    resourceId: customer.id,
    details: { reason, before: customer.cashbackBalance, after: fromMinor(target), delta: fromMinor(delta) },
  });
  return transaction;
}

export async function listCashbackTransactions(conn: DbOrTx, tenant: TenantContext, customerId: string, limit: number) {
  const [customer] = await conn
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.companyId, tenant.company.id)))
    .limit(1);
  if (!customer) throw notFound("Mijoz topilmadi");
  return conn
    .select({ ...cashbackTxFields, orderNumber: salesOrders.number })
    .from(customerCashbackTransactions)
    .leftJoin(salesOrders, eq(salesOrders.id, customerCashbackTransactions.orderId))
    .where(
      and(
        eq(customerCashbackTransactions.companyId, tenant.company.id),
        eq(customerCashbackTransactions.customerId, customerId),
      ),
    )
    .orderBy(desc(customerCashbackTransactions.createdAt), desc(customerCashbackTransactions.id))
    .limit(limit);
}
