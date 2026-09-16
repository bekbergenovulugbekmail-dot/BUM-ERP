/**
 * Mijoz balansi (hamyon) — oldindan to'langan pul. Qarz (`totalDebt`) va keshbekdan alohida yuradi.
 *
 * Har harakat bitta tranzaksiyada: tarix qatori (`customer_balance_transactions`), mijoz balansi va jurnal.
 *   Kirim (to'ldirish, qaytim):         DR kassa/bank          / CR 2300 Mijozlar avanslari (+ kassa kirimi)
 *   Sarf (chek yoki qarz to'lovi):      DR 2300 avanslar       / CR 1100 Debitorlar (+ customer_payments, method = balance)
 *   Qaytarish (balansdan to'langan qism): DR 1100 Debitorlar   / CR 2300 avanslar
 * Balans manfiy bo'lmaydi — servisda va bazada (CHECK) tekshiriladi.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, getTableColumns, sql } from "drizzle-orm";
import { badRequest, notFound } from "@bum/shared";
import { customerBalanceTransactions, customerPayments, customers, salesOrders } from "../../db/schema/sales.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { fromMinor, toMinor } from "../../shared/decimal.js";
import type { TenantContext } from "../company/tenant.js";
import { companyCurrency } from "../finance/accounts.service.js";
import {
  ledgerAccountFor,
  recordCashTransaction,
  resolvePaymentAccount,
  todayIso,
  type PaymentMethod,
} from "../finance/cash.service.js";
import { assertPeriodOpen, ensureAccountBySubtype, postJournalEntry, requireAccountBySubtype } from "../finance/journal.service.js";
import { setCustomerCashback } from "./cashback.service.js";
import { salesAudit } from "./customers.service.js";
import { isPayableSale } from "./sale-status.js";

const { companyId: _companyId, ...balanceTxFields } = getTableColumns(customerBalanceTransactions);

export type BalanceTxType = (typeof customerBalanceTransactions.type.enumValues)[number];

/** 2300 "Mijozlar avanslari" — hisob rejasida bo'lmasa (eski kompaniya) shu yerda qo'shiladi. */
export function customerAdvanceAccount(tx: Tx, companyId: string) {
  return ensureAccountBySubtype(tx, companyId, "customer_advance");
}

/** POS javoblari va chek uchun mijozning joriy holati. */
export async function customerSummary(conn: DbOrTx, companyId: string, customerId: string) {
  const [row] = await conn
    .select({
      id: customers.id,
      name: customers.name,
      code: customers.code,
      phone: customers.phone,
      balance: customers.balance,
      totalDebt: customers.totalDebt,
      creditLimit: customers.creditLimit,
      cashbackBalance: customers.cashbackBalance,
    })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.companyId, companyId)))
    .limit(1);
  if (!row) throw notFound("Mijoz topilmadi");
  return row;
}

async function lockCustomer(tx: Tx, companyId: string, customerId: string) {
  const [customer] = await tx
    .select({
      id: customers.id,
      name: customers.name,
      balance: customers.balance,
      totalDebt: customers.totalDebt,
      isActive: customers.isActive,
    })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.companyId, companyId)))
    .limit(1)
    .for("update");
  if (!customer) throw notFound("Mijoz topilmadi");
  return customer;
}

async function insertBalanceTx(
  tx: Tx,
  tenant: TenantContext,
  values: Omit<typeof customerBalanceTransactions.$inferInsert, "companyId" | "createdBy" | "createdAt" | "updatedAt">,
) {
  const [row] = await tx
    .insert(customerBalanceTransactions)
    // Tarix vaqt bo'yicha tartiblanadi — bitta tranzaksiyadagi qatorlar now() da bir xil bo'lib qolmasin
    .values({ ...values, companyId: tenant.company.id, createdBy: tenant.user.id, createdAt: new Date() })
    .returning(balanceTxFields);
  return row!;
}

