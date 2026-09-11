/**
 * Sotuv agenti konteksti: tizimga kirgan foydalanuvchiga bog'langan FAOL savdo agenti (`sales_reps.user_id`).
 * Agent API'lari faqat shu orqali ishlaydi — agent boshqa agentning ma'lumotini ko'rmaydi, `agentId`
 * hech qachon so'rovdan olinmaydi.
 */
import { and, eq } from "drizzle-orm";
import { forbidden } from "@bum/shared";
import { salesReps } from "../../db/schema/crm.js";
import type { DbOrTx } from "../../db/transaction.js";
import type { TenantContext } from "../company/tenant.js";

export type AgentProfile = {
  id: string;
  name: string;
  code: string;
  phone: string | null;
  region: string | null;
  monthlyTarget: string;
};

export type AgentContext = TenantContext & { agent: AgentProfile };

export async function requireAgent(conn: DbOrTx, tenant: TenantContext): Promise<AgentContext> {
  const [row] = await conn
    .select({
      id: salesReps.id,
      name: salesReps.name,
      code: salesReps.code,
      phone: salesReps.phone,
      region: salesReps.region,
      monthlyTarget: salesReps.monthlyTarget,
      isActive: salesReps.isActive,
    })
    .from(salesReps)
    .where(and(eq(salesReps.companyId, tenant.company.id), eq(salesReps.userId, tenant.user.id)))
    .limit(1);
  if (!row || !row.isActive) throw forbidden("Hisobingiz faol savdo agentiga bog'lanmagan");
  const { isActive: _isActive, ...agent } = row;
  return { ...tenant, agent };
}
