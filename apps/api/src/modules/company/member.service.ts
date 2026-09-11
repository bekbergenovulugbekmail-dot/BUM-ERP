/**
 * Kompaniya a'zosini yangilash: rol, filial, ombor ruxsati, a'zolik holati.
 *
 * Ierarxiya bo'yicha faqat kompaniya egasi. Convex'dagi updateMember har
 * qanday a'zoga ochiq edi va companyRole ni tekshirmasdi — Kassir o'zini
 * "Business Owner" qilib qo'yishi mumkin edi.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { badRequest, notFound } from "@bum/shared";
import { warehouses } from "../../db/schema/inventory.js";
import { branches, companyMembers, roles } from "../../db/schema/platform.js";
import type { Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import type { SessionUser } from "../auth/session.js";
import {
  assertOwnerMayManage,
  auditUserAction,
  findAssignableRole,
  loadUserForUpdate,
  type OwnedCompany,
} from "../users/user-admin.service.js";

export type MemberPatch = {
  role?: string;
  branchId?: string | null;
  /** Bo'sh massiv = barcha omborlarga ruxsat. */
  allowedWarehouseIds?: string[];
  isActive?: boolean;
};

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);
}

export async function ownerUpdateMember(
  tx: Tx,
  owner: SessionUser,
  company: OwnedCompany,
  userId: string,
  patch: MemberPatch,
  meta: RequestMeta,
) {
  const target = await loadUserForUpdate(tx, userId);
  await assertOwnerMayManage(tx, company, owner, target, "membership");

  const [membership] = await tx
    .select()
    .from(companyMembers)
    .where(and(eq(companyMembers.companyId, company.id), eq(companyMembers.userId, target.id)))
    .limit(1)
    .for("update");
  if (!membership) throw notFound("Xodim topilmadi");

  const set: Partial<typeof companyMembers.$inferInsert> = {};
  const changes: string[] = [];

  if (patch.role !== undefined && patch.role !== membership.companyRole) {
    const role = await findAssignableRole(tx, company.id, patch.role);
    set.companyRole = role.name;
    set.roleId = role.id;
    changes.push("role");

    if (membership.roleId) {
      await tx
        .update(roles)
        .set({ memberCount: sql`greatest(${roles.memberCount} - 1, 0)` })
        .where(eq(roles.id, membership.roleId));
    }
    await tx
      .update(roles)
      .set({ memberCount: sql`${roles.memberCount} + 1` })
      .where(eq(roles.id, role.id));
  }

  if (patch.branchId !== undefined && patch.branchId !== membership.branchId) {
    if (patch.branchId) {
      const [branch] = await tx
        .select({ id: branches.id })
        .from(branches)
        .where(
          and(eq(branches.id, patch.branchId), eq(branches.companyId, company.id), eq(branches.isActive, true)),
        )
        .limit(1);
      if (!branch) throw badRequest("Filial topilmadi");
    }
    set.branchId = patch.branchId;
    changes.push("branch");
  }

  if (patch.allowedWarehouseIds !== undefined) {
    const ids = [...new Set(patch.allowedWarehouseIds)];
    if (ids.length > 0) {
      const found = await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(and(eq(warehouses.companyId, company.id), inArray(warehouses.id, ids)));
      // Boshqa kompaniya ombori ham "topilmadi"
      if (found.length !== ids.length) throw badRequest("Ombor topilmadi");
    }
    if (!sameSet(ids, membership.allowedWarehouseIds)) {
      set.allowedWarehouseIds = ids;
      changes.push("warehouses");
    }
  }

  if (patch.isActive !== undefined && patch.isActive !== membership.isActive) {
    set.isActive = patch.isActive;
    changes.push(patch.isActive ? "activated" : "deactivated");
  }

  if (changes.length === 0) return membership;

  const [updated] = await tx
    .update(companyMembers)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(companyMembers.id, membership.id))
    .returning();

  await auditUserAction(tx, owner, meta, {
    action: "MEMBER_UPDATED",
    targetId: target.id,
    companyId: company.id,
    details: { changes, ...(set.companyRole ? { role: set.companyRole } : {}) },
  });
  return updated!;
}
