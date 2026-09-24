/**
 * MAS'ULIYAT CHEGARASI — "Mas'ul bo'lganlari" scope'ining server tomoni.
 *
 * Rol ruxsatiga chegara qo'yilgan bo'lsa (`roles.scopes`), xodim faqat O'ZIGA biriktirilgan
 * yozuvlar bilan ishlaydi. Frontenddagi filtrga ishonilmaydi — ro'yxat ham, bitta yozuvga
 * murojaat ham shu yerda cheklanadi (begona yozuv TOPILMADI bo'lib qaytadi, ya'ni mavjudligi
 * ham oshkor bo'lmaydi).
 *
 * Biriktirishlar MAVJUD jadvallardan o'qiladi — parallel "assignment" jadvali yaratilmagan:
 *   agent  → `sales_reps` → `distribution_routes` → `route_customers` → `customers`
 *   kuryer → `delivery_agents` → `delivery_tasks`
 */
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { isResponsibleScopable, sanitizeRoleScopes, type Permission, type RoleScopes } from "@bum/shared";
import { distributionRoutes, routeCustomers, salesReps } from "../../db/schema/crm.js";
import { deliveryAgents } from "../../db/schema/delivery.js";
import { roles } from "../../db/schema/platform.js";
import type { DbOrTx } from "../../db/transaction.js";
import { isFullAccessRole, type TenantContext } from "./tenant.js";

/**
 * Rolga yozilgan chegaralar. To'liq huquqli rolda (ega, superadmin) chegara bo'lmaydi —
 * aks holda kompaniya egasi o'z ma'lumotini ko'ra olmay qolardi.
 */
export async function effectiveScopes(conn: DbOrTx, tenant: TenantContext): Promise<RoleScopes> {
  if (isFullAccessRole(tenant.membership.companyRole)) return {};

  const match = tenant.membership.roleId
    ? eq(roles.id, tenant.membership.roleId)
    : eq(roles.name, tenant.membership.companyRole);
  const [role] = await conn
    .select({ scopes: roles.scopes })
    .from(roles)
    .where(and(match, or(eq(roles.companyId, tenant.company.id), isNull(roles.companyId))))
    .orderBy(sql`${roles.companyId} is null`)
    .limit(1);
  return sanitizeRoleScopes(role?.scopes);
}

/** Shu ruxsat uchun "faqat mas'ul bo'lganlari" chegarasi yoqilganmi. */
export function isResponsibleOnly(scopes: RoleScopes, permission: Permission): boolean {
  return isResponsibleScopable(permission) && scopes[permission] === "responsible";
}

/**
 * Foydalanuvchi MAS'UL bo'lgan mijozlar ro'yxati (marshrutlari orqali).
 * `null` — chegara qo'llanmaydi. Bo'sh massiv — mas'ul mijozi yo'q (hech narsa ko'rinmaydi).
 */
export async function responsibleCustomerIds(conn: DbOrTx, tenant: TenantContext): Promise<string[]> {
  const companyId = tenant.company.id;
  const reps = await conn
    .select({ id: salesReps.id })
    .from(salesReps)
    .where(and(eq(salesReps.companyId, companyId), eq(salesReps.userId, tenant.user.id)));
  if (reps.length === 0) return [];

  const routes = await conn
    .select({ id: distributionRoutes.id })
    .from(distributionRoutes)
    .where(
      and(
        eq(distributionRoutes.companyId, companyId),
        inArray(distributionRoutes.salesRepId, reps.map((rep) => rep.id)),
      ),
    );
  if (routes.length === 0) return [];

  const rows = await conn
    .select({ customerId: routeCustomers.customerId })
    .from(routeCustomers)
    .where(
      and(
        eq(routeCustomers.companyId, companyId),
        inArray(routeCustomers.routeId, routes.map((route) => route.id)),
      ),
    );
  return [...new Set(rows.map((row) => row.customerId))];
}

/** Foydalanuvchining yetkazuvchi profillari — yetkazmalarni chegaralash uchun. */
export async function responsibleDeliveryAgentIds(conn: DbOrTx, tenant: TenantContext): Promise<string[]> {
  const rows = await conn
    .select({ id: deliveryAgents.id })
    .from(deliveryAgents)
    .where(and(eq(deliveryAgents.companyId, tenant.company.id), eq(deliveryAgents.userId, tenant.user.id)));
  return rows.map((row) => row.id);
}
