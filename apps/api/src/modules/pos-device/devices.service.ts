/**
 * Kassa qurilmalari: ro'yxatdan o'tkazish (desktop ilovada telefon + parol bilan, `pos.devices.manage`),
 * web'dan ro'yxat va o'chirish. Token bir marta qaytadi. Audit: POS_DEVICE_REGISTERED / POS_DEVICE_UPDATED.
 */
import { and, asc, eq, ne } from "drizzle-orm";
import { badRequest, conflict, notFound } from "@bum/shared";
import { companies, companyMembers, users } from "../../db/schema/platform.js";
import { posDevices } from "../../db/schema/pos.js";
import { posShifts } from "../../db/schema/sales.js";
import { warehouses } from "../../db/schema/inventory.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import { nextDocumentNumber } from "../../shared/numbering.js";
import type { SessionUser } from "../auth/session.js";
import { requirePermission, requireTenantForWrite, type TenantContext } from "../company/tenant.js";
import { assertWarehouseAccess } from "../inventory/warehouses.service.js";
import { newDeviceToken, revokeDeviceCashiers } from "./device-auth.js";
import { assertKassaForDevice } from "../sales/kassa.service.js";

const deviceFields = {
  id: posDevices.id,
  name: posDevices.name,
  code: posDevices.code,
  warehouseId: posDevices.warehouseId,
  warehouseName: warehouses.name,
  cashAccountId: posDevices.cashAccountId,
  isActive: posDevices.isActive,
  appVersion: posDevices.appVersion,
  platform: posDevices.platform,
  lastSeenAt: posDevices.lastSeenAt,
  lastPullAt: posDevices.lastPullAt,
  lastPushAt: posDevices.lastPushAt,
  createdAt: posDevices.createdAt,
};

/** Foydalanuvchining faol a'zoliklari; kompaniya tanlanmagan va bittadan ko'p bo'lsa — tanlash talab qilinadi. */
export async function setupTenant(conn: DbOrTx, user: SessionUser, companyId?: string) {
  const memberships = await conn
    .select({ id: companies.id, name: companies.name })
    .from(companyMembers)
    .innerJoin(companies, eq(companies.id, companyMembers.companyId))
    .where(and(eq(companyMembers.userId, user.id), eq(companyMembers.isActive, true)))
    .orderBy(asc(companies.name));
  const chosen = companyId ?? (memberships.length === 1 ? memberships[0]!.id : undefined);
  if (!chosen) return { companies: memberships, tenant: null };
  const tenant = await requireTenantForWrite(conn, { ...user, activeCompanyId: chosen });
  await requirePermission(conn, tenant, "pos.devices.manage");
  return { companies: memberships, tenant };
}

export function deviceWarehouses(conn: DbOrTx, tenant: TenantContext) {
  const allowed = tenant.membership.allowedWarehouseIds;
  return conn
    .select({ id: warehouses.id, name: warehouses.name, code: warehouses.code, isDefault: warehouses.isDefault })
    .from(warehouses)
    .where(and(eq(warehouses.companyId, tenant.company.id), eq(warehouses.isActive, true)))
    .orderBy(asc(warehouses.name))
    .then((rows) => (allowed.length === 0 ? rows : rows.filter((row) => allowed.includes(row.id))));
}

export async function registerDevice(
  tx: Tx,
  tenant: TenantContext,
  input: { name: string; warehouseId: string; appVersion?: string | null; platform?: string | null },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const [warehouse] = await tx
    .select({ isActive: warehouses.isActive })
    .from(warehouses)
    .where(and(eq(warehouses.id, input.warehouseId), eq(warehouses.companyId, companyId)))
    .limit(1);
  if (!warehouse) throw badRequest("Ombor topilmadi");
  if (!warehouse.isActive) throw badRequest("Ombor faol emas");
  assertWarehouseAccess(tenant, input.warehouseId);

  const code = await nextDocumentNumber(tx, {
    table: posDevices,
    column: posDevices.code,
    companyColumn: posDevices.companyId,
    companyId,
    prefix: "K",
    width: 2,
  });
  const { token, tokenHash } = newDeviceToken();
  const [device] = await tx
    .insert(posDevices)
    .values({
      companyId,
      warehouseId: input.warehouseId,
      name: input.name,
      code,
      tokenHash,
      registeredBy: tenant.user.id,
      appVersion: input.appVersion ?? null,
      platform: input.platform ?? null,
      lastSeenAt: new Date(),
    })
    .returning({ id: posDevices.id });
  await writeAuditLog(
    {
      userId: tenant.user.id,
      userName: tenant.user.name,
      companyId,
      action: "POS_DEVICE_REGISTERED",
      resource: "pos_devices",
      resourceId: device!.id,
      details: { name: input.name, code, warehouseId: input.warehouseId },
      ...meta,
    },
    tx,
  );
  return { device: await deviceById(tx, companyId, device!.id), token };
}

