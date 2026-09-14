/**
 * Mijoz to'lovlari (convex/sales/orders.ts `recordPayment`).
 *
 * Bitta tranzaksiyada: to'lov, kassa yoki bank kirimi, jurnal (DR kassa/bank / CR debitorlar),
 * buyurtmaning to'langan summasi (jo'natilgan + to'liq to'langan → delivered), mijoz qarzi.
 *
 * Convex'dan farqlar:
 *  - ortiqcha to'lov mumkin edi; qoralama va bekor qilingan buyurtmaga ham to'lanardi
 *  - POS buyurtmasiga to'lov kassaga tushar, lekin jurnalga yozilmasdi (kassa hisobi buzilardi) —
 *    endi har to'lov bir xil yoziladi
 *  - karta/bank to'lovi naqd kassaga tushardi; sana doim bugun edi
 *  - takroriy `reference` jimgina hech narsa qaytarmasdi — endi mavjud to'lov qaytariladi (bazada unique)
 *  - buyurtmasiz (mijoz qarzi bo'yicha) to'lov yo'q edi
 */
import { and, desc, eq, getTableColumns, lt, or, sql } from "drizzle-orm";
import { badRequest, notFound } from "@bum/shared";
import { customerPayments, customers, salesOrderItems, salesOrders } from "../../db/schema/sales.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { UUID_RE, decodeCursor, encodeCursor } from "../../shared/cursor.js";
import { fromMinor, mulDivRound, toMinor } from "../../shared/decimal.js";
import type { TenantContext } from "../company/tenant.js";
import { companyCurrency } from "../finance/accounts.service.js";
import {
  ledgerAccountFor,
  recordCashTransaction,
  resolvePaymentAccount,
  todayIso,
  type PaymentMethod,
} from "../finance/cash.service.js";
import { postJournalEntry, requireAccountBySubtype } from "../finance/journal.service.js";
import { currencyRate } from "../finance/currencies.service.js";
import { findCompanyTerminal } from "../finance/terminals.service.js";
import { commissionMinor, recordBankCommission } from "../finance/bank-commission.service.js";
import { earnOrderCashback, getCashbackSettings, maxCashbackUsage, redeemCashback } from "./cashback.service.js";
import { payFromBalance } from "./customer-balance.service.js";
import { salesAudit } from "./customers.service.js";
import { orderCurrencyBuckets } from "./orders.service.js";

const { legacyId: _legacyId, companyId: _companyId, ...paymentFields } = getTableColumns(customerPayments);

export type CustomerPaymentInput = {
  customerId?: string | null;
  orderId?: string | null;
  amount: string;
  paymentDate?: string;
  method: PaymentMethod;
  cashAccountId?: string | null;
  reference?: string | null;
  notes?: string | null;
  /**
   * Chet valyutadagi to'lov: pul shu valyutadagi kassaga `foreignAmount` bo'lib tushadi,
   * `amount` — uning asosiy valyutadagi qiymati (qarz va jurnal shu bilan).
   */
  currency?: string;
  foreignAmount?: string;
  /** Karta to'lovi terminali: pul terminalga bog'langan bank hisobiga tushadi (faqat `card`). */
  terminalId?: string | null;
  /** To'lov hujjati (aralash to'lov qismi) — `payment-allocation.service.ts`. */
  paymentId?: string | null;
};