function positiveAmount(amount: string) {
  const minor = toMinor(amount);
  if (minor <= 0n) throw badRequest("Summa musbat bo'lishi kerak");
  return minor;
}

/** Balansga kirim: kassada to'ldirish yoki chek qaytimi. Pul kassaga/bankka tushadi. */
export async function depositToBalance(
  tx: Tx,
  tenant: TenantContext,
  input: {
    customerId: string;
    type: "deposit" | "change";
    amount: string;
    method: PaymentMethod;
    cashAccountId?: string | null;
    orderId?: string | null;
    posShiftId?: string | null;
    notes?: string | null;
    date?: string;
    /** Offline kassa cheki qaytimi — mijoz sinxrongacha faolsizlantirilgan bo'lsa ham yoziladi. */
    allowInactive?: boolean;
    /** Takroriy yuborishdan himoya: so'rov kaliti yozuv ID'si bo'ladi. */
    id?: string;
  },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const amount = positiveAmount(input.amount);
  const customer = await lockCustomer(tx, companyId, input.customerId);
  if (!customer.isActive && !input.allowInactive) throw badRequest("Mijoz faol emas");

  const id = input.id ?? randomUUID();
  const date = input.date ?? todayIso();
  const description = input.type === "change" ? `Qaytim balansga: ${customer.name}` : `Balansni to'ldirish: ${customer.name}`;
  const { account } = await recordCashTransaction(tx, companyId, tenant.user.id, {
    cashAccountId: await resolvePaymentAccount(tx, companyId, input.method, input.cashAccountId),
    type: "in",
    amount: input.amount,
    txDate: date,
    description,
    category: "customer_balance",
    referenceType: "customer_balance",
    referenceId: id,
  });
  const { entry } = await postJournalEntry(tx, companyId, tenant.user.id, {
    entryDate: date,
    description,
    referenceType: "customer_balance",
    referenceId: id,
    lines: [
      { accountId: await ledgerAccountFor(tx, companyId, account), debit: input.amount },
      { accountId: await customerAdvanceAccount(tx, companyId), credit: input.amount },
    ],
  });

  const balanceAfter = toMinor(customer.balance) + amount;
  await tx
    .update(customers)
    .set({ balance: fromMinor(balanceAfter), updatedAt: new Date() })
    .where(eq(customers.id, customer.id));
  const transaction = await insertBalanceTx(tx, tenant, {
    id,
    customerId: customer.id,
    type: input.type,
    amount: fromMinor(amount),
    balanceAfter: fromMinor(balanceAfter),
    method: input.method,
    orderId: input.orderId ?? null,
    posShiftId: input.posShiftId ?? null,
    cashAccountId: account.id,
    journalEntryId: entry.id,
    notes: input.notes ?? null,
  });

  await salesAudit(tx, tenant, meta, {
    action: "CUSTOMER_BALANCE_DEPOSITED",
    resource: "customers",
    resourceId: customer.id,
    details: { type: input.type, amount: fromMinor(amount), method: input.method, balanceAfter: fromMinor(balanceAfter) },
  });
  return transaction;
}

/**
 * Balansdan to'lov: chek (`orderId`) yoki buyurtmaga bog'lanmagan qarz. Kassaga pul tushmaydi —
 * avans debitorlik bilan yopiladi.
 */
