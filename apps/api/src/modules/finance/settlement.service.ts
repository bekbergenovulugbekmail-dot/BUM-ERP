/**
 * Qirqim (settlement): karta terminali va elektron hamyon pulini bank hisobiga o'tkazish.
 *
 * Terminal "kutilayotgan" hisobga (turi `card` yoki `ewallet`) bog'langan bo'lsa, sotuvdagi karta to'lovi o'sha hisobga
 * tushadi — bu "UZCARD'dan kutilayotgan" summa. Bank pulni o'tkazganda (qirqim) shu hisobdan bank hisobiga o'tkaziladi:
 * hisob sozlamasidagi foiz komissiya sifatida ushlanadi (xarajat va jurnal — `recordBankCommission`), qolgani bankka.
 *
 * Terminal to'g'ridan-to'g'ri bank hisobiga bog'langan bo'lsa eski tartib saqlanadi: pul darhol bankda, ekvayring
 * komissiyasi to'lov paytida ushlanadi.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { badRequest, notFound } from "@bum/shared";
import { cashAccounts, cashTransactions } from "../../db/schema/finance.js";
import { paymentTerminals } from "../../db/schema/finance.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { fromMinor, toMinor } from "../../shared/decimal.js";
import type { TenantContext } from "../company/tenant.js";
import { financeAudit } from "./accounts.service.js";
import { commissionMinor, recordBankCommission } from "./bank-commission.service.js";
import { TRANSFER_CATEGORY, todayIso, transferCash } from "./cash.service.js";
import { assertPeriodOpen } from "./journal.service.js";

/** Qirqim kutayotgan hisob turlari (naqd va bank emas). */
export const PENDING_ACCOUNT_TYPES = ["card", "ewallet"] as const;

const pendingFields = {
  id: cashAccounts.id,
  name: cashAccounts.name,
  type: cashAccounts.type,
  currency: cashAccounts.currency,
  balance: cashAccounts.balance,
  isActive: cashAccounts.isActive,
  settlesToCashAccountId: cashAccounts.settlesToCashAccountId,
  settlementCommissionPercent: cashAccounts.settlementCommissionPercent,
};

/**
 * Kutilayotgan summalar: har "kutilayotgan" hisob bo'yicha qirqilmagan qoldiq, bugungi tushum va qaysi bank hisobiga
 * qirqilishi. Kassada ko'rinadigan terminallar ham qo'shiladi (UZCARD, HUMO — qaysi hisobga tushishi ko'rinsin).
 */
export async function listPendingSettlements(conn: DbOrTx, companyId: string) {
  const rows = await conn
    .select(pendingFields)
    .from(cashAccounts)
    .where(and(eq(cashAccounts.companyId, companyId), inArray(cashAccounts.type, [...PENDING_ACCOUNT_TYPES])))
    .orderBy(asc(cashAccounts.name));
  if (rows.length === 0) return { accounts: [] };

  const ids = rows.map((row) => row.id);
  const targets = await conn
    .select({ id: cashAccounts.id, name: cashAccounts.name })
    .from(cashAccounts)
    .where(and(eq(cashAccounts.companyId, companyId), inArray(cashAccounts.id, rows.flatMap((row) => (row.settlesToCashAccountId ? [row.settlesToCashAccountId] : [])))));
  const targetName = new Map(targets.map((row) => [row.id, row.name]));

  const today = todayIso();
  // Bugun shu hisobga tushgan (qirqim va komissiya chiqimlari kirmaydi)
  const todayRows = await conn
    .select({
      cashAccountId: cashTransactions.cashAccountId,
      amount: sql<string>`coalesce(sum(${cashTransactions.amount}), 0)::numeric(18,2)`,
    })
    .from(cashTransactions)
    .where(
      and(
        eq(cashTransactions.companyId, companyId),
        inArray(cashTransactions.cashAccountId, ids),
        eq(cashTransactions.type, "in"),
        eq(cashTransactions.txDate, today),
      ),
    )
    .groupBy(cashTransactions.cashAccountId);
  const todayIn = new Map(todayRows.map((row) => [row.cashAccountId, row.amount]));

  const terminals = await conn
    .select({ id: paymentTerminals.id, name: paymentTerminals.name, network: paymentTerminals.network, cashAccountId: paymentTerminals.cashAccountId })
    .from(paymentTerminals)
    .where(and(eq(paymentTerminals.companyId, companyId), eq(paymentTerminals.isActive, true), inArray(paymentTerminals.cashAccountId, ids)));

  return {
    accounts: rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      currency: row.currency,
      isActive: row.isActive,
      /** Qirqilmagan (kutilayotgan) summa. */
      pending: row.balance,
      /** Bugun shu hisobga tushgan summa. */
      today: todayIn.get(row.id) ?? "0.00",
      commissionPercent: row.settlementCommissionPercent,
      settlesTo: row.settlesToCashAccountId ? { id: row.settlesToCashAccountId, name: targetName.get(row.settlesToCashAccountId) ?? "" } : null,
      terminals: terminals.filter((terminal) => terminal.cashAccountId === row.id).map(({ id, name, network }) => ({ id, name, network })),
    })),
  };
}

