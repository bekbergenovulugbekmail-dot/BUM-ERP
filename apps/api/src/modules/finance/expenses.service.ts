/**
 * Xarajatlar (convex/finance/expenses.ts).
 *
 * Holatlar: pending → approved → paid (paid — yakuniy); approved → pending qaytarish mumkin.
 *
 * Convex'dan farqlar:
 *  - `updateStatus` istalgan holatga o'tkazardi (paid → pending ham), "to'landi"
 *    kassadan pul chiqarmas va jurnalga yozmasdi — endi to'lov: kassa chiqimi +
 *    DR xarajat hisobi / CR kassa (bank), bitta tranzaksiyada
 *  - raqam `oxirgi + 1` edi — parallel yaratishda takrorlanardi (advisory lock)
 *  - xarajatni tahrirlash yo'q edi — faqat kutilayotgan holatda
 *  - `list`, `getStats` ruxsat tekshirmasdi — `finance.view`; statistika oxirgi 500 ta
 *    emas, barcha yozuvlardan
 */
import { and, desc, eq, getTableColumns, gte, lt, lte, or, sql } from "drizzle-orm";
import { ALLOCATION_METHODS, badRequest, forbidden, notFound } from "@bum/shared";
import { accounts, expenses } from "../../db/schema/finance.js";
import { employees } from "../../db/schema/hr.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { UUID_RE, decodeCursor, encodeCursor } from "../../shared/cursor.js";
import { fromMinor, toMinor } from "../../shared/decimal.js";
import { nextDocumentNumber } from "../../shared/numbering.js";
import type { TenantContext } from "../company/tenant.js";
import { companyCurrency, financeAudit } from "./accounts.service.js";
import { ledgerAccountFor, recordCashTransaction, todayIso } from "./cash.service.js";
import { assertPeriodOpen, findAccountBySubtype, postJournalEntry, requireAccountBySubtype } from "./journal.service.js";
import { applyOutgoingBankCommission } from "./bank-commission.service.js";
import { resolvePaymentParts, type PaymentPartInput } from "./payment-parts.service.js";

const { legacyId: _legacyId, companyId: _companyId, ...expenseFields } = getTableColumns(expenses);

export type ExpenseStatus = (typeof expenses.status.enumValues)[number];

const TRANSITIONS: Record<ExpenseStatus, ExpenseStatus[]> = {
  pending: ["approved"],
  approved: ["pending", "paid"],
  paid: [],
};

/** Frontend kategoriyalari → hisoblar rejasi; qolganlari "Boshqa xarajatlar". */
const CATEGORY_SUBTYPES: Record<string, string> = {
  ijara: "rent",
  maosh: "salary",
  kommunal: "utilities",
  transport: "transport",
};

/** Xodimga to'lov turlari: maosh yoki kompensatsiya (yo'l, ovqat, aloqa, turar joy, boshqa). */
export const PAYOUT_KINDS = ["salary", "transport", "meal", "phone", "housing", "other"] as const;
export type PayoutKind = (typeof PAYOUT_KINDS)[number];

export type ExpenseInput = {
  category: string;
  description: string;
  amount: string;
  expenseDate: string;
  accountId?: string | null;
  paidBy?: string | null;
  notes?: string | null;
  /** Xarajat qaysi xodimga tegishli (maosh, ovqat puli, yo'l haqi). */
  employeeId?: string | null;
  /** Xodim tanlanganda to'lov turi majburiy — hisobotda nima uchun berilgani aniq bo'lsin. */
  payoutKind?: PayoutKind | null;
};

/** Xodim shu kompaniyaniki ekanini tekshiradi (FK yo'q — hr va finance orasida aylanma import bo'lmasin). */
async function assertExpenseEmployee(tx: Tx, companyId: string, employeeId: string) {
  const [employee] = await tx
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.companyId, companyId)))
    .limit(1);
  if (!employee) throw notFound("Xodim topilmadi");
}

async function assertExpenseAccount(tx: Tx, companyId: string, accountId: string) {
  const [account] = await tx
    .select({ type: accounts.type, isActive: accounts.isActive })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.companyId, companyId)))
    .limit(1);
  if (!account) throw badRequest("Hisob topilmadi");
  if (account.type !== "expense") throw badRequest("Xarajat hisobi tanlanishi kerak");
  if (!account.isActive) throw badRequest("Hisob faol emas");
}

