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
 *   GET    /modules                     modullar holati (+ tarix — modules.manage)   (a'zo)
 *   PUT    /modules/:key                modulni yoqish/o'chirish {enabled, reason?}  (modules.manage; bog'liqliklar tekshiriladi)
 *   GET    /settings                    sozlamalar (?group=)              (settings.view)
 *   PUT    /settings/:key               sozlamani saqlash                 (settings.manage; modules → modules.manage)
 *   GET    /print-settings              chek shabloni (standart bilan)    (a'zo — kassir chek chiqaradi)
 *   PUT    /print-settings/receipt      chek shablonini saqlash           (settings.manage)
 *   PUT    /print-settings/labels       etiketka shablonlarini saqlash    (settings.manage)
 */
import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { PIN_PATTERN, badRequest, forbidden, isPermission, type Permission } from "@bum/shared";
import { db } from "../../db/client.js";
import { companyMembers } from "../../db/schema/platform.js";
import { withTransaction, type DbOrTx } from "../../db/transaction.js";
import { requestMeta, writeAuditLog } from "../../shared/audit.js";
import { listAuditLogs } from "../audit/audit-log.service.js";
import { authOf, requireAuth } from "../auth/guard.js";
import { listUserDevices, setDeviceStatus } from "../auth/devices.service.js";
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
import { moneySchema } from "../../shared/decimal.js";
// Xodim qo'shish bitta joyda: rolga qarab agent yoki yetkazuvchi profili ham shu yerda yaratiladi
import { SALES_AGENT_ROLE, createSalesAgent } from "../sales-agent/team.service.js";
import { DELIVERY_AGENT_ROLE, createDeliveryAgent } from "../delivery/team.service.js";
import { createHrCard } from "../hr/employees.service.js";
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
import {
  companyModuleStates,
  listCompanyModules,
  moduleChangeBodySchema,
  moduleHistory,
  moduleParamsSchema,
  setCompanyModule,
} from "./modules.service.js";
import { listCompanySettings, upsertCompanySetting } from "./settings.service.js";
import {
  effectivePermissions,
  requireAnyPermission,
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

/**
 * Xodim qo'shish — BITTA joy: rol qaysi bo'lsa, shunga mos profil ham shu yerda yaratiladi
 * ("Sotuv agenti" → savdo agenti profili, "Dostavka agenti" → yetkazuvchi profili). Shuning uchun
 * distribyutsiya va dostavka bo'limlarida alohida "qo'shish" formasi kerak emas.
 */
const employeeBody = z.object({
  phone: z.string().min(1).max(32),
  /** Dasturga kirmaydigan xodim uchun parol kerak emas (`softwareAccess: false`). */
  password: z.string().min(1).max(256).optional(),
  /** `false` — faqat HR kartochkasi ochiladi: login ham, litsenziya ham berilmaydi. */
  softwareAccess: z.boolean().default(true),
  name: z.string().max(200).optional(),
  role: z.string().min(1).max(100).optional(),
  pin: z.string().regex(PIN_PATTERN, "PIN 4-8 ta raqamdan iborat bo'lishi kerak").optional(),
  /** Included litsenziyalar tugagan bo'lsa — qo'shimcha litsenziya tarifi (to'lov tasdiqlanguncha kirish yopiq). */
  additionalLicensePlanId: z.uuid().optional(),
  /** Qurilma tasdig'i shu xodimga qo'llanadimi (standart — ha). */
  deviceCheck: z.boolean().optional(),
  /** Ishga kirgan sana (HR kartochkasiga yoziladi). */
  hireDate: z.iso.date().optional(),
  /** HR kartochkasi uchun bo'lim va lavozim (tanlanmasa "Asosiy" va rol nomidagi lavozim). */
  departmentId: z.uuid().optional(),
  positionId: z.uuid().optional(),
  /** Savdo agenti: hudud va oylik plan. */
  region: z.string().trim().max(100).optional(),
  monthlyTarget: moneySchema.optional(),
  /** Yetkazuvchi: transport. */
  vehicleType: z.enum(["car", "motorcycle", "bicycle", "foot", "truck"]).optional(),
  vehicleNumber: z.string().trim().max(32).optional(),
}).refine((body) => body.softwareAccess === false || Boolean(body.password), {
  message: "Dasturga kiradigan xodim uchun parol kiritilishi shart",
  path: ["password"],
});
const memberPatchBody = z.strictObject({
  /** Qurilma tasdig'i shu xodimga qo'llanadimi. */
  deviceCheck: z.boolean().optional(),
  name: z.string().trim().max(200).nullable().optional(),
  phone: z.string().min(1).max(32).optional(),
  role: z.string().min(1).max(100).optional(),
  branchId: z.uuid().nullable().optional(),
  allowedWarehouseIds: z.array(z.uuid()).max(500).optional(),
  /** Mas'ul kategoriyalar; bo'sh — barcha kategoriyalar. */
  allowedCategoryIds: z.array(z.uuid()).max(500).optional(),
  isActive: z.boolean().optional(),
  additionalLicensePlanId: z.uuid().nullable().optional(),
});
const userParams = z.object({ userId: z.uuid() });
const deviceParams = z.object({ userId: z.uuid(), deviceRowId: z.uuid() });

/** Qurilmalar faqat SHU kompaniyaning xodimi uchun ko'riladi va tasdiqlanadi. */
async function assertMember(conn: DbOrTx, companyId: string, userId: string) {
  const [row] = await conn
    .select({ userId: companyMembers.userId })
    .from(companyMembers)
    .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, userId)))
    .limit(1);
  if (!row) throw badRequest("Xodim topilmadi");
}
const deviceBody = z.strictObject({
  status: z.enum(["approved", "revoked"]),
  /** Egasi qurilmaga tushunarli nom beradi ("Ulugbek telefoni"). */
  name: z.string().trim().min(1).max(120).optional(),
});
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

