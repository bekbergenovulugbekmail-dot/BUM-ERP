/**
 * KASSA, KASSIR, SOTUVCHI VA TO'LOV USULI HISOBOTLARI (2026-09-27). Faqat SELECT.
 *
 * Kassa hisoboti MANBA HUJJATLARDAN (`cash_transactions` — balansning o'zi shulardan yig'iladi) tuziladi, smena
 * hisoblagichlaridan emas:
 *   Boshlang'ich (davr boshidagi qoldiq) + Naqd tushum (sotuv va qarz to'lovi, balansga kirim) + Boshqa kirim
 *   − Naqd qaytarish − Xarajat − Ta'minotchiga to'lov − Boshqa chiqim − O'tkazma (chiqim) + O'tkazma (kirim)
 *   ± Smena farqi (ortiqcha/kamomad) = Yakuniy qoldiq.
 * Tekshiruv: `closing` = boshlang'ich + davr harakatlari; davr bugungacha bo'lsa `closing` = joriy balans.
 * Smenalar bo'yicha: kutilgan (yopishdagi kassa balansi), sanalgan va farq (ortiqcha/kamomad).
 */
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { ALLOCATION_METHOD_LABELS, type AllocationMethod } from "@bum/shared";
import { cashAccounts, cashTransactions, paymentMethods, paymentTerminals } from "../../db/schema/finance.js";
import { employees } from "../../db/schema/hr.js";
import { warehouses } from "../../db/schema/inventory.js";
import { customerPayments, posShifts } from "../../db/schema/sales.js";
import type { DbOrTx } from "../../db/transaction.js";
import { fromMinor, toMinor } from "../../shared/decimal.js";
import type { TenantContext } from "../company/tenant.js";
import { kpiPreview } from "../hr/kpi-rules.service.js";
import { allowedWarehouses } from "../inventory/warehouses.service.js";
import { sellerTotals } from "../sales/seller.service.js";

export type Range = { from: string; to: string };

