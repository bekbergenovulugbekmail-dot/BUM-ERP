/**
 * Ta'minotchiga to'lov (convex/purchase/orders.ts `recordPayment`).
 *
 * Bitta tranzaksiyada: to'lov, kassa/bank chiqimi (`recordCashTransaction`), jurnal
 * (DR kreditorlar / CR kassa yoki bank), buyurtmaning to'langan summasi, ta'minotchi qarzi.
 *
 * Convex'dan farqlar:
 *  - usul "bank" bo'lsa ham pul asosiy (naqd) kassadan yechilar, jurnal esa bankni
 *    kreditlardi — endi bank usulida bank hisobidan, jurnal haqiqiy hisob turiga qarab
 *  - ortiqcha to'lov mumkin edi (buyurtma summasidan ham, qarzdan ham)
 *  - buyurtma boshqa ta'minotchiniki ekani tekshirilmasdi; qoralama/bekor qilingan buyurtmaga ham to'lanardi
 *  - takroriy `reference` boshqa ta'minotchining to'lovini qaytarardi — endi ta'minotchi ichida, bazada unique
 *  - to'lov buyurtmani qabul qilinmasdan "paid" qilardi (keyin qabul qilib bo'lmasdi) —
 *    endi "paid" faqat to'liq qabul + to'liq to'lovda; tovar kelmasdan to'lov — avans
 *  - kassa manfiyga tushardi; `purchase.create` bilan — endi `purchase.approve`
 */
import { and, desc, eq, getTableColumns, lt, or, sql } from "drizzle-orm";
import { badRequest, notFound } from "@bum/shared";
import { cashAccounts } from "../../db/schema/finance.js";
import { purchaseOrders, supplierPayments, suppliers } from "../../db/schema/purchase.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { UUID_RE, decodeCursor, encodeCursor } from "../../shared/cursor.js";
import { fromMinor, toMinor } from "../../shared/decimal.js";
import type { TenantContext } from "../company/tenant.js";
import { companyCurrency } from "../finance/accounts.service.js";
import { ledgerAccountFor, recordCashTransaction, todayIso } from "../finance/cash.service.js";
import { postJournalEntry, requireAccountBySubtype } from "../finance/journal.service.js";
import { purchaseAudit } from "./suppliers.service.js";

const { legacyId: _legacyId, companyId: _companyId, ...paymentFields } = getTableColumns(supplierPayments);

export type PaymentMethod = (typeof supplierPayments.method.enumValues)[number];

export type SupplierPaymentInput = {
  supplierId: string;
  orderId?: string | null;
  amount: string;
  paymentDate?: string;
  method: PaymentMethod;
  cashAccountId?: string | null;
  reference?: string | null;
  notes?: string | null;
};

async function firstBankAccount(tx: Tx, companyId: string) {
  const [bank] = await tx
    .select({ id: cashAccounts.id })
    .from(cashAccounts)
    .where(and(eq(cashAccounts.companyId, companyId), eq(cashAccounts.type, "bank"), eq(cashAccounts.isActive, true)))
    .orderBy(desc(cashAccounts.isDefault), cashAccounts.name)
    .limit(1);
  if (!bank) throw badRequest("Faol bank hisobi yo'q");
  return bank.id;
}