async function lockExpense(tx: Tx, tenant: TenantContext, expenseId: string) {
  const [expense] = await tx
    .select(expenseFields)
    .from(expenses)
    .where(and(eq(expenses.id, expenseId), eq(expenses.companyId, tenant.company.id)))
    .limit(1)
    .for("update");
  if (!expense) throw notFound("Xarajat topilmadi");
  return expense;
}

export async function listExpenses(
  conn: DbOrTx,
  tenant: TenantContext,
  options: {
    status?: ExpenseStatus;
    category?: string;
    dateFrom?: string;
    dateTo?: string;
    limit: number;
    cursor?: string;
  },
) {
  let after: { date: string; id: string } | null = null;
  if (options.cursor) {
    const [date, id] = decodeCursor(options.cursor, 2) as [string, string];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !UUID_RE.test(id)) throw badRequest("Kursor noto'g'ri");
    after = { date, id };
  }

  const rows = await conn
    .select(expenseFields)
    .from(expenses)
    .where(
      and(
        eq(expenses.companyId, tenant.company.id),
        options.status ? eq(expenses.status, options.status) : undefined,
        options.category ? eq(expenses.category, options.category) : undefined,
        options.dateFrom ? gte(expenses.expenseDate, options.dateFrom) : undefined,
        options.dateTo ? lte(expenses.expenseDate, options.dateTo) : undefined,
        after
          ? or(lt(expenses.expenseDate, after.date), and(eq(expenses.expenseDate, after.date), lt(expenses.id, after.id)))
          : undefined,
      ),
    )
    .orderBy(desc(expenses.expenseDate), desc(expenses.id))
    .limit(options.limit + 1);

  const page = rows.slice(0, options.limit);
  const last = page.at(-1);
  return {
    expenses: page,
    nextCursor: rows.length > options.limit && last ? encodeCursor([last.expenseDate, last.id]) : null,
  };
}

export async function expenseStats(conn: DbOrTx, tenant: TenantContext) {
  const companyId = tenant.company.id;
  const monthStart = `${todayIso().slice(0, 7)}-01`;

  const [totals] = await conn
    .select({
      totalThisMonth: sql<string>`coalesce(sum(${expenses.amount}) filter (where ${expenses.expenseDate} >= ${monthStart}), 0)::numeric(18,2)`,
      countThisMonth: sql<number>`(count(*) filter (where ${expenses.expenseDate} >= ${monthStart}))::int`,
      pendingCount: sql<number>`(count(*) filter (where ${expenses.status} = 'pending'))::int`,
      pendingAmount: sql<string>`coalesce(sum(${expenses.amount}) filter (where ${expenses.status} = 'pending'), 0)::numeric(18,2)`,
    })
    .from(expenses)
    .where(eq(expenses.companyId, companyId));

  const byCategory = await conn
    .select({ category: expenses.category, total: sql<string>`sum(${expenses.amount})::numeric(18,2)` })
    .from(expenses)
    .where(and(eq(expenses.companyId, companyId), gte(expenses.expenseDate, monthStart)))
    .groupBy(expenses.category)
    .orderBy(desc(sql`sum(${expenses.amount})`));

  return { ...totals!, byCategory };
}

export async function createExpense(tx: Tx, tenant: TenantContext, input: ExpenseInput, meta: RequestMeta) {
  const companyId = tenant.company.id;
  await assertPeriodOpen(tx, companyId, input.expenseDate);
  if (input.accountId) await assertExpenseAccount(tx, companyId, input.accountId);
  if (input.employeeId) {
    await assertExpenseEmployee(tx, companyId, input.employeeId);
    if (!input.payoutKind) throw badRequest("Xodim tanlanganda to'lov turini ko'rsating (maosh, ovqat puli, yo'l haqi...)");
  } else if (input.payoutKind) {
    throw badRequest("To'lov turi faqat xodim tanlanganda ko'rsatiladi");
  }

  const number = await nextDocumentNumber(tx, {
    table: expenses,
    column: expenses.number,
    companyColumn: expenses.companyId,
    companyId,
    prefix: `EXP-${input.expenseDate.slice(0, 4)}-`,
    width: 4,
  });

  const [expense] = await tx
    .insert(expenses)
    .values({
      ...input,
      number,
      companyId,
      currency: await companyCurrency(tx, companyId),
      createdBy: tenant.user.id,
    })
    .returning(expenseFields);

  await financeAudit(tx, tenant, meta, {
    action: "EXPENSE_CREATED",
    resource: "expenses",
    resourceId: expense!.id,
    details: { number, category: input.category, amount: expense!.amount },
  });
  return expense!;
}

