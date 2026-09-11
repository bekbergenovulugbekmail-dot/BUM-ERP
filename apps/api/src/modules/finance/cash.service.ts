/**
 * Kassa va bank hisoblari (convex/finance/cashAccounts.ts, journalHelper.recordCashTransaction).
 *
 * `recordCashTransaction` — kassa balansini o'zgartiradigan YAGONA yo'l; xarajat,
 * xarid, savdo va POS to'lovlari shuni chaqiradi. Qator `FOR UPDATE` bilan
 * qulflanadi, balans manfiyga tushmaydi, bir hujjatga takroriy yozuv qilinmaydi.
 *
 * Convex'dan farqlar:
 *  - `type: "transfer"` balansni faqat kamaytirib, pul hech qayerga tushmasdi —
 *    endi alohida o'tkazma: manbadan chiqim + qabul qiluvchiga kirim (+ kassa↔bank jurnal yozuvi)
 *  - yordamchi (xarid/savdo to'lovlari) balansni manfiyga tushirishga yo'l qo'yardi
 *  - boshlang'ich qoldiq tranzaksiyasiz balansga yozilardi — endi kirim tranzaksiyasi
 *    va DR kassa / CR ustav kapitali
 *  - qo'lda kirim/chiqimda qarshi hisob tanlansa jurnal yozuvi ham qilinadi
 *  - asosiy kassa bazada ham yagona (0005); kassani tahrirlash va faolsizlantirish qo'shildi
 *  - `list`, `getTransactions`, `getDashboardStats` ruxsat tekshirmasdi — `finance.view`
 */
import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { badRequest, conflict, notFound } from "@bum/shared";
import { accounts, cashAccounts, cashTransactions } from "../../db/schema/finance.js";
import { purchaseOrders } from "../../db/schema/purchase.js";
import { salesOrders } from "../../db/schema/sales.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { UUID_RE, decodeCursor, encodeCursor } from "../../shared/cursor.js";
import { fromMinor, toMinor } from "../../shared/decimal.js";
import type { TenantContext } from "../company/tenant.js";
import { companyCurrency, financeAudit } from "./accounts.service.js";
import { postJournalEntry, requireAccountBySubtype } from "./journal.service.js";

const { legacyId: _l1, companyId: _c1, ...cashAccountFields } = getTableColumns(cashAccounts);
const { legacyId: _l2, companyId: _c2, ...transactionFields } = getTableColumns(cashTransactions);

export type CashAccountType = (typeof cashAccounts.type.enumValues)[number];

/** Hisobotlarda aylanma sifatida sanalmaydigan kategoriyalar. */
export const TRANSFER_CATEGORY = "transfer";
export const OPENING_BALANCE_CATEGORY = "opening_balance";

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Kassa turi → hisoblar rejasidagi hisob (1010 naqd / 1020 bank). */
export function ledgerAccountFor(conn: DbOrTx, companyId: string, type: CashAccountType) {
  return requireAccountBySubtype(conn, companyId, type, "asset", type === "cash" ? "Naqd kassa" : "Bank hisobi");
}

export type PaymentMethod = "cash" | "bank" | "card" | "transfer";

/**
 * To'lov usuli → kassa: aniq tanlangan hisob ustun; naqd — asosiy kassa (null);
 * karta, bank, o'tkazma — birinchi faol bank hisobi (karta tushumi bankka tushadi).
 */
export async function resolvePaymentAccount(
  tx: Tx,
  companyId: string,
  method: PaymentMethod,
  cashAccountId?: string | null,
): Promise<string | null> {
  if (cashAccountId) return cashAccountId;
  if (method === "cash") return null;
  const [bank] = await tx
    .select({ id: cashAccounts.id })
    .from(cashAccounts)
    .where(and(eq(cashAccounts.companyId, companyId), eq(cashAccounts.type, "bank"), eq(cashAccounts.isActive, true)))
    .orderBy(desc(cashAccounts.isDefault), asc(cashAccounts.name))
    .limit(1);
  if (!bank) throw badRequest("Faol bank hisobi yo'q");
  return bank.id;
}