export async function recordCustomerPayment(tx: Tx, tenant: TenantContext, input: CustomerPaymentInput, meta: RequestMeta) {
  const companyId = tenant.company.id;
  if (!input.orderId && !input.customerId) throw badRequest("Mijoz yoki buyurtma tanlanishi kerak");
  let cashAccountId = input.cashAccountId ?? null;
  let terminal: Awaited<ReturnType<typeof findCompanyTerminal>> | null = null;
  if (input.terminalId) {
    // Faollik taqsimot kirishida (`resolvePaymentParts`) tekshiriladi — bu yerda kompaniyaga tegishliligi va hisobi
    if (input.method !== "card") throw badRequest("Terminal faqat karta to'lovida tanlanadi");
    terminal = await findCompanyTerminal(tx, companyId, input.terminalId);
    if (cashAccountId && cashAccountId !== terminal.cashAccountId) throw badRequest("Hisob terminalga bog'langan bank hisobiga mos emas");
    cashAccountId = terminal.cashAccountId;
  }

  if (input.reference) {
    const [existing] = await tx
      .select(paymentFields)
      .from(customerPayments)
      .where(and(eq(customerPayments.companyId, companyId), eq(customerPayments.reference, input.reference)))
      .limit(1);
    if (existing) return { payment: existing, created: false };
  }

  const amount = toMinor(input.amount);
  let customerId = input.customerId ?? null;
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
    if (input.customerId && row.customerId !== input.customerId) throw badRequest("Buyurtma boshqa mijozniki");
    if (row.status !== "confirmed" && row.status !== "shipped" && row.status !== "delivered") {
      throw badRequest("Bu holatdagi buyurtmaga to'lov qabul qilinmaydi");
    }
    const balance = toMinor(row.totalAmount) - toMinor(row.paidAmount);
    if (amount > balance) throw badRequest(`To'lov buyurtma qoldig'idan ortiq (qoldiq ${fromMinor(balance)})`);
    order = row;
    customerId = row.customerId;
  }

  let customerName: string | null = null;
  if (customerId) {
    const [customer] = await tx
      .select({ name: customers.name, totalDebt: customers.totalDebt })
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.companyId, companyId)))
      .limit(1)
      .for("update");
    if (!customer) throw notFound("Mijoz topilmadi");
    if (!order) {
      const debt = toMinor(customer.totalDebt);
      if (amount > debt) {
        throw badRequest(`To'lov mijoz qarzidan ortiq (qarz ${fromMinor(debt > 0n ? debt : 0n)}) — avans uchun buyurtmani tanlang`);
      }
    }
    customerName = customer.name;
  }

  const paymentDate = input.paymentDate ?? todayIso();
  const baseCurrency = await companyCurrency(tx, companyId);
  const paymentCurrency = input.currency ?? baseCurrency;
  const foreign = paymentCurrency !== baseCurrency;
  if (foreign && !(input.foreignAmount && toMinor(input.foreignAmount) > 0n)) {
    throw badRequest("Valyutadagi to'lov summasi ko'rsatilmagan");
  }
  const [payment] = await tx
    .insert(customerPayments)
    .values({
      companyId,
      customerId,
      orderId: order?.id ?? null,
      amount: input.amount,
      currency: paymentCurrency,
      // Kurs: asosiy qiymat / valyutadagi summa
      exchangeRate: foreign ? fromMinor(mulDivRound(amount, 10_000n, toMinor(input.foreignAmount!)), 4) : "1",
      foreignAmount: foreign ? input.foreignAmount! : "0",
      paymentDate,
      method: input.method,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      terminalId: input.terminalId ?? null,
      paymentId: input.paymentId ?? null,
      createdBy: tenant.user.id,
    })
    .returning({ id: customerPayments.id });

  const description = order ? `Mijoz to'lovi: ${order.number}` : `Mijoz to'lovi: ${customerName}`;
  const { account } = await recordCashTransaction(tx, companyId, tenant.user.id, {
    cashAccountId: await resolvePaymentAccount(tx, companyId, input.method, cashAccountId, paymentCurrency),
    type: "in",
    amount: foreign ? input.foreignAmount! : input.amount,
    currency: paymentCurrency,
    txDate: paymentDate,
    description,
    category: "sales",
    referenceType: "customer_payment",
    referenceId: payment!.id,
  });
  const { entry } = await postJournalEntry(tx, companyId, tenant.user.id, {
    entryDate: paymentDate,
    description,
    referenceType: "customer_payment",
    referenceId: payment!.id,
    lines: [
      { accountId: await ledgerAccountFor(tx, companyId, account), debit: input.amount },
      { accountId: await requireAccountBySubtype(tx, companyId, "receivable", "asset", "Debitorlar"), credit: input.amount },
    ],
  });
  // Ekvayring komissiyasi: bank to'lovdan foizni ushlaydi — mijoz qarzi to'liq yopiladi, bank hisobiga qoldiq
  const acquiringFee = terminal && !foreign ? commissionMinor(toMinor(input.amount), terminal.commissionPercent) : 0n;
  if (terminal && acquiringFee > 0n) {
    await recordBankCommission(tx, tenant, {
      cashAccountId: account.id,
      amount: acquiringFee,
      sourceType: "customer_payment",
      sourceId: payment!.id,
      date: paymentDate,
      description: `Ekvayring komissiyasi ${Number(terminal.commissionPercent)}% — ${terminal.name}: ${description}`,
    });
  }

  const [updated] = await tx
    .update(customerPayments)
    .set({ cashAccountId: account.id, journalEntryId: entry.id, updatedAt: new Date() })
    .where(eq(customerPayments.id, payment!.id))
    .returning(paymentFields);

  if (order) {
    const paid = toMinor(order.paidAmount) + amount;
    const settled = order.status === "shipped" && paid >= toMinor(order.totalAmount);
    await tx
      .update(salesOrders)
      .set({ paidAmount: fromMinor(paid), ...(settled ? { status: "delivered" as const } : {}), updatedAt: new Date() })
      .where(eq(salesOrders.id, order.id));
  }
  if (customerId) {
    await tx
      .update(customers)
      .set({ totalDebt: sql`${customers.totalDebt} - ${input.amount}::numeric`, updatedAt: new Date() })
      .where(eq(customers.id, customerId));
  }

  await salesAudit(tx, tenant, meta, {
    action: "CUSTOMER_PAYMENT_RECORDED",
    resource: "customer_payments",
    resourceId: payment!.id,
    details: {
      customerId,
      orderId: order?.id ?? null,
      amount: input.amount,
      method: input.method,
      cashAccountId: account.id,
      ...(input.terminalId ? { terminalId: input.terminalId } : {}),
      ...(input.paymentId ? { paymentId: input.paymentId } : {}),
    },
  });
  return { payment: updated!, created: true };
}