export async function updateExpense(
  tx: Tx,
  tenant: TenantContext,
  expenseId: string,
  patch: Partial<ExpenseInput>,
  meta: RequestMeta,
) {
  const expense = await lockExpense(tx, tenant, expenseId);
  if (expense.status !== "pending") throw badRequest("Faqat kutilayotgan xarajatni tahrirlash mumkin");
  if (patch.accountId) await assertExpenseAccount(tx, tenant.company.id, patch.accountId);
  if (patch.expenseDate) await assertPeriodOpen(tx, tenant.company.id, patch.expenseDate);

  const [updated] = await tx
    .update(expenses)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(expenses.id, expenseId))
    .returning(expenseFields);

  await financeAudit(tx, tenant, meta, {
    action: "EXPENSE_UPDATED",
    resource: "expenses",
    resourceId: expenseId,
    details: { changes: Object.keys(patch) },
  });
  return updated!;
}

/**
 * Xarajat to'lovi: kassa (bank) chiqimi + DR xarajat hisobi / CR kassa (bank). Web'da "to'landi" holati va kassadan
 * xarajat (POS smenasi) shu yerdan. `allowOverdraft` — faqat offline kassa sinxroni (pul allaqachon berilgan).
 *
 * `parts` berilsa — ARALASH to'lov (naqd + UZCARD + bank). Qismlar mijoz to'lovlaridagi bilan bir xil universal
 * qatlamda tekshiriladi (`resolvePaymentParts`: usul, terminal → bank hisobi, hisob turi va valyutasi). Xarajatning
 * "to'landi" holati bo'linmaydi, shuning uchun qismlar yig'indisi xarajat summasiga AYNAN teng bo'lishi shart.
 *
 * Har qism o'z hisobidan alohida chiqim bo'ladi, jurnal esa BITTA yozuv: DR xarajat (jami) / CR har bir hisob
 * o'z ulushi bilan. Sabab: jurnal yozuvi `(referenceType, referenceId)` bo'yicha takrorlanmaydi — har qismga
 * alohida yozuv urinilsa, ikkinchisi va uchinchisi jimgina birinchisiga qaytardi va pul jurnalsiz chiqib ketardi.
 */
export async function postExpensePayment(
  tx: Tx,
  tenant: TenantContext,
  expense: { id: string; number: string; description: string; category: string; amount: string; currency: string; accountId: string | null },
  input: { cashAccountId?: string | null; paidDate: string; allowOverdraft?: boolean; parts?: PaymentPartInput[] },
) {
  const companyId = tenant.company.id;
  const description = `${expense.number}: ${expense.description}`;

  const mapped = CATEGORY_SUBTYPES[expense.category];
  const debitAccount =
    expense.accountId ??
    (mapped ? await findAccountBySubtype(tx, companyId, mapped, "expense") : null) ??
    (await requireAccountBySubtype(tx, companyId, "other", "expense", "Boshqa xarajatlar"));

  /** Bitta hisobdan chiqim: kassa harakati + bank komissiyasi; jurnal qatori qaytariladi. */
  const payFrom = async (cashAccountId: string | null, amount: string) => {
    const { transaction, account } = await recordCashTransaction(tx, companyId, tenant.user.id, {
      cashAccountId,
      type: "out",
      amount,
      txDate: input.paidDate,
      description,
      category: expense.category,
      referenceType: "expense",
      referenceId: expense.id,
      allowOverdraft: input.allowOverdraft,
    });
    if (account.currency !== expense.currency) throw badRequest("Kassa valyutasi xarajat valyutasiga mos emas");
    await applyOutgoingBankCommission(tx, tenant, {
      cashAccountId: account.id,
      amount,
      date: input.paidDate,
      description,
      sourceType: "expense",
      sourceId: expense.id,
      allowOverdraft: input.allowOverdraft,
    });
    return { transactionId: transaction.id, creditLine: { accountId: await ledgerAccountFor(tx, companyId, account), credit: amount } };
  };

  let posted: { transactionId: string; creditLine: { accountId: string; credit: string } }[];
  if (input.parts?.length) {
    const resolved = await resolvePaymentParts(tx, companyId, input.parts, {
      allowedMethods: ALLOCATION_METHODS,
      offline: input.allowOverdraft,
    });
    if (resolved.length === 0) throw badRequest("To'lov summasi kiritilmagan");
    const total = resolved.reduce((sum, part) => sum + part.amount, 0n);
    const due = toMinor(expense.amount);
    if (total !== due) {
      throw badRequest(`Qismlar yig'indisi xarajat summasiga teng bo'lishi kerak (${expense.amount})`, {
        reason: total > due ? "overpayment" : "underpayment",
        total: expense.amount,
        paid: fromMinor(total),
      });
    }
    // Ikki qism bitta hisobdan bo'lsa kassa harakati takrorlanmaydi (u ham hisob bo'yicha noyob) — jimgina yo'qolmasin
    const accountsUsed = resolved.map((part) => part.cashAccountId).filter((id): id is string => id !== null);
    if (new Set(accountsUsed).size !== accountsUsed.length) {
      throw badRequest("Bitta hisob ikki marta kiritilgan — qismlarni birlashtiring");
    }
    posted = [];
    for (const part of resolved) posted.push(await payFrom(part.cashAccountId, fromMinor(part.amount)));
  } else {
    posted = [await payFrom(input.cashAccountId ?? null, expense.amount)];
  }

  const { entry } = await postJournalEntry(tx, companyId, tenant.user.id, {
    entryDate: input.paidDate,
    description: `Xarajat ${expense.number}: ${expense.description}`,
    referenceType: "expense",
    referenceId: expense.id,
    lines: [{ accountId: debitAccount, debit: expense.amount, description: expense.category }, ...posted.map((item) => item.creditLine)],
  });
  return { cashTransactionId: posted[0]!.transactionId, journalEntryId: entry.id, parts: posted.length };
}

