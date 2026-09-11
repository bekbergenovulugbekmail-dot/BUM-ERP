/**
 * Kompaniya xodimini yangilash: ism, telefon (login), rol, filial, ombor va kategoriya ruxsati, a'zolik holati.
 *
 * Ierarxiya bo'yicha faqat kompaniya egasi. Convex'dagi updateMember har
 * qanday a'zoga ochiq edi va companyRole ni tekshirmasdi — Kassir o'zini
 * "Business Owner" qilib qo'yishi mumkin edi.
 *
 * Ism va telefon — hisob darajasidagi ma'lumot: xodim boshqa kompaniyaga ham a'zo bo'lsa,
 * ularni faqat platforma admini o'zgartiradi. Telefon (login) o'zgarsa xodimning barcha sessiyalari yopiladi.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { badRequest, notFound } from "@bum/shared";
import { categories } from "../../db/schema/catalog.js";
import { warehouses } from "../../db/schema/inventory.js";
import { branches, companyMembers, roles, users } from "../../db/schema/platform.js";
import type { Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { revokeUserSessions, type SessionUser } from "../auth/session.js";
import {
  assertOwnerMayManage,
  assertPhoneFree,
  auditUserAction,
  findAssignableRole,
  loadUserForUpdate,
  normalizePhoneOrThrow,
  type OwnedCompany,
} from "../users/user-admin.service.js";

export type MemberPatch = {
  name?: string | null;
  phone?: string;
  role?: string;
  branchId?: string | null;
  /** Bo'sh massiv = barcha omborlarga ruxsat. */
  allowedWarehouseIds?: string[];
  /** Mas'ul kategoriyalar (ichki kategoriyalari bilan); bo'sh massiv = barcha kategoriyalar. */
  allowedCategoryIds?: string[];
  isActive?: boolean;
};

function sameSet(a: string[], b: string[]): boolean {
  const sortedB = [...b].sort();
  return a.length === b.length && [...a].sort().every((v, i) => v === sortedB[i]);
}

async function updateAccount(
  tx: Tx,
  owner: SessionUser,
  company: OwnedCompany,
  target: SessionUser,
  patch: Pick<MemberPatch, "name" | "phone">,
  meta: RequestMeta,
): Promise<void> {
  const name = patch.name === undefined ? undefined : patch.name?.trim() || null;
  const phone = patch.phone === undefined ? undefined : normalizePhoneOrThrow(patch.phone);
  const nameChanged = name !== undefined && name !== target.name;
  const phoneChanged = phone !== undefined && phone !== target.phone;
  if (!nameChanged && !phoneChanged) return;

  await assertOwnerMayManage(tx, company, owner, target, "account");
  if (phoneChanged) await assertPhoneFree(tx, phone, target.id);

  await tx
    .update(users)
    .set({ ...(nameChanged ? { name } : {}), ...(phoneChanged ? { phone } : {}) })
    .where(eq(users.id, target.id));

  if (nameChanged) {
    await auditUserAction(tx, owner, meta, {
      action: "USER_RENAMED",
      targetId: target.id,
      companyId: company.id,
      details: { from: target.name, to: name, by: "company_owner" },
    });
  }
  if (phoneChanged) {
    // Login o'zgardi — eski sessiyalar yopiladi, xodim yangi raqam bilan qayta kiradi
    await revokeUserSessions(tx, target.id);
    await auditUserAction(tx, owner, meta, {
      action: "USER_PHONE_CHANGED",
      targetId: target.id,
      companyId: company.id,
      severity: "warning",
      details: { from: target.phone, to: phone, by: "company_owner", sessionsRevoked: true },
    });
  }
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

  await updateAccount(tx, owner, company, target, patch, meta);

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

  if (patch.allowedCategoryIds !== undefined) {
    const ids = [...new Set(patch.allowedCategoryIds)];
    if (ids.length > 0) {
      const found = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.companyId, company.id), inArray(categories.id, ids)));
      // Boshqa kompaniya kategoriyasi ham "topilmadi"
      if (found.length !== ids.length) throw badRequest("Kategoriya topilmadi");
    }
    if (!sameSet(ids, membership.allowedCategoryIds)) {
      set.allowedCategoryIds = ids;
      changes.push("categories");
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
    details: {
      changes,
      ...(set.companyRole ? { role: set.companyRole } : {}),
      ...(set.allowedCategoryIds ? { categories: set.allowedCategoryIds.length } : {}),
    },
  });
  return updated!;
}
