/**
 * SOTUVCHI (2026-09-27) — chekni qaysi xodim sotgani (`sales_orders.seller_employee_id`).
 *
 * Alohida tushunchalar: KASSA (pul qutisi, `pos_shifts.cash_account_id`), KASSIR (pulni olgan foydalanuvchi, smena egasi),
 * YARATGAN (`created_by`), POS QURILMA (`device_id`) va SOTUVCHI (maslahat bergan, KPI oladigan xodim). Bitta kassada ko'p
 * sotuvchi ishlaydi; sotuvchi ixtiyoriy (tanlanmasa — atributsiyasiz). KPI — mavjud KPI Rule Builder ko'rsatkichlari
 * (`seller_*`), bonus qattiq kodlanmaydi.
 *
 * Ko'rsatkichlar (tiyingacha, numeric): Sotuv = Σ chegirmadan keyingi qator summasi, Chegirma = Σ(miqdor × narx) − Sotuv,
 * Qaytarish = shu sotuvchi cheklaridan davr ichida qaytarilgan summa, Sof = Sotuv − Qaytarish, Tannarx = sotilgan − qaytgan
 * tannarx, Yalpi foyda = Sof − Tannarx, Marja = Yalpi foyda / Sof. Qaytarilgan (to'liq) chek sotuvi ham kiradi, qaytarish
 * alohida ayiriladi — ikki marta ayirilmaydi.
 */
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { badRequest, notFound } from "@bum/shared";
import { employees } from "../../db/schema/hr.js";
import { salesOrderItems, salesOrders } from "../../db/schema/sales.js";
import type { DbOrTx } from "../../db/transaction.js";
import { fromMinor, toMinor } from "../../shared/decimal.js";
import { returnEventsByOrder, sumReturnEvents } from "./return-events.service.js";
import { COMPLETED_STATUSES } from "./sale-status.js";

const sold = sql.raw(`(${[...COMPLETED_STATUSES, "returned"].map((status) => `'${status}'`).join(", ")})`);

/** Sotuvchi — shu kompaniyaning faol xodimi. */
export async function assertSeller(conn: DbOrTx, companyId: string, employeeId: string) {
  const [row] = await conn
    .select({ id: employees.id, status: employees.status, name: employees.name })
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.companyId, companyId)))
    .limit(1);
  if (!row) throw notFound("Sotuvchi topilmadi");
  if (row.status !== "active") throw badRequest(`"${row.name}" faol xodim emas`);
  return row;
}

/** Kassada sotuvchi tanlash ro'yxati — faol xodimlar. */
export function sellerOptions(conn: DbOrTx, companyId: string) {
  return conn
    .select({ id: employees.id, name: employees.name, code: employees.code })
    .from(employees)
    .where(and(eq(employees.companyId, companyId), eq(employees.status, "active")))
    .orderBy(asc(employees.name));
}

export type SellerTotals = {
  employeeId: string;
  receipts: number;
  units: string;
  grossSales: string;
  discount: string;
  sales: string;
  returns: string;
  returnedUnits: string;
  netSales: string;
  cogs: string;
  grossProfit: string;
  /** Foiz, 2 xona; sof savdo 0 bo'lsa — null. */
  marginPercent: string | null;
};

/** Davr: `from` (kiritiladi) — `toExclusive` (kirmaydi), biznes sanasi. */
export async function sellerTotals(
  conn: DbOrTx,
  companyId: string,
  range: { from: string; toExclusive: string; employeeIds?: string[] },
): Promise<SellerTotals[]> {
  if (range.employeeIds && range.employeeIds.length === 0) return [];
  const sellerFilter = range.employeeIds ? [inArray(salesOrders.sellerEmployeeId, range.employeeIds)] : [];
  const sales = await conn
    .select({
      employeeId: sql<string>`${salesOrders.sellerEmployeeId}`,
      receipts: sql<number>`count(distinct ${salesOrders.id})::int`,
      units: sql<string>`coalesce(sum(${salesOrderItems.quantity}), 0)::numeric(18,4)::text`,
      gross: sql<string>`coalesce(sum(round(${salesOrderItems.quantity} * ${salesOrderItems.unitPrice}, 2)), 0)::numeric(18,2)::text`,
      revenue: sql<string>`coalesce(sum(${salesOrderItems.lineTotal}), 0)::numeric(18,2)::text`,
      cogs: sql<string>`coalesce(sum(round(${salesOrderItems.quantity} * ${salesOrderItems.costPrice}, 2)), 0)::numeric(18,2)::text`,
    })
    .from(salesOrderItems)
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderItems.orderId))
    .where(
      and(
        eq(salesOrders.companyId, companyId),
        isNotNull(salesOrders.sellerEmployeeId),
        ...sellerFilter,
        sql`${salesOrders.status} in ${sold}`,
        sql`${salesOrders.orderDate} >= ${range.from}::date and ${salesOrders.orderDate} < ${range.toExclusive}::date`,
      ),
    )
    .groupBy(salesOrders.sellerEmployeeId);
  // Qaytarishlar — yagona manba (qisman va hujjatsiz to'liq), qaytarish oyida; sotuvchi ko'rsatkichi qator asosida
  const events = await returnEventsByOrder(conn, companyId, range, and(isNotNull(salesOrders.sellerEmployeeId), ...sellerFilter));
  const returns = [...new Set(events.map((event) => event.sellerEmployeeId!))].map((employeeId) => {
    const totals = sumReturnEvents(events.filter((event) => event.sellerEmployeeId === employeeId));
    return { employeeId, amount: fromMinor(totals.lineAmount), units: fromMinor(totals.units, 4), cogs: fromMinor(totals.cogs) };
  });

  const ids = [...new Set([...sales.map((row) => row.employeeId), ...returns.map((row) => row.employeeId)])];
  return ids.map((employeeId) => {
    const s = sales.find((row) => row.employeeId === employeeId);
    const r = returns.find((row) => row.employeeId === employeeId);
    const revenue = toMinor(s?.revenue ?? "0");
    const gross = toMinor(s?.gross ?? "0");
    const returned = toMinor(r?.amount ?? "0");
    const net = revenue - returned;
    const cogs = toMinor(s?.cogs ?? "0") - toMinor(r?.cogs ?? "0");
    const profit = net - cogs;
    return {
      employeeId,
      receipts: s?.receipts ?? 0,
      units: s?.units ?? "0.0000",
      grossSales: fromMinor(gross),
      discount: fromMinor(gross - revenue),
      sales: fromMinor(revenue),
      returns: fromMinor(returned),
      returnedUnits: r?.units ?? "0.0000",
      netSales: fromMinor(net),
      cogs: fromMinor(cogs),
      grossProfit: fromMinor(profit),
      marginPercent: net === 0n ? null : fromMinor((profit * 10000n) / net),
    };
  });
}
