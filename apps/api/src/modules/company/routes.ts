/**
 * /api/company — foydalanuvchining aktiv kompaniyasi.
 *
 * Kompaniya har doim foydalanuvchining AKTIV kompaniyasi — so'rovda companyId
 * qabul qilinmaydi (faqat /switch da, a'zolik tekshiruvi bilan).
 *
 *   GET    /                            aktiv kompaniya + a'zolik + ruxsatlar   (a'zo)
 *   PATCH  /                            kompaniya ma'lumotlari           (company.manage)
 *   GET    /mine                        a'zo bo'lgan kompaniyalar         (sessiya)
 *   POST   /switch                      aktiv kompaniyani almashtirish    (faol a'zo)
 *   GET    /branches                    filiallar                         (a'zo)
 *   POST   /branches                    filial yaratish                   (branches.manage)
 *   PATCH  /branches/:branchId          filialni yangilash                (branches.manage)
 *   GET    /employees                   a'zolar                           (users.view)
 *   POST   /employees                   xodim qo'shish                    (kompaniya egasi)
 *   PATCH  /employees/:userId           rol, filial, ombor, holat         (kompaniya egasi)
 *   POST   /employees/:userId/password  parolni tiklash                   (kompaniya egasi)
 *   GET    /roles                       kompaniya rollari                 (a'zo)
 *   POST   /roles                       rol yaratish                      (roles.manage)
 *   PATCH  /roles/:roleId               rolni tahrirlash                  (roles.manage)
 *   DELETE /roles/:roleId               rolni o'chirish                   (roles.manage)
 *   GET    /audit-logs                  kompaniya audit jurnali           (audit.view)
 *   GET    /settings                    sozlamalar (?group=)              (settings.view)
 *   PUT    /settings/:key               sozlamani saqlash                 (settings.manage; modules → modules.manage)
 *   GET    /print-settings              chek shabloni (standart bilan)    (a'zo — kassir chek chiqaradi)
 *   PUT    /print-settings/receipt      chek shablonini saqlash           (settings.manage)
 *   PUT    /print-settings/labels       etiketka shablonlarini saqlash    (settings.manage)
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { badRequest, isPermission, type Permission } from "@bum/shared";
import { db } from "../../db/client.js";
import { withTransaction } from "../../db/transaction.js";
import { requestMeta } from "../../shared/audit.js";
import { listAuditLogs } from "../audit/audit-log.service.js";
import { authOf, requireAuth } from "../auth/guard.js";
import {
  createEmployee,
  listCompanyMembers,
  ownerResetEmployeePassword,
  resolveOwnedCompany,
} from "../users/user-admin.service.js";
import {
  createBranch,
  getCompany,
  listBranches,
  listMyCompanies,
  switchCompany,
  updateBranch,
  updateCompany,
} from "./company.service.js";
import { ownerUpdateMember } from "./member.service.js";
import {
  assertPermissionsNotEmpty,
  createRole,
  deleteRole,
  listRoles,
  updateRole,
} from "./role.service.js";
import {
  getPrintSettings,
  labelSettingsSchema,
  receiptTemplateSchema,
  saveLabelSettings,
  saveReceiptTemplate,
} from "./print-settings.service.js";
import { listCompanySettings, upsertCompanySetting } from "./settings.service.js";
import {
  effectivePermissions,
  requirePermission,
  requireTenant,
  requireTenantForWrite,
} from "./tenant.js";

/** Bo'sh satr NULL sifatida saqlanadi — ma'lumotni tozalash imkoni. */
const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional();

const companyPatchBody = z.strictObject({
  name: z.string().trim().min(1).max(200).optional(),
  legalName: nullableText(300),
  taxId: nullableText(32),
  phone: nullableText(20),
  email: z.email().max(255).nullable().optional(),
  website: nullableText(255),
  address: nullableText(1000),
  city: nullableText(100),
  region: nullableText(100),
  country: z.string().length(2).optional(),
  currency: z.string().length(3).optional(),
  language: z.string().length(2).optional(),
});

const switchBody = z.strictObject({ companyId: z.uuid() });

const branchCreateBody = z.strictObject({
  name: z.string().trim().min(1).max(200),
  code: z.string().trim().min(1).max(32),
  address: nullableText(1000),
  city: nullableText(100),
  phone: nullableText(20),
  isDefault: z.boolean().optional(),
});
const branchPatchBody = branchCreateBody.partial().extend({ isActive: z.boolean().optional() });
const branchParams = z.object({ branchId: z.uuid() });

const employeeBody = z.object({
  phone: z.string().min(1).max(32),
  password: z.string().min(1).max(256),
  name: z.string().max(200).optional(),
  role: z.string().min(1).max(100).optional(),
});
const memberPatchBody = z.strictObject({
  name: z.string().trim().max(200).nullable().optional(),
  phone: z.string().min(1).max(32).optional(),
  role: z.string().min(1).max(100).optional(),
  branchId: z.uuid().nullable().optional(),
  allowedWarehouseIds: z.array(z.uuid()).max(500).optional(),
  /** Mas'ul kategoriyalar; bo'sh — barcha kategoriyalar. */
  allowedCategoryIds: z.array(z.uuid()).max(500).optional(),
  isActive: z.boolean().optional(),
});
const userParams = z.object({ userId: z.uuid() });
const resetPasswordBody = z.object({ newPassword: z.string().min(1).max(256) });

