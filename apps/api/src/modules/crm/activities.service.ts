/**
 * CRM faoliyatlari: qo'ng'iroq, uchrashuv, xat, izoh, vazifa (convex/crm/activities.ts).
 *
 * Convex'dan farqlar:
 *  - `create` holatni doim "done" qilardi — rejalashtirilgan vazifa yaratib bo'lmasdi;
 *    endi holat berilmasa vazifa "planned", qolganlari "done"
 *  - tahrirlash yo'q edi; `updateStatus` / `remove` to'xtatilgan kompaniyada ham yozardi
 *  - `createdBy` yozilmasdi; o'qish `crm.view`
 */
import { and, desc, eq, getTableColumns } from "drizzle-orm";
import { notFound } from "@bum/shared";
import { activities, leads } from "../../db/schema/crm.js";
import { customers } from "../../db/schema/sales.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import type { TenantContext } from "../company/tenant.js";
import { assertCustomer, assertLead, crmAudit } from "./leads.service.js";

const { legacyId: _legacyId, companyId: _companyId, ...activityFields } = getTableColumns(activities);

export type ActivityType = (typeof activities.type.enumValues)[number];
export type ActivityStatus = (typeof activities.status.enumValues)[number];

export type ActivityInput = {
  type: ActivityType;
  title: string;
  description?: string | null;
  customerId?: string | null;
  leadId?: string | null;
  activityDate: string;
  dueDate?: string | null;
  status?: ActivityStatus;
  outcome?: string | null;
};

export async function listActivities(
  conn: DbOrTx,
  tenant: TenantContext,
  options: { customerId?: string; leadId?: string; status?: ActivityStatus; type?: ActivityType; limit: number },
) {
  return conn
    .select({ ...activityFields, customerName: customers.name, leadName: leads.name })
    .from(activities)
    .leftJoin(customers, eq(customers.id, activities.customerId))
    .leftJoin(leads, eq(leads.id, activities.leadId))
    .where(
      and(
        eq(activities.companyId, tenant.company.id),
        options.customerId ? eq(activities.customerId, options.customerId) : undefined,
        options.leadId ? eq(activities.leadId, options.leadId) : undefined,
        options.status ? eq(activities.status, options.status) : undefined,
        options.type ? eq(activities.type, options.type) : undefined,
      ),
    )
    .orderBy(desc(activities.activityDate), desc(activities.createdAt))
    .limit(options.limit);
}

export async function createActivity(tx: Tx, tenant: TenantContext, input: ActivityInput, meta: RequestMeta) {
  const companyId = tenant.company.id;
  if (input.customerId) await assertCustomer(tx, companyId, input.customerId);
  if (input.leadId) await assertLead(tx, companyId, input.leadId);

  const [activity] = await tx
    .insert(activities)
    .values({
      ...input,
      status: input.status ?? (input.type === "task" ? "planned" : "done"),
      companyId,
      createdBy: tenant.user.id,
    })
    .returning(activityFields);

  await crmAudit(tx, tenant, meta, {
    action: "ACTIVITY_CREATED",
    resource: "activities",
    resourceId: activity!.id,
    details: { type: activity!.type, customerId: activity!.customerId, leadId: activity!.leadId },
  });
  return activity!;
}

export async function updateActivity(
  tx: Tx,
  tenant: TenantContext,
  activityId: string,
  patch: Partial<ActivityInput>,
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  if (patch.customerId) await assertCustomer(tx, companyId, patch.customerId);
  if (patch.leadId) await assertLead(tx, companyId, patch.leadId);

  const [activity] = await tx
    .update(activities)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(activities.id, activityId), eq(activities.companyId, companyId)))
    .returning(activityFields);
  if (!activity) throw notFound("Faoliyat topilmadi");

  await crmAudit(tx, tenant, meta, {
    action: "ACTIVITY_UPDATED",
    resource: "activities",
    resourceId: activityId,
    details: { changes: Object.keys(patch) },
  });
  return activity;
}

export async function deleteActivity(tx: Tx, tenant: TenantContext, activityId: string, meta: RequestMeta) {
  const [deleted] = await tx
    .delete(activities)
    .where(and(eq(activities.id, activityId), eq(activities.companyId, tenant.company.id)))
    .returning({ id: activities.id, title: activities.title });
  if (!deleted) throw notFound("Faoliyat topilmadi");

  await crmAudit(tx, tenant, meta, {
    action: "ACTIVITY_DELETED",
    resource: "activities",
    resourceId: activityId,
    details: { title: deleted.title },
  });
}