export type CashMove = {
  /** null — kompaniyaning asosiy kassasi. */
  cashAccountId?: string | null;
  type: "in" | "out";
  amount: string;
  txDate: string;
  description: string;
  category?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
};

export async function recordCashTransaction(tx: Tx, companyId: string, createdBy: string | null, move: CashMove) {
  if (toMinor(move.amount) <= 0n) throw badRequest("Summa musbat bo'lishi kerak");

  const [account] = await tx
    .select(cashAccountFields)
    .from(cashAccounts)
    .where(
      and(
        eq(cashAccounts.companyId, companyId),
        move.cashAccountId
          ? eq(cashAccounts.id, move.cashAccountId)
          : and(eq(cashAccounts.isDefault, true), eq(cashAccounts.isActive, true)),
      ),
    )
    .limit(1)
    .for("update");
  if (!account) throw move.cashAccountId ? notFound("Kassa topilmadi") : badRequest("Asosiy kassa belgilanmagan");
  if (!account.isActive) throw badRequest("Kassa faol emas");

  if (move.referenceType && move.referenceId) {
    const [existing] = await tx
      .select(transactionFields)
      .from(cashTransactions)
      .where(
        and(
          eq(cashTransactions.companyId, companyId),
          eq(cashTransactions.cashAccountId, account.id),
          eq(cashTransactions.type, move.type),
          eq(cashTransactions.referenceType, move.referenceType),
          eq(cashTransactions.referenceId, move.referenceId),
        ),
      )
      .limit(1);
    if (existing) return { transaction: existing, account, created: false };
  }

  const delta = move.type === "in" ? move.amount : `-${move.amount}`;
  const [updated] = await tx
    .update(cashAccounts)
    .set({ balance: sql`${cashAccounts.balance} + ${delta}::numeric`, updatedAt: new Date() })
    .where(and(eq(cashAccounts.id, account.id), sql`${cashAccounts.balance} + ${delta}::numeric >= 0`))
    .returning({ balance: cashAccounts.balance });
  if (!updated) throw badRequest("Kassada yetarli mablag' yo'q");

  const [transaction] = await tx
    .insert(cashTransactions)
    .values({
      companyId,
      cashAccountId: account.id,
      type: move.type,
      amount: move.amount,
      currency: account.currency,
      txDate: move.txDate,
      description: move.description,
      category: move.category ?? null,
      referenceType: move.referenceType ?? null,
      referenceId: move.referenceId ?? null,
      balanceAfter: updated.balance,
      createdBy,
      // Kursor millisekund aniqligida — now() mikrosekundi sahifalashni buzardi
      createdAt: new Date(),
    })
    .returning(transactionFields);

  return { transaction: transaction!, account, created: true };
}

// ─── Kassalar ────────────────────────────────────────────────────────────────

export async function listCashAccounts(conn: DbOrTx, tenant: TenantContext, includeInactive = false) {
  return conn
    .select(cashAccountFields)
    .from(cashAccounts)
    .where(
      and(eq(cashAccounts.companyId, tenant.company.id), includeInactive ? undefined : eq(cashAccounts.isActive, true)),
    )
    .orderBy(desc(cashAccounts.isDefault), asc(cashAccounts.type), asc(cashAccounts.name));
}

async function clearDefault(tx: Tx, companyId: string) {
  await tx
    .update(cashAccounts)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(and(eq(cashAccounts.companyId, companyId), eq(cashAccounts.isDefault, true)));
}

export type CashAccountInput = {
  name: string;
  type: CashAccountType;
  bankName?: string | null;
  accountNumber?: string | null;
  isDefault?: boolean;
  openingBalance?: string;
};

