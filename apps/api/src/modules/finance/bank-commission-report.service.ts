/**
 * Bank komissiyasi hisoboti: davr bo'yicha ekvayring (karta to'lovidan ushlangan) va pul chiqarish komissiyasi — jami,
 * bank hisobi va karta turi (UZCARD, HUMO ...) bo'yicha; kartadan tushum (brutto) va hisobga sof tushgan summa.
 * Manba — avtomatik "bank komissiyasi" xarajatlari (`bank-commission.service.ts`); qo'lda kiritilgan xarajatlar kirmaydi.
 */
import { and, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { cashAccounts, cashTransactions, expenses, paymentTerminals } from "../../db/schema/finance.js";
import { customerPayments } from "../../db/schema/sales.js";
import type { DbOrTx } from "../../db/transaction.js";
import { fromMinor, toMinor } from "../../shared/decimal.js";
import type { TenantContext } from "../company/tenant.js";
import { BANK_FEE_CATEGORY } from "./bank-commission.service.js";

export type BankCommissionReportQuery = { dateFrom?: string; dateTo?: string; cashAccountId?: string };

/** Javobdagi qatorlar soni (jami summalar hamma qatorlar bo'yicha). */
const ROW_LIMIT = 500;

type AccountSum = { acquiring: bigint; outgoing: bigint; cardTurnover: bigint };
type TerminalSum = { turnover: bigint; commission: bigint };

export async function bankCommissionReport(conn: DbOrTx, tenant: TenantContext, query: BankCommissionReportQuery) {
  const companyId = tenant.company.id;

  const fees = await conn
    .select({
      id: expenses.id,
      number: expenses.number,
      date: expenses.expenseDate,
      amount: expenses.amount,
      description: expenses.description,
      sourceType: expenses.referenceType,
      cashAccountId: cashTransactions.cashAccountId,
      terminalId: customerPayments.terminalId,
      sourceAmount: customerPayments.amount,
    })
    .from(expenses)
    .leftJoin(
      cashTransactions,
      and(eq(cashTransactions.companyId, expenses.companyId), eq(cashTransactions.referenceType, "bank_fee"), eq(cashTransactions.referenceId, expenses.id)),
    )
    .leftJoin(
      customerPayments,
      and(eq(expenses.referenceType, "customer_payment"), eq(customerPayments.companyId, expenses.companyId), eq(customerPayments.id, expenses.referenceId)),
    )
    .where(
      and(
        eq(expenses.companyId, companyId),
        eq(expenses.category, BANK_FEE_CATEGORY),
        isNotNull(expenses.referenceType),
        query.dateFrom ? gte(expenses.expenseDate, query.dateFrom) : undefined,
        query.dateTo ? lte(expenses.expenseDate, query.dateTo) : undefined,
        query.cashAccountId ? eq(cashTransactions.cashAccountId, query.cashAccountId) : undefined,
      ),
    )
    .orderBy(desc(expenses.expenseDate), desc(expenses.number));

  // Karta turi bo'yicha tushum (brutto): mijoz to'lagan to'liq summa
  const turnover = await conn
    .select({
      terminalId: customerPayments.terminalId,
      cashAccountId: customerPayments.cashAccountId,
      amount: sql<string>`coalesce(sum(${customerPayments.amount}), 0)::text`,
    })
    .from(customerPayments)
    .where(
      and(
        eq(customerPayments.companyId, companyId),
        isNotNull(customerPayments.terminalId),
        query.dateFrom ? gte(customerPayments.paymentDate, query.dateFrom) : undefined,
        query.dateTo ? lte(customerPayments.paymentDate, query.dateTo) : undefined,
        query.cashAccountId ? eq(customerPayments.cashAccountId, query.cashAccountId) : undefined,
      ),
    )
    .groupBy(customerPayments.terminalId, customerPayments.cashAccountId);

  const terminals = new Map(
    (
      await conn
        .select({
          id: paymentTerminals.id,
          name: paymentTerminals.name,
          network: paymentTerminals.network,
          commissionPercent: paymentTerminals.commissionPercent,
          cashAccountName: cashAccounts.name,
        })
        .from(paymentTerminals)
        .innerJoin(cashAccounts, eq(cashAccounts.id, paymentTerminals.cashAccountId))
        .where(eq(paymentTerminals.companyId, companyId))
    ).map((row) => [row.id, row]),
  );
  const accountNames = new Map(
    (await conn.select({ id: cashAccounts.id, name: cashAccounts.name }).from(cashAccounts).where(eq(cashAccounts.companyId, companyId))).map((row) => [
      row.id,
      row.name,
    ]),
  );

  const byAccount = new Map<string, AccountSum>();
  const byTerminal = new Map<string, TerminalSum>();
  const accountSum = (id: string) => {
    let sum = byAccount.get(id);
    if (!sum) byAccount.set(id, (sum = { acquiring: 0n, outgoing: 0n, cardTurnover: 0n }));
    return sum;
  };
  const terminalSum = (id: string) => {
    let sum = byTerminal.get(id);
    if (!sum) byTerminal.set(id, (sum = { turnover: 0n, commission: 0n }));
    return sum;
  };

  let acquiring = 0n;
  let outgoing = 0n;
  let cardTurnover = 0n;
  for (const fee of fees) {
    const minor = toMinor(fee.amount);
    if (fee.sourceType === "customer_payment") {
      acquiring += minor;
      if (fee.cashAccountId) accountSum(fee.cashAccountId).acquiring += minor;
      if (fee.terminalId) terminalSum(fee.terminalId).commission += minor;
    } else {
      outgoing += minor;
      if (fee.cashAccountId) accountSum(fee.cashAccountId).outgoing += minor;
    }
  }
  for (const row of turnover) {
    const minor = toMinor(row.amount);
    cardTurnover += minor;
    if (row.terminalId) terminalSum(row.terminalId).turnover += minor;
    if (row.cashAccountId) accountSum(row.cashAccountId).cardTurnover += minor;
  }

  return {
    dateFrom: query.dateFrom ?? null,
    dateTo: query.dateTo ?? null,
    totals: {
      acquiring: fromMinor(acquiring),
      outgoing: fromMinor(outgoing),
      total: fromMinor(acquiring + outgoing),
      cardTurnover: fromMinor(cardTurnover),
    },
    byAccount: [...byAccount.entries()]
      .map(([cashAccountId, sum]) => ({
        cashAccountId,
        name: accountNames.get(cashAccountId) ?? "—",
        acquiring: fromMinor(sum.acquiring),
        outgoing: fromMinor(sum.outgoing),
        total: fromMinor(sum.acquiring + sum.outgoing),
        cardTurnover: fromMinor(sum.cardTurnover),
        sortKey: sum.acquiring + sum.outgoing,
      }))
      .sort((a, b) => (b.sortKey > a.sortKey ? 1 : b.sortKey < a.sortKey ? -1 : a.name.localeCompare(b.name)))
      .map(({ sortKey: _sortKey, ...row }) => row),
    byTerminal: [...byTerminal.entries()]
      .map(([terminalId, sum]) => {
        const terminal = terminals.get(terminalId);
        return {
          terminalId,
          name: terminal?.name ?? "—",
          network: terminal?.network ?? "other",
          cashAccountName: terminal?.cashAccountName ?? "—",
          commissionPercent: terminal?.commissionPercent ?? "0",
          turnover: fromMinor(sum.turnover),
          commission: fromMinor(sum.commission),
          net: fromMinor(sum.turnover - sum.commission),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
    rows: fees.slice(0, ROW_LIMIT).map((fee) => ({
      id: fee.id,
      number: fee.number,
      date: fee.date,
      kind: fee.sourceType === "customer_payment" ? ("acquiring" as const) : ("outgoing" as const),
      sourceType: fee.sourceType!,
      cashAccountId: fee.cashAccountId,
      cashAccountName: fee.cashAccountId ? (accountNames.get(fee.cashAccountId) ?? null) : null,
      terminalName: fee.terminalId ? (terminals.get(fee.terminalId)?.name ?? null) : null,
      sourceAmount: fee.sourceAmount,
      amount: fee.amount,
      description: fee.description,
    })),
  };
}