/** Faqat katalogdagi ruxsat nomlari — Convex'da ixtiyoriy satr qabul qilinardi. */
const permissionList = z
  .array(z.custom<Permission>((v) => typeof v === "string" && isPermission(v), "Noma'lum ruxsat"))
  .max(200);
const roleColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Rang #RRGGBB ko'rinishida").nullable().optional();
const roleCreateBody = z.strictObject({
  name: z.string().trim().min(1).max(100),
  description: nullableText(500),
  color: roleColor,
  permissions: permissionList,
});
const rolePatchBody = z.strictObject({
  name: z.string().trim().min(1).max(100).optional(),
  description: nullableText(500),
  color: roleColor,
  permissions: permissionList.optional(),
  isActive: z.boolean().optional(),
});
const roleParams = z.object({ roleId: z.uuid() });

const auditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  resource: z.string().trim().min(1).max(100).optional(),
  cursor: z.string().max(200).optional(),
});

const settingsQuery = z.object({ group: z.string().trim().min(1).max(50).optional() });
const settingParams = z.object({ key: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/, "Kalit noto'g'ri") });
const settingBody = z.strictObject({
  value: z.string().max(10_000),
  group: z.string().trim().min(1).max(50),
  description: z.string().trim().max(500).optional(),
});

export async function companyRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  // ─── Kompaniya ───────────────────────────────────────────────────────────

  app.get("/", async (req) => {
    const tenant = await requireTenant(db, authOf(req).user);
    return {
      company: await getCompany(db, tenant.company.id),
      membership: {
        companyRole: tenant.membership.companyRole,
        branchId: tenant.membership.branchId,
        allowedWarehouseIds: tenant.membership.allowedWarehouseIds,
        allowedCategoryIds: tenant.membership.allowedCategoryIds,
      },
      permissions: await effectivePermissions(db, tenant),
    };
  });

  app.patch("/", async (req) => {
    const patch = companyPatchBody.parse(req.body);
    const { user } = authOf(req);
    const company = await withTransaction(async (tx) => {
      const tenant = await requireTenantForWrite(tx, user);
      await requirePermission(tx, tenant, "company.manage");
      return updateCompany(tx, tenant, patch, requestMeta(req));
    });
    return { company };
  });

  app.get("/mine", async (req) => ({ companies: await listMyCompanies(db, authOf(req).user) }));

  app.post("/switch", async (req) => {
    const { companyId } = switchBody.parse(req.body);
    const { user } = authOf(req);
    await withTransaction((tx) => switchCompany(tx, user, companyId, requestMeta(req)));
    return { ok: true, activeCompanyId: companyId };
  });

  // ─── Filiallar ───────────────────────────────────────────────────────────

  app.get("/branches", async (req) => {
    const tenant = await requireTenant(db, authOf(req).user);
    return { branches: await listBranches(db, tenant) };
  });

  app.post("/branches", async (req, reply) => {
    const body = branchCreateBody.parse(req.body);
    const { user } = authOf(req);
    const branch = await withTransaction(async (tx) => {
      const tenant = await requireTenantForWrite(tx, user);
      await requirePermission(tx, tenant, "branches.manage");
      return createBranch(tx, tenant, body, requestMeta(req));
    });
    reply.status(201);
    return { branch };
  });

  app.patch("/branches/:branchId", async (req) => {
    const { branchId } = branchParams.parse(req.params);
    const patch = branchPatchBody.parse(req.body);
    const { user } = authOf(req);
    const branch = await withTransaction(async (tx) => {
      const tenant = await requireTenantForWrite(tx, user);
      await requirePermission(tx, tenant, "branches.manage");
      return updateBranch(tx, tenant, branchId, patch, requestMeta(req));
    });
    return { branch };
  });

  // ─── Xodimlar ────────────────────────────────────────────────────────────

  app.get("/employees", async (req) => {
    const tenant = await requireTenant(db, authOf(req).user);
    await requirePermission(db, tenant, "users.view");
    return { employees: await listCompanyMembers(db, tenant.company.id) };
  });

  app.post("/employees", async (req, reply) => {
    const body = employeeBody.parse(req.body);
    const { user } = authOf(req);

    const { user: employee, role } = await withTransaction(async (tx) => {
      const company = await resolveOwnedCompany(tx, user);
      return createEmployee(tx, user, company, body, requestMeta(req));
    });

    reply.status(201);
    return { employee: { id: employee.id, phone: employee.phone, name: employee.name, companyRole: role } };
  });

  app.patch("/employees/:userId", async (req) => {
    const { userId } = userParams.parse(req.params);
    const patch = memberPatchBody.parse(req.body);
    const { user } = authOf(req);

    const member = await withTransaction(async (tx) => {
      const company = await resolveOwnedCompany(tx, user);
      return ownerUpdateMember(tx, user, company, userId, patch, requestMeta(req));
    });
    return {
      member: {
        userId: member.userId,
        companyRole: member.companyRole,
        branchId: member.branchId,
        allowedWarehouseIds: member.allowedWarehouseIds,
        allowedCategoryIds: member.allowedCategoryIds,
        isActive: member.isActive,
      },
    };
  });

  app.post("/employees/:userId/password", async (req) => {
    const { userId } = userParams.parse(req.params);
    const { newPassword } = resetPasswordBody.parse(req.body);
    const { user } = authOf(req);

    await withTransaction(async (tx) => {
      const company = await resolveOwnedCompany(tx, user);
      await ownerResetEmployeePassword(tx, user, company, userId, newPassword, requestMeta(req));
    });
    return { ok: true };
  });

  // ─── Rollar ──────────────────────────────────────────────────────────────

  app.get("/roles", async (req) => {
    const tenant = await requireTenant(db, authOf(req).user);
    return { roles: await listRoles(db, tenant) };
  });

  app.post("/roles", async (req, reply) => {
    const body = roleCreateBody.parse(req.body);
    assertPermissionsNotEmpty(body.permissions);
    const { user } = authOf(req);
    const role = await withTransaction(async (tx) => {
      const tenant = await requireTenantForWrite(tx, user);
      await requirePermission(tx, tenant, "roles.manage");
      return createRole(tx, tenant, body, requestMeta(req));
    });
    reply.status(201);
    return { role };
  });

  app.patch("/roles/:roleId", async (req) => {
    const { roleId } = roleParams.parse(req.params);
    const patch = rolePatchBody.parse(req.body);
    const { user } = authOf(req);
    const role = await withTransaction(async (tx) => {
      const tenant = await requireTenantForWrite(tx, user);
      await requirePermission(tx, tenant, "roles.manage");
      return updateRole(tx, tenant, roleId, patch, requestMeta(req));
    });
    return { role };
  });

  app.delete("/roles/:roleId", async (req) => {
    const { roleId } = roleParams.parse(req.params);
    const { user } = authOf(req);
    await withTransaction(async (tx) => {
      const tenant = await requireTenantForWrite(tx, user);
      await requirePermission(tx, tenant, "roles.manage");
      await deleteRole(tx, tenant, roleId, requestMeta(req));
    });
    return { ok: true };
  });

  // ─── Audit jurnali ───────────────────────────────────────────────────────

  app.get("/audit-logs", async (req) => {
    const query = auditQuery.parse(req.query);
    const tenant = await requireTenant(db, authOf(req).user);
    await requirePermission(db, tenant, "audit.view");
    // companyId har doim tenantdan — so'rovdan emas
    return listAuditLogs(db, { ...query, companyId: tenant.company.id });
  });

  // ─── Sozlamalar ──────────────────────────────────────────────────────────

  app.get("/settings", async (req) => {
    const { group } = settingsQuery.parse(req.query);
    const tenant = await requireTenant(db, authOf(req).user);
    await requirePermission(db, tenant, "settings.view");
    return { settings: await listCompanySettings(db, tenant, group) };
  });

  app.put("/settings/:key", async (req) => {
    const { key } = settingParams.parse(req.params);
    const body = settingBody.parse(req.body);
    // Tekshiruvsiz JSON yozilmasin — chop etish sozlamalarining o'z endpointi bor
    if (key.startsWith("print.")) throw badRequest("Chop etish sozlamalari /print-settings orqali saqlanadi");
    const { user } = authOf(req);
    const setting = await withTransaction(async (tx) => {
      const tenant = await requireTenantForWrite(tx, user);
      await requirePermission(tx, tenant, body.group === "modules" ? "modules.manage" : "settings.manage");
      return upsertCompanySetting(tx, tenant, { key, ...body }, requestMeta(req));
    });
    return { setting };
  });

  // ─── Chop etish sozlamalari ──────────────────────────────────────────────

  app.get("/print-settings", async (req) => {
    const tenant = await requireTenant(db, authOf(req).user);
    return getPrintSettings(db, tenant);
  });

  app.put("/print-settings/receipt", async (req) => {
    const template = receiptTemplateSchema.parse(req.body);
    const { user } = authOf(req);
    const receipt = await withTransaction(async (tx) => {
      const tenant = await requireTenantForWrite(tx, user);
      await requirePermission(tx, tenant, "settings.manage");
      return saveReceiptTemplate(tx, tenant, template, requestMeta(req));
    });
    return { receipt };
  });

  app.put("/print-settings/labels", async (req) => {
    const body = labelSettingsSchema.parse(req.body);
    const { user } = authOf(req);
    const labels = await withTransaction(async (tx) => {
      const tenant = await requireTenantForWrite(tx, user);
      await requirePermission(tx, tenant, "settings.manage");
      return saveLabelSettings(tx, tenant, body, requestMeta(req));
    });
    return { labels };
  });
}