export type SettlementInput = {
  /** Berilmasa — qirqilmagan butun qoldiq. */
  amount?: string;
  /** Berilmasa — hisobga bog'langan bank hisobi. */
  toCashAccountId?: string | null;
  txDate?: string;
  notes?: string | null;
};

/** Qirqim: kutilayotgan hisobdan bank hisobiga; komissiya shu yerda ushlanadi (xarajat + jurnal). */
export async function settleCashAccount(tx: Tx, tenant: TenantContext, cashAccountId: string, input: SettlementInput, meta: RequestMeta) {
  const companyId = tenant.company.id;
  const [account] = await tx
    .select(pendingFields)
    .from(cashAccounts)
    .where(and(eq(cashAccounts.id, cashAccountId), eq(cashAccounts.companyId, companyId)))
    .limit(1)
    .for("update");
  if (!account) throw notFound("Hisob topilmadi");
  if (!(PENDING_ACCOUNT_TYPES as readonly string[]).includes(account.type)) {
    throw badRequest("Faqat kutilayotgan hisob (karta yoki hamyon) qirqiladi", { reason: "not_pending_account" });
  }
  if (!account.isActive) throw badRequest("Hisob faol emas");

  const balance = toMinor(account.balance);
  const amount = input.amount ? toMinor(input.amount) : balance;
  if (amount <= 0n) throw badRequest("Qirqiladigan summa yo'q");
  if (amount > balance) {
    throw badRequest(`Kutilayotgan summa ${fromMinor(balance)} — undan ortig'ini qirqib bo'lmaydi`, { reason: "exceeds_pending", pending: fromMinor(balance) });
  }

  const targetId = input.toCashAccountId ?? account.settlesToCashAccountId;
  if (!targetId) throw badRequest("Qaysi bank hisobiga qirqilishi belgilanmagan — hisob sozlamasida tanlang");
  const [target] = await tx
    .select({ id: cashAccounts.id, name: cashAccounts.name, type: cashAccounts.type, isActive: cashAccounts.isActive, currency: cashAccounts.currency })
    .from(cashAccounts)
    .where(and(eq(cashAccounts.id, targetId), eq(cashAccounts.companyId, companyId)))
    .limit(1);
  if (!target) throw notFound("Bank hisobi topilmadi");
  if (target.type !== "bank" || !target.isActive) throw badRequest("Qirqim faqat faol bank hisobiga o'tkaziladi");
  if (target.currency !== account.currency) throw badRequest("Qirqim bir xil valyutadagi hisobga o'tkaziladi");

  const txDate = input.txDate ?? todayIso();
  await assertPeriodOpen(tx, companyId, txDate);
  const fee = commissionMinor(amount, account.settlementCommissionPercent);
  const net = amount - fee;
  if (net <= 0n) throw badRequest("Komissiya qirqim summasidan katta");

  const notes = input.notes?.trim() || null;
  const transfer = await transferCash(
    tx,
    tenant,
    {
      fromCashAccountId: account.id,
      toCashAccountId: target.id,
      amount: fromMinor(net),
      txDate,
      description: `Qirqim: ${account.name} → ${target.name}${notes ? ` · ${notes}` : ""}`,
    },
    meta,
  );
  if (fee > 0n) {
    await recordBankCommission(tx, tenant, {
      cashAccountId: account.id,
      amount: fee,
      sourceType: "cash_settlement",
      sourceId: transfer.referenceId,
      date: txDate,
      description: `Qirqim komissiyasi ${Number(account.settlementCommissionPercent)}% — ${account.name}`,
    });
  }

  await financeAudit(tx, tenant, meta, {
    action: "CASH_SETTLEMENT",
    resource: "cash_accounts",
    resourceId: account.id,
    details: { amount: fromMinor(amount), commission: fromMinor(fee), net: fromMinor(net), toCashAccountId: target.id, referenceId: transfer.referenceId, category: TRANSFER_CATEGORY },
  });

  return {
    referenceId: transfer.referenceId,
    amount: fromMinor(amount),
    commission: fromMinor(fee),
    net: fromMinor(net),
    toCashAccountId: target.id,
    pending: fromMinor(balance - amount),
  };
}