export async function payFromBalance(
  tx: Tx,
  tenant: TenantContext,
  input: {
    customerId: string;
    amount: string;
    orderId?: string | null;
    posShiftId?: string | null;
    notes?: string | null;
    date?: string;
    /** Takroriy yuborishdan himoya kaliti (to'lov `reference`). */
    reference?: string | null;
  },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const amount = positiveAmount(input.amount);

  let order: { id: string; number: string; status: string; totalAmount: string; paidAmount: string } | null = null;
  if (input.orderId) {
    const [row] = await tx
      .select({
        id: salesOrders.id,
        number: salesOrders.number,
        customerId: salesOrders.customerId,
        status: salesOrders.status,
        totalAmount: salesOrders.totalAmount,
        paidAmount: salesOrders.paidAmount,
      })
      .from(salesOrders)
      .where(and(eq(salesOrders.id, input.orderId), eq(salesOrders.companyId, companyId)))
      .limit(1)
      .for("update");
    if (!row) throw notFound("Buyurtma topilmadi");
    if (row.customerId !== input.customerId) throw badRequest("Buyurtma boshqa mijozniki");
    if (!isPayableSale(row.status)) throw badRequest("Bu holatdagi buyurtmaga to'lov qabul qilinmaydi");
    const due = toMinor(row.totalAmount) - toMinor(row.paidAmount);
    if (amount > due) throw badRequest(`To'lov buyurtma qoldig'idan ortiq (qoldiq ${fromMinor(due)})`);
    order = row;
  }

  const customer = await lockCustomer(tx, companyId, input.customerId);
  const balance = toMinor(customer.balance);
  if (amount > balance) throw badRequest(`Mijoz balansida yetarli mablag' yo'q (balans ${fromMinor(balance)})`);
  if (!order) {
    const debt = toMinor(customer.totalDebt);
    if (amount > debt) throw badRequest(`To'lov mijoz qarzidan ortiq (qarz ${fromMinor(debt > 0n ? debt : 0n)})`);
  }

  const date = input.date ?? todayIso();
  const description = order ? `Balansdan to'lov: ${order.number}` : `Qarz balansdan to'landi: ${customer.name}`;
  const [payment] = await tx
    .insert(customerPayments)
    .values({
      companyId,
      customerId: customer.id,
      orderId: order?.id ?? null,
      amount: fromMinor(amount),
      currency: await companyCurrency(tx, companyId),
      paymentDate: date,
      method: "balance",
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      createdBy: tenant.user.id,
    })
    .returning({ id: customerPayments.id });
  const { entry } = await postJournalEntry(tx, companyId, tenant.user.id, {
    entryDate: date,
    description,
    referenceType: "customer_payment",
    referenceId: payment!.id,
    lines: [
      { accountId: await customerAdvanceAccount(tx, companyId), debit: fromMinor(amount) },
      { accountId: await requireAccountBySubtype(tx, companyId, "receivable", "asset", "Debitorlar"), credit: fromMinor(amount) },
    ],
  });
  await tx
    .update(customerPayments)
    .set({ journalEntryId: entry.id, updatedAt: new Date() })
    .where(eq(customerPayments.id, payment!.id));

  if (order) {
    const paid = toMinor(order.paidAmount) + amount;
    // Balansdan to'lash ham sotuv holatini o'zgartirmaydi — faqat to'langan summani oshiradi
    await tx
      .update(salesOrders)
      .set({ paidAmount: fromMinor(paid), updatedAt: new Date() })
      .where(eq(salesOrders.id, order.id));
  }

  const balanceAfter = balance - amount;
  await tx
    .update(customers)
    .set({
      balance: fromMinor(balanceAfter),
      totalDebt: sql`${customers.totalDebt} - ${fromMinor(amount)}::numeric`,
      updatedAt: new Date(),
    })
    .where(eq(customers.id, customer.id));
  const transaction = await insertBalanceTx(tx, tenant, {
    customerId: customer.id,
    type: "sale_payment",
    amount: fromMinor(-amount),
    balanceAfter: fromMinor(balanceAfter),
    orderId: order?.id ?? null,
    paymentId: payment!.id,
    posShiftId: input.posShiftId ?? null,
    journalEntryId: entry.id,
    notes: input.notes ?? null,
  });

  await salesAudit(tx, tenant, meta, {
    action: "CUSTOMER_BALANCE_SPENT",
    resource: "customers",
    resourceId: customer.id,
    details: { amount: fromMinor(amount), orderId: order?.id ?? null, paymentId: payment!.id, balanceAfter: fromMinor(balanceAfter) },
  });
  return { paymentId: payment!.id, transaction };
}

