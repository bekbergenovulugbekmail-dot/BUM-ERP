/**
 * Mijozning BANK ORQALI to'lovi (bank tushumi) — xodim kiritadi: bank hisobi, summa, sana, bank hujjati raqami, izoh.
 *
 * Bitta hujjat (`payments`, source = `bank_receipt`), bitta tranzaksiya:
 *   qarzgacha qism  → `recordCustomerPayment` (method = bank): DR bank / CR 1100 Debitorlar, ochiq hujjatlarga taqsimot,
 *                      mijoz qarzi kamayadi
 *   qolgan qism     → `depositToBalance`: DR bank / CR 2300 Mijozlar avanslari, mijoz hamyoni (avans) oshadi
 * Qarz bo'lmasa — hammasi avans. Balans QO'LDA o'zgartirilmaydi: har ikki qism mavjud yagona yo'llar orqali yoziladi
 * (kassa harakati + kontragentli jurnal + tarix qatori), shuning uchun mijoz akti, qarz yoshi va bank hisobi mos keladi.
 *
 * Himoya:
 *  - hisob faqat shu kompaniyaning FAOL BANK hisobi, asosiy valyutada;
 *  - `expectedAdvance` — foydalanuvchi ko'rib tasdiqlagan taqsimot; qarz shu orada o'zgargan bo'lsa 409 (qayta ko'rish);
 *  - `requestId` — takroriy yuborish ikkinchi tushum yaratmaydi; bank hujjati raqami shu hisobda takrorlanmaydi;
 *  - yopilgan davrga yozilmaydi.
 *
 * Bekor qilish (`reverseBankReceipt`): hujjatning qarz qismi `reverseCustomerPayment` orqali (u avans qismini ham
 * birga bekor qiladi), faqat avansdan iborat hujjat — `reverseBalanceDeposit` orqali. Hech narsa o'chirilmaydi.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { badRequest, conflict, notFound } from "@bum/shared";
import { cashAccounts } from "../../db/schema/finance.js";
import { customerBalanceTransactions, customerPayments, customers, payments } from "../../db/schema/sales.js";
import { users } from "../../db/schema/platform.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { fromMinor, toMinor } from "../../shared/decimal.js";
import type { TenantContext } from "../company/tenant.js";
import { companyCurrency } from "../finance/accounts.service.js";
import { ledgerAccountFor, recordCashTransaction, todayIso } from "../finance/cash.service.js";
import { assertPeriodOpen, ensureAccountBySubtype, postJournalEntry } from "../finance/journal.service.js";
import { depositToBalance } from "./customer-balance.service.js";
import { salesAudit } from "./customers.service.js";
import { createPaymentHeader } from "./payment-allocation.service.js";
import { recordCustomerPayment } from "./payments.service.js";

export type BankReceiptInput = {
  customerId: string;
  cashAccountId: string;
  amount: string;
  paymentDate?: string;
  reference?: string | null;
  notes?: string | null;
  /** Foydalanuvchi ko'rgan avans qismi — server hisobi bilan mos kelmasa (qarz o'zgargan) 409. */
  expectedAdvance?: string;
  requestId?: string;
};

/** Taqsimot: qarzgacha — to'lov, qolgani — avans. Qarz manfiy (ortiqcha to'langan) bo'lsa — hammasi avans. */
export function splitBankReceipt(amount: bigint, debt: bigint) {
  const open = debt > 0n ? debt : 0n;
  const toDebt = amount < open ? amount : open;
  return { toDebt, toAdvance: amount - toDebt };
}

async function bankAccount(conn: DbOrTx, companyId: string, accountId: string) {
  const [account] = await conn
    .select({ id: cashAccounts.id, name: cashAccounts.name, type: cashAccounts.type, currency: cashAccounts.currency, isActive: cashAccounts.isActive })
    .from(cashAccounts)
    .where(and(eq(cashAccounts.id, accountId), eq(cashAccounts.companyId, companyId)))
    .limit(1);
  if (!account) throw notFound("Bank hisobi topilmadi");
  if (account.type !== "bank") throw badRequest("Bank tushumi faqat BANK hisobiga yoziladi (kassa emas)");
  if (!account.isActive) throw badRequest("Bank hisobi faol emas");
  if (account.currency !== (await companyCurrency(conn, companyId))) {
    throw badRequest(`"${account.name}" ${account.currency} valyutasida — bank tushumi asosiy valyutada kiritiladi`);
  }
  return account;
}

