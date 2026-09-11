/**
 * Kompaniya rollari (convex/admin.ts: listRoles, createRole, updateRole, deleteRole).
 *
 * Convex'dagi teshiklar yopildi:
 *  - hammasi faqat a'zolikni tekshirardi — endi `roles.manage`
 *  - updateRole `companyId` si yo'q GLOBAL rolni ham tahrirlashga ruxsat berardi:
 *    har qanday xodim global rolga barcha ruxsatlarni qo'shib, BARCHA kompaniyalarga
 *    ta'sir qila olardi — endi faqat shu kompaniyaning o'z roli
 *  - ruxsat nomlari tekshirilmasdi — endi faqat katalogdagi `Permission`
 *  - rol tahrirlovchi o'zida yo'q ruxsatni bera olardi (o'z roliga qo'shib huquqini
 *    oshirish) — endi faqat o'zidagi ruxsatlarni bera oladi
 *  - to'liq ruxsat rol NOMI bo'yicha beriladi — "Superadmin" / "Business Owner"
 *    nomli rol yaratish yoki shu nomga o'zgartirish taqiqlangan
 *  - deleteRole xodimlari bor rolni ham o'chirardi
 *  - tizim rolining nomi o'zgarsa a'zoliklardagi rol nomi eskirib qolardi
 */
import { and, count, eq, or } from "drizzle-orm";
import { badRequest, conflict, forbidden, notFound, type Permission } from "@bum/shared";
import { companyMembers, roles } from "../../db/schema/platform.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import { effectivePermissions, isFullAccessRole, type TenantContext } from "./tenant.js";

const roleColumns = {
  id: roles.id,
  name: roles.name,
  description: roles.description,
  color: roles.color,
  permissions: roles.permissions,
  isSystem: roles.isSystem,
  isActive: roles.isActive,
  memberCount: roles.memberCount,
  createdAt: roles.createdAt,
  updatedAt: roles.updatedAt,
};

function audit(
  tx: Tx,
  tenant: TenantContext,
  meta: RequestMeta,
  entry: { action: string; roleId: string; details: Record<string, unknown>; severity?: "info" | "warning" },
): Promise<void> {
  return writeAuditLog(
    {
      userId: tenant.user.id,
      userName: tenant.user.name,
      companyId: tenant.company.id,
      action: entry.action,
      resource: "roles",
      resourceId: entry.roleId,
      severity: entry.severity ?? "info",
      details: entry.details,
      ...meta,
    },
    tx,
  );
}

function assertAllowedName(name: string): void {
  if (isFullAccessRole(name)) throw forbidden(`"${name}" nomli rol yaratib bo'lmaydi`);
}

/** Faqat o'zida bor ruxsatni boshqaga berish mumkin. */
async function assertCanGrant(tx: Tx, tenant: TenantContext, requested: Permission[]): Promise<void> {
  if (requested.length === 0) return;
  const own = await effectivePermissions(tx, tenant);
  const missing = requested.filter((p) => !own.includes(p));
  if (missing.length > 0) {
    throw forbidden(`O'zingizda yo'q ruxsatni bera olmaysiz: ${missing.join(", ")}`);
  }
}

async function assertNameFree(tx: Tx, companyId: string, name: string): Promise<void> {
  const [existing] = await tx
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.companyId, companyId), eq(roles.name, name)))
    .limit(1);
  if (existing) throw conflict("Bu nomda rol mavjud");
}

export async function listRoles(conn: DbOrTx, tenant: TenantContext) {
  return conn
    .select(roleColumns)
    .from(roles)
    .where(eq(roles.companyId, tenant.company.id))
    .orderBy(roles.name);
}

async function loadCompanyRole(tx: Tx, tenant: TenantContext, roleId: string) {
  const [role] = await tx
    .select(roleColumns)
    .from(roles)
    // Global rol yoki boshqa kompaniya roli ham "topilmadi"
    .where(and(eq(roles.id, roleId), eq(roles.companyId, tenant.company.id)))
    .limit(1)
    .for("update");
  if (!role) throw notFound("Rol topilmadi");
  return role;
}

export type NewRole = {
  name: string;
  description?: string | null;
  color?: string | null;
  permissions: Permission[];
};

