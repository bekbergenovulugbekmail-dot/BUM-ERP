/**
 * Lidlar (convex/crm/leads.ts).
 *
 * Convex'dan farqlar:
 *  - `updateStage` mijozni (`customerId`) boshqa kompaniyadan ham bog'lardi; `update` agentni tekshirmasdi
 *  - "yutildi" bosqichida lidni yangi mijozga aylantirish (`convertToCustomer`) — Convex'da mijozni
 *    alohida yaratib, ID ni qo'lda bog'lash kerak edi
 *  - "yo'qotildi" sababsiz qo'yilmaydi; qayta ochilganda sabab tozalanadi
 *  - `update` / `updateStage` / `remove` to'xtatilgan kompaniyada ham yozardi; o'qish `crm.view`
 *  - Convex'dagi `company` maydoni — `companyName`
 */
import { and, desc, eq, getTableColumns, ilike, or, sql } from "drizzle-orm";
import { badRequest, notFound } from "@bum/shared";
import { leads, salesReps } from "../../db/schema/crm.js";
import { customers } from "../../db/schema/sales.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import type { TenantContext } from "../company/tenant.js";
import { assertSalesRep } from "../distribution/sales-reps.service.js";
import { createCustomer } from "../sales/customers.service.js";

const { legacyId: _legacyId, companyId: _companyId, ...leadFields } = getTableColumns(leads);

export function crmAudit(
  tx: Tx,
  tenant: TenantContext,
  meta: RequestMeta,
  entry: { action: string; resource: string; resourceId: string; details: Record<string, unknown> },
) {
  return writeAuditLog(
    { userId: tenant.user.id, userName: tenant.user.name, companyId: tenant.company.id, ...entry, ...meta },
    tx,
  );
}

export type LeadStage = (typeof leads.stage.enumValues)[number];
export type LeadSource = (typeof leads.source.enumValues)[number];

export type LeadInput = {
  name: string;
  companyName?: string | null;
  phone?: string | null;
  email?: string | null;
  source?: LeadSource;
  estimatedValue?: string | null;
  salesRepId?: string | null;
  expectedCloseDate?: string | null;
  notes?: string | null;
};

export async function assertLead(conn: DbOrTx, companyId: string, leadId: string) {
  const [lead] = await conn
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.companyId, companyId)))
    .limit(1);
  if (!lead) throw badRequest("Lid topilmadi");
}

export async function assertCustomer(conn: DbOrTx, companyId: string, customerId: string) {
  const [customer] = await conn
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.companyId, companyId)))
    .limit(1);
  if (!customer) throw badRequest("Mijoz topilmadi");
}

