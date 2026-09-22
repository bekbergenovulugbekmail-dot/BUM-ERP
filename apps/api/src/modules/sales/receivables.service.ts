/**
 * Debitorlik (mijoz qarzi): to'lovni ochiq hujjatlarga taqsimlash va yosh guruhlari bo'yicha hisobot.
 *
 * MANBA BITTA: ochiq qarz — yakunlangan sotuvning to'lanmagan SOF qoldig'i
 * (`total_amount − qaytarilgan − paid_amount`, holat `completed | shipped | delivered`).
 * `customers.total_debt` — shu yig'indining keshi. Hisobot, ogohlantirish va kredit tekshiruvi
 * bitta ta'rifdan foydalanadi, shuning uchun ular bir-biriga zid bo'lmaydi.
 *
 * MUAMMO (shu modul yopadi): mijoz darajasidagi to'lov (buyurtma ko'rsatilmagan) faqat `total_debt` ni
 * kamaytirar, hujjatlarning `paid_amount` i esa o'zgarmasdan qolardi. Natijada qarzi yopilgan mijozning
 * eski buyurtmalari "muddati o'tgan" bo'lib turaverardi va yosh guruhlari haqiqatdan katta chiqardi.
 *
 * QOIDA: taqsimot deterministik — eng eski MUDDAT birinchi (`order_date + payment_term_days`), muddat teng
 * bo'lsa eski hujjat, keyin hujjat id'si. Jurnal va to'lov hujjati O'ZGARMAYDI: taqsimot faqat
 * hujjatlarning to'langan summasini yozadi (jami — o'sha to'lov summasi).
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { customers, salesOrders, salesReturns } from "../../db/schema/sales.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { fromMinor, toMinor } from "../../shared/decimal.js";
import type { TenantContext } from "../company/tenant.js";
import { todayIso } from "../finance/cash.service.js";
import { COMPLETED_STATUSES } from "./sale-status.js";

/** Yosh guruhlari (kun). Chegaralar hisobot va kredit siyosatida bir xil ishlatiladi. */
export const AGING_BUCKETS = ["current", "d0_30", "d31_60", "d61_90", "d90_plus"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

/** Muddatdan necha kun o'tgan → guruh. Muddati kelmagan qarz — `current`. */
export function agingBucketOf(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "d0_30";
  if (daysOverdue <= 60) return "d31_60";
  if (daysOverdue <= 90) return "d61_90";
  return "d90_plus";
}

const dayNumber = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);

/**
 * Hujjatning SOF summasi: qaytarilgan tovar qiymati chegirilgan.
 *
 * Qisman qaytarishda `total_amount` o'zgarmaydi (hujjat tarixi buzilmaydi), lekin mijoz endi
 * faqat qolgan tovar uchun qarzdor. Shuning uchun qarz sof summadan hisoblanadi — aks holda
 * qarz yoshi `customers.total_debt` dan katta chiqardi.
 */
const netAmountSql = sql<string>`(${salesOrders.totalAmount} - coalesce((
  select sum(r."total_amount") from "sales_returns" r where r."order_id" = ${salesOrders.id}
), 0))::numeric(18,2)`;

/** Ochiq qarz hujjati — `completed | shipped | delivered` va to'lanmagan sof qoldiq bilan. */
const openCondition = sql`${salesOrders.status} in ${sql.raw(`(${COMPLETED_STATUSES.map((status) => `'${status}'`).join(", ")})`)}
  and ${netAmountSql} > ${salesOrders.paidAmount}`;

/** To'lov muddati: hujjat sanasi + mijozning to'lov muddati (kun). */
const dueDateSql = sql<string>`(${salesOrders.orderDate} + ${customers.paymentTermDays})::text`;

