/**
 * Omborlar (convex/warehouse/warehouses.ts).
 *
 * Convex'dan farqlar:
 *  - seedDefault ruxsatsiz edi — kerak emas, kompaniya yaratilganda WH-001 ochiladi
 *  - yaratish/tahrirlash `warehouses.manage` (Convex'da warehouse.manage — Omborchi ham ombor ochardi)
 *  - bitta asosiy ombor bazada ham kafolatlangan (0004 migratsiya)
 *  - asosiy yoki zaxirasi bor omborni faolsizlantirib bo'lmaydi
 *  - filial va mas'ul shaxs shu kompaniyaniki bo'lishi shart
 *  - a'zoning `allowedWarehouseIds` ruxsati amalda qo'llanadi (Convex'da saqlanardi, lekin tekshirilmasdi)
 */
import { and, desc, eq, getTableColumns, gt, inArray, ne } from "drizzle-orm";
import { badRequest, conflict, forbidden, notFound } from "@bum/shared";
import { stockLevels, warehouses } from "../../db/schema/inventory.js";
import { branches, companyMembers } from "../../db/schema/platform.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import { isFullAccessRole, type TenantContext } from "../company/tenant.js";

const { legacyId: _legacyId, companyId: _companyId, ...warehouseFields } = getTableColumns(warehouses);
export { warehouseFields };

/** Bo'sh ro'yxat — barcha omborlar; to'liq huquqli rollar cheklanmaydi. */
export function allowedWarehouses(tenant: TenantContext): string[] | null {
  if (isFullAccessRole(tenant.membership.companyRole)) return null;
  const allowed = tenant.membership.allowedWarehouseIds;
  return allowed.length === 0 ? null : allowed;
}

export function assertWarehouseAccess(tenant: TenantContext, warehouseId: string): void {
  const allowed = allowedWarehouses(tenant);
  if (allowed && !allowed.includes(warehouseId)) throw forbidden("Bu omborga ruxsatingiz yo'q");
}

export async function getWarehouse(conn: DbOrTx, tenant: TenantContext, warehouseId: string) {
  const [warehouse] = await conn
    .select(warehouseFields)
    .from(warehouses)
    .where(and(eq(warehouses.id, warehouseId), eq(warehouses.companyId, tenant.company.id)))
    .limit(1);
  if (!warehouse) throw notFound("Ombor topilmadi");
  assertWarehouseAccess(tenant, warehouse.id);
  return warehouse;
}

export async function listWarehouses(conn: DbOrTx, tenant: TenantContext, includeInactive = false) {
  const allowed = allowedWarehouses(tenant);
  return conn
    .select(warehouseFields)
    .from(warehouses)
    .where(
      and(
        eq(warehouses.companyId, tenant.company.id),
        includeInactive ? undefined : eq(warehouses.isActive, true),
        allowed ? inArray(warehouses.id, allowed) : undefined,
      ),
    )
    .orderBy(desc(warehouses.isDefault), warehouses.code);
}

export type WarehouseInput = {
  name: string;
  code: string;
  address?: string | null;
  city?: string | null;
  phone?: string | null;
  managerId?: string | null;
  branchId?: string | null;
  isDefault?: boolean;
  notes?: string | null;
};

async function assertReferences(tx: Tx, tenant: TenantContext, input: Partial<WarehouseInput>) {
  if (input.branchId) {
    const [branch] = await tx
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.id, input.branchId), eq(branches.companyId, tenant.company.id)))
      .limit(1);
    if (!branch) throw badRequest("Filial topilmadi");
  }
  if (input.managerId) {
    const [member] = await tx
      .select({ id: companyMembers.id })
      .from(companyMembers)
      .where(
        and(
          eq(companyMembers.companyId, tenant.company.id),
          eq(companyMembers.userId, input.managerId),
          eq(companyMembers.isActive, true),
        ),
      )
      .limit(1);
    if (!member) throw badRequest("Mas'ul shaxs kompaniya a'zosi emas");
  }
}

async function clearDefault(tx: Tx, companyId: string, exceptId?: string) {
  await tx
    .update(warehouses)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(
      and(
        eq(warehouses.companyId, companyId),
        eq(warehouses.isDefault, true),
        exceptId ? ne(warehouses.id, exceptId) : undefined,
      ),
    );
}

function audit(tx: Tx, tenant: TenantContext, meta: RequestMeta, action: string, id: string, details: Record<string, unknown>) {
  return writeAuditLog(
    {
      userId: tenant.user.id,
      userName: tenant.user.name,
      companyId: tenant.company.id,
      action,
      resource: "warehouses",
      resourceId: id,
      details,
      ...meta,
    },
    tx,
  );
}

export async function createWarehouse(tx: Tx, tenant: TenantContext, input: WarehouseInput, meta: RequestMeta) {
  await assertReferences(tx, tenant, input);
  if (input.isDefault) await clearDefault(tx, tenant.company.id);

  const [warehouse] = await tx
    .insert(warehouses)
    .values({ ...input, isDefault: input.isDefault ?? false, companyId: tenant.company.id })
    .returning(warehouseFields);

  await audit(tx, tenant, meta, "WAREHOUSE_CREATED", warehouse!.id, { code: warehouse!.code, name: warehouse!.name });
  return warehouse!;
}

export async function updateWarehouse(
  tx: Tx,
  tenant: TenantContext,
  warehouseId: string,
  patch: Partial<WarehouseInput> & { isActive?: boolean },
  meta: RequestMeta,
) {
  const [current] = await tx
    .select(warehouseFields)
    .from(warehouses)
    .where(and(eq(warehouses.id, warehouseId), eq(warehouses.companyId, tenant.company.id)))
    .limit(1)
    .for("update");
  if (!current) throw notFound("Ombor topilmadi");

  const willBeDefault = patch.isDefault ?? current.isDefault;
  const willBeActive = patch.isActive ?? current.isActive;
  if (current.isDefault && patch.isDefault === false) {
    throw badRequest("Asosiy omborni olib bo'lmaydi — boshqa omborni asosiy qiling");
  }
  if (willBeDefault && !willBeActive) throw badRequest("Asosiy ombor faol bo'lishi kerak");

  if (current.isActive && patch.isActive === false) {
    const [withStock] = await tx
      .select({ id: stockLevels.id })
      .from(stockLevels)
      .where(and(eq(stockLevels.warehouseId, warehouseId), gt(stockLevels.quantity, "0")))
      .limit(1);
    if (withStock) throw conflict("Omborda zaxira bor — avval boshqa omborga o'tkazing");
  }

  await assertReferences(tx, tenant, patch);
  if (patch.isDefault && !current.isDefault) await clearDefault(tx, tenant.company.id, warehouseId);

  const [updated] = await tx
    .update(warehouses)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(warehouses.id, warehouseId))
    .returning(warehouseFields);

  await audit(tx, tenant, meta, "WAREHOUSE_UPDATED", warehouseId, { changes: Object.keys(patch) });
  return updated!;
}