export async function setExpenseStatus(
  tx: Tx,
  tenant: TenantContext,
  expenseId: string,
  input: { status: ExpenseStatus; cashAccountId?: string | null; paidDate?: string; parts?: PaymentPartInput[] },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const expense = await lockExpense(tx, tenant, expenseId);
  if (!TRANSITIONS[expense.status].includes(input.status)) {
    throw badRequest(`Holatni o'zgartirib bo'lmaydi: ${expense.status} → ${input.status}`);
  }
  // Vazifalar ajratimi: xarajatni kiritgan xodim uni o'zi tasdiqlamaydi (kompaniya egasidan tashqari)
  if (input.status === "approved" && expense.createdBy === tenant.user.id && tenant.company.ownerId !== tenant.user.id) {
    throw forbidden("O'zingiz kiritgan xarajatni tasdiqlay olmaysiz — boshqa mas'ul tasdiqlaydi");
  }

  let payment: { cashTransactionId: string; journalEntryId: string } | null = null;
  if (input.status === "paid") {
    // Audit AUD-011: foydalanuvchi tanlagan sana yopilgan davrga tushmasin (oflayn kassa sinxroni — istisno)
    await assertPeriodOpen(tx, companyId, input.paidDate ?? todayIso());
    payment = await postExpensePayment(tx, tenant, expense, {
      cashAccountId: input.cashAccountId,
      paidDate: input.paidDate ?? todayIso(),
      parts: input.parts,
    });
  }

  const [updated] = await tx
    .update(expenses)
    .set({ status: input.status, updatedAt: new Date() })
    .where(eq(expenses.id, expenseId))
    .returning(expenseFields);

  await financeAudit(tx, tenant, meta, {
    action: "EXPENSE_STATUS_CHANGED",
    resource: "expenses",
    resourceId: expenseId,
    details: { number: expense.number, from: expense.status, to: input.status, ...payment },
  });
  return { expense: updated!, payment };
}

export async function deleteExpense(tx: Tx, tenant: TenantContext, expenseId: string, meta: RequestMeta) {
  const expense = await lockExpense(tx, tenant, expenseId);
  if (expense.status === "paid") throw badRequest("To'langan xarajat o'chirilmaydi");
  // Tasdiqlangan xarajat — boshqa mas'ul qarori; uni izsiz o'chirib bo'lmaydi (avval "kutilmoqda" ga qaytariladi)
  if (expense.status !== "pending") throw badRequest("Faqat kutilayotgan xarajat o'chiriladi — tasdiqni avval bekor qiling");

  await tx.delete(expenses).where(eq(expenses.id, expenseId));
  await financeAudit(tx, tenant, meta, {
    action: "EXPENSE_DELETED",
    resource: "expenses",
    resourceId: expenseId,
    details: { number: expense.number, amount: expense.amount },
  });
}