/** Qurilmani tasdiqlash: rahbar (`users.manage`) yoki qurilmalarga mas'ul xodim (`devices.manage`). */
const DEVICE_PERMISSIONS = ["devices.manage", "users.manage"] as const satisfies readonly [Permission, ...Permission[]];

export async function companyRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  // ─── Kompaniya ───────────────────────────────────────────────────────────

  // Obuna yoki litsenziya tugagan bo'lsa ham ochiq: ilova qobig'i (menyu, ruxsatlar, obuna sahifasi) shunga tayanadi
  app.get("/", async (req) => {
    const tenant = await requireTenant(db, authOf(req).user, { access: "account" });
    return {
      company: await getCompany(db, tenant.company.id),
      membership: {
        companyRole: tenant.membership.companyRole,
        branchId: tenant.membership.branchId,
        allowedWarehouseIds: tenant.membership.allowedWarehouseIds,
        allowedCategoryIds: tenant.membership.allowedCategoryIds,
      },
      permissions: await effectivePermissions(db, tenant),
      /** Modul holatlari — menyu va sahifalar shunga qarab yashiriladi (API modul guard'i baribir yopadi). */
      modules: await companyModuleStates(db, tenant.company.id),
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
    const meta = requestMeta(req);

    // Dasturdan foydalanmaydigan xodim (yuk tashuvchi, qorovul ...) — faqat HR kartochkasi, litsenziyasiz
    if (body.softwareAccess === false) {
      if (!body.name?.trim()) throw badRequest("Ism-familiya kiritilishi shart");
      const employee = await withTransaction(async (tx) => {
        await resolveOwnedCompany(tx, user);
        const tenant = await requireTenantForWrite(tx, user);
        return createHrCard(
          tx,
          tenant,
          {
            name: body.name!.trim(),
            phone: body.phone,
            userId: null,
            role: body.role ?? "Xodim",
            hireDate: body.hireDate,
            departmentId: body.departmentId ?? null,
            positionId: body.positionId ?? null,
          },
          meta,
        );
      });
      reply.status(201);
      return { employee, license: null, payment: null };
    }

    // Agent va yetkazuvchi uchun login + a'zolik + HR xodimi + profil bitta tranzaksiyada yaratiladi
    if (body.role === SALES_AGENT_ROLE || body.role === DELIVERY_AGENT_ROLE) {
      if (!body.name?.trim()) throw badRequest("Ism-familiya kiritilishi shart");
      const created = await withTransaction(async (tx) => {
        await resolveOwnedCompany(tx, user);
        const tenant = await requireTenantForWrite(tx, user);
        const shared = {
          name: body.name!.trim(),
          phone: body.phone,
          password: body.password!,
          ...(body.pin ? { pin: body.pin } : {}),
          ...(body.additionalLicensePlanId ? { additionalLicensePlanId: body.additionalLicensePlanId } : {}),
          ...(body.deviceCheck === false ? { deviceCheck: false } : {}),
          ...(body.hireDate ? { hireDate: body.hireDate } : {}),
        };
        return body.role === SALES_AGENT_ROLE
          ? createSalesAgent(tx, tenant, { ...shared, region: body.region ?? null, ...(body.monthlyTarget ? { monthlyTarget: body.monthlyTarget } : {}) }, meta)
          : createDeliveryAgent(
              tx,
              tenant,
              { ...shared, ...(body.vehicleType ? { vehicleType: body.vehicleType } : {}), ...(body.vehicleNumber ? { vehicleNumber: body.vehicleNumber } : {}) },
              meta,
            );
      });
      reply.status(201);
      return {
        employee: { id: created.userId, phone: body.phone, name: body.name, companyRole: body.role },
        profile: created,
        license: null,
        payment: null,
      };
    }

    const { user: employee, role, license } = await withTransaction(async (tx) => {
      const company = await resolveOwnedCompany(tx, user);
      const created = await createEmployee(tx, user, company, { ...body, password: body.password! }, meta);
      // Har bir yangi xodim Kadrlar ro'yxatida ham ko'rinadi (bo'lim va lavozim bilan)
      const tenant = await requireTenantForWrite(tx, user);
      await createHrCard(
        tx,
        tenant,
        {
          name: created.user.name ?? body.name?.trim() ?? body.phone,
          phone: created.user.phone,
          userId: created.user.id,
          role: created.role,
          hireDate: body.hireDate,
          departmentId: body.departmentId ?? null,
          positionId: body.positionId ?? null,
        },
        meta,
      );
      return created;
    });

    reply.status(201);
    return {
      employee: { id: employee.id, phone: employee.phone, name: employee.name, companyRole: role },
      license: { id: license.license.id, type: license.license.licenseType, status: license.license.status },
      payment: license.payment ? { id: license.payment.id, amount: license.payment.amount, status: license.payment.status } : null,
    };
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

  // ─── Xodimning ishonchli qurilmalari ─────────────────────────────────────
  // Login va parolni bilgan begona odam kira olmasligi uchun: yangi qurilmani rahbar yoki
  // qurilmalarni boshqarish ruxsati berilgan xodim (masalan, HR menejeri) tasdiqlaydi.

  app.get("/employees/:userId/devices", async (req) => {
    const { userId } = userParams.parse(req.params);
    const tenant = await requireTenant(db, authOf(req).user);
    await requireAnyPermission(db, tenant, DEVICE_PERMISSIONS);
    await assertMember(db, tenant.company.id, userId);
    return { devices: await listUserDevices(db, userId) };
  });

  app.post("/employees/:userId/devices/:deviceRowId", async (req) => {
    const { userId, deviceRowId } = deviceParams.parse(req.params);
    const body = deviceBody.parse(req.body);
    const { user } = authOf(req);
    const device = await withTransaction(async (tx) => {
      const tenant = await requireTenantForWrite(tx, user);
      await requireAnyPermission(tx, tenant, DEVICE_PERMISSIONS);
      await assertMember(tx, tenant.company.id, userId);
      const updated = await setDeviceStatus(tx, { deviceRowId, userId, status: body.status, name: body.name, actorId: user.id });
      if (!updated) throw badRequest("Qurilma topilmadi");
      await writeAuditLog(
        {
          userId: user.id,
          userName: user.name,
          companyId: tenant.company.id,
          action: body.status === "approved" ? "DEVICE_APPROVED" : "DEVICE_REVOKED",
          resource: "user_devices",
          resourceId: deviceRowId,
          details: { targetUserId: userId, name: updated.name },
          ...requestMeta(req),
        },
        tx,
      );
      return updated;
    });
    return { device };
  });

  // ─── Modullar ────────────────────────────────────────────────────────────

  // Holat — har a'zoga (menyu); tarix — modullarni boshqaruvchiga
  app.get("/modules", async (req) => {
    const tenant = await requireTenant(db, authOf(req).user, { access: "account" });
    const canManage = (await effectivePermissions(db, tenant)).includes("modules.manage");
    return {
      modules: await listCompanyModules(db, tenant.company.id),
      history: canManage ? await moduleHistory(db, tenant.company.id) : [],
    };
  });

  /**
   * Modullarni kompaniyaning o'zi yoqa/o'chira olmaydi — bu faqat platforma admini orqali
   * (`PUT /api/platform/companies/:companyId/modules/:key`). Kompaniya to'plami ro'yxatdan
   * o'tishda tanlanadi, keyingi o'zgarish admin qaroriga bog'liq.
   */
  app.put("/modules/:key", async (req) => {
    moduleParamsSchema.parse(req.params);
    moduleChangeBodySchema.parse(req.body);
    throw forbidden(
      "Modullar platforma administratori orqali ochiladi. Kerakli modulni so'rab murojaat qiling.",
    );
  });

  app.get("/settings", async (req) => {
    const { group } = settingsQuery.parse(req.query);
    const tenant = await requireTenant(db, authOf(req).user);
    await requirePermission(db, tenant, "settings.view");
    return { settings: await listCompanySettings(db, tenant, group) };
  });

  app.put("/settings/:key", async (req) => {
    const { key } = settingParams.parse(req.params);
    const body = settingBody.parse(req.body);
    // Tekshiruvsiz JSON yozilmasin — chop etish va keshbek sozlamalarining o'z endpointlari bor
    if (
      key.startsWith("print.") ||
      key.startsWith("loyalty.") ||
      key.startsWith("currency.") ||
      key.startsWith("sales_agent.") ||
      key.startsWith("delivery.") ||
      key.startsWith("pos.") ||
      key.startsWith("sales.") ||
      key.startsWith("finance.")
    ) {
      throw badRequest("Bu sozlama o'z bo'limi orqali saqlanadi (chek/etiketka, keshbek, valyutalar, agent, dostavka, kassa yoki savdo siyosati)");
    }
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
