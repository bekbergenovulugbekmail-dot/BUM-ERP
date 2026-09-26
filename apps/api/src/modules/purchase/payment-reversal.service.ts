/**
 * Ta'minotchiga to'lovni BEKOR QILISH (audit AUD-013). O'chirilmaydi — teskari yozuvlar bitta tranzaksiyada:
 *   pul o'sha kassa/bankka qaytadi (kirim), jurnal teskari (asl kurs va kitob qiymatida — kurs farqi ham qaytadi),
 *   bank komissiyasi (bo'lsa) qaytadi va uning xarajati `reversed`, buyurtmaning to'langan summasi kamayadi ("paid" →
 *   "received"), ta'minotchi qarzi va kitob qiymati tiklanadi. To'lov `reversed`, sabab va kim/qachon saqlanadi.
 * Himoya: qator `FOR UPDATE`, qayta bekor qilish — 409, sabab majburiy, bugungi sana ochiq davrda, `finance.approve`.
 */
import { and, eq, sql } from "drizzle-orm";
import { badRequest, conflict, notFound } from "@bum/shared";
import { expenses } from "../../db/schema/finance.js";
import { purchaseOrderCurrencies, purchaseOrders, supplierPayments, suppliers } from "../../db/schema/purchase.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { fromMinor, toMinor } from "../../shared/decimal.js";
import type { TenantContext } from "../company/tenant.js";
import { todayIso } from "../finance/cash.service.js";
import { assertPeriodOpen } from "../finance/journal.service.js";
import { mirrorBlockers, mirrorReferences, type SourceRef } from "../finance/reversal.service.js";
import { applySupplierBalance } from "./supplier-balances.service.js";
import { purchaseAudit } from "./suppliers.service.js";

async function paymentRow(conn: DbOrTx, companyId: string, paymentId: string, lock: boolean) {
  const query = conn.select().from(supplierPayments).where(and(eq(supplierPayments.id, paymentId), eq(supplierPayments.companyId, companyId))).limit(1);
  const [row] = lock ? await query.for("update") : await query;
  if (!row) throw notFound("To'lov topilmadi");
  return row;
}

async function feeRefs(conn: DbOrTx, companyId: string, paymentId: string) {
  const fees = await conn
    .select({ id: expenses.id, amount: expenses.amount, status: expenses.status })
    .from(expenses)
    .where(and(eq(expenses.companyId, companyId), eq(expenses.referenceType, "supplier_payment"), eq(expenses.referenceId, paymentId)));
  return fees.filter((fee) => fee.status !== "reversed");
}

export async function previewSupplierPaymentReversal(conn: DbOrTx, tenant: TenantContext, paymentId: string) {
  const companyId = tenant.company.id;
  const payment = await paymentRow(conn, companyId, paymentId, false);
  const [supplier] = await conn.select({ name: suppliers.name }).from(suppliers).where(eq(suppliers.id, payment.supplierId)).limit(1);
  const fees = await feeRefs(conn, companyId, payment.id);
  const blockers: string[] = [];
  if (payment.status === "reversed") blockers.push("To'lov allaqachon bekor qilingan");
  // Pul hisobga QAYTADI (kirim) — kassada yetmaslik muammosi yo'q; faqat tekshiruv uchun umumiy qatlam
  blockers.push(...(await mirrorBlockers(conn, companyId, [{ type: "supplier_payment", id: payment.id }])));
  let order: { number: string; status: string } | null = null;
  if (payment.orderId) {
    const [row] = await conn.select({ number: purchaseOrders.number, status: purchaseOrders.status }).from(purchaseOrders).where(eq(purchaseOrders.id, payment.orderId)).limit(1);
    order = row ?? null;
  }
  return {
    payment: { id: payment.id, amount: payment.amount, currency: payment.currency, paymentDate: payment.paymentDate, method: payment.method, status: payment.status },
    supplier: supplier?.name ?? "—",
    order,
    commission: fees.reduce((sum, fee) => sum + toMinor(fee.amount), 0n) > 0n ? fromMinor(fees.reduce((sum, fee) => sum + toMinor(fee.amount), 0n)) : null,
    blockers,
  };
}

