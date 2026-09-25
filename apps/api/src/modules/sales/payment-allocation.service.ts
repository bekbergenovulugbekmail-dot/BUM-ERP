/**
 * Mijozdan pul qabul qilinadigan hamma joyda (POS web va desktop, yetkazishda, qarz va buyurtma to'lovi) bitta
 * qoidalar to'plami: to'lov hujjati (`payments`) va usul bo'yicha qismlar (`customer_payments`: usul, summa,
 * kassa/bank hisobi, terminal). Har qism o'z hisobiga kassa harakati va jurnal (DR shu hisobning buxgalteriya
 * hisobi / CR debitorlar) bilan yoziladi — "hammasi naqd" deb bitta yozuv qilinmaydi.
 *
 * Qismlarni tekshirish va summalar arifmetikasi yo'nalishdan mustaqil — u `finance/payment-parts.service.ts` da
 * va ta'minotchiga to'lov hamda xarajat to'lovida ham aynan shu qoidalar ishlatiladi. Bu yerda faqat KIRIM
 * tomoni: to'lov hujjati, mijoz/buyurtma bog'lanishi va debitorlik yozuvlari.
 */
import { and, asc, eq } from "drizzle-orm";
import { badRequest, notFound, type AllocationMethod } from "@bum/shared";
import { customerPayments, payments, salesOrders } from "../../db/schema/sales.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { fromMinor } from "../../shared/decimal.js";
import type { TenantContext } from "../company/tenant.js";
import { companyCurrency } from "../finance/accounts.service.js";
import { assertPeriodOpen } from "../finance/journal.service.js";
import { resolvePaymentParts, type ResolvedPart } from "../finance/payment-parts.service.js";
import { recordCustomerPayment } from "./payments.service.js";

// Yo'nalishdan mustaqil qatlam — mavjud chaqiruvchilar shu modul orqali ishlatishda davom etadi
export {
  resolvePaymentParts,
  settlePaymentParts,
  type PaymentPartInput,
  type ResolvedPart,
  type SettleRules,
  type Settlement,
} from "../finance/payment-parts.service.js";

export type PaymentSource = "pos" | "pos_device" | "delivery" | "sales_payment" | "pos_customer_payment" | "bank_receipt";

/** Idempotentlik kaliti bo'yicha mavjud hujjat va uning qismlari. */
export async function findPaymentByKey(conn: DbOrTx, companyId: string, idempotencyKey: string) {
  const [header] = await conn
    .select()
    .from(payments)
    .where(and(eq(payments.companyId, companyId), eq(payments.idempotencyKey, idempotencyKey)))
    .limit(1);
  if (!header) return null;
  const allocations = await conn
    .select()
    .from(customerPayments)
    .where(eq(customerPayments.paymentId, header.id))
    .orderBy(asc(customerPayments.createdAt), asc(customerPayments.id));
  return { payment: header, allocations };
}

export async function createPaymentHeader(
  tx: Tx,
  tenant: TenantContext,
  input: { source: PaymentSource; idempotencyKey?: string | null; customerId?: string | null; orderId?: string | null; total: bigint },
) {
  const [header] = await tx
    .insert(payments)
    .values({
      companyId: tenant.company.id,
      source: input.source,
      idempotencyKey: input.idempotencyKey ?? null,
      customerId: input.customerId ?? null,
      orderId: input.orderId ?? null,
      totalAmount: fromMinor(input.total),
      currency: await companyCurrency(tx, tenant.company.id),
      createdBy: tenant.user.id,
      createdAt: new Date(),
    })
    .returning();
  return header!;
}

/**
 * Tayyor qismlarni yozadi: har biri `recordCustomerPayment` (kassa/bank kirimi, jurnal, buyurtma to'langani, mijoz qarzi).
 * Havola — `kalit:tartib` (kalit bo'lsa), birinchi qism uchun `firstReference` berilsa — shu (eski havolalar bilan mos).
 */
