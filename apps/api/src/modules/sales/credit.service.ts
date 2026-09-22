/**
 * Kredit nazorati — BITTA server qoidasi barcha kanallar uchun (ERP, kassa, savdo agenti).
 *
 * Uch qatlam, shu tartibda:
 *   1. `customers.credit_status = 'hold'` — QO'LDA qo'yilgan to'xtatish (rahbar qaroriga tayanadi,
 *      faqat rahbar ochadi: mijoz to'lasa ham o'zi ochilmaydi);
 *   2. siyosat chegarasi (`sales.policy`) — muddati o'tgan qarz kunlari yoki summasi chegaradan oshsa
 *      nasiya rad etiladi. Bu holat HOSILAVIY: har chaqiruvda qaytadan hisoblanadi va bazada
 *      saqlanmaydi. Sababi ikkita: (a) rad etish xatosi tranzaksiyani qaytaradi — shu tranzaksiyada
 *      yozilgan holat baribir saqlanmasdi; (b) mijoz qarzini to'laganda to'xtatish O'ZI ochilishi
 *      kerak, aks holda har to'lovdan keyin rahbar qo'lda ochishi kerak bo'lardi;
 *   3. kredit limiti — mavjud tekshiruv (`dispatchOrder`, agent buyurtmasi) o'z joyida qoladi.
 *
 * MUHIM: to'xtatish faqat QARZ QOLDIRADIGAN sotuvni bloklaydi. Naqd (to'liq to'langan) sotuv va
 * mijozning qarzni to'lashi HECH QACHON bloklanmaydi — aks holda mijoz qarzini uza olmay qolardi.
 * Shu bilan `is_active = false` (butunlay bloklash) dan farq qiladi.
 *
 * Chegaralar kompaniya sozlamasidan olinadi — kodda "sehrli" raqam yo'q; standart holatda o'chiq
 * (`null`), ya'ni mavjud xatti-harakat o'zgarmaydi.
 */
import { and, eq } from "drizzle-orm";
import { AppError } from "@bum/shared";
import { customers } from "../../db/schema/sales.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { toMinor } from "../../shared/decimal.js";
import type { TenantContext } from "../company/tenant.js";
import { todayIso } from "../finance/cash.service.js";
import { customerOverdue } from "./receivables.service.js";
import { getSalesPolicy } from "./sales-policy.service.js";

export type CreditStatus = "ok" | "hold";

export type CreditDecision = {
  allowed: boolean;
  status: CreditStatus;
  reason: string | null;
  overdueAmount: string;
  maxDaysOverdue: number;
  /** To'xtatish siyosat chegarasidan kelib chiqqanmi (hosilaviy) yoki qo'lda qo'yilganmi. */
  autoHold: boolean;
};

/** Mijozning kredit holati — hisobot va tekshiruv uchun bir xil hisoblash. */
export async function evaluateCredit(conn: DbOrTx, companyId: string, customerId: string, asOf = todayIso()): Promise<CreditDecision> {
  const [customer] = await conn
    .select({ creditStatus: customers.creditStatus, creditHoldReason: customers.creditHoldReason })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.companyId, companyId)))
    .limit(1);
  const overdue = await customerOverdue(conn, companyId, customerId, asOf);

  if (customer?.creditStatus === "hold") {
    return {
      allowed: false,
      status: "hold",
      reason: customer.creditHoldReason ?? "Nasiya to'xtatilgan",
      overdueAmount: overdue.overdueAmount,
      maxDaysOverdue: overdue.maxDaysOverdue,
      autoHold: false,
    };
  }

  const policy = await getSalesPolicy(conn, companyId);
  const days = policy.creditHoldOverdueDays;
  const amount = policy.creditHoldOverdueAmount;
  if (days !== null && overdue.maxDaysOverdue > days) {
    return {
      allowed: false,
      status: "hold",
      reason: `To'lov muddati ${overdue.maxDaysOverdue} kun o'tgan (chegara ${days} kun)`,
      overdueAmount: overdue.overdueAmount,
      maxDaysOverdue: overdue.maxDaysOverdue,
      autoHold: true,
    };
  }
  if (amount !== null && toMinor(overdue.overdueAmount) > toMinor(amount)) {
    return {
      allowed: false,
      status: "hold",
      reason: `Muddati o'tgan qarz ${overdue.overdueAmount} (chegara ${amount})`,
      overdueAmount: overdue.overdueAmount,
      maxDaysOverdue: overdue.maxDaysOverdue,
      autoHold: true,
    };
  }
  return { allowed: true, status: "ok", reason: null, overdueAmount: overdue.overdueAmount, maxDaysOverdue: overdue.maxDaysOverdue, autoHold: false };
}

/**
 * Nasiya sotuvni tekshiradi. `unpaidMinor` — shu sotuvdan keyin mijozda qoladigan to'lanmagan summa;
 * 0 yoki manfiy bo'lsa (naqd sotuv) tekshiruv o'tkazib yuboriladi.
 */
export async function assertCreditAllowed(tx: Tx, companyId: string, customerId: string, unpaidMinor: bigint): Promise<void> {
  if (unpaidMinor <= 0n) return;
  const decision = await evaluateCredit(tx, companyId, customerId);
  if (decision.allowed) return;

  throw new AppError("FORBIDDEN", `Nasiya sotuv to'xtatilgan: ${decision.reason}`, {
    reason: "credit_hold",
    overdueAmount: decision.overdueAmount,
    maxDaysOverdue: decision.maxDaysOverdue,
    autoHold: decision.autoHold,
  });
}

/** Qo'lda to'xtatish yoki ochish — `sales.approve`; kim, qachon va sabab audit bilan saqlanadi. */
export async function setCreditStatus(
  tx: Tx,
  tenant: TenantContext,
  customerId: string,
  input: { status: CreditStatus; reason: string },
) {
  const [customer] = await tx
    .select({ id: customers.id, name: customers.name, creditStatus: customers.creditStatus })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.companyId, tenant.company.id)))
    .limit(1)
    .for("update");
  if (!customer) throw new AppError("NOT_FOUND", "Mijoz topilmadi");

  const hold = input.status === "hold";
  const [updated] = await tx
    .update(customers)
    .set({
      creditStatus: input.status,
      creditHoldReason: hold ? input.reason : null,
      creditHoldAt: hold ? new Date() : null,
      creditHoldBy: hold ? tenant.user.id : null,
      updatedAt: new Date(),
    })
    .where(eq(customers.id, customerId))
    .returning({
      id: customers.id,
      name: customers.name,
      creditStatus: customers.creditStatus,
      creditHoldReason: customers.creditHoldReason,
      creditHoldAt: customers.creditHoldAt,
      creditHoldBy: customers.creditHoldBy,
    });
  return { customer: updated!, previousStatus: customer.creditStatus };
}