export async function recordSupplierPayment(tx: Tx, tenant: TenantContext, input: SupplierPaymentInput, meta: RequestMeta) {
  const companyId = tenant.company.id;
  const [supplier] = await tx
    .select({ id: suppliers.id, name: suppliers.name, totalDebt: suppliers.totalDebt })
    .from(suppliers)
    .where(and(eq(suppliers.id, input.supplierId), eq(suppliers.companyId, companyId)))
    .limit(1)
    .for("update");
  if (!supplier) throw notFound("Ta'minotchi topilmadi");

  if (input.reference) {
    const [existing] = await tx
      .select(paymentFields)
      .from(supplierPayments)
      .where(
        and(
          eq(supplierPayments.companyId, companyId),
          eq(supplierPayments.supplierId, supplier.id),
          eq(supplierPayments.reference, input.reference),
        ),
      )
      .limit(1);
    if (existing) return { payment: existing, created: false };
  }

  const amount = toMinor(input.amount);
  let order: { id: string; number: string; status: string; totalAmount: string; paidAmount: string } | null = null;
  if (input.orderId) {
    const [row] = await tx
      .select({
        id: purchaseOrders.id,
        number: purchaseOrders.number,
        supplierId: purchaseOrders.supplierId,
        status: purchaseOrders.status,
        totalAmount: purchaseOrders.totalAmount,
        paidAmount: purchaseOrders.paidAmount,
      })
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, input.orderId), eq(purchaseOrders.companyId, companyId)))
      .limit(1)
      .for("update");
    if (!row) throw notFound("Buyurtma topilmadi");
    if (row.supplierId !== supplier.id) throw badRequest("Buyurtma boshqa ta'minotchiniki");
    if (row.status === "draft" || row.status === "cancelled") {
      throw badRequest("Qoralama yoki bekor qilingan buyurtmaga to'lov qilib bo'lmaydi");
    }
    const balance = toMinor(row.totalAmount) - toMinor(row.paidAmount);
    if (amount > balance) throw badRequest(`To'lov buyurtma qoldig'idan ortiq (qoldiq ${fromMinor(balance)})`);
    order = row;
  } else {
    const debt = toMinor(supplier.totalDebt);
    if (amount > debt) {
      throw badRequest(`To'lov ta'minotchi qarzidan ortiq (qarz ${fromMinor(debt > 0n ? debt : 0n)}) — avans uchun buyurtmani tanlang`);
    }
  }

  const paymentDate = input.paymentDate ?? todayIso();
  const cashAccountId =
    input.cashAccountId ??
    (input.method === "bank" || input.method === "transfer" ? await firstBankAccount(tx, companyId) : null);

  const [payment] = await tx
    .insert(supplierPayments)
    .values({
      companyId,
      supplierId: supplier.id,
      orderId: order?.id ?? null,
      amount: input.amount,
      currency: await companyCurrency(tx, companyId),
      paymentDate,
      method: input.method,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      createdBy: tenant.user.id,
    })
    .returning({ id: supplierPayments.id });

  const description = order ? `${supplier.name}ga to'lov (${order.number})` : `${supplier.name}ga to'lov`;
  const { account } = await recordCashTransaction(tx, companyId, tenant.user.id, {
    cashAccountId,
    type: "out",
    amount: input.amount,
    txDate: paymentDate,
    description,
    category: "purchase",
    referenceType: "supplier_payment",
    referenceId: payment!.id,
  });
  const { entry } = await postJournalEntry(tx, companyId, tenant.user.id, {
    entryDate: paymentDate,
    description,
    referenceType: "supplier_payment",
    referenceId: payment!.id,
    lines: [
      { accountId: await requireAccountBySubtype(tx, companyId, "payable", "liability", "Kreditorlar"), debit: input.amount },
      { accountId: await ledgerAccountFor(tx, companyId, account.type), credit: input.amount },
    ],
  });

  const [updated] = await tx
    .update(supplierPayments)
    .set({ cashAccountId: account.id, journalEntryId: entry.id, updatedAt: new Date() })
    .where(eq(supplierPayments.id, payment!.id))
    .returning(paymentFields);

  if (order) {
    const paid = toMinor(order.paidAmount) + amount;
    const settled = paid >= toMinor(order.totalAmount) && (order.status === "received" || order.status === "invoiced");
    await tx
      .update(purchaseOrders)
      .set({ paidAmount: fromMinor(paid), ...(settled ? { status: "paid" as const } : {}), updatedAt: new Date() })
      .where(eq(purchaseOrders.id, order.id));
  }
  await tx
    .update(suppliers)
    .set({ totalDebt: sql`${suppliers.totalDebt} - ${input.amount}::numeric`, updatedAt: new Date() })
    .where(eq(suppliers.id, supplier.id));

  await purchaseAudit(tx, tenant, meta, {
    action: "SUPPLIER_PAYMENT_RECORDED",
    resource: "supplier_payments",
    resourceId: payment!.id,
    details: { supplierId: supplier.id, orderId: order?.id ?? null, amount: input.amount, cashAccountId: account.id },
  });
  return { payment: updated!, created: true };
}

export async function listSupplierPayments(
  conn: DbOrTx,
  tenant: TenantContext,
  options: { supplierId?: string; orderId?: string; limit: number; cursor?: string },
) {
  let after: { date: string; id: string } | null = null;
  if (options.cursor) {
    const [date, id] = decodeCursor(options.cursor, 2) as [string, string];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !UUID_RE.test(id)) throw badRequest("Kursor noto'g'ri");
    after = { date, id };
  }

  const rows = await conn
    .select({ ...paymentFields, supplierName: suppliers.name })
    .from(supplierPayments)
    .innerJoin(suppliers, eq(suppliers.id, supplierPayments.supplierId))
    .where(
      and(
        eq(supplierPayments.companyId, tenant.company.id),
        options.supplierId ? eq(supplierPayments.supplierId, options.supplierId) : undefined,
        options.orderId ? eq(supplierPayments.orderId, options.orderId) : undefined,
        after
          ? or(
              lt(supplierPayments.paymentDate, after.date),
              and(eq(supplierPayments.paymentDate, after.date), lt(supplierPayments.id, after.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(supplierPayments.paymentDate), desc(supplierPayments.id))
    .limit(options.limit + 1);

  const page = rows.slice(0, options.limit);
  const last = page.at(-1);
  return {
    payments: page,
    nextCursor: rows.length > options.limit && last ? encodeCursor([last.paymentDate, last.id]) : null,
  };
}