/**
 * Mijoz darajasidagi to'lovni ochiq hujjatlarga taqsimlaydi (eng eski muddat birinchi).
 * Qaytadi: qaysi hujjatga qancha yozilgani va taqsimlanmagan qoldiq (qarzdan ortiq to'lov bo'lsa).
 *
 * Chaqiruvchi tranzaksiya ichida chaqiradi; hujjat qatorlari `for update` bilan qulflanadi
 * (qulflash tartibi butun tizimdagidek: MIJOZ allaqachon qulflangan bo'ladi, keyin hujjatlar).
 */
export async function allocateCustomerPayment(
  tx: Tx,
  companyId: string,
  customerId: string,
  amountMinor: bigint,
): Promise<{ allocations: { orderId: string; number: string; amount: string }[]; unallocated: string }> {
  if (amountMinor <= 0n) return { allocations: [], unallocated: "0.00" };

  const open = await tx
    .select({
      id: salesOrders.id,
      number: salesOrders.number,
      netAmount: netAmountSql,
      paidAmount: salesOrders.paidAmount,
      dueDate: dueDateSql,
    })
    .from(salesOrders)
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(and(eq(salesOrders.companyId, companyId), eq(salesOrders.customerId, customerId), openCondition))
    .orderBy(asc(sql`${salesOrders.orderDate} + ${customers.paymentTermDays}`), asc(salesOrders.orderDate), asc(salesOrders.id))
    .for("update", { of: salesOrders });

  let left = amountMinor;
  const allocations: { orderId: string; number: string; amount: string }[] = [];
  for (const order of open) {
    if (left <= 0n) break;
    const due = toMinor(order.netAmount) - toMinor(order.paidAmount);
    if (due <= 0n) continue;
    const applied = due < left ? due : left;
    await tx
      .update(salesOrders)
      .set({ paidAmount: sql`${salesOrders.paidAmount} + ${fromMinor(applied)}::numeric`, updatedAt: new Date() })
      .where(eq(salesOrders.id, order.id));
    allocations.push({ orderId: order.id, number: order.number, amount: fromMinor(applied) });
    left -= applied;
  }
  return { allocations, unallocated: fromMinor(left) };
}

export type AgingRow = {
  customerId: string;
  customerName: string;
  customerCode: string;
  phone: string | null;
  orderId: string;
  number: string;
  orderDate: string;
  dueDate: string;
  daysOverdue: number;
  bucket: AgingBucket;
  totalAmount: string;
  /** Qaytarilgan tovar qiymati chegirilgan summa — qarz shundan hisoblanadi. */
  netAmount: string;
  paidAmount: string;
  remaining: string;
};

export type AgingTotals = Record<AgingBucket, string> & { total: string };

const emptyTotals = (): AgingTotals => ({ current: "0.00", d0_30: "0.00", d31_60: "0.00", d61_90: "0.00", d90_plus: "0.00", total: "0.00" });

function sumInto(target: AgingTotals, bucket: AgingBucket, amount: bigint) {
  target[bucket] = fromMinor(toMinor(target[bucket]) + amount);
  target.total = fromMinor(toMinor(target.total) + amount);
}

/**
 * Debitorlik yoshi: har bir ochiq hujjat bo'yicha qator, mijoz kesimida va umumiy yig'indi.
 * Hisobot BAZADAN hisoblanadi (kesh emas) — shuning uchun `customers.total_debt` bilan solishtirsa bo'ladi.
 */
