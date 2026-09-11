/**
 * Hisoblar rejasi va buxgalteriya hisobotlari (convex/finance/accounts.ts).
 *
 * Convex'dan farqlar:
 *  - seedDefaultAccounts moliya sahifasi ochilganda frontenddan chaqirilardi
 *    (ruxsat tekshiruvisiz) — endi kompaniya yaratilganda avtomatik; oldin
 *    yaratilgan kompaniyalar uchun `POST /api/finance/setup` (finance.manage)
 *  - hisob tahrirlash yo'q edi — nom, tavsif, ota hisob, faollik; kod va tur o'zgarmaydi
 *  - `list` ruxsat tekshirmasdi — `finance.view`
 *  - aylanma-saldo va foyda-zarar jurnal qatorlaridan hisoblanadi (keshlangan balansdan emas)
 */
import { and, asc, eq, getTableColumns, gte, lte, sql } from "drizzle-orm";
import { badRequest, conflict, notFound } from "@bum/shared";
import { accounts, cashAccounts, journalEntries, journalLines } from "../../db/schema/finance.js";
import { companies } from "../../db/schema/platform.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import { fromMinor, toMinor } from "../../shared/decimal.js";
import type { TenantContext } from "../company/tenant.js";

export type AccountType = (typeof accounts.type.enumValues)[number];

/** Subtype — boshqa modullar hisobni kod emas, shu bo'yicha topadi (journal.service). */
export const DEFAULT_ACCOUNTS: { code: string; name: string; type: AccountType; subtype: string }[] = [
  { code: "1010", name: "Naqd kassa", type: "asset", subtype: "cash" },
  { code: "1020", name: "Bank hisobi", type: "asset", subtype: "bank" },
  { code: "1100", name: "Debitorlar", type: "asset", subtype: "receivable" },
  { code: "1200", name: "Tovar zaxirasi", type: "asset", subtype: "inventory" },
  { code: "2000", name: "Kreditorlar", type: "liability", subtype: "payable" },
  { code: "2100", name: "Qisqa muddatli qarzlar", type: "liability", subtype: "short_debt" },
  { code: "2200", name: "Ish haqidan soliq majburiyati", type: "liability", subtype: "payroll_tax" },
  { code: "2300", name: "Mijozlar avanslari (balans)", type: "liability", subtype: "customer_advance" },
  { code: "2400", name: "Keshbek majburiyati", type: "liability", subtype: "cashback_liability" },
  { code: "3000", name: "Ustav kapitali", type: "equity", subtype: "capital" },
  { code: "4000", name: "Sotuv daromadi", type: "income", subtype: "sales" },
  { code: "4100", name: "Boshqa daromadlar", type: "income", subtype: "other" },
  { code: "5000", name: "Tovar tannarxi", type: "expense", subtype: "cogs" },
  { code: "5100", name: "Ish haqi xarajatlari", type: "expense", subtype: "salary" },
  { code: "5200", name: "Ijara xarajatlari", type: "expense", subtype: "rent" },
  { code: "5300", name: "Kommunal to'lovlar", type: "expense", subtype: "utilities" },
  { code: "5400", name: "Transport xarajatlari", type: "expense", subtype: "transport" },
  { code: "5500", name: "Boshqa xarajatlar", type: "expense", subtype: "other" },
  { code: "5600", name: "Keshbek xarajatlari", type: "expense", subtype: "cashback_expense" },
];

const { legacyId: _legacyId, companyId: _companyId, ...accountFields } = getTableColumns(accounts);

export function financeAudit(
  tx: Tx,
  tenant: TenantContext,
  meta: RequestMeta,
  entry: { action: string; resource: string; resourceId: string; details: Record<string, unknown> },
) {
  return writeAuditLog(
    { userId: tenant.user.id, userName: tenant.user.name, companyId: tenant.company.id, ...entry, ...meta },
    tx,
  );
}

export async function companyCurrency(conn: DbOrTx, companyId: string): Promise<string> {
  const [row] = await conn.select({ currency: companies.currency }).from(companies).where(eq(companies.id, companyId));
  return row?.currency ?? "UZS";
}

/** Standart hisoblar rejasi va ikki kassa. Idempotent — mavjudlari o'tkazib yuboriladi. */
export async function seedFinanceDefaults(tx: Tx, companyId: string, currency: string) {
  const inserted = await tx
    .insert(accounts)
    .values(DEFAULT_ACCOUNTS.map((account) => ({ ...account, companyId, currency })))
    .onConflictDoNothing()
    .returning({ id: accounts.id });

  const [anyCash] = await tx
    .select({ id: cashAccounts.id })
    .from(cashAccounts)
    .where(eq(cashAccounts.companyId, companyId))
    .limit(1);
  if (!anyCash) {
    await tx.insert(cashAccounts).values([
      { companyId, name: "Asosiy kassa", type: "cash", currency, isDefault: true },
      { companyId, name: "Asosiy bank hisobi", type: "bank", currency },
    ]);
  }
  return { accountsCreated: inserted.length, cashAccountsCreated: anyCash ? 0 : 2 };
}

export async function listAccounts(
  conn: DbOrTx,
  tenant: TenantContext,
  options: { type?: AccountType; includeInactive?: boolean },
) {
  return conn
    .select(accountFields)
    .from(accounts)
    .where(
      and(
        eq(accounts.companyId, tenant.company.id),
        options.type ? eq(accounts.type, options.type) : undefined,
        options.includeInactive ? undefined : eq(accounts.isActive, true),
      ),
    )
    .orderBy(asc(accounts.code));
}