/** Tanlash uchun: faol bank hisoblari asosiy valyutada (qoldiqsiz — kiritgan xodimga hisob qoldig'i ko'rsatilmaydi). */
export async function bankReceiptAccounts(conn: DbOrTx, tenant: TenantContext) {
  const currency = await companyCurrency(conn, tenant.company.id);
  return conn
    .select({ id: cashAccounts.id, name: cashAccounts.name, bankName: cashAccounts.bankName, isDefault: cashAccounts.isDefault })
    .from(cashAccounts)
    .where(
      and(
        eq(cashAccounts.companyId, tenant.company.id),
        eq(cashAccounts.type, "bank"),
        eq(cashAccounts.isActive, true),
        eq(cashAccounts.currency, currency),
      ),
    )
    .orderBy(desc(cashAccounts.isDefault), asc(cashAccounts.name));
}

/** Ko'rib chiqish: qancha qarzga, qancha avansga ketadi (hech narsa yozilmaydi). */
export async function previewBankReceipt(conn: DbOrTx, tenant: TenantContext, input: { customerId: string; amount: string }) {
  const amount = toMinor(input.amount);
  if (amount <= 0n) throw badRequest("Summa musbat bo'lishi kerak");
  const [customer] = await conn
    .select({ id: customers.id, name: customers.name, totalDebt: customers.totalDebt, balance: customers.balance })
    .from(customers)
    .where(and(eq(customers.id, input.customerId), eq(customers.companyId, tenant.company.id)))
    .limit(1);
  if (!customer) throw notFound("Mijoz topilmadi");
  const { toDebt, toAdvance } = splitBankReceipt(amount, toMinor(customer.totalDebt));
  return {
    customer: { id: customer.id, name: customer.name },
    amount: fromMinor(amount),
    toDebt: fromMinor(toDebt),
    toAdvance: fromMinor(toAdvance),
    debtBefore: customer.totalDebt,
    debtAfter: fromMinor(toMinor(customer.totalDebt) - toDebt),
    advanceBefore: customer.balance,
    advanceAfter: fromMinor(toMinor(customer.balance) + toAdvance),
  };
}

export async function recordBankReceipt(tx: Tx, tenant: TenantContext, input: BankReceiptInput, meta: RequestMeta) {
  const companyId = tenant.company.id;
  const amount = toMinor(input.amount);
  if (amount <= 0n) throw badRequest("Summa musbat bo'lishi kerak");
  const paymentDate = input.paymentDate ?? todayIso();
  if (paymentDate > todayIso()) throw badRequest("Kelajakdagi sana bilan bank tushumi kiritilmaydi");
  await assertPeriodOpen(tx, companyId, paymentDate);
  const account = await bankAccount(tx, companyId, input.cashAccountId);
  const reference = input.reference?.trim() || null;
  const idempotencyKey = input.requestId ? `bank_receipt:${input.requestId}` : null;

  if (idempotencyKey) {
    const [existing] = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(and(eq(payments.companyId, companyId), eq(payments.idempotencyKey, idempotencyKey)))
      .limit(1);
    if (existing) return { ...(await bankReceiptDetail(tx, tenant, existing.id)), created: false };
  }
  if (reference) {
    const [duplicate] = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          eq(payments.companyId, companyId),
          eq(payments.source, "bank_receipt"),
          eq(payments.cashAccountId, account.id),
          eq(payments.reference, reference),
          eq(payments.status, "posted"),
        ),
      )
      .limit(1);
    if (duplicate) throw conflict(`"${reference}" raqamli bank hujjati bu hisobda allaqachon kiritilgan`, { paymentId: duplicate.id });
  }

  // Mijoz qulflanadi — qarz o'qilgandan keyin boshqa to'lov uni o'zgartira olmaydi
  const [customer] = await tx
    .select({ id: customers.id, name: customers.name, totalDebt: customers.totalDebt, isActive: customers.isActive })
    .from(customers)
    .where(and(eq(customers.id, input.customerId), eq(customers.companyId, companyId)))
    .limit(1)
    .for("update");
  if (!customer) throw notFound("Mijoz topilmadi");
  const { toDebt, toAdvance } = splitBankReceipt(amount, toMinor(customer.totalDebt));
  if (input.expectedAdvance !== undefined && toMinor(input.expectedAdvance) !== toAdvance) {
    throw conflict("Mijoz qarzi o'zgargan — taqsimotni qayta ko'rib tasdiqlang", {
      reason: "split_changed",
      toDebt: fromMinor(toDebt),
      toAdvance: fromMinor(toAdvance),
    });
  }
  if (toAdvance > 0n && !customer.isActive) throw badRequest("Mijoz faol emas — avans qabul qilinmaydi");

  const header = await createPaymentHeader(tx, tenant, { source: "bank_receipt", idempotencyKey, customerId: customer.id, total: amount });
  await tx
    .update(payments)
    .set({ reference, notes: input.notes?.trim() || null, cashAccountId: account.id, paymentDate })
    .where(eq(payments.id, header.id));

  const label = `Bank tushumi${reference ? ` №${reference}` : ""}: ${customer.name}`;
  let paymentPartId: string | null = null;
  if (toDebt > 0n) {
    const { payment } = await recordCustomerPayment(
      tx,
      tenant,
      {
        customerId: customer.id,
        amount: fromMinor(toDebt),
        paymentDate,
        method: "bank",
        cashAccountId: account.id,
        notes: input.notes?.trim() || (reference ? `Bank hujjati №${reference}` : null),
        paymentId: header.id,
      },
      meta,
    );
    paymentPartId = payment.id;
  }
  let advanceId: string | null = null;
  if (toAdvance > 0n) {
    const deposit = await depositToBalance(
      tx,
      tenant,
      {
        customerId: customer.id,
        type: "deposit",
        amount: fromMinor(toAdvance),
        method: "bank",
        cashAccountId: account.id,
        date: paymentDate,
        notes: `${label} — avans${input.notes?.trim() ? ` (${input.notes.trim()})` : ""}`,
        description: `${label} — avans`,
        paymentHeaderId: header.id,
      },
      meta,
    );
    advanceId = deposit.id;
  }

  await salesAudit(tx, tenant, meta, {
    action: "BANK_RECEIPT_RECORDED",
    resource: "payments",
    resourceId: header.id,
    details: {
      customerId: customer.id,
      cashAccountId: account.id,
      amount: fromMinor(amount),
      toDebt: fromMinor(toDebt),
      toAdvance: fromMinor(toAdvance),
      reference,
      paymentDate,
      paymentPartId,
      advanceId,
    },
  });
  return { ...(await bankReceiptDetail(tx, tenant, header.id)), created: true };
}

