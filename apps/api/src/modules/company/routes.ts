/**
 * /api/company — foydalanuvchining aktiv kompaniyasi.
 *
 * Kompaniya har doim foydalanuvchining AKTIV kompaniyasi — so'rovda companyId
 * qabul qilinmaydi (faqat /switch da, a'zolik tekshiruvi bilan).
 *
 *   GET   /                          aktiv kompaniya + a'zolik + ruxsatlar    (a'zo)
 *   PATCH /                          kompaniya ma'lumotlari            (company.manage)
 *   GET   /mine                      a'zo bo'lgan kompaniyalar          (sessiya)
 *   POST  /switch                    aktiv kompaniyani almashtirish     (faol a'zo)
 *   GET   /branches                  filiallar                          (a'zo)
 *   POST  /branches                  filial yaratish                    (branches.manage)
 *   PATCH /branches/:branchId        filialni yangilash                 (branches.manage)
 *   GET   /employees                 a'zolar                            (users.view)
 *   POST  /employees                 xodim qo'shish                     (kompaniya egasi)
 *   PATCH /employees/:userId         rol, filial, ombor, holat          (kompaniya egasi)
 *   POST  /employees/:userId/password  parolni tiklash                  (kompaniya egasi)
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db/client.js";
import { withTransaction } from "../../db/transaction.js";
import { requestMeta } from "../../shared/audit.js";
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
  role: z.string().min(1).max(100).optional(),
  branchId: z.uuid().nullable().optional(),
  allowedWarehouseIds: z.array(z.uuid()).max(500).optional(),
  isActive: z.boolean().optional(),
});
const userParams = z.object({ userId: z.uuid() });
const resetPasswordBody = z.object({ newPassword: z.string().min(1).max(256) });

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
}
