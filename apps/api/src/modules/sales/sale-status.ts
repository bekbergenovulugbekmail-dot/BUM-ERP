/**
 * Sotuv holati, to'lov holati va yetkazish holati — uchta alohida o'q.
 *
 *  - Sotuv holati  (`sales_orders.status`)   — hujjatning hayot sikli: qoralama → tasdiqlangan → yakunlangan.
 *  - To'lov holati (summalardan hisoblanadi) — `paid_amount` va `total_amount` nisbati; ustun sifatida saqlanmaydi,
 *    shuning uchun ikkita manba bir-biriga zid bo'lib qolmaydi.
 *  - Yetkazish holati (`delivery_tasks.status`) — tovar mijozga fizik yetganmi. Sotuv holatida EMAS.
 *
 * Tarixiy `shipped`/`delivered` qiymatlari aslida to'lov holatini bildirgan (`shipped` — qarz bor,
 * `delivered` — to'langan) va yetkazishga aloqasi yo'q edi. Ular endi yozilmaydi, lekin eski yozuvlar
 * saqlanib qolgani uchun o'qishda `completed` bilan teng hisoblanadi.
 */
import { sql } from "drizzle-orm";
import { salesOrders } from "../../db/schema/sales.js";

/** Yakunlangan sotuv: tovar berildi, zaxira chiqdi, jurnal yozildi. Eski `shipped`/`delivered` ham shu ma'noda. */
export const COMPLETED_STATUSES = ["completed", "shipped", "delivered"] as const;

/** Tushum tan olingan holatlar (hisobotlar shu bo'yicha sanaydi). */
export const REALIZED_STATUSES = COMPLETED_STATUSES;

/** Mijozdan to'lov qabul qilinadigan holatlar. */
export const PAYABLE_STATUSES = ["confirmed", ...COMPLETED_STATUSES] as const;

export type SalePaymentStatus = "unpaid" | "partial" | "paid";

/** Sotuv yakunlanganmi (tovar berilgan). To'langanini bildirmaydi. */
export function isCompletedSale(status: string): boolean {
  return status === "completed" || status === "shipped" || status === "delivered";
}

/** Buyurtmaga to'lov yozish mumkinmi. */
export function isPayableSale(status: string): boolean {
  return status === "confirmed" || isCompletedSale(status);
}

/** To'lov holati — faqat summalardan; `0` summali chek to'langan hisoblanadi. */
export const paymentStatusSql = sql<SalePaymentStatus>`(case
  when ${salesOrders.paidAmount} >= ${salesOrders.totalAmount} then 'paid'
  when ${salesOrders.paidAmount} > 0 then 'partial'
  else 'unpaid'
end)`;
