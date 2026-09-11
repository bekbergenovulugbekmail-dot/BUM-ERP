/**
 * Ish markazlari (convex/manufacturing/orders.ts: listWorkCenters, createWorkCenter, deleteWorkCenter).
 *
 * Convex'dan farqlar:
 *  - kod "markazlar soni + 1" edi — o'chirishdan keyin takrorlanardi (`WC-001`, advisory lock)
 *  - vaqt yozuvlari bor markaz o'chirilardi — endi faolsizlantirish; tahrirlash qo'shildi
 */
import { and, asc, eq, getTableColumns } from "drizzle-orm";
import { conflict, notFound } from "@bum/shared";
import { productionTimeLines, workCenters } from "../../db/schema/manufacturing.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { nextDocumentNumber } from "../../shared/numbering.js";
import type { TenantContext } from "../company/tenant.js";
import { manufacturingAudit } from "./boms.service.js";

const { legacyId: _legacyId, companyId: _companyId, ...workCenterFields } = getTableColumns(workCenters);

export type WorkCenterType = (typeof workCenters.type.enumValues)[number];

export async function listWorkCenters(conn: DbOrTx, tenant: TenantContext, includeInactive = false) {
  return conn
    .select(workCenterFields)
    .from(workCenters)
    .where(and(eq(workCenters.companyId, tenant.company.id), includeInactive ? undefined : eq(workCenters.isActive, true)))
    .orderBy(asc(workCenters.code));
}

export async function createWorkCenter(
  tx: Tx,
  tenant: TenantContext,
  input: { name: string; type?: WorkCenterType; costPerHour?: string },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const code = await nextDocumentNumber(tx, {
    table: workCenters,
    column: workCenters.code,
    companyColumn: workCenters.companyId,
    companyId,
    prefix: "WC-",
    width: 3,
  });
  const [workCenter] = await tx.insert(workCenters).values({ ...input, code, companyId }).returning(workCenterFields);

  await manufacturingAudit(tx, tenant, meta, {
    action: "WORK_CENTER_CREATED",
    resource: "work_centers",
    resourceId: workCenter!.id,
    details: { code, name: input.name },
  });
  return workCenter!;
}

export async function updateWorkCenter(
  tx: Tx,
  tenant: TenantContext,
  workCenterId: string,
  patch: { name?: string; type?: WorkCenterType; costPerHour?: string; isActive?: boolean },
  meta: RequestMeta,
) {
  const [workCenter] = await tx
    .update(workCenters)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(workCenters.id, workCenterId), eq(workCenters.companyId, tenant.company.id)))
    .returning(workCenterFields);
  if (!workCenter) throw notFound("Ish markazi topilmadi");

  await manufacturingAudit(tx, tenant, meta, {
    action: "WORK_CENTER_UPDATED",
    resource: "work_centers",
    resourceId: workCenterId,
    details: { changes: Object.keys(patch) },
  });
  return workCenter;
}

export async function deleteWorkCenter(tx: Tx, tenant: TenantContext, workCenterId: string, meta: RequestMeta) {
  const [workCenter] = await tx
    .select({ id: workCenters.id, code: workCenters.code })
    .from(workCenters)
    .where(and(eq(workCenters.id, workCenterId), eq(workCenters.companyId, tenant.company.id)))
    .limit(1)
    .for("update");
  if (!workCenter) throw notFound("Ish markazi topilmadi");

  const [used] = await tx
    .select({ id: productionTimeLines.id })
    .from(productionTimeLines)
    .where(eq(productionTimeLines.workCenterId, workCenterId))
    .limit(1);
  if (used) throw conflict("Ish markazida vaqt yozuvlari bor — o'chirish o'rniga faolsizlantiring");

  await tx.delete(workCenters).where(eq(workCenters.id, workCenterId));
  await manufacturingAudit(tx, tenant, meta, {
    action: "WORK_CENTER_DELETED",
    resource: "work_centers",
    resourceId: workCenterId,
    details: { code: workCenter.code },
  });
}
