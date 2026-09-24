/**
 * MIJOZ OBOROTI — kartochkadagi yagona moliyaviy xulosa.
 *
 * Muammo: "jami oborot" har hisobotda boshqacha hisoblanishi mumkin edi (biri `total_amount`,
 * boshqasi to'langan summa, uchinchisi qaytarishni chegirmaydi). Shu yerda BITTA ta'rif:
 *
 *   Jami xarid (gross) = bekor qilinmagan hujjatlarning `total_amount` yig'indisi
 *   Jami qaytarish     = shu hujjatlar bo'yicha qaytarishlar
 *   Sof savdo          = jami xarid − jami qaytarish   (AYNAN `netOrderAmount`)
 *   Jami to'lov        = mijozning barcha to'lovlari
 *   Joriy qarz         = yakunlangan hujjatlarning to'lanmagan SOF qoldig'i
 *                        (`receivables.service.ts` dagi ta'rif bilan bir xil)
 *   Joriy balans       = mijoz hamyonidagi avans (qarzdan alohida)
 *
 * Faqat O'QIYDI — hech narsa o'zgartirilmaydi.
 */
import { and, eq, sql } from "drizzle-orm";
import { notFound } from "@bum/shared";
import { customerPayments, customers, salesOrders } from "../../db/schema/sales.js";
import type { DbOrTx } from "../../db/transaction.js";
import { netOrderAmount } from "./orders.service.js";

/** Bekor qilingan va qoralama hujjatlar oborotga kirmaydi. */
const COUNTED = sql`${salesOrders.status} not in ('draft', 'cancelled')`;
/** Qarz faqat yakunlangan hujjatlardan — tovar mijozda. */
const OWED = sql`${salesOrders.status} in ('completed', 'shipped', 'delivered')`;

export async function customerTurnover(conn: DbOrTx, companyId: string, customerId: string) {
  const [customer] = await conn
    .select({
      id: customers.id,
      name: customers.name,
      code: customers.code,
      balance: customers.balance,
      totalDebt: customers.totalDebt,
      creditLimit: customers.creditLimit,
      cashbackBalance: customers.cashbackBalance,
    })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.companyId, companyId)))
    .limit(1);
  if (!customer) throw notFound("Mijoz topilmadi");

  const [orders] = await conn
    .select({
      orderCount: sql<number>`(count(*) filter (where ${COUNTED}))::int`,
      grossSales: sql<string>`coalesce(sum(${salesOrders.totalAmount}) filter (where ${COUNTED}), 0)::numeric(18,2)`,
      netSales: sql<string>`coalesce(sum(${netOrderAmount}) filter (where ${COUNTED}), 0)::numeric(18,2)`,
      // Hujjatlarga yozilgan to'lov (taqsimlangan qism)
      allocatedPaid: sql<string>`coalesce(sum(${salesOrders.paidAmount}) filter (where ${COUNTED}), 0)::numeric(18,2)`,
      // Qarz — yakunlangan hujjatlarning to'lanmagan SOF qoldig'i (ortiqcha to'lov boshqa hujjatni yopmaydi)
      openDebt: sql<string>`coalesce(sum(${netOrderAmount} - ${salesOrders.paidAmount}) filter (where ${OWED} and ${netOrderAmount} > ${salesOrders.paidAmount}), 0)::numeric(18,2)`,
    })
    .from(salesOrders)
    .where(and(eq(salesOrders.companyId, companyId), eq(salesOrders.customerId, customerId)));

  const [payments] = await conn
    .select({
      paymentCount: sql<number>`count(*)::int`,
      totalPaid: sql<string>`coalesce(sum(${customerPayments.amount}), 0)::numeric(18,2)`,
    })
    .from(customerPayments)
    .where(and(eq(customerPayments.companyId, companyId), eq(customerPayments.customerId, customerId)));

  const gross = Number(orders?.grossSales ?? 0);
  const net = Number(orders?.netSales ?? 0);

  return {
    customer,
    orderCount: orders?.orderCount ?? 0,
    /** Jami xarid — qaytarish chegirilmagan. */
    grossSales: orders?.grossSales ?? "0.00",
    /** Jami qaytarish = jami xarid − sof savdo. */
    returnsTotal: (gross - net).toFixed(2),
    /** Sof savdo — "jami oborot" shu degani. */
    netSales: orders?.netSales ?? "0.00",
    paymentCount: payments?.paymentCount ?? 0,
    totalPaid: payments?.totalPaid ?? "0.00",
    allocatedPaid: orders?.allocatedPaid ?? "0.00",
    /** Hujjatlardan hisoblangan joriy qarz (kesh emas — haqiqiy manba). */
    openDebt: orders?.openDebt ?? "0.00",
    /** `customers.total_debt` keshi — moslikni tekshirish uchun yonma-yon beriladi. */
    cachedDebt: customer.totalDebt,
    balance: customer.balance,
    cashbackBalance: customer.cashbackBalance,
  };
}