/**
 * Chet valyutadagi to'lovning asosiy qiymati. Buyurtmada shu valyuta qismi bo'lsa — buyurtma kursida
 * (qoldiqni to'liq yopsa — aynan qolgan asosiy qiymat), aks holda joriy kurs bilan.
 */
async function foreignPaymentBase(tx: Tx, companyId: string, orderId: string | null, currency: string, amount: bigint) {
  if (amount <= 0n) throw badRequest("Summa musbat bo'lishi kerak");
  if (!orderId) return mulDivRound(amount, toMinor(await currencyRate(tx, companyId, currency), 4), 10_000n);

  const [order] = await tx
    .select({ currency: salesOrders.currency, totalAmount: salesOrders.totalAmount, paidAmount: salesOrders.paidAmount })
    .from(salesOrders)
    .where(and(eq(salesOrders.id, orderId), eq(salesOrders.companyId, companyId)))
    .limit(1)
    .for("update");
  if (!order) throw notFound("Buyurtma topilmadi");
  const items = await tx
    .select({
      priceCurrency: salesOrderItems.priceCurrency,
      priceRate: salesOrderItems.priceRate,
      currencyTotal: salesOrderItems.currencyTotal,
      lineTotal: salesOrderItems.lineTotal,
    })
    .from(salesOrderItems)
    .where(eq(salesOrderItems.orderId, orderId));
  const payments = await tx
    .select({ currency: customerPayments.currency, amount: customerPayments.amount, foreignAmount: customerPayments.foreignAmount })
    .from(customerPayments)
    .where(eq(customerPayments.orderId, orderId));
  const balance = toMinor(order.totalAmount) - toMinor(order.paidAmount);

  const bucket = orderCurrencyBuckets(order.currency, items, payments).find((b) => b.currency === currency);
  if (bucket) {
    const remaining = bucket.total - bucket.paid;
    if (amount > remaining) {
      throw badRequest(`To'lov ${currency} qoldig'idan ortiq (qoldiq ${fromMinor(remaining > 0n ? remaining : 0n)})`);
    }
    const base = amount === remaining ? bucket.base - bucket.paidBase : mulDivRound(amount, toMinor(bucket.rate, 4), 10_000n);
    return base < balance ? base : balance;
  }
  const rate = toMinor(await currencyRate(tx, companyId, currency), 4);
  const base = mulDivRound(amount, rate, 10_000n);
  // Qoldiqni yopadigan summa yaxlitlash sababli bir tiyin oshsa — aynan qoldiq
  if (base > balance && mulDivRound(amount - 1n, rate, 10_000n) < balance) return balance;
  return base;
}

export type SalesPaymentInput = Omit<CustomerPaymentInput, "method" | "foreignAmount"> & {
  method: CustomerPaymentInput["method"] | "balance" | "cashback";
};

/**
 * `POST /api/sales/payments`: naqd/karta/bank asosiy yoki chet valyutada (`currency` bo'lsa `amount` shu valyutada,
 * pul shu valyutadagi kassa/bankka), mijoz balansidan va keshbekdan (asosiy valyutada; keshbek — buyurtmaga,
 * sozlamadagi ulush chegarasida). To'lovdan keyin buyurtma keshbek shartiga yetsa — keshbek beriladi.
 */
