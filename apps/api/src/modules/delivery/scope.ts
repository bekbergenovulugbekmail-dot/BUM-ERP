/**
 * Yetkazish bo'limida "Mas'ul bo'lganlari" (`delivery.view` — responsible) chegarasi.
 *
 * Chegara yoqilgan xodim (masalan, supervayzer) faqat:
 *   - o'zi va u supervayzeri bo'lgan yetkazuvchilarni (`delivery_agents.user_id` / `supervisor_user_id`),
 *   - shu yetkazuvchilarga biriktirilgan yetkazmalarni,
 *   - hamda O'Z JAMOASI savdo agentlari olgan buyurtmalarning yetkazmalarini (hali biriktirilmagan bo'lsa ham —
 *     supervayzer ularni o'z yetkazuvchisiga biriktiradi) ko'radi va boshqaradi.
 * Qolgani — TOPILMADI (mavjudligi oshkor bo'lmaydi). Yangi jadval yo'q: mavjud biriktirishlardan o'qiladi.
 */
import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { notFound } from "@bum/shared";
import { deliveryAgents, deliveryTasks } from "../../db/schema/delivery.js";
import { salesOrders } from "../../db/schema/sales.js";
import { agentOrders } from "../../db/schema/sales-agent.js";
import type { DbOrTx } from "../../db/transaction.js";
import { effectiveScopes, isResponsibleOnly, responsibleDeliveryAgentIds, responsibleSalesRepIds } from "../company/responsibility.service.js";
import type { TenantContext } from "../company/tenant.js";

export type DeliveryScope = { agentIds: string[]; salesRepIds: string[] } | null;

export async function deliveryScope(conn: DbOrTx, tenant: TenantContext): Promise<DeliveryScope> {
  const scopes = await effectiveScopes(conn, tenant);
  if (!isResponsibleOnly(scopes, "delivery.view")) return null;
  const [agentIds, salesRepIds] = await Promise.all([responsibleDeliveryAgentIds(conn, tenant), responsibleSalesRepIds(conn, tenant)]);
  return { agentIds, salesRepIds };
}

/** Buyurtma jamoa agentiniki (agent buyurtmasi). */
function orderFromTeam(orderId: SQL | typeof salesOrders.id | typeof deliveryTasks.orderId, salesRepIds: string[]): SQL | undefined {
  if (salesRepIds.length === 0) return undefined;
  return sql`exists (select 1 from ${agentOrders} where ${agentOrders.orderId} = ${orderId} and ${inArray(agentOrders.salesRepId, salesRepIds)})`;
}

/** Yetkazmalar uchun SQL sharti (`undefined` — chegara yo'q). */
export function taskScopeCondition(scope: DeliveryScope): SQL | undefined {
  if (!scope) return undefined;
  const parts = [
    scope.agentIds.length > 0 ? inArray(deliveryTasks.deliveryAgentId, scope.agentIds) : undefined,
    orderFromTeam(deliveryTasks.orderId, scope.salesRepIds),
  ].filter((part): part is SQL => part !== undefined);
  return parts.length > 0 ? or(...parts) : sql`false`;
}

/** Sotuv buyurtmalari (dispetcher, tayyor buyurtmalar) uchun SQL sharti. */
export function orderScopeCondition(scope: DeliveryScope): SQL | undefined {
  if (!scope) return undefined;
  return orderFromTeam(salesOrders.id, scope.salesRepIds) ?? sql`false`;
}

export function agentInScope(scope: DeliveryScope, agentId: string | null | undefined) {
  return !scope || (agentId !== null && agentId !== undefined && scope.agentIds.includes(agentId));
}

export function assertAgentInScope(scope: DeliveryScope, agentId: string | null | undefined) {
  if (!agentInScope(scope, agentId)) throw notFound("Yetkazuvchi topilmadi");
}

export async function assertTasksInScope(conn: DbOrTx, companyId: string, scope: DeliveryScope, taskIds: string[]) {
  if (!scope || taskIds.length === 0) return;
  const unique = [...new Set(taskIds)];
  const rows = await conn
    .select({ id: deliveryTasks.id })
    .from(deliveryTasks)
    .where(and(eq(deliveryTasks.companyId, companyId), inArray(deliveryTasks.id, unique), taskScopeCondition(scope)));
  if (rows.length !== unique.length) throw notFound("Yetkazma topilmadi");
}

export async function assertOrdersInScope(conn: DbOrTx, companyId: string, scope: DeliveryScope, orderIds: string[]) {
  if (!scope || orderIds.length === 0) return;
  const unique = [...new Set(orderIds)];
  const rows = await conn
    .select({ id: salesOrders.id })
    .from(salesOrders)
    .where(and(eq(salesOrders.companyId, companyId), inArray(salesOrders.id, unique), orderScopeCondition(scope)));
  if (rows.length !== unique.length) throw notFound("Buyurtma topilmadi");
}

/** Yetkazuvchilar ro'yxati sharti. */
export function agentScopeCondition(scope: DeliveryScope): SQL | undefined {
  if (!scope) return undefined;
  return scope.agentIds.length > 0 ? inArray(deliveryAgents.id, scope.agentIds) : sql`false`;
}
