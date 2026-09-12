/**
 * Yangi mijoz topish: agent potentsial do'konni (nomi, aloqa, manzil, joylashuv, izoh) yuboradi; supervayzer
 * (`sales_agent.supervise`) uni mijozga aylantiradi (ixtiyoriy marshrutga qo'shib) yoki sabab bilan rad etadi.
 * Agent faqat o'zi yuborganlarini ko'radi.
 */
import { and, desc, eq } from "drizzle-orm";
import { badRequest, conflict, notFound, rateLimited } from "@bum/shared";
import { salesReps } from "../../db/schema/crm.js";
import { agentProspects } from "../../db/schema/sales-agent.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import { isValidCoordinate } from "../../shared/geo.js";
import { recordHit } from "../../shared/rate-limit.js";
import type { TenantContext } from "../company/tenant.js";
import { addRouteCustomer } from "../distribution/distribution.service.js";
import { createCustomer } from "../sales/customers.service.js";
import type { AgentContext } from "./agent-context.js";

export type ProspectStatus = (typeof agentProspects.status.enumValues)[number];

/** Bir agentdan soatiga shuncha yangi mijoz (xato yoki suiiste'mol oldini olish). */
const PROSPECTS_PER_HOUR = 50;

const prospectFields = {
  id: agentProspects.id,
  name: agentProspects.name,
  phone: agentProspects.phone,
  address: agentProspects.address,
  comment: agentProspects.comment,
  latitude: agentProspects.latitude,
  longitude: agentProspects.longitude,
  status: agentProspects.status,
  customerId: agentProspects.customerId,
  rejectionReason: agentProspects.rejectionReason,
  salesRepId: agentProspects.salesRepId,
  salesRepName: salesReps.name,
  createdAt: agentProspects.createdAt,
};

function findProspects(conn: DbOrTx, companyId: string, filter: { id?: string; salesRepId?: string; status?: ProspectStatus }, limit: number) {
  return conn
    .select(prospectFields)
    .from(agentProspects)
    .innerJoin(salesReps, eq(salesReps.id, agentProspects.salesRepId))
    .where(
      and(
        eq(agentProspects.companyId, companyId),
        filter.id ? eq(agentProspects.id, filter.id) : undefined,
        filter.salesRepId ? eq(agentProspects.salesRepId, filter.salesRepId) : undefined,
        filter.status ? eq(agentProspects.status, filter.status) : undefined,
      ),
    )
    .orderBy(desc(agentProspects.createdAt))
    .limit(limit);
}

async function prospectById(conn: DbOrTx, companyId: string, id: string) {
  const [prospect] = await findProspects(conn, companyId, { id }, 1);
  if (!prospect) throw notFound("Yangi mijoz topilmadi");
  return prospect;
}

function audit(tx: Tx, tenant: TenantContext, meta: RequestMeta, action: string, resourceId: string, details: Record<string, unknown>) {
  return writeAuditLog(
    { userId: tenant.user.id, userName: tenant.user.name, companyId: tenant.company.id, action, resource: "agent_prospects", resourceId, details, ...meta },
    tx,
  );
}

export function listAgentProspects(conn: DbOrTx, context: AgentContext) {
  return findProspects(conn, context.company.id, { salesRepId: context.agent.id }, 100);
}

export type ProspectInput = {
  name: string;
  phone?: string | null;
  address?: string | null;
  comment?: string | null;
  latitude?: number;
  longitude?: number;
  accuracy?: number | null;
};

export async function createProspect(tx: Tx, context: AgentContext, input: ProspectInput, meta: RequestMeta) {
  if ((await recordHit(`agent-prospect:${context.agent.id}`, 3600)) > PROSPECTS_PER_HOUR) throw rateLimited();
  const hasPoint = input.latitude !== undefined && input.longitude !== undefined;
  if (hasPoint && !isValidCoordinate({ latitude: input.latitude!, longitude: input.longitude! })) {
    throw badRequest("Koordinata noto'g'ri");
  }
  const [created] = await tx
    .insert(agentProspects)
    .values({
      companyId: context.company.id,
      salesRepId: context.agent.id,
      userId: context.user.id,
      name: input.name.trim(),
      phone: input.phone?.trim() || null,
      address: input.address?.trim() || null,
      comment: input.comment?.trim() || null,
      latitude: hasPoint ? input.latitude!.toFixed(6) : null,
      longitude: hasPoint ? input.longitude!.toFixed(6) : null,
      accuracy: hasPoint && input.accuracy != null ? input.accuracy.toFixed(2) : null,
    })
    .returning({ id: agentProspects.id });
  await audit(tx, context, meta, "PROSPECT_CREATED", created!.id, { name: input.name.trim(), withLocation: hasPoint });
  return prospectById(tx, context.company.id, created!.id);
}

export function supervisorProspects(conn: DbOrTx, tenant: TenantContext, status?: ProspectStatus) {
  return findProspects(conn, tenant.company.id, { status }, 300);
}

async function lockNew(tx: Tx, tenant: TenantContext, id: string) {
  const [row] = await tx
    .select()
    .from(agentProspects)
    .where(and(eq(agentProspects.id, id), eq(agentProspects.companyId, tenant.company.id)))
    .limit(1)
    .for("update");
  if (!row) throw notFound("Yangi mijoz topilmadi");
  if (row.status !== "new") throw conflict("Bu yangi mijoz allaqachon ko'rib chiqilgan");
  return row;
}

/** Mijoz yaratiladi (aloqa, manzil, koordinata, izoh bilan), ixtiyoriy — marshrutga qo'shiladi. */
export async function convertProspect(tx: Tx, tenant: TenantContext, id: string, input: { routeId?: string | null }, meta: RequestMeta) {
  const row = await lockNew(tx, tenant, id);
  const customer = await createCustomer(
    tx,
    tenant,
    {
      name: row.name,
      phone: row.phone,
      address: row.address,
      notes: row.comment,
      ...(row.latitude !== null && row.longitude !== null ? { latitude: Number(row.latitude), longitude: Number(row.longitude) } : {}),
    },
    meta,
  );
  if (input.routeId) await addRouteCustomer(tx, tenant, input.routeId, { customerId: customer.id }, meta);
  await tx
    .update(agentProspects)
    .set({ status: "converted", customerId: customer.id, reviewedBy: tenant.user.id, reviewedAt: new Date(), updatedAt: new Date() })
    .where(eq(agentProspects.id, id));
  await audit(tx, tenant, meta, "PROSPECT_CONVERTED", id, { customerId: customer.id, routeId: input.routeId ?? null });
  return { prospect: await prospectById(tx, tenant.company.id, id), customerId: customer.id };
}

export async function rejectProspect(tx: Tx, tenant: TenantContext, id: string, reason: string, meta: RequestMeta) {
  await lockNew(tx, tenant, id);
  await tx
    .update(agentProspects)
    .set({ status: "rejected", rejectionReason: reason, reviewedBy: tenant.user.id, reviewedAt: new Date(), updatedAt: new Date() })
    .where(eq(agentProspects.id, id));
  await audit(tx, tenant, meta, "PROSPECT_REJECTED", id, { reason });
  return prospectById(tx, tenant.company.id, id);
}
