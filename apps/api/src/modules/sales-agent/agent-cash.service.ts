/**
 * Savdo agenti yig'gan naqd pul — yetkazuvchidagi bilan bir xil qoida:
 * mijozdan olingan naqd asosiy kassaga emas, agentning "yo'ldagi naqd" hisobiga tushadi va
 * kassaga topshirilganda o'tkaziladi. Shunda "kimda qancha pul bor" har doim ko'rinadi.
 *
 * Buxgalteriyada bu umumiy naqd (1010) ichida qoladi: topshirish — kassalar orasidagi o'tkazma,
 * sotuv jurnaliga tegmaydi.
 */
import { and, desc, eq } from "drizzle-orm";
import { AppError, badRequest, notFound } from "@bum/shared";
import { salesReps } from "../../db/schema/crm.js";
import { cashAccounts, cashTransactions } from "../../db/schema/finance.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { fromMinor, toMinor } from "../../shared/decimal.js";
import type { RequestMeta } from "../../shared/audit.js";
import { effectivePermissions, type TenantContext } from "../company/tenant.js";
import { companyCurrency } from "../finance/accounts.service.js";
import { transferCash } from "../finance/cash.service.js";

const accountFields = {
  id: cashAccounts.id,
  name: cashAccounts.name,
  currency: cashAccounts.currency,
  balance: cashAccounts.balance,
  isActive: cashAccounts.isActive,
};

function findRepAccount(conn: DbOrTx, companyId: string, salesRepId: string) {
  return conn
    .select(accountFields)
    .from(cashAccounts)
    .where(and(eq(cashAccounts.companyId, companyId), eq(cashAccounts.salesRepId, salesRepId)))
    .limit(1);
}

/** Agentning "yo'ldagi naqd" hisobi — birinchi naqd to'lovda yaratiladi (asosiy valyutada). */
export async function salesRepCashAccount(tx: Tx, companyId: string, rep: { id: string; code: string }): Promise<string> {
  const [existing] = await findRepAccount(tx, companyId, rep.id);
  if (existing) return existing.id;
  await tx
    .insert(cashAccounts)
    .values({
      companyId,
      name: `Savdo agenti ${rep.code} — yo'ldagi naqd`,
      type: "cash",
      currency: await companyCurrency(tx, companyId),
      salesRepId: rep.id,
    })
    .onConflictDoNothing();
  const [created] = await findRepAccount(tx, companyId, rep.id);
  return created!.id;
}

async function companyRep(conn: DbOrTx, companyId: string, salesRepId: string) {
  const [rep] = await conn
    .select({ id: salesReps.id, code: salesReps.code, name: salesReps.name })
    .from(salesReps)
    .where(and(eq(salesReps.id, salesRepId), eq(salesReps.companyId, companyId)))
    .limit(1);
  if (!rep) throw notFound("Savdo agenti topilmadi");
  return rep;
}

/** Agentdagi topshirilmagan naqd va oxirgi topshirishlar. */
export async function repCashSummary(conn: DbOrTx, companyId: string, salesRepId: string) {
  const rep = await companyRep(conn, companyId, salesRepId);
  const [account] = await findRepAccount(conn, companyId, salesRepId);
  const handovers = account
    ? await conn
        .select({
          id: cashTransactions.id,
          amount: cashTransactions.amount,
          txDate: cashTransactions.txDate,
          description: cashTransactions.description,
          createdAt: cashTransactions.createdAt,
        })
        .from(cashTransactions)
        .where(and(eq(cashTransactions.cashAccountId, account.id), eq(cashTransactions.type, "out")))
        .orderBy(desc(cashTransactions.createdAt))
        .limit(20)
    : [];
  return {
    agent: rep,
    balance: account?.balance ?? "0.00",
    currency: account?.currency ?? (await companyCurrency(conn, companyId)),
    cashAccountId: account?.id ?? null,
    handovers,
  };
}

/**
 * Naqdni kassaga topshirish: standart — kompaniyaning asosiy naqd kassasi; boshqa kassani tanlash
 * `finance.manage` talab qiladi. Agentdagi summadan oshmaydi va boshqa agent hisobiga o'tmaydi.
 */
export async function handoverRepCash(
  tx: Tx,
  tenant: TenantContext,
  salesRepId: string,
  input: { amount: string; toCashAccountId?: string | null; notes?: string | null },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const rep = await companyRep(tx, companyId, salesRepId);
  const [account] = await tx
    .select(accountFields)
    .from(cashAccounts)
    .where(and(eq(cashAccounts.companyId, companyId), eq(cashAccounts.salesRepId, salesRepId)))
    .limit(1)
    .for("update");

  const amount = toMinor(input.amount);
  if (amount <= 0n) throw badRequest("Summa noldan katta bo'lishi kerak");
  const balance = account ? toMinor(account.balance) : 0n;
  if (!account || amount > balance) {
    throw badRequest(`Topshiriladigan summa agentdagi naqddan oshmasin (${fromMinor(balance)})`, {
      reason: "exceeds_agent_cash",
      balance: fromMinor(balance),
    });
  }

  let targetId = input.toCashAccountId ?? null;
  if (targetId) {
    if (!(await effectivePermissions(tx, tenant)).includes("finance.manage")) {
      throw new AppError("FORBIDDEN", "Boshqa kassaga topshirish uchun ruxsat yo'q: finance.manage", {
        reason: "target_requires_finance",
      });
    }
  } else {
    const [main] = await tx
      .select({ id: cashAccounts.id })
      .from(cashAccounts)
      .where(
        and(
          eq(cashAccounts.companyId, companyId),
          eq(cashAccounts.isDefault, true),
          eq(cashAccounts.type, "cash"),
          eq(cashAccounts.isActive, true),
        ),
      )
      .limit(1);
    if (!main) throw badRequest("Asosiy naqd kassa topilmadi — kassani tanlang");
    targetId = main.id;
  }

  const [target] = await tx
    .select({ type: cashAccounts.type, isActive: cashAccounts.isActive, salesRepId: cashAccounts.salesRepId })
    .from(cashAccounts)
    .where(and(eq(cashAccounts.id, targetId), eq(cashAccounts.companyId, companyId)))
    .limit(1);
  if (!target || !target.isActive) throw badRequest("Kassa topilmadi yoki faol emas");
  if (target.salesRepId) throw badRequest("Boshqa agentning hisobiga topshirib bo'lmaydi");

  const transfer = await transferCash(
    tx,
    tenant,
    {
      fromCashAccountId: account.id,
      toCashAccountId: targetId,
      amount: input.amount,
      description: input.notes ?? `Savdo agenti ${rep.code} naqdni kassaga topshirdi`,
    },
    meta,
  );
  return { transfer, agent: rep };
}