const nextDay = (iso: string) => {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

/** Harakat turi → hisobot qatori. */
function bucketOf(referenceType: string | null, type: "in" | "out") {
  const ref = referenceType ?? "";
  if (ref === "customer_payment" || ref === "customer_balance") return type === "in" ? "cashSales" : "otherOut";
  if (ref === "customer_payment_reversal" || ref === "customer_balance_reversal") return type === "out" ? "salesReversals" : "otherIn";
  if (ref.startsWith("sales_return") || ref.startsWith("sales_refund")) return type === "out" ? "refunds" : "otherIn";
  if (ref === "cash_transfer") return type === "in" ? "transfersIn" : "transfersOut";
  if (ref === "expense") return type === "out" ? "expenses" : "otherIn";
  if (ref === "supplier_payment") return type === "out" ? "supplierPayments" : "otherIn";
  if (ref === "purchase_return_refund") return "supplierRefunds";
  if (ref.startsWith("pos_shift_difference")) return type === "in" ? "over" : "short";
  return type === "in" ? "otherIn" : "otherOut";
}

const BUCKETS = [
  "cashSales",
  "otherIn",
  "supplierRefunds",
  "transfersIn",
  "over",
  "refunds",
  "salesReversals",
  "expenses",
  "supplierPayments",
  "otherOut",
  "transfersOut",
  "short",
] as const;
type Bucket = (typeof BUCKETS)[number];
const INFLOW = new Set<Bucket>(["cashSales", "otherIn", "supplierRefunds", "transfersIn", "over"]);

/** POS kassalar (omborga bog'langan naqd hisoblar) — kassa hisoboti; `cashAccountId` bilan — bitta kassa. */
export async function kassaReport(conn: DbOrTx, tenant: TenantContext, range: Range & { cashAccountId?: string }) {
  const companyId = tenant.company.id;
  const allowed = allowedWarehouses(tenant);
  const kassas = await conn
    .select({ id: cashAccounts.id, name: cashAccounts.name, code: cashAccounts.code, balance: cashAccounts.balance, warehouseId: cashAccounts.warehouseId, warehouseName: warehouses.name })
    .from(cashAccounts)
    .innerJoin(warehouses, eq(warehouses.id, cashAccounts.warehouseId))
    .where(
      and(
        eq(cashAccounts.companyId, companyId),
        eq(cashAccounts.type, "cash"),
        isNotNull(cashAccounts.warehouseId),
        ...(range.cashAccountId ? [eq(cashAccounts.id, range.cashAccountId)] : []),
        ...(allowed ? [inArray(cashAccounts.warehouseId, allowed.length ? allowed : ["00000000-0000-0000-0000-000000000000"])] : []),
      ),
    )
    .orderBy(asc(cashAccounts.code), asc(cashAccounts.name));
  if (kassas.length === 0) return { from: range.from, to: range.to, kassas: [] };
  const ids = kassas.map((kassa) => kassa.id);
  const end = nextDay(range.to);
  const signed = sql`case when ${cashTransactions.type} = 'in' then ${cashTransactions.amount} else -${cashTransactions.amount} end`;

  const opening = await conn
    .select({ id: cashTransactions.cashAccountId, amount: sql<string>`coalesce(sum(${signed}), 0)::numeric(18,2)::text` })
    .from(cashTransactions)
    .where(and(inArray(cashTransactions.cashAccountId, ids), sql`${cashTransactions.txDate} < ${range.from}::date`))
    .groupBy(cashTransactions.cashAccountId);
  const moves = await conn
    .select({
      id: cashTransactions.cashAccountId,
      referenceType: cashTransactions.referenceType,
      type: cashTransactions.type,
      amount: sql<string>`sum(${cashTransactions.amount})::numeric(18,2)::text`,
    })
    .from(cashTransactions)
    .where(
      and(
        inArray(cashTransactions.cashAccountId, ids),
        sql`${cashTransactions.txDate} >= ${range.from}::date and ${cashTransactions.txDate} < ${end}::date`,
      ),
    )
    .groupBy(cashTransactions.cashAccountId, cashTransactions.referenceType, cashTransactions.type);
  const shifts = await conn
    .select({
      id: posShifts.cashAccountId,
      count: sql<number>`count(*)::int`,
      closed: sql<number>`count(*) filter (where ${posShifts.status} = 'closed')::int`,
      counted: sql<string>`coalesce(sum(${posShifts.closingCash}) filter (where ${posShifts.status} = 'closed'), 0)::numeric(18,2)::text`,
      difference: sql<string>`coalesce(sum(${posShifts.cashDifference}) filter (where ${posShifts.status} = 'closed'), 0)::numeric(18,2)::text`,
    })
    .from(posShifts)
    .where(
      and(
        eq(posShifts.companyId, companyId),
        inArray(posShifts.cashAccountId, ids),
        sql`(${posShifts.openedAt} at time zone 'Asia/Tashkent')::date >= ${range.from}::date`,
        sql`(${posShifts.openedAt} at time zone 'Asia/Tashkent')::date < ${end}::date`,
      ),
    )
    .groupBy(posShifts.cashAccountId);

  return {
    from: range.from,
    to: range.to,
    kassas: kassas.map((kassa) => {
      const totals = Object.fromEntries(BUCKETS.map((bucket) => [bucket, 0n])) as Record<Bucket, bigint>;
      for (const move of moves.filter((row) => row.id === kassa.id)) {
        totals[bucketOf(move.referenceType, move.type as "in" | "out")] += toMinor(move.amount);
      }
      const open = toMinor(opening.find((row) => row.id === kassa.id)?.amount ?? "0");
      const net = BUCKETS.reduce((sum, bucket) => sum + (INFLOW.has(bucket) ? totals[bucket] : -totals[bucket]), 0n);
      const shift = shifts.find((row) => row.id === kassa.id);
      const closing = open + net;
      return {
        id: kassa.id,
        name: kassa.name,
        code: kassa.code,
        warehouseName: kassa.warehouseName,
        opening: fromMinor(open),
        ...Object.fromEntries(BUCKETS.map((bucket) => [bucket, fromMinor(totals[bucket])])),
        /** Kutilgan = boshlang'ich + kirimlar − chiqimlar (farqdan oldin). */
        expected: fromMinor(closing - totals.over + totals.short),
        overShort: fromMinor(totals.over - totals.short),
        closing: fromMinor(closing),
        balanceNow: kassa.balance,
        shifts: {
          count: shift?.count ?? 0,
          closed: shift?.closed ?? 0,
          counted: shift?.counted ?? "0.00",
          difference: shift?.difference ?? "0.00",
        },
      } as Record<Bucket, string> & {
        id: string; name: string; code: string | null; warehouseName: string; opening: string; expected: string; overShort: string;
        closing: string; balanceNow: string; shifts: { count: number; closed: number; counted: string; difference: string };
      };
    }),
  };
}

/** Kassir hisoboti — smenalar egasi bo'yicha (kassir = smenani ochgan foydalanuvchi, sotuvchi emas). */
export async function cashierReport(conn: DbOrTx, tenant: TenantContext, range: Range) {
  const allowed = allowedWarehouses(tenant);
  const end = nextDay(range.to);
  const rows = await conn
    .select({
      cashierId: posShifts.cashierId,
      cashierName: sql<string>`max(${posShifts.cashierName})`,
      shifts: sql<number>`count(*)::int`,
      receipts: sql<number>`coalesce(sum(${posShifts.receiptCount}), 0)::int`,
      sales: sql<string>`coalesce(sum(${posShifts.totalSales}), 0)::numeric(18,2)::text`,
      cash: sql<string>`coalesce(sum(${posShifts.totalCash}), 0)::numeric(18,2)::text`,
      card: sql<string>`coalesce(sum(${posShifts.totalCard}), 0)::numeric(18,2)::text`,
      bank: sql<string>`coalesce(sum(${posShifts.totalBank}), 0)::numeric(18,2)::text`,
      returns: sql<string>`coalesce(sum(${posShifts.totalReturns}), 0)::numeric(18,2)::text`,
      over: sql<string>`coalesce(sum(greatest(${posShifts.cashDifference}, 0)), 0)::numeric(18,2)::text`,
      short: sql<string>`coalesce(sum(greatest(-${posShifts.cashDifference}, 0)), 0)::numeric(18,2)::text`,
    })
    .from(posShifts)
    .where(
      and(
        eq(posShifts.companyId, tenant.company.id),
        sql`(${posShifts.openedAt} at time zone 'Asia/Tashkent')::date >= ${range.from}::date`,
        sql`(${posShifts.openedAt} at time zone 'Asia/Tashkent')::date < ${end}::date`,
        ...(allowed ? [inArray(posShifts.warehouseId, allowed.length ? allowed : ["00000000-0000-0000-0000-000000000000"])] : []),
      ),
    )
    .groupBy(posShifts.cashierId)
    .orderBy(sql`max(${posShifts.cashierName})`);
  return { from: range.from, to: range.to, cashiers: rows };
}

/** Sotuvchi hisoboti: sotuv, dona, chegirma, qaytarish, sof, tannarx, YF, marja + KPI (Rule Builder) va bonus (`to` oyi). */
export async function sellerReport(conn: DbOrTx, tenant: TenantContext, range: Range, options: { withProfit: boolean }) {
  const companyId = tenant.company.id;
  const totals = await sellerTotals(conn, companyId, { from: range.from, toExclusive: nextDay(range.to) });
  const ids = totals.map((row) => row.employeeId);
  const people = ids.length
    ? await conn.select({ id: employees.id, name: employees.name, code: employees.code }).from(employees).where(and(eq(employees.companyId, companyId), inArray(employees.id, ids)))
    : [];
  const month = range.to.slice(0, 7);
  const kpi = ids.length ? await kpiPreview(conn, companyId, month) : { employees: [] as { employeeId?: string; id?: string; total: string; lines: { metric: string; amount: string }[] }[] };
  const kpiRows = (kpi as { employees: { employeeId?: string; id?: string; total: string; lines: { metric: string; amount: string }[] }[] }).employees;
  return {
    from: range.from,
    to: range.to,
    kpiMonth: month,
    profitHidden: !options.withProfit,
    sellers: totals
      .map((row) => {
        const person = people.find((p) => p.id === row.employeeId);
        const k = kpiRows.find((entry) => (entry.employeeId ?? entry.id) === row.employeeId);
        const sellerLines = (k?.lines ?? []).filter((line) => line.metric.startsWith("seller_"));
        const bonus = sellerLines.reduce((sum, line) => sum + toMinor(line.amount), 0n);
        return {
          ...row,
          ...(options.withProfit ? {} : { cogs: null, grossProfit: null, marginPercent: null }),
          name: person?.name ?? "—",
          code: person?.code ?? null,
          kpi: sellerLines,
          bonus: fromMinor(bonus),
        };
      })
      .sort((a, b) => Number(toMinor(b.netSales) - toMinor(a.netSales))),
  };
}

/** To'lov usuli hisoboti: o'tkazilgan (posted) mijoz to'lovlari — boshqariladigan usul, aks holda tur + terminal bo'yicha. */
export async function paymentMethodReport(conn: DbOrTx, tenant: TenantContext, range: Range) {
  const rows = await conn
    .select({
      paymentMethodId: customerPayments.paymentMethodId,
      methodName: paymentMethods.name,
      method: customerPayments.method,
      terminalId: customerPayments.terminalId,
      terminalName: paymentTerminals.name,
      count: sql<number>`count(*)::int`,
      amount: sql<string>`coalesce(sum(${customerPayments.amount}), 0)::numeric(18,2)::text`,
      posAmount: sql<string>`coalesce(sum(${customerPayments.amount}) filter (where ${customerPayments.posShiftId} is not null), 0)::numeric(18,2)::text`,
    })
    .from(customerPayments)
    .leftJoin(paymentMethods, eq(paymentMethods.id, customerPayments.paymentMethodId))
    .leftJoin(paymentTerminals, eq(paymentTerminals.id, customerPayments.terminalId))
    .where(
      and(
        eq(customerPayments.companyId, tenant.company.id),
        eq(customerPayments.status, "posted"),
        sql`${customerPayments.paymentDate} between ${range.from}::date and ${range.to}::date`,
      ),
    )
    .groupBy(customerPayments.paymentMethodId, paymentMethods.name, customerPayments.method, customerPayments.terminalId, paymentTerminals.name);
  const total = rows.reduce((sum, row) => sum + toMinor(row.amount), 0n);
  return {
    from: range.from,
    to: range.to,
    total: fromMinor(total),
    methods: rows
      .map((row) => ({
        ...row,
        label: row.methodName ?? (row.terminalName ? `Karta · ${row.terminalName}` : (ALLOCATION_METHOD_LABELS[row.method as AllocationMethod] ?? row.method)),
        sharePercent: total === 0n ? "0.00" : fromMinor((toMinor(row.amount) * 10000n) / total),
      }))
      .sort((a, b) => Number(toMinor(b.amount) - toMinor(a.amount))),
  };
}