export async function listLeads(
  conn: DbOrTx,
  tenant: TenantContext,
  options: { stage?: LeadStage; salesRepId?: string; search?: string; limit: number },
) {
  const pattern = options.search ? `%${options.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  return conn
    .select({ ...leadFields, salesRepName: salesReps.name })
    .from(leads)
    .leftJoin(salesReps, eq(salesReps.id, leads.salesRepId))
    .where(
      and(
        eq(leads.companyId, tenant.company.id),
        options.stage ? eq(leads.stage, options.stage) : undefined,
        options.salesRepId ? eq(leads.salesRepId, options.salesRepId) : undefined,
        pattern
          ? or(ilike(leads.name, pattern), ilike(leads.companyName, pattern), ilike(leads.phone, pattern))
          : undefined,
      ),
    )
    .orderBy(desc(leads.createdAt), desc(leads.id))
    .limit(options.limit);
}

export async function leadStats(conn: DbOrTx, tenant: TenantContext) {
  const byStage = await conn
    .select({
      stage: leads.stage,
      count: sql<number>`count(*)::int`,
      value: sql<string>`coalesce(sum(${leads.estimatedValue}), 0)::numeric(18,2)`,
    })
    .from(leads)
    .where(eq(leads.companyId, tenant.company.id))
    .groupBy(leads.stage);

  const [totals] = await conn
    .select({
      total: sql<number>`count(*)::int`,
      openValue: sql<string>`coalesce(sum(${leads.estimatedValue}) filter (where ${leads.stage} not in ('won', 'lost')), 0)::numeric(18,2)`,
      wonValue: sql<string>`coalesce(sum(${leads.estimatedValue}) filter (where ${leads.stage} = 'won'), 0)::numeric(18,2)`,
    })
    .from(leads)
    .where(eq(leads.companyId, tenant.company.id));

  return { ...totals!, byStage };
}

async function lockLead(tx: Tx, tenant: TenantContext, leadId: string) {
  const [lead] = await tx
    .select(leadFields)
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.companyId, tenant.company.id)))
    .limit(1)
    .for("update");
  if (!lead) throw notFound("Lid topilmadi");
  return lead;
}

export async function createLead(tx: Tx, tenant: TenantContext, input: LeadInput, meta: RequestMeta) {
  const companyId = tenant.company.id;
  if (input.salesRepId) await assertSalesRep(tx, companyId, input.salesRepId);

  const [lead] = await tx.insert(leads).values({ ...input, companyId }).returning(leadFields);
  await crmAudit(tx, tenant, meta, {
    action: "LEAD_CREATED",
    resource: "leads",
    resourceId: lead!.id,
    details: { name: lead!.name, source: lead!.source },
  });
  return lead!;
}

export async function updateLead(tx: Tx, tenant: TenantContext, leadId: string, patch: Partial<LeadInput>, meta: RequestMeta) {
  await lockLead(tx, tenant, leadId);
  if (patch.salesRepId) await assertSalesRep(tx, tenant.company.id, patch.salesRepId);

  const [lead] = await tx
    .update(leads)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(leads.id, leadId))
    .returning(leadFields);
  await crmAudit(tx, tenant, meta, {
    action: "LEAD_UPDATED",
    resource: "leads",
    resourceId: leadId,
    details: { changes: Object.keys(patch) },
  });
  return lead!;
}

export async function changeLeadStage(
  tx: Tx,
  tenant: TenantContext,
  leadId: string,
  input: { stage: LeadStage; lostReason?: string | null; customerId?: string | null; convertToCustomer?: boolean },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const lead = await lockLead(tx, tenant, leadId);

  let customerId = lead.customerId;
  if (input.stage === "won") {
    if (input.customerId) {
      await assertCustomer(tx, companyId, input.customerId);
      customerId = input.customerId;
    } else if (input.convertToCustomer && !customerId) {
      const customer = await createCustomer(
        tx,
        tenant,
        { name: lead.companyName ?? lead.name, phone: lead.phone, email: lead.email, notes: `Liddan: ${lead.name}` },
        meta,
      );
      customerId = customer.id;
    }
  } else if (input.customerId || input.convertToCustomer) {
    throw badRequest("Mijoz faqat yutilgan lidga bog'lanadi");
  }
  if (input.stage === "lost" && !input.lostReason) throw badRequest("Yo'qotish sababi kiritilishi kerak");

  const [updated] = await tx
    .update(leads)
    .set({
      stage: input.stage,
      customerId,
      lostReason: input.stage === "lost" ? input.lostReason : null,
      updatedAt: new Date(),
    })
    .where(eq(leads.id, leadId))
    .returning(leadFields);

  await crmAudit(tx, tenant, meta, {
    action: "LEAD_STAGE_CHANGED",
    resource: "leads",
    resourceId: leadId,
    details: { from: lead.stage, to: input.stage, customerId },
  });
  return updated!;
}

export async function deleteLead(tx: Tx, tenant: TenantContext, leadId: string, meta: RequestMeta) {
  const lead = await lockLead(tx, tenant, leadId);
  await tx.delete(leads).where(eq(leads.id, leadId));
  await crmAudit(tx, tenant, meta, {
    action: "LEAD_DELETED",
    resource: "leads",
    resourceId: leadId,
    details: { name: lead.name, stage: lead.stage },
  });
}