/** Qaytarilgan chekning balansdan to'langan qismi naqd emas — balansga qaytadi. */
export async function refundToBalance(
  tx: Tx,
  tenant: TenantContext,
  input: { customerId: string; orderId: string; orderNumber: string; amount: string; posShiftId?: string | null; date?: string },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const amount = positiveAmount(input.amount);
  const customer = await lockCustomer(tx, companyId, input.customerId);

  const id = randomUUID();
  const date = input.date ?? todayIso();
  const description = `Balansga qaytarish: ${input.orderNumber}`;
  const { entry } = await postJournalEntry(tx, companyId, tenant.user.id, {
    entryDate: date,
    description,
    referenceType: "customer_balance",
    referenceId: id,
    lines: [
      { accountId: await requireAccountBySubtype(tx, companyId, "receivable", "asset", "Debitorlar"), debit: fromMinor(amount) },
      { accountId: await customerAdvanceAccount(tx, companyId), credit: fromMinor(amount) },
    ],
  });

  const balanceAfter = toMinor(customer.balance) + amount;
  await tx
    .update(customers)
    .set({
      balance: fromMinor(balanceAfter),
      totalDebt: sql`${customers.totalDebt} + ${fromMinor(amount)}::numeric`,
      updatedAt: new Date(),
    })
    .where(eq(customers.id, customer.id));
  const transaction = await insertBalanceTx(tx, tenant, {
    id,
    customerId: customer.id,
    type: "refund",
    amount: fromMinor(amount),
    balanceAfter: fromMinor(balanceAfter),
    orderId: input.orderId,
    posShiftId: input.posShiftId ?? null,
    journalEntryId: entry.id,
  });

  await salesAudit(tx, tenant, meta, {
    action: "CUSTOMER_BALANCE_REFUNDED",
    resource: "customers",
    resourceId: customer.id,
    details: { amount: fromMinor(amount), orderId: input.orderId, balanceAfter: fromMinor(balanceAfter) },
  });
  return transaction;
}

/**
 * Balansni to'g'rilash: hamyon balansi va/yoki qarz noto'g'ri bo'lsa — to'g'ri qiymatga o'rnatiladi (delta hisoblanadi).
 * Farq jurnalda "Boshqa xarajatlar" (qiymat oshsa) yoki "Boshqa daromadlar" (kamaysa) bilan yopiladi; sabab majburiy
 * va audit jurnaliga tushadi. Yopilgan davrga tuzatish kiritilmaydi. Hamyon tuzatishi balans tarixida `adjustment`
 * qatori bo'lib ko'rinadi; qarz tuzatishi — jurnal yozuvi va audit orqali.
 */
