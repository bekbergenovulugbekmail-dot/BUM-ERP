/**
 * Sotuv qaytarishlari — KPI va sof ko'rsatkichlar uchun yagona manba (egasi qarori, 2026-09-28: KPI real sof natija
 * bo'yicha; qaytarish QAYSI OYDA amalga oshgan bo'lsa, shu oyda ayiriladi — asl sotuv oldingi oyda bo'lsa ham; o'tgan
 * oy qiymati o'zgarmaydi). Faqat SELECT.
 *
 *  - Qisman (va qatorlab to'liq) qaytarish — `sales_returns` hujjati; sana — hujjat yaratilgan kun (Toshkent vaqti).
 *  - To'liq qaytarish (`returnOrder`) — alohida hujjat yo'q: buyurtma `returned`, `sales_returns` qatorlari yo'q; sana —
 *    shu buyurtmaning "sales_return" jurnal yozuvi (yozuvsiz eski ma'lumot — buyurtma yangilangan kun).
 *
 * Har buyurtma bo'yicha: `amount` — hujjat summasi (buyurtma `total_amount` asosidagi ko'rsatkichlar uchun), `lineAmount` —
 * qatorlar yig'indisi (qator asosidagi ko'rsatkichlar, masalan sotuvchi), `units` — dona, `cogs` — tannarx.
 */
import { and, eq, sql, type SQL } from "drizzle-orm";
import { journalEntries } from "../../db/schema/finance.js";
import { salesOrderItems, salesOrders, salesReturnItems, salesReturns } from "../../db/schema/sales.js";
import type { DbOrTx } from "../../db/transaction.js";
import { fromMinor, toMinor } from "../../shared/decimal.js";

export type ReturnEvent = {
  orderId: string;
  /** `partial` — `sales_returns` hujjati; `full` — hujjatsiz to'liq qaytarish (`returnOrder`). */
  kind: "partial" | "full";
  sellerEmployeeId: string | null;
  createdBy: string | null;
  amount: string;
  lineAmount: string;
  units: string;
  cogs: string;
};

const tashkentDay = (column: unknown) => sql`(${column} at time zone 'Asia/Tashkent')::date`;

export async function returnEventsByOrder(
  conn: DbOrTx,
  companyId: string,
  range: { from: string; toExclusive: string },
  /** Buyurtmaga qo'shimcha shart (`sales_orders` ustunlari bo'yicha) — xodim, manba, agent va h.k. */
  orderCondition?: SQL,
): Promise<ReturnEvent[]> {
  const partialRange = and(
    eq(salesReturns.companyId, companyId),
    sql`${tashkentDay(salesReturns.createdAt)} >= ${range.from}::date`,
    sql`${tashkentDay(salesReturns.createdAt)} < ${range.toExclusive}::date`,
    orderCondition,
  );
  // Hujjat summasi — sarlavhalardan (qatorlar bilan birlashtirilsa takrorlanardi), qatorlar — alohida
  const headers = await conn
    .select({
      orderId: salesOrders.id,
      sellerEmployeeId: salesOrders.sellerEmployeeId,
      createdBy: salesOrders.createdBy,
      amount: sql<string>`coalesce(sum(${salesReturns.totalAmount}), 0)::numeric(18,2)::text`,
    })
    .from(salesReturns)
    .innerJoin(salesOrders, eq(salesOrders.id, salesReturns.orderId))
    .where(partialRange)
    .groupBy(salesOrders.id);
  const lines = await conn
    .select({
      orderId: salesOrders.id,
      lineAmount: sql<string>`coalesce(sum(${salesReturnItems.lineTotal}), 0)::numeric(18,2)::text`,
      units: sql<string>`coalesce(sum(${salesReturnItems.quantity}), 0)::numeric(18,4)::text`,
      cogs: sql<string>`coalesce(sum(${salesReturnItems.cogs}), 0)::numeric(18,2)::text`,
    })
    .from(salesReturnItems)
    .innerJoin(salesReturns, eq(salesReturns.id, salesReturnItems.returnId))
    .innerJoin(salesOrders, eq(salesOrders.id, salesReturns.orderId))
    .where(partialRange)
    .groupBy(salesOrders.id);
  const linesByOrder = new Map(lines.map((row) => [row.orderId, row]));
  const partial: ReturnEvent[] = headers.map((row) => ({
    ...row,
    kind: "partial" as const,
    lineAmount: linesByOrder.get(row.orderId)?.lineAmount ?? "0.00",
    units: linesByOrder.get(row.orderId)?.units ?? "0.0000",
    cogs: linesByOrder.get(row.orderId)?.cogs ?? "0.00",
  }));

  const returnDay = sql`coalesce(${journalEntries.entryDate}, ${tashkentDay(salesOrders.updatedAt)})`;
  const full = await conn
    .select({
      orderId: salesOrders.id,
      sellerEmployeeId: salesOrders.sellerEmployeeId,
      createdBy: salesOrders.createdBy,
      amount: sql<string>`max(${salesOrders.totalAmount})::numeric(18,2)::text`,
      lineAmount: sql<string>`coalesce(sum(${salesOrderItems.lineTotal}), 0)::numeric(18,2)::text`,
      units: sql<string>`coalesce(sum(${salesOrderItems.quantity}), 0)::numeric(18,4)::text`,
      cogs: sql<string>`coalesce(sum(round(${salesOrderItems.quantity} * ${salesOrderItems.costPrice}, 2)), 0)::numeric(18,2)::text`,
    })
    .from(salesOrders)
    .innerJoin(salesOrderItems, eq(salesOrderItems.orderId, salesOrders.id))
    .leftJoin(
      journalEntries,
      and(eq(journalEntries.referenceType, "sales_return"), eq(journalEntries.referenceId, salesOrders.id), eq(journalEntries.companyId, companyId)),
    )
    .where(
      and(
        eq(salesOrders.companyId, companyId),
        eq(salesOrders.status, "returned"),
        sql`not exists (select 1 from ${salesReturns} r where r.order_id = ${salesOrders.id})`,
        sql`${returnDay} >= ${range.from}::date`,
        sql`${returnDay} < ${range.toExclusive}::date`,
        orderCondition,
      ),
    )
    .groupBy(salesOrders.id);

  return [...partial, ...full.map((row) => ({ ...row, kind: "full" as const }))];
}

/** Hodisalar yig'indisi (bigint, 2/4 kasr). */
export function sumReturnEvents(events: ReturnEvent[]) {
  return events.reduce(
    (acc, event) => ({
      amount: acc.amount + toMinor(event.amount),
      lineAmount: acc.lineAmount + toMinor(event.lineAmount),
      units: acc.units + toMinor(event.units, 4),
      cogs: acc.cogs + toMinor(event.cogs),
      count: acc.count + 1,
    }),
    { amount: 0n, lineAmount: 0n, units: 0n, cogs: 0n, count: 0 },
  );
}

export const returnTotalsText = (totals: ReturnType<typeof sumReturnEvents>) => ({
  amount: fromMinor(totals.amount),
  lineAmount: fromMinor(totals.lineAmount),
  units: fromMinor(totals.units, 4),
  cogs: fromMinor(totals.cogs),
});