export async function recordAllocations(
  tx: Tx,
  tenant: TenantContext,
  header: { id: string; idempotencyKey: string | null },
  parts: ResolvedPart[],
  target: {
    customerId?: string | null;
    orderId?: string | null;
    paymentDate?: string;
    notes?: string | null;
    firstReference?: string | null;
    /** Kassa smenasi — har qism shu sessiyaga bog'lanadi. */
    posShiftId?: string | null;
  },
  meta: RequestMeta,
) {
  const rows = [];
  for (const [index, part] of parts.entries()) {
    const reference =
      index === 0 && target.firstReference ? target.firstReference : header.idempotencyKey ? `${header.idempotencyKey}:${index}` : null;
    const { payment } = await recordCustomerPayment(
      tx,
      tenant,
      {
        customerId: target.orderId ? null : (target.customerId ?? null),
        orderId: target.orderId ?? null,
        amount: fromMinor(part.amount),
        method: part.method,
        cashAccountId: part.cashAccountId,
        terminalId: part.terminalId,
        paymentId: header.id,
        posShiftId: target.posShiftId ?? null,
        reference,
        ...(target.paymentDate ? { paymentDate: target.paymentDate } : {}),
        notes: target.notes ?? null,
      },
      meta,
    );
    rows.push(payment);
  }
  return rows;
}

/**
 * Mijoz yoki buyurtma bo'yicha aralash to'lov (qarz, buyurtma to'lovi, kassada qarz to'lash): jami summa qismlar
 * yig'indisi; ortiqcha to'lov (qarz yoki buyurtma qoldig'idan) — rad, hech bir qism yozilmaydi (bitta tranzaksiya).
 */
export async function recordMixedCustomerPayment(
  tx: Tx,
  tenant: TenantContext,
  input: {
    source: PaymentSource;
    customerId?: string | null;
    orderId?: string | null;
    parts: import("../finance/payment-parts.service.js").PaymentPartInput[];
    idempotencyKey?: string | null;
    paymentDate?: string;
    notes?: string | null;
    allowedMethods?: readonly AllocationMethod[];
    /** Kassa smenasi — kassada qabul qilingan to'lov shu sessiyaga tegishli. */
    posShiftId?: string | null;
  },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  // Audit AUD-011: qo'lda kiritilgan to'lov sanasi yopilgan davrga tushmasin (kassa/oflayn yo'llar — bugungi yoki qurilma sanasi)
  if (input.source === "sales_payment" && input.paymentDate) await assertPeriodOpen(tx, companyId, input.paymentDate);
  if (!input.orderId && !input.customerId) throw badRequest("Mijoz yoki buyurtma tanlanishi kerak");
  // To'lov hujjatidagi mijoz buyurtma mijozi bilan bir xil (boshqa kompaniya mijozi yozilib qolmasin)
  if (input.orderId && input.customerId) {
    const [order] = await tx
      .select({ customerId: salesOrders.customerId })
      .from(salesOrders)
      .where(and(eq(salesOrders.id, input.orderId), eq(salesOrders.companyId, companyId)))
      .limit(1);
    if (!order) throw notFound("Buyurtma topilmadi");
    if (order.customerId !== input.customerId) throw badRequest("Buyurtma boshqa mijozniki");
  }
  if (input.idempotencyKey) {
    const existing = await findPaymentByKey(tx, companyId, input.idempotencyKey);
    if (existing) return { ...existing, created: false };
  }
  const parts = await resolvePaymentParts(tx, companyId, input.parts, { allowedMethods: input.allowedMethods });
  if (parts.length === 0) throw badRequest("To'lov summasi kiritilmagan");
  const total = parts.reduce((sum, part) => sum + part.amount, 0n);
  const header = await createPaymentHeader(tx, tenant, {
    source: input.source,
    idempotencyKey: input.idempotencyKey,
    customerId: input.customerId,
    orderId: input.orderId,
    total,
  });
  const allocations = await recordAllocations(tx, tenant, header, parts, input, meta);
  return { payment: header, allocations, created: true };
}