/** Bitta bank tushumi: hujjat, qismlari (qarz to'lovi va avans) va holati. */
export async function bankReceiptDetail(conn: DbOrTx, tenant: TenantContext, paymentId: string) {
  const [header] = await conn
    .select({
      id: payments.id,
      customerId: payments.customerId,
      customerName: customers.name,
      totalAmount: payments.totalAmount,
      status: payments.status,
      reference: payments.reference,
      notes: payments.notes,
      paymentDate: payments.paymentDate,
      cashAccountId: payments.cashAccountId,
      cashAccountName: cashAccounts.name,
      createdAt: payments.createdAt,
      createdByName: users.name,
      reversedAt: payments.reversedAt,
      reversalReason: payments.reversalReason,
    })
    .from(payments)
    .leftJoin(customers, eq(customers.id, payments.customerId))
    .leftJoin(cashAccounts, eq(cashAccounts.id, payments.cashAccountId))
    .leftJoin(users, eq(users.id, payments.createdBy))
    .where(and(eq(payments.id, paymentId), eq(payments.companyId, tenant.company.id), eq(payments.source, "bank_receipt")))
    .limit(1);
  if (!header) throw notFound("Bank tushumi topilmadi");
  const [debtPart] = await conn
    .select({ id: customerPayments.id, amount: customerPayments.amount, status: customerPayments.status })
    .from(customerPayments)
    .where(eq(customerPayments.paymentId, header.id))
    .orderBy(asc(customerPayments.createdAt))
    .limit(1);
  const [advance] = await conn
    .select({ id: customerBalanceTransactions.id, amount: customerBalanceTransactions.amount, status: customerBalanceTransactions.status })
    .from(customerBalanceTransactions)
    .where(and(eq(customerBalanceTransactions.paymentHeaderId, header.id), eq(customerBalanceTransactions.type, "deposit")))
    .limit(1);
  return {
    receipt: {
      ...header,
      toDebt: debtPart?.amount ?? "0.00",
      toAdvance: advance?.amount ?? "0.00",
      paymentPartId: debtPart?.id ?? null,
      advanceId: advance?.id ?? null,
    },
  };
}

