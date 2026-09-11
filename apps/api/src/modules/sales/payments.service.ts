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
import { customerPayments, customers, salesOrders } from "../../db/schema/sales.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { UUID_RE, decodeCursor, encodeCursor } from "../../shared/cursor.js";
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
import { postJournalEntry, requireAccountBySubtype } from "../finance/journal.service.js";
import { salesAudit } from "./customers.service.js";

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
};

export async function recordCustomerPayment(tx: Tx, tenant: TenantContext, input: CustomerPaymentInput, meta: RequestMeta) {
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
  const [payment] = await tx
    .insert(customerPayments)
    .values({
      companyId,
      customerId,
      orderId: order?.id ?? null,
      amount: input.amount,
      currency: await companyCurrency(tx, companyId),
      paymentDate,
      method: input.method,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      createdBy: tenant.user.id,
    })
    .returning({ id: customerPayments.id });

  const description = order ? `Mijoz to'lovi: ${order.number}` : `Mijoz to'lovi: ${customerName}`;
  const { account } = await recordCashTransaction(tx, companyId, tenant.user.id, {
    cashAccountId: await resolvePaymentAccount(tx, companyId, input.method, input.cashAccountId),
    type: "in",
    amount: input.amount,
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
      { accountId: await ledgerAccountFor(tx, companyId, account.type), debit: input.amount },
      { accountId: await requireAccountBySubtype(tx, companyId, "receivable", "asset", "Debitorlar"), credit: input.amount },
    ],
  });

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
    details: { customerId, orderId: order?.id ?? null, amount: input.amount, method: input.method, cashAccountId: account.id },
  });
  return { payment: updated!, created: true };
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