export async function reverseSupplierPayment(tx: Tx, tenant: TenantContext, paymentId: string, reason: string, meta: RequestMeta) {
  const companyId = tenant.company.id;
  const cleanReason = reason.trim();
  if (cleanReason.length < 3) throw badRequest("Bekor qilish sababini yozing");
  const today = todayIso();
  await assertPeriodOpen(tx, companyId, today);

  const payment = await paymentRow(tx, companyId, paymentId, true);
  if (payment.status === "reversed") throw conflict("To'lov allaqachon bekor qilingan");
  const [supplier] = await tx.select({ name: suppliers.name }).from(suppliers).where(eq(suppliers.id, payment.supplierId)).limit(1).for("update");
  const label = `${supplier?.name ?? "Ta'minotchi"}ga to'lov bekor qilindi (${payment.paymentDate}): ${cleanReason}`;

  // 1) Pul va jurnal — to'lovning o'zi va bank komissiyasi
  const fees = await feeRefs(tx, companyId, payment.id);
  const refs: SourceRef[] = [{ type: "supplier_payment", id: payment.id }, ...fees.map((fee) => ({ type: "bank_fee", id: fee.id }))];
  const entries = await mirrorReferences(tx, companyId, tenant.user.id, { refs, reversalType: "supplier_payment_reversal", label, date: today });
  for (const fee of fees) {
    await tx
      .update(expenses)
      .set({ status: "reversed", reversedAt: new Date(), reversedBy: tenant.user.id, reversalReason: cleanReason, updatedAt: new Date() })
      .where(eq(expenses.id, fee.id));
  }

  // 2) Buyurtma: to'langan summa kamayadi, "to'langan" holati qabul qilinganga qaytadi
  if (payment.orderId) {
    await tx
      .update(purchaseOrderCurrencies)
      .set({ paidAmount: sql`greatest(${purchaseOrderCurrencies.paidAmount} - ${payment.amount}::numeric, 0)`, updatedAt: new Date() })
      .where(and(eq(purchaseOrderCurrencies.orderId, payment.orderId), eq(purchaseOrderCurrencies.currency, payment.currency)));
    await tx
      .update(purchaseOrders)
      .set({
        paidAmount: sql`greatest(${purchaseOrders.paidAmount} - ${payment.baseAmount}::numeric, 0)`,
        status: sql`case when ${purchaseOrders.status} = 'paid' then 'received'::purchase_order_status else ${purchaseOrders.status} end`,
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, payment.orderId));
  }

  // 3) Ta'minotchi qarzi va kitob qiymati — to'lov kamaytirganining aynan teskarisi
  await applySupplierBalance(tx, {
    companyId,
    userId: tenant.user.id,
    supplierId: payment.supplierId,
    currency: payment.currency,
    debtDelta: toMinor(payment.amount),
    bookDelta: toMinor(payment.baseAmount) + toMinor(payment.fxAmount),
    date: today,
    description: supplier?.name ?? "",
  });

  await tx
    .update(supplierPayments)
    .set({ status: "reversed", reversedAt: new Date(), reversedBy: tenant.user.id, reversalReason: cleanReason, reversalJournalEntryId: entries[0] ?? null, updatedAt: new Date() })
    .where(eq(supplierPayments.id, payment.id));

  await purchaseAudit(tx, tenant, meta, {
    action: "SUPPLIER_PAYMENT_REVERSED",
    resource: "supplier_payments",
    resourceId: payment.id,
    details: { reason: cleanReason, amount: payment.amount, currency: payment.currency, orderId: payment.orderId, fees: fees.map((fee) => fee.id), reversalJournalEntries: entries },
  });
  return { paymentId: payment.id, status: "reversed" as const, reversalJournalEntries: entries };
}