async function deviceById(conn: DbOrTx, companyId: string, deviceId: string) {
  const [device] = await conn
    .select(deviceFields)
    .from(posDevices)
    .innerJoin(warehouses, eq(warehouses.id, posDevices.warehouseId))
    .where(and(eq(posDevices.id, deviceId), eq(posDevices.companyId, companyId)))
    .limit(1);
  if (!device) throw notFound("Kassa qurilmasi topilmadi");
  return device;
}

export function listDevices(conn: DbOrTx, tenant: TenantContext) {
  return conn
    .select({ ...deviceFields, registeredByName: users.name })
    .from(posDevices)
    .innerJoin(warehouses, eq(warehouses.id, posDevices.warehouseId))
    .leftJoin(users, eq(users.id, posDevices.registeredBy))
    .where(eq(posDevices.companyId, tenant.company.id))
    .orderBy(asc(posDevices.code));
}

export async function updateDevice(
  tx: Tx,
  tenant: TenantContext,
  deviceId: string,
  patch: { name?: string; isActive?: boolean; cashAccountId?: string | null },
  meta: RequestMeta,
) {
  const current = await deviceById(tx, tenant.company.id, deviceId);
  if (patch.cashAccountId !== undefined && patch.cashAccountId !== current.cashAccountId) {
    // Qurilma → kassa deterministik: ochiq smena davomida kassa almashsa, smena puli ikki kassaga bo'linib ketadi
    const [open] = await tx
      .select({ id: posShifts.id })
      .from(posShifts)
      .where(and(eq(posShifts.companyId, tenant.company.id), eq(posShifts.deviceId, deviceId), eq(posShifts.status, "open")))
      .limit(1);
    if (open) throw conflict("Qurilmada ochiq smena bor — kassani smena yopilgach almashtiring");
    if (patch.cashAccountId) {
      await assertKassaForDevice(tx, tenant.company.id, patch.cashAccountId, current.warehouseId);
      const [other] = await tx
        .select({ code: posDevices.code })
        .from(posDevices)
        .where(and(eq(posDevices.companyId, tenant.company.id), eq(posDevices.cashAccountId, patch.cashAccountId), eq(posDevices.isActive, true), ne(posDevices.id, deviceId)))
        .limit(1);
      if (other) throw conflict(`Bu kassa boshqa qurilmaga biriktirilgan: ${other.code}`);
    }
  }
  // O'chirilganda token yangi tasodifiy xesh bilan almashtiriladi va kassir bog'lanishlari bekor: qayta yoqish eski
  // (o'g'irlangan bo'lishi mumkin) tokenni tiklamaydi — kassa ilovada qayta ro'yxatdan o'tkaziladi
  const deactivating = patch.isActive === false && current.isActive;
  await tx
    .update(posDevices)
    .set({ ...patch, ...(deactivating ? { tokenHash: newDeviceToken().tokenHash } : {}), updatedAt: new Date() })
    .where(eq(posDevices.id, deviceId));
  if (deactivating) await revokeDeviceCashiers(tx, deviceId);
  await writeAuditLog(
    {
      userId: tenant.user.id,
      userName: tenant.user.name,
      companyId: tenant.company.id,
      action: patch.isActive === false && current.isActive ? "POS_DEVICE_DEACTIVATED" : "POS_DEVICE_UPDATED",
      resource: "pos_devices",
      resourceId: deviceId,
      details: {
        changes: Object.keys(patch),
        code: current.code,
        ...(patch.cashAccountId !== undefined ? { cashAccountFrom: current.cashAccountId, cashAccountTo: patch.cashAccountId } : {}),
      },
      ...meta,
    },
    tx,
  );
  return deviceById(tx, tenant.company.id, deviceId);
}