export async function setCustomerBalances(
  tx: Tx,
  tenant: TenantContext,
  input: { customerId: string; balance?: string; totalDebt?: string; cashback?: string; reason: string; date?: string },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const reason = input.reason.trim();
  if (reason.length < 3) throw badRequest("To'g'rilash sababi ko'rsatilishi kerak");
  if (input.balance === undefined && input.totalDebt === undefined && input.cashback === undefined) {
    throw badRequest("To'g'rilanadigan qiymat tanlanmagan");
  }

  const date = input.date ?? todayIso();
  await assertPeriodOpen(tx, companyId, date);
  const customer = await lockCustomer(tx, companyId, input.customerId);
  const before = { balance: customer.balance, totalDebt: customer.totalDebt };
  const otherIncome = () => requireAccountBySubtype(tx, companyId, "other", "income", "Boshqa daromadlar");
  const otherExpense = () => requireAccountBySubtype(tx, companyId, "other", "expense", "Boshqa xarajatlar");
  let transaction: Awaited<ReturnType<typeof insertBalanceTx>> | null = null;

  if (input.balance !== undefined) {
    const target = toMinor(input.balance);
    if (target < 0n) throw badRequest("Balans manfiy bo'lmaydi");
    const delta = target - toMinor(customer.balance);
    if (delta !== 0n) {
      const id = randomUUID();
      const amount = fromMinor(delta > 0n ? delta : -delta);
      const advance = await customerAdvanceAccount(tx, companyId);
      const { entry } = await postJournalEntry(tx, companyId, tenant.user.id, {
        entryDate: date,
        description: `Balans to'g'rilandi: ${customer.name} — ${reason}`,
        referenceType: "customer_balance",
        referenceId: id,
        lines:
          delta > 0n
            ? [
                { accountId: await otherExpense(), debit: amount },
                { accountId: advance, credit: amount },
              ]
            : [
                { accountId: advance, debit: amount },
                { accountId: await otherIncome(), credit: amount },
              ],
      });
      await tx
        .update(customers)
        .set({ balance: fromMinor(target), updatedAt: new Date() })
        .where(eq(customers.id, customer.id));
      transaction = await insertBalanceTx(tx, tenant, {
        id,
        customerId: customer.id,
        type: "adjustment",
        amount: fromMinor(delta),
        balanceAfter: fromMinor(target),
        journalEntryId: entry.id,
        notes: reason,
      });
    }
  }

  if (input.totalDebt !== undefined) {
    const target = toMinor(input.totalDebt);
    if (target < 0n) throw badRequest("Qarz manfiy bo'lmaydi — ortiqcha to'lov balansga yoziladi");
    const delta = target - toMinor(customer.totalDebt);
    if (delta !== 0n) {
      const amount = fromMinor(delta > 0n ? delta : -delta);
      const receivable = await requireAccountBySubtype(tx, companyId, "receivable", "asset", "Debitorlar");
      await postJournalEntry(tx, companyId, tenant.user.id, {
        entryDate: date,
        description: `Qarz to'g'rilandi: ${customer.name} — ${reason}`,
        referenceType: "customer_debt_adjustment",
        referenceId: randomUUID(),
        lines:
          delta > 0n
            ? [
                { accountId: receivable, debit: amount },
                { accountId: await otherIncome(), credit: amount },
              ]
            : [
                { accountId: await otherExpense(), debit: amount },
                { accountId: receivable, credit: amount },
              ],
      });
      await tx
        .update(customers)
        .set({ totalDebt: fromMinor(target), updatedAt: new Date() })
        .where(eq(customers.id, customer.id));
    }
  }

  // Keshbek — alohida hisob: o'z tarixi, jurnal yozuvi va audit qatori bilan
  const cashbackTransaction =
    input.cashback === undefined
      ? null
      : await setCustomerCashback(tx, tenant, { customerId: customer.id, cashback: input.cashback, reason, date }, meta);

  await salesAudit(tx, tenant, meta, {
    action: "CUSTOMER_BALANCE_ADJUSTED",
    resource: "customers",
    resourceId: customer.id,
    details: {
      reason,
      before,
      after: { balance: input.balance ?? before.balance, totalDebt: input.totalDebt ?? before.totalDebt },
    },
  });
  return { customer: await customerSummary(tx, companyId, customer.id), transaction, cashbackTransaction };
}

export async function listBalanceTransactions(conn: DbOrTx, tenant: TenantContext, customerId: string, limit: number) {
  await customerSummary(conn, tenant.company.id, customerId);
  return conn
    .select({ ...balanceTxFields, orderNumber: salesOrders.number })
    .from(customerBalanceTransactions)
    .leftJoin(salesOrders, eq(salesOrders.id, customerBalanceTransactions.orderId))
    .where(
      and(
        eq(customerBalanceTransactions.companyId, tenant.company.id),
        eq(customerBalanceTransactions.customerId, customerId),
      ),
    )
    .orderBy(desc(customerBalanceTransactions.createdAt), desc(customerBalanceTransactions.id))
    .limit(limit);
}