export async function createRole(tx: Tx, tenant: TenantContext, input: NewRole, meta: RequestMeta) {
  assertAllowedName(input.name);
  const permissions = [...new Set(input.permissions)];
  await assertCanGrant(tx, tenant, permissions);
  await assertNameFree(tx, tenant.company.id, input.name);

  const [role] = await tx
    .insert(roles)
    .values({
      companyId: tenant.company.id,
      name: input.name,
      description: input.description ?? null,
      color: input.color ?? null,
      permissions,
      isSystem: false,
    })
    .returning(roleColumns);

  await audit(tx, tenant, meta, {
    action: "ROLE_CREATED",
    roleId: role!.id,
    details: { name: role!.name, permissions },
  });
  return role!;
}

export type RolePatch = {
  name?: string;
  description?: string | null;
  color?: string | null;
  permissions?: Permission[];
  isActive?: boolean;
};

export async function updateRole(
  tx: Tx,
  tenant: TenantContext,
  roleId: string,
  patch: RolePatch,
  meta: RequestMeta,
) {
  const role = await loadCompanyRole(tx, tenant, roleId);
  // To'liq ruxsat nom bo'yicha beriladi — bu rollarni tahrirlashning ma'nosi yo'q
  if (isFullAccessRole(role.name)) throw forbidden("To'liq huquqli rolni o'zgartirib bo'lmaydi");

  const set: Partial<typeof roles.$inferInsert> = {};
  const changes: string[] = [];
  let added: Permission[] = [];
  let removed: string[] = [];

  if (patch.name !== undefined && patch.name !== role.name) {
    if (role.isSystem) throw forbidden("Tizim rolining nomini o'zgartirib bo'lmaydi");
    assertAllowedName(patch.name);
    await assertNameFree(tx, tenant.company.id, patch.name);
    set.name = patch.name;
    changes.push("name");
  }
  if (patch.description !== undefined && patch.description !== role.description) {
    set.description = patch.description;
    changes.push("description");
  }
  if (patch.color !== undefined && patch.color !== role.color) {
    set.color = patch.color;
    changes.push("color");
  }
  if (patch.permissions !== undefined) {
    const next = [...new Set(patch.permissions)];
    added = next.filter((p) => !role.permissions.includes(p));
    removed = role.permissions.filter((p) => !(next as string[]).includes(p));
    if (added.length > 0 || removed.length > 0) {
      await assertCanGrant(tx, tenant, added);
      set.permissions = next;
      changes.push("permissions");
    }
  }
  if (patch.isActive !== undefined && patch.isActive !== role.isActive) {
    set.isActive = patch.isActive;
    changes.push("isActive");
  }

  if (changes.length === 0) return role;

  const [updated] = await tx
    .update(roles)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(roles.id, role.id))
    .returning(roleColumns);

  // A'zoliklardagi rol nomi (companyRole) rol bilan mos qolsin
  if (set.name) {
    await tx
      .update(companyMembers)
      .set({ companyRole: set.name, updatedAt: new Date() })
      .where(and(eq(companyMembers.companyId, tenant.company.id), eq(companyMembers.roleId, role.id)));
  }

  await audit(tx, tenant, meta, {
    action: "ROLE_UPDATED",
    roleId: role.id,
    severity: changes.includes("permissions") || changes.includes("isActive") ? "warning" : "info",
    details: {
      name: updated!.name,
      changes,
      ...(added.length > 0 ? { added } : {}),
      ...(removed.length > 0 ? { removed } : {}),
    },
  });
  return updated!;
}

export async function deleteRole(tx: Tx, tenant: TenantContext, roleId: string, meta: RequestMeta): Promise<void> {
  const role = await loadCompanyRole(tx, tenant, roleId);
  if (role.isSystem) throw forbidden("Tizim rollarini o'chirib bo'lmaydi");

  // memberCount hisoblagichiga emas, haqiqiy a'zoliklarga qaraladi
  const [inUse] = await tx
    .select({ n: count() })
    .from(companyMembers)
    .where(
      and(
        eq(companyMembers.companyId, tenant.company.id),
        or(eq(companyMembers.roleId, role.id), eq(companyMembers.companyRole, role.name)),
      ),
    );
  if (inUse && inUse.n > 0) {
    throw conflict(`Bu rolda ${inUse.n} ta xodim bor — avval ularning rolini o'zgartiring`);
  }

  await tx.delete(roles).where(eq(roles.id, role.id));
  await audit(tx, tenant, meta, {
    action: "ROLE_DELETED",
    roleId: role.id,
    severity: "warning",
    details: { name: role.name, permissions: role.permissions },
  });
}

/** Zod bilan birga ishlatiladi — katalogda yo'q nom kiritilsa 400. */
export function assertPermissionsNotEmpty(permissions: Permission[]): void {
  if (permissions.length === 0) throw badRequest("Kamida bitta ruxsat tanlang");
}