export async function listBankReceipts(conn: DbOrTx, tenant: TenantContext, filters: { customerId?: string; limit: number }) {
  const rows = await conn
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.companyId, tenant.company.id),
        eq(payments.source, "bank_receipt"),
        filters.customerId ? eq(payments.customerId, filters.customerId) : undefined,
      ),
    )
    .orderBy(desc(payments.createdAt), desc(payments.id))
    .limit(filters.limit);
  const receipts = [];
  for (const row of rows) receipts.push((await bankReceiptDetail(conn, tenant, row.id)).receipt);
  return { receipts };
}

// ─── Avans kirimini bekor qilish ─────────────────────────────────────────────

type DepositRow = typeof customerBalanceTransactions.$inferSelect;

/** Bekor qilish to'siqlari: avans ishlatilgan bo'lsa yoki hisobda pul yetmasa — rad. */
export async function depositReversalBlockers(conn: DbOrTx, rows: DepositRow[], alreadyNeeded = new Map<string, bigint>()) {
  const blockers: string[] = [];
  const byCustomer = new Map<string, bigint>();
  const byAccount = new Map(alreadyNeeded);
  for (const row of rows) {
    if (row.status === "reversed") blockers.push("Avans kirimi allaqachon bekor qilingan");
    byCustomer.set(row.customerId, (byCustomer.get(row.customerId) ?? 0n) + toMinor(row.amount));
    if (!row.cashAccountId) blockers.push("Avans kirimi hisobga bog'lanmagan — bekor qilib bo'lmaydi");
    else byAccount.set(row.cashAccountId, (byAccount.get(row.cashAccountId) ?? 0n) + toMinor(row.amount));
  }
  for (const [customerId, need] of byCustomer) {
    const [customer] = await conn.select({ balance: customers.balance }).from(customers).where(eq(customers.id, customerId)).limit(1);
    if (!customer || toMinor(customer.balance) < need) {
      blockers.push(`Avans ishlatilgan: mijoz hamyonida ${customer?.balance ?? "0"} qolgan, bekor qilish uchun ${fromMinor(need)} kerak`);
    }
  }
  for (const [accountId, need] of byAccount) {
    const [account] = await conn.select({ name: cashAccounts.name, balance: cashAccounts.balance }).from(cashAccounts).where(eq(cashAccounts.id, accountId)).limit(1);
    if (!account || toMinor(account.balance) < need) {
      blockers.push(`"${account?.name ?? "hisob"}" da yetarli pul yo'q (qoldiq ${account?.balance ?? "0"})`);
    }
  }
  return [...new Set(blockers)];
}

/**
 * Avans kirim(lar)ini BEKOR QILADI: pul hisobdan qaytadi (kassa chiqimi), jurnal teskari (DR 2300 / CR bank),
 * mijoz hamyoni kamayadi, teskari tarix qatori (`deposit_reversal`), asl qator `reversed`. Chaqiruvchi — tranzaksiyada,
 * qatorlarni `FOR UPDATE` bilan qulflagan va to'siqlarni tekshirgan bo'lishi kerak.
 */
export async function reverseDepositRows(tx: Tx, tenant: TenantContext, rows: DepositRow[], reason: string) {
  const companyId = tenant.company.id;
  const today = todayIso();
  const advanceAccount = await ensureAccountBySubtype(tx, companyId, "customer_advance");
  const entries: string[] = [];
  for (const row of rows) {
    const label = `Avans kirimi bekor qilindi: ${reason}`;
    const { account } = await recordCashTransaction(tx, companyId, tenant.user.id, {
      cashAccountId: row.cashAccountId!,
      type: "out",
      amount: row.amount,
      txDate: today,
      description: label,
      category: "customer_balance",
      referenceType: "customer_balance_reversal",
      referenceId: row.id,
    });
    const { entry } = await postJournalEntry(tx, companyId, tenant.user.id, {
      party: { type: "customer", id: row.customerId },
      entryDate: today,
      description: label,
      referenceType: "customer_balance_reversal",
      referenceId: row.id,
      lines: [
        { accountId: advanceAccount, debit: row.amount },
        { accountId: await ledgerAccountFor(tx, companyId, account), credit: row.amount },
      ],
    });
    const [customer] = await tx
      .update(customers)
      .set({ balance: sql`${customers.balance} - ${row.amount}::numeric`, updatedAt: new Date() })
      .where(eq(customers.id, row.customerId))
      .returning({ balance: customers.balance });
    await tx.insert(customerBalanceTransactions).values({
      companyId,
      customerId: row.customerId,
      type: "deposit_reversal",
      amount: fromMinor(-toMinor(row.amount)),
      balanceAfter: customer!.balance,
      cashAccountId: row.cashAccountId,
      journalEntryId: entry.id,
      paymentHeaderId: row.paymentHeaderId,
      notes: label,
      createdBy: tenant.user.id,
      createdAt: new Date(),
    });
    await tx
      .update(customerBalanceTransactions)
      .set({ status: "reversed", reversedAt: new Date(), reversedBy: tenant.user.id, reversalReason: reason, reversalJournalEntryId: entry.id, updatedAt: new Date() })
      .where(eq(customerBalanceTransactions.id, row.id));
    entries.push(entry.id);
  }
  return entries;
}