export async function createCashAccount(tx: Tx, tenant: TenantContext, input: CashAccountInput, meta: RequestMeta) {
  const companyId = tenant.company.id;
  const { openingBalance, ...fields } = input;
  if (input.isDefault) await clearDefault(tx, companyId);

  const [account] = await tx
    .insert(cashAccounts)
    .values({ ...fields, isDefault: input.isDefault ?? false, companyId, currency: await companyCurrency(tx, companyId) })
    .returning(cashAccountFields);

  if (openingBalance && toMinor(openingBalance) > 0n) {
    const txDate = todayIso();
    await recordCashTransaction(tx, companyId, tenant.user.id, {
      cashAccountId: account!.id,
      type: "in",
      amount: openingBalance,
      txDate,
      description: "Boshlang'ich qoldiq",
      category: OPENING_BALANCE_CATEGORY,
      referenceType: "cash_opening_balance",
      referenceId: account!.id,
    });
    await postJournalEntry(tx, companyId, tenant.user.id, {
      entryDate: txDate,
      description: `Boshlang'ich qoldiq: ${account!.name}`,
      referenceType: "cash_opening_balance",
      referenceId: account!.id,
      lines: [
        { accountId: await ledgerAccountFor(tx, companyId, account!.type), debit: openingBalance },
        {
          accountId: await requireAccountBySubtype(tx, companyId, "capital", "equity", "Ustav kapitali"),
          credit: openingBalance,
        },
      ],
    });
  }

  await financeAudit(tx, tenant, meta, {
    action: "CASH_ACCOUNT_CREATED",
    resource: "cash_accounts",
    resourceId: account!.id,
    details: { name: account!.name, type: account!.type, openingBalance: openingBalance ?? "0" },
  });

  const [fresh] = await tx.select(cashAccountFields).from(cashAccounts).where(eq(cashAccounts.id, account!.id));
  return fresh!;
}

export async function updateCashAccount(
  tx: Tx,
  tenant: TenantContext,
  cashAccountId: string,
  patch: { name?: string; bankName?: string | null; accountNumber?: string | null; isDefault?: boolean; isActive?: boolean },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const [current] = await tx
    .select(cashAccountFields)
    .from(cashAccounts)
    .where(and(eq(cashAccounts.id, cashAccountId), eq(cashAccounts.companyId, companyId)))
    .limit(1)
    .for("update");
  if (!current) throw notFound("Kassa topilmadi");

  if (current.isDefault && patch.isDefault === false) {
    throw badRequest("Asosiy kassani olib bo'lmaydi — boshqa kassani asosiy qiling");
  }
  if ((patch.isDefault ?? current.isDefault) && !(patch.isActive ?? current.isActive)) {
    throw badRequest("Asosiy kassa faol bo'lishi kerak");
  }
  if (current.isActive && patch.isActive === false && toMinor(current.balance) !== 0n) {
    throw conflict("Kassada mablag' bor — avval boshqa kassaga o'tkazing");
  }
  if (patch.isDefault && !current.isDefault) await clearDefault(tx, companyId);

  const [updated] = await tx
    .update(cashAccounts)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(cashAccounts.id, cashAccountId))
    .returning(cashAccountFields);

  await financeAudit(tx, tenant, meta, {
    action: "CASH_ACCOUNT_UPDATED",
    resource: "cash_accounts",
    resourceId: cashAccountId,
    details: { changes: Object.keys(patch) },
  });
  return updated!;
}

// ─── Tranzaksiyalar ──────────────────────────────────────────────────────────

