/**
 * Shared journal-entry helper for purchase and sales workflows.
 *
 * DESIGN:
 *   - All writes are inlined into the calling mutation's transaction
 *   - Duplicate protection: caller passes referenceType + referenceId
 *     If a posted JE for that reference already exists we return it instead of inserting
 *   - Debit = Credit is enforced by construction — every call receives a balanced pair of lines
 *   - All rows carry companyId from the calling mutation (never from frontend)
 *
 * ACCOUNT SUBTYPE LOOKUP ORDER:
 *   1. Prefer accounts.subtype match (deterministic)
 *   2. Fall back to DEFAULT_ACCOUNTS defined in accounts.ts
 *   3. If still missing, return null — caller decides whether to skip JE or throw
 */
import type { MutationCtx } from "../_generated/server.d.ts";
import type { Id } from "../_generated/dataModel.d.ts";
import { ConvexError } from "convex/values";

type AccountSubtype = string;

async function findAccount(
  ctx: MutationCtx,
  companyId: Id<"companies">,
  subtype: AccountSubtype,
): Promise<Id<"accounts"> | null> {
  const acc = await ctx.db
    .query("accounts")
    .filter((q) =>
      q.and(
        q.eq(q.field("companyId"), companyId),
        q.eq(q.field("subtype"), subtype),
        q.eq(q.field("isActive"), true),
      )
    )
    .first();
  return acc?._id ?? null;
}

async function nextJENumber(ctx: MutationCtx, companyId: Id<"companies">): Promise<string> {
  const year = new Date().getFullYear();
  const last = await ctx.db
    .query("journalEntries")
    .withIndex("by_company", (q) => q.eq("companyId", companyId))
    .order("desc")
    .first();
  const prefix = `JE-${year}-`;
  const seq =
    last && last.number.startsWith(prefix)
      ? parseInt(last.number.split("-")[2] ?? "0") + 1
      : 1;
  return `${prefix}${String(seq).padStart(5, "0")}`;
}

type JELine = {
  accountId: Id<"accounts">;
  debit: number;
  credit: number;
  description?: string;
};

/**
 * Insert a balanced journal entry inside a mutation transaction.
 * - Validates debit == credit before inserting.
 * - Idempotent: if a posted JE with the same referenceType+referenceId exists,
 *   returns its _id without inserting a duplicate.
 */
export async function createJournalEntry(
  ctx: MutationCtx,
  {
    companyId,
    date,
    description,
    referenceType,
    referenceId,
    lines,
  }: {
    companyId: Id<"companies">;
    date: string;
    description: string;
    referenceType: string;
    referenceId: string;
    lines: JELine[];
  }
): Promise<Id<"journalEntries">> {
  // IDEMPOTENCY: check if journal entry for this reference already exists
  if (referenceType && referenceId) {
    const existing = await ctx.db
      .query("journalEntries")
      .withIndex("by_reference", (q) =>
        q.eq("referenceType", referenceType).eq("referenceId", referenceId)
      )
      .filter((q) => q.and(
        q.eq(q.field("companyId"), companyId),
        q.neq(q.field("status"), "voided"),
      ))
      .first();
    if (existing) return existing._id;
  }

  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);

  // Enforce debit = credit (within 1 so'm rounding tolerance)
  if (Math.abs(totalDebit - totalCredit) > 1) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: `Journal entry balansi buzildi: Debet ${totalDebit} ≠ Kredit ${totalCredit}`,
    });
  }

  const number = await nextJENumber(ctx, companyId);
  const entryId = await ctx.db.insert("journalEntries", {
    number,
    date,
    description,
    referenceType,
    referenceId,
    status: "posted",
    totalDebit,
    totalCredit,
    companyId,
  });

  for (const line of lines) {
    await ctx.db.insert("journalLines", {
      entryId,
      accountId: line.accountId,
      debit: line.debit,
      credit: line.credit,
      description: line.description,
      companyId,
    });
  }

  // Update account balances: asset/expense increase with debit; liability/equity/income increase with credit
  for (const line of lines) {
    const acct = await ctx.db.get(line.accountId);
    if (!acct || acct.companyId !== companyId) continue;
    let delta = 0;
    if (acct.type === "asset" || acct.type === "expense") {
      delta = line.debit - line.credit;
    } else {
      delta = line.credit - line.debit;
    }
    await ctx.db.patch(line.accountId, { balance: acct.balance + delta });
  }

  return entryId;
}

/**
 * Update the default cash account balance and insert a cash transaction.
 * - Idempotent: if a cashTransaction with same referenceType+referenceId already exists,
 *   skips insertion (prevents duplicate on retry/double-click).
 */
