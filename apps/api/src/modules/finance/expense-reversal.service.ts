/**
 * To'langan XARAJATNI BEKOR QILISH (audit AUD-013). O'chirilmaydi — teskari yozuvlar bitta tranzaksiyada: pul o'sha
 * kassa/bank(lar)ga qaytadi, jurnal teskari (DR kassa / CR xarajat hisobi), bank komissiyasi (bo'lsa) ham qaytadi.
 * Xarajat holati `reversed` (hisobotlardan chiqadi), sabab va kim/qachon saqlanadi. Qayta bekor qilish — 409.
 * Vazifalar ajratimi: xarajatni kiritgan xodim o'zi bekor qilmaydi (kompaniya egasidan tashqari).
 */
import { and, eq } from "drizzle-orm";
import { badRequest, conflict, forbidden, notFound } from "@bum/shared";
import { expenses } from "../../db/schema/finance.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import type { TenantContext } from "../company/tenant.js";
import { financeAudit } from "./accounts.service.js";
import { todayIso } from "./cash.service.js";
import { assertPeriodOpen } from "./journal.service.js";
import { mirrorBlockers, mirrorReferences, type SourceRef } from "./reversal.service.js";

async function feesOf(conn: DbOrTx, companyId: string, expenseId: string) {
  const rows = await conn
    .select({ id: expenses.id, status: expenses.status })
    .from(expenses)
    .where(and(eq(expenses.companyId, companyId), eq(expenses.referenceType, "expense"), eq(expenses.referenceId, expenseId)));
  return rows.filter((row) => row.status !== "reversed");
}

export async function previewExpenseReversal(conn: DbOrTx, tenant: TenantContext, expenseId: string) {
  const companyId = tenant.company.id;
  const [expense] = await conn.select().from(expenses).where(and(eq(expenses.id, expenseId), eq(expenses.companyId, companyId))).limit(1);
  if (!expense) throw notFound("Xarajat topilmadi");
  const blockers: string[] = [];
  if (expense.status === "reversed") blockers.push("Xarajat allaqachon bekor qilingan");
  else if (expense.status !== "paid") blockers.push("Faqat to'langan xarajat bekor qilinadi — kutilayotganini tahrirlang yoki o'chiring");
  if (expense.referenceType) blockers.push("Avtomatik xarajat (bank komissiyasi) o'z hujjati bilan bekor qilinadi");
  blockers.push(...(await mirrorBlockers(conn, companyId, [{ type: "expense", id: expense.id }])));
  return { expense: { id: expense.id, number: expense.number, amount: expense.amount, category: expense.category, status: expense.status }, blockers };
}

export async function reverseExpense(tx: Tx, tenant: TenantContext, expenseId: string, reason: string, meta: RequestMeta) {
  const companyId = tenant.company.id;
  const cleanReason = reason.trim();
  if (cleanReason.length < 3) throw badRequest("Bekor qilish sababini yozing");
  const today = todayIso();
  await assertPeriodOpen(tx, companyId, today);
  const [expense] = await tx.select().from(expenses).where(and(eq(expenses.id, expenseId), eq(expenses.companyId, companyId))).limit(1).for("update");
  if (!expense) throw notFound("Xarajat topilmadi");
  if (expense.status === "reversed") throw conflict("Xarajat allaqachon bekor qilingan");
  if (expense.status !== "paid") throw badRequest("Faqat to'langan xarajat bekor qilinadi");
  if (expense.referenceType) throw badRequest("Avtomatik xarajat (bank komissiyasi) o'z hujjati bilan bekor qilinadi");
  if (expense.createdBy === tenant.user.id && tenant.company.ownerId !== tenant.user.id) {
    throw forbidden("O'zingiz kiritgan xarajatni bekor qila olmaysiz — boshqa mas'ul bekor qiladi");
  }

  const fees = await feesOf(tx, companyId, expense.id);
  const refs: SourceRef[] = [{ type: "expense", id: expense.id }, ...fees.map((fee) => ({ type: "bank_fee", id: fee.id }))];
  const entries = await mirrorReferences(tx, companyId, tenant.user.id, {
    refs,
    reversalType: "expense_reversal",
    label: `Xarajat ${expense.number} bekor qilindi: ${cleanReason}`,
    date: today,
  });
  const stamp = { status: "reversed" as const, reversedAt: new Date(), reversedBy: tenant.user.id, reversalReason: cleanReason, updatedAt: new Date() };
  await tx.update(expenses).set(stamp).where(eq(expenses.id, expense.id));
  for (const fee of fees) await tx.update(expenses).set(stamp).where(eq(expenses.id, fee.id));

  await financeAudit(tx, tenant, meta, {
    action: "EXPENSE_REVERSED",
    resource: "expenses",
    resourceId: expense.id,
    details: { number: expense.number, amount: expense.amount, reason: cleanReason, fees: fees.map((fee) => fee.id), reversalJournalEntries: entries },
  });
  return { expenseId: expense.id, status: "reversed" as const, reversalJournalEntries: entries };
}