export async function receivablesAging(
  conn: DbOrTx,
  tenant: TenantContext,
  options: { customerId?: string; bucket?: AgingBucket; overdueOnly?: boolean; limit?: number; asOf?: string } = {},
) {
  const companyId = tenant.company.id;
  const asOf = options.asOf ?? todayIso();
  const limit = Math.min(options.limit ?? 500, 2000);

  const rows = await conn
    .select({
      customerId: customers.id,
      customerName: customers.name,
      customerCode: customers.code,
      phone: customers.phone,
      orderId: salesOrders.id,
      number: salesOrders.number,
      orderDate: salesOrders.orderDate,
      dueDate: dueDateSql,
      totalAmount: salesOrders.totalAmount,
      netAmount: netAmountSql,
      paidAmount: salesOrders.paidAmount,
    })
    .from(salesOrders)
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(
      and(
        eq(salesOrders.companyId, companyId),
        openCondition,
        options.customerId ? eq(salesOrders.customerId, options.customerId) : undefined,
      ),
    )
    .orderBy(asc(sql`${salesOrders.orderDate} + ${customers.paymentTermDays}`), asc(salesOrders.id))
    .limit(limit);

  const today = dayNumber(asOf);
  const totals = emptyTotals();
  const byCustomer = new Map<string, { customerId: string; customerName: string; customerCode: string; phone: string | null; totals: AgingTotals; oldestDueDate: string | null; maxDaysOverdue: number }>();
  const items: AgingRow[] = [];

  for (const row of rows) {
    const remaining = toMinor(row.netAmount) - toMinor(row.paidAmount);
    if (remaining <= 0n) continue;
    const daysOverdue = today - dayNumber(row.dueDate);
    const bucket = agingBucketOf(daysOverdue);
    if (options.bucket && bucket !== options.bucket) continue;
    if (options.overdueOnly && daysOverdue <= 0) continue;

    items.push({
      customerId: row.customerId,
      customerName: row.customerName,
      customerCode: row.customerCode,
      phone: row.phone,
      orderId: row.orderId,
      number: row.number,
      orderDate: row.orderDate,
      dueDate: row.dueDate,
      daysOverdue: daysOverdue > 0 ? daysOverdue : 0,
      bucket,
      totalAmount: row.totalAmount,
      netAmount: row.netAmount,
      paidAmount: row.paidAmount,
      remaining: fromMinor(remaining),
    });
    sumInto(totals, bucket, remaining);

    const existing = byCustomer.get(row.customerId) ?? {
      customerId: row.customerId,
      customerName: row.customerName,
      customerCode: row.customerCode,
      phone: row.phone,
      totals: emptyTotals(),
      oldestDueDate: null as string | null,
      maxDaysOverdue: 0,
    };
    sumInto(existing.totals, bucket, remaining);
    if (!existing.oldestDueDate || row.dueDate < existing.oldestDueDate) existing.oldestDueDate = row.dueDate;
    if (daysOverdue > existing.maxDaysOverdue) existing.maxDaysOverdue = daysOverdue;
    byCustomer.set(row.customerId, existing);
  }

  const customersRows = [...byCustomer.values()].sort((a, b) => b.maxDaysOverdue - a.maxDaysOverdue || Number(toMinor(b.totals.total) - toMinor(a.totals.total)));
  return { asOf, totals, customers: customersRows, items };
}

/** Bitta mijozning ochiq qarzi (kredit tekshiruvi va credit hold uchun) — hisobot bilan bir xil ta'rif. */
export async function customerOverdue(conn: DbOrTx, companyId: string, customerId: string, asOf = todayIso()) {
  const [row] = await conn
    .select({
      openAmount: sql<string>`coalesce(sum(${netAmountSql} - ${salesOrders.paidAmount}), 0)::numeric(18,2)`,
      overdueAmount: sql<string>`coalesce(sum(${netAmountSql} - ${salesOrders.paidAmount})
        filter (where ${salesOrders.orderDate} + ${customers.paymentTermDays} < ${asOf}::date), 0)::numeric(18,2)`,
      maxDaysOverdue: sql<number>`coalesce(max(${asOf}::date - (${salesOrders.orderDate} + ${customers.paymentTermDays}))
        filter (where ${salesOrders.orderDate} + ${customers.paymentTermDays} < ${asOf}::date), 0)::int`,
    })
    .from(salesOrders)
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(and(eq(salesOrders.companyId, companyId), eq(salesOrders.customerId, customerId), openCondition));
  return {
    openAmount: row?.openAmount ?? "0.00",
    overdueAmount: row?.overdueAmount ?? "0.00",
    maxDaysOverdue: row?.maxDaysOverdue ?? 0,
  };
}