/** Ota hisob shu kompaniyaniki va shu turda; zanjirda sikl yo'q. */
async function assertParent(tx: Tx, companyId: string, parentId: string, type: AccountType, selfId?: string) {
  let current: string | null = parentId;
  for (let depth = 0; current; depth++) {
    if (current === selfId) throw badRequest("Hisob o'ziga yoki o'z ichki hisobiga bo'ysuna olmaydi");
    if (depth > 20) throw badRequest("Hisoblar ierarxiyasi juda chuqur");
    const [parent] = await tx
      .select({ type: accounts.type, parentId: accounts.parentId })
      .from(accounts)
      .where(and(eq(accounts.id, current), eq(accounts.companyId, companyId)))
      .limit(1);
    if (!parent) throw badRequest("Ota hisob topilmadi");
    if (depth === 0 && parent.type !== type) throw badRequest("Ota hisob shu turdagi bo'lishi kerak");
    current = parent.parentId;
  }
}

export type AccountInput = {
  code: string;
  name: string;
  type: AccountType;
  subtype?: string | null;
  parentId?: string | null;
  description?: string | null;
};

export async function createAccount(tx: Tx, tenant: TenantContext, input: AccountInput, meta: RequestMeta) {
  const companyId = tenant.company.id;
  if (input.parentId) await assertParent(tx, companyId, input.parentId, input.type);

  const [account] = await tx
    .insert(accounts)
    .values({ ...input, companyId, currency: await companyCurrency(tx, companyId) })
    .returning(accountFields);

  await financeAudit(tx, tenant, meta, {
    action: "ACCOUNT_CREATED",
    resource: "accounts",
    resourceId: account!.id,
    details: { code: account!.code, name: account!.name, type: account!.type },
  });
  return account!;
}

export async function updateAccount(
  tx: Tx,
  tenant: TenantContext,
  accountId: string,
  patch: { name?: string; subtype?: string | null; parentId?: string | null; description?: string | null; isActive?: boolean },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const [current] = await tx
    .select(accountFields)
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.companyId, companyId)))
    .limit(1)
    .for("update");
  if (!current) throw notFound("Hisob topilmadi");

  if (patch.parentId) await assertParent(tx, companyId, patch.parentId, current.type, current.id);
  if (patch.isActive === false && current.isActive && toMinor(current.balance) !== 0n) {
    throw conflict("Balansi nol bo'lmagan hisobni faolsizlantirib bo'lmaydi");
  }

  const [updated] = await tx
    .update(accounts)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(accounts.id, accountId))
    .returning(accountFields);

  await financeAudit(tx, tenant, meta, {
    action: "ACCOUNT_UPDATED",
    resource: "accounts",
    resourceId: accountId,
    details: { changes: Object.keys(patch) },
  });
  return updated!;
}

// ─── Hisobotlar ──────────────────────────────────────────────────────────────

export type DateRange = { dateFrom?: string; dateTo?: string };

/** Aylanma-saldo: faqat o'tkazilgan (posted) yozuvlar; balans hisob turining normal tomonida. */
export async function trialBalance(conn: DbOrTx, tenant: TenantContext, range: DateRange) {
  const totals = conn
    .select({
      accountId: journalLines.accountId,
      debit: sql<string>`sum(${journalLines.debit})`.as("debit"),
      credit: sql<string>`sum(${journalLines.credit})`.as("credit"),
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(
      and(
        eq(journalLines.companyId, tenant.company.id),
        eq(journalEntries.status, "posted"),
        range.dateFrom ? gte(journalEntries.entryDate, range.dateFrom) : undefined,
        range.dateTo ? lte(journalEntries.entryDate, range.dateTo) : undefined,
      ),
    )
    .groupBy(journalLines.accountId)
    .as("totals");

  const rows = await conn
    .select({
      accountId: accounts.id,
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      debit: sql<string>`coalesce(${totals.debit}, 0)::numeric(18,2)`,
      credit: sql<string>`coalesce(${totals.credit}, 0)::numeric(18,2)`,
    })
    .from(accounts)
    .leftJoin(totals, eq(totals.accountId, accounts.id))
    .where(eq(accounts.companyId, tenant.company.id))
    .orderBy(asc(accounts.code));

  let totalDebit = 0n;
  let totalCredit = 0n;
  const result = rows
    .map((row) => {
      const debit = toMinor(row.debit);
      const credit = toMinor(row.credit);
      const debitNormal = row.type === "asset" || row.type === "expense";
      return { ...row, debitMinor: debit, creditMinor: credit, balance: fromMinor(debitNormal ? debit - credit : credit - debit) };
    })
    .filter((row) => row.debitMinor !== 0n || row.creditMinor !== 0n)
    .map(({ debitMinor, creditMinor, ...row }) => {
      totalDebit += debitMinor;
      totalCredit += creditMinor;
      return row;
    });

  return {
    rows: result,
    totalDebit: fromMinor(totalDebit),
    totalCredit: fromMinor(totalCredit),
    balanced: totalDebit === totalCredit,
  };
}

export async function profitAndLoss(conn: DbOrTx, tenant: TenantContext, range: DateRange) {
  const { rows } = await trialBalance(conn, tenant, range);
  const pick = (type: AccountType) =>
    rows.filter((r) => r.type === type).map((r) => ({ accountId: r.accountId, code: r.code, name: r.name, amount: r.balance }));
  const sum = (items: { amount: string }[]) => items.reduce((s, i) => s + toMinor(i.amount), 0n);

  const income = pick("income");
  const expenses = pick("expense");
  return {
    income,
    expenses,
    totalIncome: fromMinor(sum(income)),
    totalExpense: fromMinor(sum(expenses)),
    netProfit: fromMinor(sum(income) - sum(expenses)),
  };
}
