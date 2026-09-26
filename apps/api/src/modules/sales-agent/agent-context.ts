/**
 * Sotuv agenti konteksti: tizimga kirgan foydalanuvchiga bog'langan FAOL savdo agenti (`sales_reps.user_id`).
 * Agent API'lari faqat shu orqali ishlaydi — agent boshqa agentning ma'lumotini ko'rmaydi, `agentId`
 * hech qachon so'rovdan olinmaydi.
 */
import { and, eq } from "drizzle-orm";
import { forbidden, notFound } from "@bum/shared";
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

/**
 * Supervayzer agent NOMIDAN ishlayapti: `user` — supervayzerning o'zi (audit, `created_by`), `agent` — agent (buyurtma
 * agentniki: KPI, marshrut, mijozlar). Faqat buyurtma oqimida; GPS, tashrif va ish vaqti — faqat agentning o'zi.
 */
export type ActingContext = { supervisorUserId: string; supervisorName: string; salesRepId: string };

export type AgentContext = TenantContext & { agent: AgentProfile; acting?: ActingContext };

/** So'rov sarlavhasi: supervayzer qaysi agent nomidan ishlayapti. */
export const ACT_AS_HEADER = "x-act-as-sales-rep";

const agentFields = {
  id: salesReps.id,
  name: salesReps.name,
  code: salesReps.code,
  phone: salesReps.phone,
  region: salesReps.region,
  monthlyTarget: salesReps.monthlyTarget,
  isActive: salesReps.isActive,
};

/**
 * Supervayzer → agent konteksti. Ruxsat (`sales_agent.supervise`) va jamoa chegarasi chaqiruvchida tekshiriladi;
 * bu yerda — agent shu kompaniyada va faol. Begona yoki mavjud bo'lmagan agent — TOPILMADI.
 */
export async function actingAgent(conn: DbOrTx, tenant: TenantContext, salesRepId: string): Promise<AgentContext> {
  const [row] = await conn
    .select(agentFields)
    .from(salesReps)
    .where(and(eq(salesReps.companyId, tenant.company.id), eq(salesReps.id, salesRepId)))
    .limit(1);
  if (!row) throw notFound("Agent topilmadi");
  if (!row.isActive) throw forbidden("Agent faol emas");
  const { isActive: _isActive, ...agent } = row;
  return { ...tenant, agent, acting: { supervisorUserId: tenant.user.id, supervisorName: tenant.user.name ?? "", salesRepId: agent.id } };
}

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
