/**
 * Yetkazuvchi yig'gan naqd pul (kompaniya egasining qarori): mijozdan olingan naqd asosiy kassaga emas, yetkazuvchining
 * "yo'ldagi naqd" hisobiga tushadi va kassaga topshirilganda o'tkaziladi — kimda qancha pul borligi ko'rinadi.
 * Hisob buxgalteriyada umumiy naqd (1010): topshirish kassalar orasidagi o'tkazma, sotuv jurnali o'zgarmaydi.
 */
import { and, desc, eq } from "drizzle-orm";
import { AppError, badRequest, notFound } from "@bum/shared";
import { deliveryAgents } from "../../db/schema/delivery.js";
import { cashAccounts, cashTransactions } from "../../db/schema/finance.js";
import { users } from "../../db/schema/platform.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import { fromMinor, toMinor } from "../../shared/decimal.js";
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

function findAgentAccount(conn: DbOrTx, companyId: string, deliveryAgentId: string) {
  return conn
    .select(accountFields)
    .from(cashAccounts)
    .where(and(eq(cashAccounts.companyId, companyId), eq(cashAccounts.deliveryAgentId, deliveryAgentId)))
    .limit(1);
}

/** Yetkazuvchining "yo'ldagi naqd" hisobi — birinchi naqd to'lovda yaratiladi (asosiy valyutada). */
export async function agentCashAccount(tx: Tx, companyId: string, agent: { id: string; code: string }): Promise<string> {
  const [existing] = await findAgentAccount(tx, companyId, agent.id);
  if (existing) return existing.id;
  await tx
    .insert(cashAccounts)
    .values({ companyId, name: `Yetkazuvchi ${agent.code} — yo'ldagi naqd`, type: "cash", currency: await companyCurrency(tx, companyId), deliveryAgentId: agent.id })
    .onConflictDoNothing();
  const [created] = await findAgentAccount(tx, companyId, agent.id);
  return created!.id;
}

async function companyAgent(conn: DbOrTx, companyId: string, deliveryAgentId: string) {
  const [agent] = await conn
    .select({ id: deliveryAgents.id, code: deliveryAgents.code, name: users.name })
    .from(deliveryAgents)
    .innerJoin(users, eq(users.id, deliveryAgents.userId))
    .where(and(eq(deliveryAgents.id, deliveryAgentId), eq(deliveryAgents.companyId, companyId)))
    .limit(1);
  if (!agent) throw notFound("Yetkazuvchi agent topilmadi");
  return agent;
}

/** Yetkazuvchidagi naqd va oxirgi topshirishlar. */
export async function agentCashSummary(conn: DbOrTx, companyId: string, deliveryAgentId: string) {
  const agent = await companyAgent(conn, companyId, deliveryAgentId);
  const [account] = await findAgentAccount(conn, companyId, deliveryAgentId);
  const handovers = account
    ? await conn
        .select({ id: cashTransactions.id, amount: cashTransactions.amount, txDate: cashTransactions.txDate, description: cashTransactions.description, createdAt: cashTransactions.createdAt })
        .from(cashTransactions)
        .where(and(eq(cashTransactions.cashAccountId, account.id), eq(cashTransactions.type, "out")))
        .orderBy(desc(cashTransactions.createdAt))
        .limit(20)
    : [];
  return {
    agent,
    balance: account?.balance ?? "0.00",
    currency: account?.currency ?? (await companyCurrency(conn, companyId)),
    cashAccountId: account?.id ?? null,
    handovers,
  };
}

/**
 * Naqdni kassaga topshirish: standart — kompaniyaning asosiy naqd kassasi (`delivery.manage`); boshqa kassani tanlash —
 * `finance.manage`. Yetkazuvchidagi summadan oshmaydi; boshqa yetkazuvchi hisobiga o'tkazilmaydi.
 */
export async function handoverAgentCash(
  tx: Tx,
  tenant: TenantContext,
  deliveryAgentId: string,
  input: { amount: string; toCashAccountId?: string | null; notes?: string | null },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const agent = await companyAgent(tx, companyId, deliveryAgentId);
  const [account] = await tx
    .select(accountFields)
    .from(cashAccounts)
    .where(and(eq(cashAccounts.companyId, companyId), eq(cashAccounts.deliveryAgentId, deliveryAgentId)))
    .limit(1)
    .for("update");
  const amount = toMinor(input.amount);
  if (amount <= 0n) throw badRequest("Summa noldan katta bo'lishi kerak");
  const balance = account ? toMinor(account.balance) : 0n;
  if (!account || amount > balance) {
    throw badRequest(`Topshiriladigan summa yetkazuvchidagi naqddan oshmasin (${fromMinor(balance)})`, { reason: "exceeds_agent_cash", balance: fromMinor(balance) });
  }

  let targetId = input.toCashAccountId ?? null;
  if (targetId) {
    if (!(await effectivePermissions(tx, tenant)).includes("finance.manage")) {
      throw new AppError("FORBIDDEN", "Boshqa kassaga topshirish uchun ruxsat yo'q: finance.manage", { reason: "target_requires_finance" });
    }
  } else {
    const [main] = await tx
      .select({ id: cashAccounts.id })
      .from(cashAccounts)
      .where(and(eq(cashAccounts.companyId, companyId), eq(cashAccounts.isDefault, true), eq(cashAccounts.type, "cash"), eq(cashAccounts.isActive, true)))
      .limit(1);
    if (!main) throw badRequest("Asosiy naqd kassa topilmadi — kassani tanlang");
    targetId = main.id;
  }
  const [target] = await tx
    .select({ type: cashAccounts.type, isActive: cashAccounts.isActive, deliveryAgentId: cashAccounts.deliveryAgentId })
    .from(cashAccounts)
    .where(and(eq(cashAccounts.id, targetId), eq(cashAccounts.companyId, companyId)))
    .limit(1);
  if (!target) throw notFound("Kassa topilmadi");
  if (target.deliveryAgentId) throw badRequest("Naqd yetkazuvchi hisobiga emas, kassaga topshiriladi");
  if (target.type !== "cash" || !target.isActive) throw badRequest("Naqd pul faol naqd kassaga topshiriladi");

  const notes = input.notes?.trim() || null;
  const transfer = await transferCash(
    tx,
    tenant,
    {
      fromCashAccountId: account.id,
      toCashAccountId: targetId,
      amount: fromMinor(amount),
      description: `Yetkazuvchi ${agent.code} naqdni topshirdi${notes ? `: ${notes}` : ""}`,
    },
    meta,
  );
  await writeAuditLog(
    {
      userId: tenant.user.id,
      userName: tenant.user.name,
      companyId,
      action: "DELIVERY_CASH_HANDOVER",
      resource: "delivery_agents",
      resourceId: deliveryAgentId,
      details: { amount: fromMinor(amount), toCashAccountId: targetId, referenceId: transfer.referenceId },
      ...meta,
    },
    tx,
  );
  return { referenceId: transfer.referenceId, amount: fromMinor(amount), balance: fromMinor(balance - amount), toCashAccountId: targetId };
}