/** To'lov hujjatiga bog'langan avans kirimlari (qulflab). */
export async function lockHeaderDeposits(tx: DbOrTx, headerId: string, lock: boolean) {
  const query = tx
    .select()
    .from(customerBalanceTransactions)
    .where(and(eq(customerBalanceTransactions.paymentHeaderId, headerId), eq(customerBalanceTransactions.type, "deposit")))
    .orderBy(asc(customerBalanceTransactions.createdAt));
  return lock ? query.for("update") : query;
}

/**
 * Oddiy avans kirimini (balansni to'ldirish yoki faqat avansdan iborat bank tushumi) bekor qilish.
 * Qarz qismi bor bank tushumi — to'lov orqali bekor qilinadi (`reverseCustomerPayment` avansni ham qaytaradi).
 */
export async function reverseBalanceDeposit(tx: Tx, tenant: TenantContext, depositId: string, reason: string, meta: RequestMeta) {
  const companyId = tenant.company.id;
  const cleanReason = reason.trim();
  if (cleanReason.length < 3) throw badRequest("Bekor qilish sababini yozing");
  await assertPeriodOpen(tx, companyId, todayIso());
  const [row] = await tx
    .select()
    .from(customerBalanceTransactions)
    .where(and(eq(customerBalanceTransactions.id, depositId), eq(customerBalanceTransactions.companyId, companyId)))
    .limit(1)
    .for("update");
  if (!row) throw notFound("Avans kirimi topilmadi");
  if (row.type !== "deposit") throw badRequest("Faqat balansni to'ldirish (avans kirimi) bekor qilinadi");
  if (row.status === "reversed") throw conflict("Avans kirimi allaqachon bekor qilingan");
  if (row.paymentHeaderId) {
    const [part] = await tx
      .select({ id: customerPayments.id })
      .from(customerPayments)
      .where(eq(customerPayments.paymentId, row.paymentHeaderId))
      .limit(1);
    if (part) throw badRequest("Bu avans bank tushumining bir qismi — butun tushumni bekor qiling", { paymentPartId: part.id });
  }
  await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, row.customerId)).for("update");
  const blockers = await depositReversalBlockers(tx, [row]);
  if (blockers.length > 0) throw badRequest(blockers.join("; "), { blockers });

  const entries = await reverseDepositRows(tx, tenant, [row], cleanReason);
  if (row.paymentHeaderId) {
    await tx
      .update(payments)
      .set({ status: "reversed", reversedAt: new Date(), reversedBy: tenant.user.id, reversalReason: cleanReason })
      .where(eq(payments.id, row.paymentHeaderId));
  }
  await salesAudit(tx, tenant, meta, {
    action: "CUSTOMER_BALANCE_DEPOSIT_REVERSED",
    resource: "customers",
    resourceId: row.customerId,
    details: { depositId: row.id, amount: row.amount, reason: cleanReason, paymentHeaderId: row.paymentHeaderId, reversalJournalEntries: entries },
  });
  return { depositId: row.id, reversalJournalEntries: entries };
}

/** Bank tushumini bekor qilish — qaysi yo'l bilan bekor qilinishini aniqlaydi. */
export async function bankReceiptReversalTarget(conn: DbOrTx, tenant: TenantContext, paymentId: string) {
  const { receipt } = await bankReceiptDetail(conn, tenant, paymentId);
  if (receipt.status === "reversed") throw conflict("Bank tushumi allaqachon bekor qilingan");
  return receipt.paymentPartId ? { kind: "payment" as const, id: receipt.paymentPartId } : { kind: "deposit" as const, id: receipt.advanceId! };
}