export async function recordSalesPayment(tx: Tx, tenant: TenantContext, input: SalesPaymentInput, meta: RequestMeta) {
  const companyId = tenant.company.id;
  if (!input.orderId && !input.customerId) throw badRequest("Mijoz yoki buyurtma tanlanishi kerak");
  if (input.reference) {
    const [existing] = await tx
      .select(paymentFields)
      .from(customerPayments)
      .where(and(eq(customerPayments.companyId, companyId), eq(customerPayments.reference, input.reference)))
      .limit(1);
    if (existing) return { payment: existing, created: false };
  }

  const baseCurrency = await companyCurrency(tx, companyId);
  const currency = input.currency ?? baseCurrency;
  let paymentId: string;

  if (input.method === "balance" || input.method === "cashback") {
    if (currency !== baseCurrency) throw badRequest("Balans va keshbekdan to'lov asosiy valyutada kiritiladi");
    let customerId = input.customerId ?? null;
    let orderTotal = 0n;
    if (input.orderId) {
      const [order] = await tx
        .select({ customerId: salesOrders.customerId, totalAmount: salesOrders.totalAmount })
        .from(salesOrders)
        .where(and(eq(salesOrders.id, input.orderId), eq(salesOrders.companyId, companyId)))
        .limit(1);
      if (!order) throw notFound("Buyurtma topilmadi");
      if (customerId && order.customerId !== customerId) throw badRequest("Buyurtma boshqa mijozniki");
      customerId = order.customerId;
      orderTotal = toMinor(order.totalAmount);
    }
    if (!customerId) throw badRequest("Balans va keshbekdan to'lash uchun mijoz kerak");

    if (input.method === "balance") {
      ({ paymentId } = await payFromBalance(
        tx,
        tenant,
        { customerId, orderId: input.orderId ?? null, amount: input.amount, notes: input.notes, date: input.paymentDate },
        meta,
      ));
    } else {
      if (!input.orderId) throw badRequest("Keshbekdan faqat buyurtma to'lanadi");
      const cashback = await getCashbackSettings(tx, companyId);
      if (!cashback.enabled) throw badRequest("Keshbek tizimi o'chirilgan");
      const [used] = await tx
        .select({
          total: sql<string>`coalesce(sum(${customerPayments.amount}) filter (where ${customerPayments.method} = 'cashback'), 0)::numeric(18,2)`,
        })
        .from(customerPayments)
        .where(eq(customerPayments.orderId, input.orderId));
      const limit = maxCashbackUsage(cashback, orderTotal) - toMinor(used!.total);
      if (toMinor(input.amount) > limit) {
        throw badRequest(
          `Keshbek bilan buyurtmaning ${cashback.maxUsagePercent}% igacha to'lash mumkin (qolgan ${fromMinor(limit > 0n ? limit : 0n)})`,
        );
      }
      ({ paymentId } = await redeemCashback(
        tx,
        tenant,
        { customerId, orderId: input.orderId, amount: input.amount, date: input.paymentDate },
        meta,
      ));
    }
    if (input.reference) {
      await tx.update(customerPayments).set({ reference: input.reference }).where(eq(customerPayments.id, paymentId));
    }
  } else if (currency !== baseCurrency) {
    const foreignAmount = toMinor(input.amount);
    const base = await foreignPaymentBase(tx, companyId, input.orderId ?? null, currency, foreignAmount);
    const { payment } = await recordCustomerPayment(
      tx,
      tenant,
      { ...input, method: input.method, amount: fromMinor(base), currency, foreignAmount: fromMinor(foreignAmount) },
      meta,
    );
    paymentId = payment.id;
  } else {
    const { payment } = await recordCustomerPayment(tx, tenant, { ...input, method: input.method }, meta);
    paymentId = payment.id;
  }

  if (input.orderId) await earnOrderCashback(tx, tenant, input.orderId);
  const [payment] = await tx.select(paymentFields).from(customerPayments).where(eq(customerPayments.id, paymentId)).limit(1);
  return { payment: payment!, created: true };
}

export async function listCustomerPayments(
  conn: DbOrTx,
  tenant: TenantContext,
  options: { customerId?: string; orderId?: string; limit: number; cursor?: string },
) {
  let after: { date: string; id: string } | null = null;
  if (options.cursor) {
    const [date, id] = decodeCursor(options.cursor, 2) as [string, string];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !UUID_RE.test(id)) throw badRequest("Kursor noto'g'ri");
    after = { date, id };
  }

  const rows = await conn
    .select({ ...paymentFields, customerName: customers.name })
    .from(customerPayments)
    .leftJoin(customers, eq(customers.id, customerPayments.customerId))
    .where(
      and(
        eq(customerPayments.companyId, tenant.company.id),
        options.customerId ? eq(customerPayments.customerId, options.customerId) : undefined,
        options.orderId ? eq(customerPayments.orderId, options.orderId) : undefined,
        after
          ? or(
              lt(customerPayments.paymentDate, after.date),
              and(eq(customerPayments.paymentDate, after.date), lt(customerPayments.id, after.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(customerPayments.paymentDate), desc(customerPayments.id))
    .limit(options.limit + 1);

  const page = rows.slice(0, options.limit);
  const last = page.at(-1);
  return {
    payments: page,
    nextCursor: rows.length > options.limit && last ? encodeCursor([last.paymentDate, last.id]) : null,
  };
}
