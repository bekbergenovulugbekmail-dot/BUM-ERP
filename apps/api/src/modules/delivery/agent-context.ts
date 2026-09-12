/**
 * Yetkazuvchi agent konteksti: tizimga kirgan foydalanuvchiga bog'langan FAOL yetkazuvchi (`delivery_agents.user_id`).
 * Agent API'lari faqat shu orqali ishlaydi — `deliveryAgentId`, `companyId` hech qachon so'rovdan olinmaydi,
 * agent boshqa agentning yetkazmasini, mijozini yoki lokatsiyasini ko'rmaydi.
 */
import { and, eq } from "drizzle-orm";
import { forbidden } from "@bum/shared";
import { deliveryAgents } from "../../db/schema/delivery.js";
import { users } from "../../db/schema/platform.js";
import type { DbOrTx } from "../../db/transaction.js";
import type { TenantContext } from "../company/tenant.js";

export type DeliveryAgentProfile = {
  id: string;
  code: string;
  name: string | null;
  phone: string;
  territory: string | null;
  deliveryZone: string | null;
  vehicleType: (typeof deliveryAgents.vehicleType.enumValues)[number] | null;
  vehicleNumber: string | null;
  branchId: string | null;
  supervisorUserId: string | null;
};

export type DeliveryAgentContext = TenantContext & { deliveryAgent: DeliveryAgentProfile };

export async function requireDeliveryAgent(conn: DbOrTx, tenant: TenantContext): Promise<DeliveryAgentContext> {
  const [row] = await conn
    .select({
      id: deliveryAgents.id,
      code: deliveryAgents.code,
      name: users.name,
      phone: users.phone,
      territory: deliveryAgents.territory,
      deliveryZone: deliveryAgents.deliveryZone,
      vehicleType: deliveryAgents.vehicleType,
      vehicleNumber: deliveryAgents.vehicleNumber,
      branchId: deliveryAgents.branchId,
      supervisorUserId: deliveryAgents.supervisorUserId,
      isActive: deliveryAgents.isActive,
    })
    .from(deliveryAgents)
    .innerJoin(users, eq(users.id, deliveryAgents.userId))
    .where(and(eq(deliveryAgents.companyId, tenant.company.id), eq(deliveryAgents.userId, tenant.user.id)))
    .limit(1);
  if (!row || !row.isActive) throw forbidden("Hisobingiz faol yetkazuvchi agentga bog'lanmagan");
  const { isActive: _isActive, ...deliveryAgent } = row;
  return { ...tenant, deliveryAgent };
}