export async function recordCashTransaction(
  ctx: MutationCtx,
  {
    companyId,
    cashAccountId,
    type,
    amount,
    description,
    date,
    referenceType,
    referenceId,
    category,
  }: {
    companyId: Id<"companies">;
    cashAccountId: Id<"cashAccounts"> | null;
    type: "in" | "out";
    amount: number;
    description: string;
    date: string;
    referenceType: string;
    referenceId: string;
    category?: string;
  }
): Promise<Id<"cashTransactions"> | null> {
  // Resolve cash account
  let accountId = cashAccountId;
  if (!accountId) {
    const defaultAcc = await ctx.db
      .query("cashAccounts")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .filter((q) => q.and(
        q.eq(q.field("isActive"), true),
        q.eq(q.field("isDefault"), true),
      ))
      .first();
    accountId = defaultAcc?._id ?? null;
  }
  if (!accountId) return null;

  // Verify ownership
  const account = await ctx.db.get(accountId);
  if (!account || account.companyId !== companyId) return null;

  // IDEMPOTENCY: check for existing transaction with this reference
  const existing = await ctx.db
    .query("cashTransactions")
    .withIndex("by_reference", (q) =>
      q.eq("referenceType", referenceType).eq("referenceId", referenceId)
    )
    .filter((q) => q.eq(q.field("companyId"), companyId))
    .first();
  if (existing) return existing._id;

  const delta = type === "in" ? amount : -amount;
  const newBalance = account.balance + delta;

  await ctx.db.patch(accountId, { balance: newBalance });

  return ctx.db.insert("cashTransactions", {
    cashAccountId: accountId,
    type,
    amount,
    currency: account.currency,
    date,
    description,
    category,
    referenceType,
    referenceId,
    balanceAfter: newBalance,
    companyId,
  });
}

/**
 * Build journal entry lines for a supplier payment.
 * DR Kreditorlar (2000) / CR Cash/Bank (1010/1020)
 */
export async function buildSupplierPaymentJELines(
  ctx: MutationCtx,
  companyId: Id<"companies">,
  amount: number,
  method: "cash" | "bank" | "card" | "transfer",
): Promise<JELine[] | null> {
  const payableId = await findAccount(ctx, companyId, "payable");
  // cash/card → cash subtype; bank/transfer → bank subtype
  const cashSubtype = method === "cash" || method === "card" ? "cash" : "bank";
  const cashId = await findAccount(ctx, companyId, cashSubtype);

  if (!payableId || !cashId) return null;

  return [
    { accountId: payableId, debit: amount, credit: 0, description: "Kreditor qarz to'lovi" },
    { accountId: cashId, debit: 0, credit: amount, description: "Kassa/bank chiqimi" },
  ];
}

/**
 * Build journal entry lines for goods receipt (inventory purchase).
 * DR Tovar zaxirasi (1200) / CR Kreditorlar (2000)
 */
export async function buildGoodsReceiptJELines(
  ctx: MutationCtx,
  companyId: Id<"companies">,
  amount: number,
): Promise<JELine[] | null> {
  const inventoryId = await findAccount(ctx, companyId, "inventory");
  const payableId = await findAccount(ctx, companyId, "payable");

  if (!inventoryId || !payableId) return null;

  return [
    { accountId: inventoryId, debit: amount, credit: 0, description: "Tovar kirim" },
    { accountId: payableId, debit: 0, credit: amount, description: "Kreditor qarz vujudga keldi" },
  ];
}

/**
 * Build journal entry lines for a sale shipment (perpetual inventory).
 * Revenue line: DR Cash/Receivable / CR Revenue (4000)
 * COGS line:    DR COGS (5000) / CR Inventory (1200)
 */
export async function buildSaleShipJELines(
  ctx: MutationCtx,
  companyId: Id<"companies">,
  revenue: number,
  cogs: number,
  isPOS: boolean,
): Promise<JELine[] | null> {
  // POS = immediate cash; credit sales = receivable
  const arSubtype = isPOS ? "cash" : "receivable";
  const arId = await findAccount(ctx, companyId, arSubtype);
  const revenueId = await findAccount(ctx, companyId, "sales");
  const cogsId = await findAccount(ctx, companyId, "cogs");
  const inventoryId = await findAccount(ctx, companyId, "inventory");

  if (!arId || !revenueId || !cogsId || !inventoryId) return null;

  const lines: JELine[] = [];
  if (revenue > 0) {
    lines.push(
      { accountId: arId, debit: revenue, credit: 0, description: "Sotuv tushumi" },
      { accountId: revenueId, debit: 0, credit: revenue, description: "Sotuv daromadi" },
    );
  }
  if (cogs > 0) {
    lines.push(
      { accountId: cogsId, debit: cogs, credit: 0, description: "Tovar tannarxi" },
      { accountId: inventoryId, debit: 0, credit: cogs, description: "Inventar kamaytirish" },
    );
  }
  return lines.length >= 2 ? lines : null;
}

/**
 * Build journal entry lines for a customer payment receipt.
 * DR Cash/Bank / CR Receivable (if credit sale was used, partial payment)
 * For POS this is already captured at shipment — skip to avoid double entry.
 */
export async function buildCustomerPaymentJELines(
  ctx: MutationCtx,
  companyId: Id<"companies">,
  amount: number,
  method: "cash" | "card" | "bank" | "transfer",
): Promise<JELine[] | null> {
  const cashSubtype = method === "cash" || method === "card" ? "cash" : "bank";
  const cashId = await findAccount(ctx, companyId, cashSubtype);
  const arId = await findAccount(ctx, companyId, "receivable");

  if (!cashId || !arId) return null;

  return [
    { accountId: cashId, debit: amount, credit: 0, description: "Mijoz to'lovi kirimi" },
    { accountId: arId, debit: 0, credit: amount, description: "Debitor qarz yopilishi" },
  ];
}
