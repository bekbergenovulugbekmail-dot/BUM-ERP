/**
 * Bank komissiyasi — avtomatik, har safar qo'lda yechilmaydi:
 *
 *  - Ekvayring (karta terminali): mijoz 100 000 so'm to'laydi, terminal komissiyasi 0.25% — bank hisobiga to'lov kirimi
 *    100 000 va komissiya chiqimi 250 (qoldiq 99 750), mijoz qarzi to'liq 100 000 ga yopiladi.
 *  - Pul chiqarish (bank hisobi): ta'minotchiga 1 000 000, hisob komissiyasi 1% — hisobdan 1 000 000 + 10 000 chiqadi,
 *    ta'minotchi balansiga 1 000 000.
 *
 * Har komissiya: `expenses` (kategoriya "bank komissiyasi", to'langan, manba havolasi bilan) — Xarajatlar bo'limida
 * ko'rinadi; kassa/bank chiqimi; jurnal DR 5800 "Bank komissiyasi xarajatlari" / CR bank hisobining buxgalteriya hisobi.
 * Bitta manbadan (to'lov, xarajat, maosh, o'tkazma) bitta komissiya — takroriy so'rovda qayta yozilmaydi.
 * Faqat asosiy valyutadagi hisoblarda (valyutali bank hisobi komissiyasi qo'lda).
 */
import { and, eq } from "drizzle-orm";
import { cashAccounts, expenses } from "../../db/schema/finance.js";
import type { Tx } from "../../db/transaction.js";
import { fromMinor, mulDivRound, toMinor } from "../../shared/decimal.js";
import { nextDocumentNumber } from "../../shared/numbering.js";
import type { TenantContext } from "../company/tenant.js";
import { companyCurrency } from "./accounts.service.js";
import { ledgerAccountFor, recordCashTransaction } from "./cash.service.js";
import { ensureAccountBySubtype, postJournalEntry } from "./journal.service.js";

export const BANK_FEE_CATEGORY = "bank komissiyasi";

/** Komissiya tiyinda: summa × foiz / 100, yarmidan yuqoriga yaxlitlanadi (0.25% × 100 000 = 250). */
export function commissionMinor(amount: bigint, percent: string | null | undefined): bigint {
  if (!percent || amount <= 0n) return 0n;
  const rate = toMinor(percent);
  return rate > 0n ? mulDivRound(amount, rate, 10_000n) : 0n;
}

export type BankCommissionInput = {
  cashAccountId: string;
  /** Komissiya summasi, tiyinda. */
  amount: bigint;
  /** Manba: `customer_payment`, `supplier_payment`, `expense`, `salary_payment`, `cash_transaction`, `cash_transfer`. */
  sourceType: string;
  sourceId: string;
  date: string;
  description: string;
  /** Offline kassa sinxroni — pul allaqachon harakatlangan. */
  allowOverdraft?: boolean;
};

export async function recordBankCommission(tx: Tx, tenant: TenantContext, input: BankCommissionInput) {
  if (input.amount <= 0n) return null;
  const companyId = tenant.company.id;
  const [existing] = await tx
    .select({ id: expenses.id, amount: expenses.amount })
    .from(expenses)
    .where(and(eq(expenses.companyId, companyId), eq(expenses.referenceType, input.sourceType), eq(expenses.referenceId, input.sourceId)))
    .limit(1);
  if (existing) return { expenseId: existing.id, amount: existing.amount, created: false };

  const feeAccountId = await ensureAccountBySubtype(tx, companyId, "bank_fees");
  const amount = fromMinor(input.amount);
  const number = await nextDocumentNumber(tx, {
    table: expenses,
    column: expenses.number,
    companyColumn: expenses.companyId,
    companyId,
    prefix: `EXP-${input.date.slice(0, 4)}-`,
    width: 4,
  });
  const [expense] = await tx
    .insert(expenses)
    .values({
      companyId,
      number,
      category: BANK_FEE_CATEGORY,
      description: input.description,
      amount,
      currency: await companyCurrency(tx, companyId),
      expenseDate: input.date,
      accountId: feeAccountId,
      status: "paid",
      referenceType: input.sourceType,
      referenceId: input.sourceId,
      createdBy: tenant.user.id,
    })
    .returning({ id: expenses.id });

  const { account } = await recordCashTransaction(tx, companyId, tenant.user.id, {
    cashAccountId: input.cashAccountId,
    type: "out",
    amount,
    txDate: input.date,
    description: `${number}: ${input.description}`,
    category: BANK_FEE_CATEGORY,
    referenceType: "bank_fee",
    referenceId: expense!.id,
    allowOverdraft: input.allowOverdraft,
  });
  await postJournalEntry(tx, companyId, tenant.user.id, {
    entryDate: input.date,
    description: `Bank komissiyasi ${number}: ${input.description}`,
    referenceType: "bank_fee",
    referenceId: expense!.id,
    lines: [
      { accountId: feeAccountId, debit: amount, description: BANK_FEE_CATEGORY },
      { accountId: await ledgerAccountFor(tx, companyId, account), credit: amount },
    ],
  });
  return { expenseId: expense!.id, amount, created: true };
}

/**
 * Bank hisobidan pul chiqqanda — hisob sozlamasidagi foiz bo'yicha komissiya (kassa, valyutali hisob va 0% — yo'q).
 * `amount` — asosiy chiqim summasi (hisob valyutasida).
 */
export async function applyOutgoingBankCommission(
  tx: Tx,
  tenant: TenantContext,
  input: { cashAccountId: string; amount: string; date: string; description: string; sourceType: string; sourceId: string; allowOverdraft?: boolean },
) {
  const companyId = tenant.company.id;
  const [account] = await tx
    .select({ type: cashAccounts.type, currency: cashAccounts.currency, percent: cashAccounts.outgoingCommissionPercent })
    .from(cashAccounts)
    .where(and(eq(cashAccounts.id, input.cashAccountId), eq(cashAccounts.companyId, companyId)))
    .limit(1);
  if (!account || account.type !== "bank") return null;
  if (account.currency !== (await companyCurrency(tx, companyId))) return null;
  const fee = commissionMinor(toMinor(input.amount), account.percent);
  if (fee <= 0n) return null;
  return recordBankCommission(tx, tenant, {
    cashAccountId: input.cashAccountId,
    amount: fee,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    date: input.date,
    description: `Pul chiqarish komissiyasi ${Number(account.percent)}% — ${input.description}`,
    allowOverdraft: input.allowOverdraft,
  });
}
