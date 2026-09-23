/**
 * KIMDA KOMPANIYA PULI BOR — bitta ro'yxat.
 *
 * Muammo: sotuv agenti va dostavka agentining "yo'ldagi naqd" hisobi ikki xil bo'limda
 * (Distribyutsiya → Sotuv agentlari, Dostavka → Agentlar) edi. Pulni qabul qiladigan odam
 * (kassir, buxgalter, rahbar) "qayerda topshiriladi?" deb qidirib yurardi.
 *
 * Bu yerda ikkala tur BIR ro'yxatga yig'iladi — faqat O'QISH. Topshirishning o'zi avvalgi
 * endpointlarda qoladi: har bir bo'limning o'z qoidalari va auditi buzilmasin.
 */
import { and, desc, eq, isNotNull, ne, or } from "drizzle-orm";
import { salesReps } from "../../db/schema/crm.js";
import { deliveryAgents } from "../../db/schema/delivery.js";
import { cashAccounts } from "../../db/schema/finance.js";
import { users } from "../../db/schema/platform.js";
import type { DbOrTx } from "../../db/transaction.js";

export type AgentCashHolder = {
  kind: "sales_rep" | "delivery_agent";
  /** Topshirish endpointi uchun kerakli identifikator (`sales_reps.id` yoki `delivery_agents.id`). */
  holderId: string;
  name: string;
  code: string;
  cashAccountId: string;
  balance: string;
  currency: string;
};

/**
 * Yo'lda naqd puli bor agentlar (qoldig'i nolga teng bo'lmaganlari), ko'pdan kamga.
 * Nol qoldiqlilar ko'rsatilmaydi — ro'yxat "kimdan pul olish kerak" degan savolga javob beradi.
 */
export async function agentCashHolders(conn: DbOrTx, companyId: string): Promise<AgentCashHolder[]> {
  const accounts = await conn
    .select({
      id: cashAccounts.id,
      balance: cashAccounts.balance,
      currency: cashAccounts.currency,
      salesRepId: cashAccounts.salesRepId,
      deliveryAgentId: cashAccounts.deliveryAgentId,
      repName: salesReps.name,
      repCode: salesReps.code,
      agentCode: deliveryAgents.code,
      agentName: users.name,
    })
    .from(cashAccounts)
    .leftJoin(salesReps, eq(salesReps.id, cashAccounts.salesRepId))
    .leftJoin(deliveryAgents, eq(deliveryAgents.id, cashAccounts.deliveryAgentId))
    .leftJoin(users, eq(users.id, deliveryAgents.userId))
    .where(
      and(
        eq(cashAccounts.companyId, companyId),
        or(isNotNull(cashAccounts.salesRepId), isNotNull(cashAccounts.deliveryAgentId)),
        ne(cashAccounts.balance, "0"),
      ),
    )
    .orderBy(desc(cashAccounts.balance));

  return accounts.map((row) => {
    const isRep = row.salesRepId !== null;
    return {
      kind: isRep ? ("sales_rep" as const) : ("delivery_agent" as const),
      holderId: (isRep ? row.salesRepId : row.deliveryAgentId)!,
      name: (isRep ? row.repName : row.agentName) ?? (isRep ? row.repCode : row.agentCode) ?? "—",
      code: (isRep ? row.repCode : row.agentCode) ?? "—",
      cashAccountId: row.id,
      balance: row.balance,
      currency: row.currency,
    };
  });
}