export async function listCashTransactions(
  conn: DbOrTx,
  tenant: TenantContext,
  options: { cashAccountId: string; dateFrom?: string; dateTo?: string; limit: number; cursor?: string },
) {
  const [account] = await conn
    .select({ id: cashAccounts.id })
    .from(cashAccounts)
    .where(and(eq(cashAccounts.id, options.cashAccountId), eq(cashAccounts.companyId, tenant.company.id)))
    .limit(1);
  if (!account) throw notFound("Kassa topilmadi");

  let after: { at: Date; id: string } | null = null;
  if (options.cursor) {
    const [iso, id] = decodeCursor(options.cursor, 2) as [string, string];
    const at = new Date(iso);
    if (Number.isNaN(at.getTime()) || !UUID_RE.test(id)) throw badRequest("Kursor noto'g'ri");
    after = { at, id };
  }

  const rows = await conn
    .select(transactionFields)
    .from(cashTransactions)
    .where(
      and(
        eq(cashTransactions.companyId, tenant.company.id),
        eq(cashTransactions.cashAccountId, account.id),
        options.dateFrom ? gte(cashTransactions.txDate, options.dateFrom) : undefined,
        options.dateTo ? lte(cashTransactions.txDate, options.dateTo) : undefined,
        after
          ? or(
              lt(cashTransactions.createdAt, after.at),
              and(eq(cashTransactions.createdAt, after.at), lt(cashTransactions.id, after.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(cashTransactions.createdAt), desc(cashTransactions.id))
    .limit(options.limit + 1);

  const page = rows.slice(0, options.limit);
  const last = page.at(-1);
  return {
    transactions: page,
    nextCursor: rows.length > options.limit && last ? encodeCursor([last.createdAt.toISOString(), last.id]) : null,
  };
}

export async function recordManualCashTransaction(
  tx: Tx,
  tenant: TenantContext,
  input: {
    cashAccountId: string;
    type: "in" | "out";
    amount: string;
    txDate?: string;
    description: string;
    category?: string | null;
    counterAccountId?: string | null;
  },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const txDate = input.txDate ?? todayIso();
  const { transaction, account } = await recordCashTransaction(tx, companyId, tenant.user.id, {
    cashAccountId: input.cashAccountId,
    type: input.type,
    amount: input.amount,
    txDate,
    description: input.description,
    category: input.category ?? null,
  });

  let journalEntryId: string | null = null;
  if (input.counterAccountId) {
    const [counter] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.id, input.counterAccountId), eq(accounts.companyId, companyId)))
      .limit(1);
    if (!counter) throw badRequest("Qarshi hisob topilmadi");
    const ledger = await ledgerAccountFor(tx, companyId, account.type);
    if (ledger === counter.id) throw badRequest("Qarshi hisob kassaning o'z hisobi bo'lishi mumkin emas");

    const lines =
      input.type === "in"
        ? [{ accountId: ledger, debit: input.amount }, { accountId: counter.id, credit: input.amount }]
        : [{ accountId: counter.id, debit: input.amount }, { accountId: ledger, credit: input.amount }];
    const { entry } = await postJournalEntry(tx, companyId, tenant.user.id, {
      entryDate: txDate,
      description: input.description,
      referenceType: "cash_transaction",
      referenceId: transaction.id,
      lines,
    });
    journalEntryId = entry.id;
  }

  await financeAudit(tx, tenant, meta, {
    action: "CASH_TRANSACTION_RECORDED",
    resource: "cash_transactions",
    resourceId: transaction.id,
    details: { cashAccountId: account.id, type: input.type, amount: input.amount, journalEntryId },
  });
  return { transaction, journalEntryId };
}

export async function transferCash(
  tx: Tx,
  tenant: TenantContext,
  input: { fromCashAccountId: string; toCashAccountId: string; amount: string; txDate?: string; description?: string | null },
  meta: RequestMeta,
) {
  if (input.fromCashAccountId === input.toCashAccountId) throw badRequest("Bir xil hisob tanlandi");
  const companyId = tenant.company.id;

  // Ikkala qator doimiy tartibda qulflanadi — qarama-qarshi o'tkazmalar deadlock bermaydi
  const pair = await tx
    .select(cashAccountFields)
    .from(cashAccounts)
    .where(and(eq(cashAccounts.companyId, companyId), inArray(cashAccounts.id, [input.fromCashAccountId, input.toCashAccountId])))
    .orderBy(asc(cashAccounts.id))
    .for("update");
  const source = pair.find((a) => a.id === input.fromCashAccountId);
  const target = pair.find((a) => a.id === input.toCashAccountId);
  if (!source || !target) throw notFound("Kassa topilmadi");
  if (source.currency !== target.currency) throw badRequest("O'tkazma faqat bir xil valyutadagi hisoblar orasida");

  const referenceId = randomUUID();
  const txDate = input.txDate ?? todayIso();
  const description = input.description || `${source.name} → ${target.name}`;
  const common = { amount: input.amount, txDate, description, category: TRANSFER_CATEGORY, referenceType: "cash_transfer", referenceId };

  const out = await recordCashTransaction(tx, companyId, tenant.user.id, { ...common, cashAccountId: source.id, type: "out" });
  const into = await recordCashTransaction(tx, companyId, tenant.user.id, { ...common, cashAccountId: target.id, type: "in" });

  // Kassa ↔ bank — hisoblar rejasida ham pul ko'chadi; kassa ↔ kassa bitta hisob ichida
  let journalEntryId: string | null = null;
  if (source.type !== target.type) {
    const { entry } = await postJournalEntry(tx, companyId, tenant.user.id, {
      entryDate: txDate,
      description,
      referenceType: "cash_transfer",
      referenceId,
      lines: [
        { accountId: await ledgerAccountFor(tx, companyId, target.type), debit: input.amount },
        { accountId: await ledgerAccountFor(tx, companyId, source.type), credit: input.amount },
      ],
    });
    journalEntryId = entry.id;
  }

  await financeAudit(tx, tenant, meta, {
    action: "CASH_TRANSFERRED",
    resource: "cash_transactions",
    resourceId: referenceId,
    details: { from: source.id, to: target.id, amount: input.amount, journalEntryId },
  });
  return { referenceId, from: out.transaction, to: into.transaction, journalEntryId };
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export async function financeDashboard(conn: DbOrTx, tenant: TenantContext) {
  const companyId = tenant.company.id;
  const monthStart = `${todayIso().slice(0, 7)}-01`;

  const accountList = await listCashAccounts(conn, tenant);
  const totalOf = (type: CashAccountType) =>
    accountList.filter((a) => a.type === type).reduce((s, a) => s + toMinor(a.balance), 0n);

  const [cash] = await conn
    .select({
      income: sql<string>`coalesce(sum(${cashTransactions.amount}) filter (where ${cashTransactions.type} = 'in'), 0)::numeric(18,2)`,
      expense: sql<string>`coalesce(sum(${cashTransactions.amount}) filter (where ${cashTransactions.type} = 'out'), 0)::numeric(18,2)`,
    })
    .from(cashTransactions)
    .where(
      and(
        eq(cashTransactions.companyId, companyId),
        gte(cashTransactions.txDate, monthStart),
        or(isNull(cashTransactions.category), notInArray(cashTransactions.category, [TRANSFER_CATEGORY, OPENING_BALANCE_CATEGORY])),
      ),
    );

  const [sales] = await conn
    .select({ total: sql<string>`coalesce(sum(${salesOrders.totalAmount}), 0)::numeric(18,2)` })
    .from(salesOrders)
    .where(and(eq(salesOrders.companyId, companyId), gte(salesOrders.orderDate, monthStart), ne(salesOrders.status, "cancelled")));

  const [purchases] = await conn
    .select({ total: sql<string>`coalesce(sum(${purchaseOrders.totalAmount}), 0)::numeric(18,2)` })
    .from(purchaseOrders)
    .where(
      and(eq(purchaseOrders.companyId, companyId), gte(purchaseOrders.orderDate, monthStart), ne(purchaseOrders.status, "cancelled")),
    );

  const totalCash = totalOf("cash");
  const totalBank = totalOf("bank");
  return {
    totalCash: fromMinor(totalCash),
    totalBank: fromMinor(totalBank),
    totalBalance: fromMinor(totalCash + totalBank),
    monthIncome: cash!.income,
    monthExpense: cash!.expense,
    monthNetCash: fromMinor(toMinor(cash!.income) - toMinor(cash!.expense)),
    monthSalesTotal: sales!.total,
    monthPurchaseTotal: purchases!.total,
    accounts: accountList,
  };
}
