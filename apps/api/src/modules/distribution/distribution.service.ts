/**
 * Yetkazib berish marshrutlari, marshrut mijozlari va tashriflar (convex/crm/distribution.ts).
 *
 * Tashrif holatlari: planned → in_progress → completed; planned / in_progress → cancelled.
 * Yakunlangan va bekor qilingan tashrif o'zgarmaydi.
 *
 * Convex'dan farqlar:
 *  - `updateRoute` / `createVisit` agentni boshqa kompaniyadan ham qabul qilardi
 *  - hafta kunlari tekshirilmasdi (istalgan son); tashrif holati va ko'rsatkichlari istalgancha
 *    o'zgarardi (yakunlangan tashrif ham), tashrif qilingan mijozlar marshrutdagidan ko'p bo'lishi mumkin edi
 *  - tashriflari bor marshrutni o'chirish tashriflarni yetim qoldirardi — endi faolsizlantirish
 *  - mijozlar tartibini o'zgartirish yo'q edi; o'chirilgan mijozdan keyin tartib raqami takrorlanardi
 *  - yozish amallari to'xtatilgan kompaniyada ham ishlardi; o'qish `distribution.view` (CRM'dan alohida)
 */
import { and, asc, desc, eq, getTableColumns, gte, lte, sql } from "drizzle-orm";
import { badRequest, conflict, notFound } from "@bum/shared";
import { distributionRoutes, routeCustomers, routeVisits, salesReps } from "../../db/schema/crm.js";
import { customers } from "../../db/schema/sales.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import type { TenantContext } from "../company/tenant.js";
import { assertCustomer } from "../crm/leads.service.js";
import { assertSalesRep, distributionAudit } from "./sales-reps.service.js";

const { legacyId: _l1, companyId: _c1, ...routeFields } = getTableColumns(distributionRoutes);
const { legacyId: _l2, companyId: _c2, ...routeCustomerFields } = getTableColumns(routeCustomers);
const { legacyId: _l3, companyId: _c3, ...visitFields } = getTableColumns(routeVisits);

export type VisitStatus = (typeof routeVisits.status.enumValues)[number];

const VISIT_TRANSITIONS: Record<VisitStatus, VisitStatus[]> = {
  planned: ["in_progress", "completed", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export type RouteInput = {
  name: string;
  salesRepId?: string | null;
  description?: string | null;
  days: number[];
  color?: string | null;
};

async function lockRoute(tx: Tx, tenant: TenantContext, routeId: string) {
  const [route] = await tx
    .select(routeFields)
    .from(distributionRoutes)
    .where(and(eq(distributionRoutes.id, routeId), eq(distributionRoutes.companyId, tenant.company.id)))
    .limit(1)
    .for("update");
  if (!route) throw notFound("Marshrut topilmadi");
  return route;
}

// ─── Marshrutlar ─────────────────────────────────────────────────────────────

export async function listRoutes(conn: DbOrTx, tenant: TenantContext, includeInactive = false) {
  return conn
    .select({
      ...routeFields,
      salesRepName: salesReps.name,
      customerCount: sql<number>`(select count(*)::int from ${routeCustomers} where ${routeCustomers.routeId} = ${distributionRoutes.id})`,
    })
    .from(distributionRoutes)
    .leftJoin(salesReps, eq(salesReps.id, distributionRoutes.salesRepId))
    .where(
      and(
        eq(distributionRoutes.companyId, tenant.company.id),
        includeInactive ? undefined : eq(distributionRoutes.isActive, true),
      ),
    )
    .orderBy(asc(distributionRoutes.name));
}

export async function getRoute(conn: DbOrTx, tenant: TenantContext, routeId: string) {
  const [route] = await conn
    .select({ ...routeFields, salesRepName: salesReps.name })
    .from(distributionRoutes)
    .leftJoin(salesReps, eq(salesReps.id, distributionRoutes.salesRepId))
    .where(and(eq(distributionRoutes.id, routeId), eq(distributionRoutes.companyId, tenant.company.id)))
    .limit(1);
  if (!route) throw notFound("Marshrut topilmadi");

  const members = await conn
    .select({
      ...routeCustomerFields,
      customerName: customers.name,
      phone: customers.phone,
      address: customers.address,
      totalDebt: customers.totalDebt,
    })
    .from(routeCustomers)
    .innerJoin(customers, eq(customers.id, routeCustomers.customerId))
    .where(eq(routeCustomers.routeId, routeId))
    .orderBy(asc(routeCustomers.sortOrder), asc(routeCustomers.createdAt));
  return { ...route, customers: members };
}

export async function createRoute(tx: Tx, tenant: TenantContext, input: RouteInput, meta: RequestMeta) {
  const companyId = tenant.company.id;
  if (input.salesRepId) await assertSalesRep(tx, companyId, input.salesRepId);

  const [route] = await tx
    .insert(distributionRoutes)
    .values({ ...input, days: [...new Set(input.days)].sort(), companyId })
    .returning(routeFields);
  await distributionAudit(tx, tenant, meta, {
    action: "ROUTE_CREATED",
    resource: "distribution_routes",
    resourceId: route!.id,
    details: { name: route!.name, days: route!.days },
  });
  return route!;
}

export async function updateRoute(
  tx: Tx,
  tenant: TenantContext,
  routeId: string,
  patch: Partial<RouteInput> & { isActive?: boolean },
  meta: RequestMeta,
) {
  await lockRoute(tx, tenant, routeId);
  if (patch.salesRepId) await assertSalesRep(tx, tenant.company.id, patch.salesRepId);

  const [route] = await tx
    .update(distributionRoutes)
    .set({ ...patch, ...(patch.days ? { days: [...new Set(patch.days)].sort() } : {}), updatedAt: new Date() })
    .where(eq(distributionRoutes.id, routeId))
    .returning(routeFields);
  await distributionAudit(tx, tenant, meta, {
    action: "ROUTE_UPDATED",
    resource: "distribution_routes",
    resourceId: routeId,
    details: { changes: Object.keys(patch) },
  });
  return route!;
}

export async function deleteRoute(tx: Tx, tenant: TenantContext, routeId: string, meta: RequestMeta) {
  const route = await lockRoute(tx, tenant, routeId);
  const [visit] = await tx.select({ id: routeVisits.id }).from(routeVisits).where(eq(routeVisits.routeId, routeId)).limit(1);
  if (visit) throw conflict("Marshrutda tashriflar bor — o'chirish o'rniga faolsizlantiring");

  await tx.delete(distributionRoutes).where(eq(distributionRoutes.id, routeId));
  await distributionAudit(tx, tenant, meta, {
    action: "ROUTE_DELETED",
    resource: "distribution_routes",
    resourceId: routeId,
    details: { name: route.name },
  });
}

// ─── Marshrut mijozlari ──────────────────────────────────────────────────────

export async function addRouteCustomer(
  tx: Tx,
  tenant: TenantContext,
  routeId: string,
  input: { customerId: string; visitNotes?: string | null },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  await lockRoute(tx, tenant, routeId);
  await assertCustomer(tx, companyId, input.customerId);

  const [last] = await tx
    .select({ max: sql<number>`coalesce(max(${routeCustomers.sortOrder}), 0)::int` })
    .from(routeCustomers)
    .where(eq(routeCustomers.routeId, routeId));
  const [member] = await tx
    .insert(routeCustomers)
    .values({ companyId, routeId, customerId: input.customerId, visitNotes: input.visitNotes ?? null, sortOrder: (last?.max ?? 0) + 1 })
    .returning(routeCustomerFields);

  await distributionAudit(tx, tenant, meta, {
    action: "ROUTE_CUSTOMER_ADDED",
    resource: "distribution_routes",
    resourceId: routeId,
    details: { customerId: input.customerId },
  });
  return member!;
}

export async function removeRouteCustomer(tx: Tx, tenant: TenantContext, routeId: string, memberId: string, meta: RequestMeta) {
  await lockRoute(tx, tenant, routeId);
  const [deleted] = await tx
    .delete(routeCustomers)
    .where(and(eq(routeCustomers.id, memberId), eq(routeCustomers.routeId, routeId)))
    .returning({ customerId: routeCustomers.customerId });
  if (!deleted) throw notFound("Marshrutda bunday mijoz yo'q");

  await distributionAudit(tx, tenant, meta, {
    action: "ROUTE_CUSTOMER_REMOVED",
    resource: "distribution_routes",
    resourceId: routeId,
    details: { customerId: deleted.customerId },
  });
}

/** `memberIds` — marshrutdagi BARCHA qatorlar yangi tartibda. */
export async function reorderRouteCustomers(
  tx: Tx,
  tenant: TenantContext,
  routeId: string,
  memberIds: string[],
  meta: RequestMeta,
) {
  await lockRoute(tx, tenant, routeId);
  const current = await tx.select({ id: routeCustomers.id }).from(routeCustomers).where(eq(routeCustomers.routeId, routeId));
  const known = new Set(current.map((c) => c.id));
  if (memberIds.length !== known.size || new Set(memberIds).size !== memberIds.length || !memberIds.every((id) => known.has(id))) {
    throw badRequest("Tartib marshrutdagi barcha mijozlarni bir martadan o'z ichiga olishi kerak");
  }

  for (const [index, id] of memberIds.entries()) {
    await tx.update(routeCustomers).set({ sortOrder: index + 1, updatedAt: new Date() }).where(eq(routeCustomers.id, id));
  }
  await distributionAudit(tx, tenant, meta, {
    action: "ROUTE_CUSTOMERS_REORDERED",
    resource: "distribution_routes",
    resourceId: routeId,
    details: { count: memberIds.length },
  });
  return getRoute(tx, tenant, routeId);
}

// ─── Tashriflar ──────────────────────────────────────────────────────────────

export async function listVisits(
  conn: DbOrTx,
  tenant: TenantContext,
  options: { routeId?: string; salesRepId?: string; status?: VisitStatus; dateFrom?: string; dateTo?: string; limit: number },
) {
  return conn
    .select({ ...visitFields, routeName: distributionRoutes.name, salesRepName: salesReps.name })
    .from(routeVisits)
    .innerJoin(distributionRoutes, eq(distributionRoutes.id, routeVisits.routeId))
    .leftJoin(salesReps, eq(salesReps.id, routeVisits.salesRepId))
    .where(
      and(
        eq(routeVisits.companyId, tenant.company.id),
        options.routeId ? eq(routeVisits.routeId, options.routeId) : undefined,
        options.salesRepId ? eq(routeVisits.salesRepId, options.salesRepId) : undefined,
        options.status ? eq(routeVisits.status, options.status) : undefined,
        options.dateFrom ? gte(routeVisits.visitDate, options.dateFrom) : undefined,
        options.dateTo ? lte(routeVisits.visitDate, options.dateTo) : undefined,
      ),
    )
    .orderBy(desc(routeVisits.visitDate), desc(routeVisits.createdAt))
    .limit(options.limit);
}

export async function createVisit(
  tx: Tx,
  tenant: TenantContext,
  input: { routeId: string; salesRepId?: string | null; visitDate: string; notes?: string | null },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const route = await lockRoute(tx, tenant, input.routeId);
  if (!route.isActive) throw badRequest("Marshrut faol emas");
  const salesRepId = input.salesRepId ?? route.salesRepId;
  if (salesRepId) await assertSalesRep(tx, companyId, salesRepId);

  const [visit] = await tx
    .insert(routeVisits)
    .values({ companyId, routeId: route.id, salesRepId, visitDate: input.visitDate, notes: input.notes ?? null })
    .returning(visitFields);
  await distributionAudit(tx, tenant, meta, {
    action: "VISIT_CREATED",
    resource: "route_visits",
    resourceId: visit!.id,
    details: { routeId: route.id, visitDate: input.visitDate },
  });
  return visit!;
}

export async function updateVisit(
  tx: Tx,
  tenant: TenantContext,
  visitId: string,
  patch: { status?: VisitStatus; customersVisited?: number; ordersCreated?: number; totalAmount?: string; notes?: string | null },
  meta: RequestMeta,
) {
  const [visit] = await tx
    .select(visitFields)
    .from(routeVisits)
    .where(and(eq(routeVisits.id, visitId), eq(routeVisits.companyId, tenant.company.id)))
    .limit(1)
    .for("update");
  if (!visit) throw notFound("Tashrif topilmadi");
  if (visit.status === "completed" || visit.status === "cancelled") {
    throw badRequest("Yakunlangan yoki bekor qilingan tashrif o'zgartirilmaydi");
  }
  if (patch.status && patch.status !== visit.status && !VISIT_TRANSITIONS[visit.status].includes(patch.status)) {
    throw badRequest(`Holatni o'zgartirib bo'lmaydi: ${visit.status} → ${patch.status}`);
  }

  if (patch.customersVisited !== undefined) {
    const [members] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(routeCustomers)
      .where(eq(routeCustomers.routeId, visit.routeId));
    if (patch.customersVisited > (members?.count ?? 0)) {
      throw badRequest(`Marshrutda ${members?.count ?? 0} ta mijoz bor`);
    }
  }

  const [updated] = await tx
    .update(routeVisits)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(routeVisits.id, visitId))
    .returning(visitFields);
  await distributionAudit(tx, tenant, meta, {
    action: "VISIT_UPDATED",
    resource: "route_visits",
    resourceId: visitId,
    details: { from: visit.status, ...patch },
  });
  return updated!;
}
