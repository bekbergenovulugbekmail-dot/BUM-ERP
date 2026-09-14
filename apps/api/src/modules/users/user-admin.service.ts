/**
 * Foydalanuvchi boshqaruvi ierarxiyasi.
 *
 *   bootstrap admin  — .env dan seed qilinadi (platform/bootstrap.service.ts);
 *                      API orqali o'zgartirilmaydi, bloklanmaydi, o'chirilmaydi
 *   platforma admini — kompaniya egalarini yaratadi; oddiy foydalanuvchilarning
 *                      telefon/parolini o'zgartiradi, faollashtiradi/bloklaydi
 *   kompaniya egasi  — faqat o'z kompaniyasiga xodim qo'shadi, parolini tiklaydi
 *                      va a'zoligini yangilaydi (company/member.service.ts)
 *   xodim            — o'z parolini eski parolni bilgan holda o'zgartiradi
 *
 * Har amal audit jurnaliga yoziladi. Parol almashsa — o'sha foydalanuvchining
 * barcha sessiyalari bekor qilinadi.
 *
 * Tranzaksiyani controller ochadi. `verifyCurrentPassword` ataylab tashqarida —
 * xato urinishlar hisobi rollback bo'lib ketmasligi uchun.
 */
import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import {
  PIN_PATTERN,
  badRequest,
  conflict,
  forbidden,
  isValidPhone,
  normalizePhone,
  notFound,
} from "@bum/shared";
import { branches, companies, companyMembers, roles, users } from "../../db/schema/platform.js";
import { licenses, subscriptions } from "../../db/schema/subscription.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import { assertNotLimited, recordHit } from "../../shared/rate-limit.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { revokeUserSessions, type SessionUser } from "../auth/session.js";
import { assertCompanyWritable, isFullAccessRole } from "../company/tenant.js";
import { assertTenantAccess } from "../subscription/access.js";
import { assignLicense, type AssignLicenseResult } from "../subscription/license.service.js";

/** Convex'dagi userAdmin.MIN_PASSWORD bilan bir xil. */
export const MIN_PASSWORD_LENGTH = 8;

/** Convex'dagi userAdmin.createUserAccount standarti. */
const DEFAULT_EMPLOYEE_ROLE = "Kassir";

const PASSWORD_CHANGE_WINDOW_SECONDS = 15 * 60;
const MAX_PASSWORD_CHANGE_FAILS = 5;

const BOOTSTRAP_PROTECTED = "Bootstrap admin faqat .env orqali boshqariladi";

// ─── Umumiy ──────────────────────────────────────────────────────────────────

/** Eng ko'p tanlanadigan parollar — uzunlik talabiga javob bersa ham rad etiladi. */
const COMMON_PASSWORDS = new Set([
  "12345678", "123456789", "1234567890", "87654321", "11111111", "00000000", "12341234", "11223344",
  "password", "password1", "password123", "qwertyui", "qwerty123", "qwerty12", "1q2w3e4r", "abcd1234",
  "admin123", "admin1234", "iloveyou", "parol123", "parol1234", "bumerp123", "12345qwert", "asdfghjk",
]);

export function assertPasswordPolicy(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(`Parol kamida ${MIN_PASSWORD_LENGTH} ta belgidan iborat bo'lishi kerak`);
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase()) || /^(.)\1+$/.test(password)) {
    throw badRequest("Parol juda oddiy — boshqa, taxmin qilish qiyin parol tanlang");
  }
}

export function normalizePhoneOrThrow(raw: string): string {
  const phone = normalizePhone(raw);
  if (!phone || !isValidPhone(phone)) throw badRequest("Telefon raqam noto'g'ri formatda");
  return phone;
}

export async function loadUserForUpdate(tx: Tx, userId: string): Promise<SessionUser> {
  const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1).for("update");
  if (!user) throw notFound("Foydalanuvchi topilmadi");
  return user;
}

export async function assertPhoneFree(conn: DbOrTx, phone: string, exceptUserId?: string): Promise<void> {
  const condition = exceptUserId
    ? and(eq(users.phone, phone), ne(users.id, exceptUserId))
    : eq(users.phone, phone);
  const [row] = await conn.select({ id: users.id }).from(users).where(condition).limit(1);
  if (row) throw conflict("Bu telefon raqam bilan foydalanuvchi allaqachon mavjud");
}

export type NewAccount = {
  phone: string;
  password: string;
  name?: string | null;
};

export async function insertUser(
  tx: Tx,
  input: NewAccount & { activeCompanyId?: string | null },
): Promise<SessionUser> {
  const phone = normalizePhoneOrThrow(input.phone);
  assertPasswordPolicy(input.password);
  await assertPhoneFree(tx, phone);

  const [user] = await tx
    .insert(users)
    .values({
      phone,
      name: input.name?.trim() || null,
      passwordHash: await hashPassword(input.password),
      passwordChangedAt: new Date(),
      activeCompanyId: input.activeCompanyId ?? null,
    })
    .returning();
  return user!;
}

/** Parolni almashtiradi va foydalanuvchining BARCHA sessiyalarini bekor qiladi. */
export async function applyNewPassword(tx: Tx, target: SessionUser, newPassword: string): Promise<void> {
  assertPasswordPolicy(newPassword);
  await tx
    .update(users)
    .set({
      passwordHash: await hashPassword(newPassword),
      passwordAlgo: "argon2id",
      passwordChangedAt: new Date(),
    })
    .where(eq(users.id, target.id));
  await revokeUserSessions(tx, target.id);
}

export function auditUserAction(
  conn: DbOrTx,
  actor: SessionUser,
  meta: RequestMeta,
  entry: {
    action: string;
    targetId: string;
    companyId?: string | null;
    details?: Record<string, unknown>;
    severity?: "info" | "warning";
  },
): Promise<void> {
  return writeAuditLog(
    {
      userId: actor.id,
      userName: actor.name,
      companyId: entry.companyId ?? null,
      action: entry.action,
      resource: "users",
      resourceId: entry.targetId,
      severity: entry.severity ?? "info",
      ...(entry.details ? { details: entry.details } : {}),
      ...meta,
    },
    conn,
  );
}

// ─── Platforma admini ────────────────────────────────────────────────────────

/** Platforma admini faqat oddiy (admin bo'lmagan) foydalanuvchilarni boshqaradi. */
function assertPlatformAdminMayManage(actor: SessionUser, target: SessionUser): void {
  if (target.isBootstrapAdmin) throw forbidden(BOOTSTRAP_PROTECTED);
  if (target.id === actor.id) {
    throw forbidden("O'z hisobingizni bu yerda o'zgartirib bo'lmaydi — /api/auth/password");
  }
  if (target.isPlatformAdmin) throw forbidden("Platforma adminlarini boshqarib bo'lmaydi");
}

export async function platformResetPassword(
  tx: Tx,
  actor: SessionUser,
  userId: string,
  newPassword: string,
  meta: RequestMeta,
): Promise<void> {
  const target = await loadUserForUpdate(tx, userId);
  assertPlatformAdminMayManage(actor, target);
  await applyNewPassword(tx, target, newPassword);
  await auditUserAction(tx, actor, meta, {
    action: "USER_PASSWORD_RESET",
    targetId: target.id,
    companyId: target.activeCompanyId,
    severity: "warning",
    details: { by: "platform_admin", sessionsRevoked: true },
  });
}

export async function platformChangePhone(
  tx: Tx,
  actor: SessionUser,
  userId: string,
  rawPhone: string,
  meta: RequestMeta,
): Promise<SessionUser> {
  const target = await loadUserForUpdate(tx, userId);
  assertPlatformAdminMayManage(actor, target);

  const phone = normalizePhoneOrThrow(rawPhone);
  if (phone === target.phone) return target;
  await assertPhoneFree(tx, phone, target.id);

  const [updated] = await tx.update(users).set({ phone }).where(eq(users.id, target.id)).returning();
  // Login identifikatori almashdi — eski sessiyalar bekor (kompaniya egasi yo'li bilan bir xil)
  await revokeUserSessions(tx, target.id);
  await auditUserAction(tx, actor, meta, {
    action: "USER_PHONE_CHANGED",
    targetId: target.id,
    companyId: target.activeCompanyId,
    severity: "warning",
    details: { from: target.phone, to: phone },
  });
  return updated!;
}

export async function platformSetActive(
  tx: Tx,
  actor: SessionUser,
  userId: string,
  isActive: boolean,
  meta: RequestMeta,
): Promise<void> {
  const target = await loadUserForUpdate(tx, userId);
  assertPlatformAdminMayManage(actor, target);
  if (target.isActive === isActive) return;

  await tx.update(users).set({ isActive }).where(eq(users.id, target.id));
  // Bloklangan foydalanuvchi darhol barcha qurilmalardan chiqariladi
  if (!isActive) await revokeUserSessions(tx, target.id);

  await auditUserAction(tx, actor, meta, {
    action: isActive ? "USER_ACTIVATED" : "USER_BLOCKED",
    targetId: target.id,
    companyId: target.activeCompanyId,
    severity: "warning",
  });
}

// ─── Kompaniya egasi ─────────────────────────────────────────────────────────

/**
 * Qo'shimcha platforma adminini tayinlash / olib tashlash.
 * Qaror: buni FAQAT bootstrap admin qiladi. Bootstrap adminning o'ziga tegmaydi.
 * Olib tashlash darhol amal qiladi — har so'rovda foydalanuvchi bazadan o'qiladi.
 */
export async function setPlatformAdmin(
  tx: Tx,
  actor: SessionUser,
  userId: string,
  isPlatformAdmin: boolean,
  meta: RequestMeta,
): Promise<void> {
  if (!actor.isBootstrapAdmin) {
    throw forbidden("Platforma adminini faqat bootstrap admin tayinlaydi");
  }
  const target = await loadUserForUpdate(tx, userId);
  if (target.isBootstrapAdmin) throw forbidden(BOOTSTRAP_PROTECTED);
  if (isPlatformAdmin && !target.isActive) {
    throw badRequest("Faol bo'lmagan foydalanuvchini platforma admini qilib bo'lmaydi");
  }
  if (target.isPlatformAdmin === isPlatformAdmin) return;

  await tx.update(users).set({ isPlatformAdmin }).where(eq(users.id, target.id));
  await auditUserAction(tx, actor, meta, {
    action: isPlatformAdmin ? "PLATFORM_ADMIN_GRANTED" : "PLATFORM_ADMIN_REVOKED",
    targetId: target.id,
    severity: "warning",
    details: { phone: target.phone },
  });
}

export type OwnedCompany = { id: string; name: string };

/** Joriy foydalanuvchi aktiv kompaniyasining egasi bo'lmasa — FORBIDDEN. */
export async function resolveOwnedCompany(conn: DbOrTx, user: SessionUser): Promise<OwnedCompany> {
  if (!user.activeCompanyId) throw forbidden("Kompaniya tanlanmagan");

  const [company] = await conn
    .select({
      id: companies.id,
      name: companies.name,
      ownerId: companies.ownerId,
      isActive: companies.isActive,
      status: companies.status,
      subscriptionStatus: subscriptions.status,
      subscriptionExpiresAt: subscriptions.expiresAt,
    })
    .from(companies)
    .leftJoin(subscriptions, eq(subscriptions.companyId, companies.id))
    .where(eq(companies.id, user.activeCompanyId))
    .limit(1);

  if (!company || company.ownerId !== user.id) {
    throw forbidden("Xodimlarni faqat kompaniya egasi boshqaradi");
  }
  // To'xtatilgan, tugatilgan, sinov yoki obuna muddati o'tgan kompaniyada ham yopiq
  assertCompanyWritable(company);
  assertTenantAccess({
    access: "business",
    isOwner: true,
    subscription: company.subscriptionStatus ? { status: company.subscriptionStatus, expiresAt: company.subscriptionExpiresAt } : null,
    license: null,
  });
  return { id: company.id, name: company.name };
}

/**
 * Ega shu foydalanuvchini boshqara oladimi.
 * `password` va `account` (ism, telefon) — hisob darajasidagi amal: xodim boshqa
 * kompaniyaga ham a'zo bo'lsa taqiqlanadi. `membership` — faqat shu kompaniyadagi a'zolik.
 */
export async function assertOwnerMayManage(
  tx: Tx,
  company: OwnedCompany,
  owner: SessionUser,
  target: SessionUser,
  purpose: "password" | "account" | "membership",
): Promise<void> {
  const memberships = await tx
    .select({ companyId: companyMembers.companyId, companyRole: companyMembers.companyRole })
    .from(companyMembers)
    .where(eq(companyMembers.userId, target.id));

  const here = memberships.find((m) => m.companyId === company.id);
  // Boshqa kompaniya foydalanuvchisining mavjudligi ham oshkor qilinmaydi
  if (!here) throw notFound("Xodim topilmadi");

  if (target.isBootstrapAdmin) throw forbidden(BOOTSTRAP_PROTECTED);
  if (target.isPlatformAdmin) throw forbidden("Platforma adminini kompaniya egasi boshqarmaydi");
  if (target.id === owner.id) {
    throw forbidden(
      purpose === "password"
        ? "O'z parolingizni /api/auth/password orqali o'zgartiring"
        : purpose === "account"
          ? "O'z ism va telefoningizni bu yerda o'zgartirib bo'lmaydi"
          : "O'z a'zoligingizni o'zgartirib bo'lmaydi",
    );
  }
  if (isFullAccessRole(here.companyRole)) {
    throw forbidden("Egalik rolidagi foydalanuvchini faqat platforma admini boshqaradi");
  }
  // Parol, ism va telefon butun hisobga tegishli — boshqa kompaniyaga ham ta'sir qilmasligi uchun
  if (purpose !== "membership" && memberships.some((m) => m.companyId !== company.id)) {
    throw forbidden(
      purpose === "password"
        ? "Xodim boshqa kompaniyaga ham a'zo — parolini faqat platforma admini tiklaydi"
        : "Xodim boshqa kompaniyaga ham a'zo — ism va telefonini faqat platforma admini o'zgartiradi",
    );
  }
}

export async function findAssignableRole(tx: Tx, companyId: string, name: string) {
  if (isFullAccessRole(name)) {
    throw forbidden(`"${name}" rolini xodimga berib bo'lmaydi`);
  }

  // Avval kompaniyaning o'z roli, bo'lmasa global standart rol
  const [role] = await tx
    .select({ id: roles.id, name: roles.name, permissions: roles.permissions })
    .from(roles)
    .where(
      and(
        eq(roles.name, name),
        eq(roles.isActive, true),
        or(eq(roles.companyId, companyId), isNull(roles.companyId)),
      ),
    )
    .orderBy(sql`${roles.companyId} is null`)
    .limit(1);

  if (!role) throw badRequest(`Rol topilmadi: ${name}`);
  return role;
}

export type CompanyAccountInput = NewAccount & {
  role?: string;
  /** Ekran qulfini ochish PIN'i (4–8 raqam) — faqat xeshi saqlanadi. */
  pin?: string | null;
  /** HR xodimi bilan bog'lash (litsenziyada ham). */
  employeeId?: string | null;
  /** Included litsenziyalar tugagan bo'lsa — qo'shimcha litsenziya tarifi. */
  additionalLicensePlanId?: string | null;
};

export type CompanyAccount = { user: SessionUser; role: string; license: AssignLicenseResult };

/**
 * Dasturdan foydalanuvchi xodim: hisob (telefon login + parol xeshi), a'zolik, rol, ixtiyoriy PIN xeshi va litsenziya —
 * chaqiruvchining bitta tranzaksiyasida. Included litsenziya tugagan va qo'shimcha tarif tanlanmagan bo'lsa
 * `license_limit_reached` — hech narsa yaratilmaydi (rollback). Parol va PIN auditga yozilmaydi.
 *
 * @param actorPermissions egasi bo'lmagan yaratuvchi (HR) — rol ruxsatlari uning o'z ruxsatlaridan oshmasin; `null` — egasi.
 */
export async function createCompanyAccount(
  tx: Tx,
  actor: SessionUser,
  companyId: string,
  input: CompanyAccountInput,
  meta: RequestMeta,
  actorPermissions: readonly string[] | null = null,
): Promise<CompanyAccount> {
  const role = await findAssignableRole(tx, companyId, input.role ?? DEFAULT_EMPLOYEE_ROLE);
  if (actorPermissions && role.permissions.some((permission) => !actorPermissions.includes(permission))) {
    throw forbidden(`"${role.name}" rolida sizda yo'q ruxsatlar bor — bu rolni faqat kompaniya egasi beradi`);
  }
  if (input.pin != null && !PIN_PATTERN.test(input.pin)) throw badRequest("PIN 4-8 ta raqamdan iborat bo'lishi kerak");

  const user = await insertUser(tx, { ...input, activeCompanyId: companyId });
  if (input.pin) {
    await tx.update(users).set({ pinHash: await hashPassword(input.pin) }).where(eq(users.id, user.id));
  }

  const [branch] = await tx
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.companyId, companyId), eq(branches.isDefault, true)))
    .limit(1);

  await tx.insert(companyMembers).values({
    companyId,
    userId: user.id,
    companyRole: role.name,
    roleId: role.id,
    branchId: branch?.id ?? null,
    joinedAt: new Date(),
  });
  await tx
    .update(roles)
    .set({ memberCount: sql`${roles.memberCount} + 1` })
    .where(eq(roles.id, role.id));

  const license = await assignLicense(tx, {
    companyId,
    userId: user.id,
    employeeId: input.employeeId ?? null,
    actor,
    meta,
    additionalPlanId: input.additionalLicensePlanId ?? null,
  });

  await auditUserAction(tx, actor, meta, {
    action: "EMPLOYEE_CREATED",
    targetId: user.id,
    companyId,
    details: {
      phone: user.phone,
      role: role.name,
      licenseType: license.license.licenseType,
      licenseStatus: license.license.status,
      pinSet: Boolean(input.pin),
    },
  });

  return { user, role: role.name, license };
}

export function createEmployee(
  tx: Tx,
  owner: SessionUser,
  company: OwnedCompany,
  input: CompanyAccountInput,
  meta: RequestMeta,
): Promise<CompanyAccount> {
  return createCompanyAccount(tx, owner, company.id, input, meta);
}

export async function ownerResetEmployeePassword(
  tx: Tx,
  owner: SessionUser,
  company: OwnedCompany,
  userId: string,
  newPassword: string,
  meta: RequestMeta,
): Promise<void> {
  const target = await loadUserForUpdate(tx, userId);
  await assertOwnerMayManage(tx, company, owner, target, "password");
  await applyNewPassword(tx, target, newPassword);
  await auditUserAction(tx, owner, meta, {
    action: "USER_PASSWORD_RESET",
    targetId: target.id,
    companyId: company.id,
    severity: "warning",
    details: { by: "company_owner", sessionsRevoked: true },
  });
}

export async function listCompanyMembers(conn: DbOrTx, companyId: string) {
  return conn
    .select({
      id: users.id,
      phone: users.phone,
      name: users.name,
      isActive: users.isActive,
      companyRole: companyMembers.companyRole,
      branchId: companyMembers.branchId,
      branchName: branches.name,
      allowedWarehouseIds: companyMembers.allowedWarehouseIds,
      allowedCategoryIds: companyMembers.allowedCategoryIds,
      membershipActive: companyMembers.isActive,
      joinedAt: companyMembers.joinedAt,
      lastSeenAt: users.lastSeenAt,
      licenseId: licenses.id,
      licenseType: licenses.licenseType,
      licenseStatus: licenses.status,
      licenseExpiresAt: licenses.expiresAt,
    })
    .from(companyMembers)
    .innerJoin(users, eq(users.id, companyMembers.userId))
    .leftJoin(branches, eq(branches.id, companyMembers.branchId))
    .leftJoin(
      licenses,
      and(eq(licenses.companyId, companyMembers.companyId), eq(licenses.userId, companyMembers.userId), ne(licenses.status, "revoked")),
    )
    .where(eq(companyMembers.companyId, companyId))
    .orderBy(companyMembers.joinedAt);
}

// ─── O'z paroli ──────────────────────────────────────────────────────────────

/** Tranzaksiyadan tashqarida chaqiriladi — xato urinishlar hisobi saqlanib qolsin. */
export async function verifyCurrentPassword(user: SessionUser, currentPassword: string): Promise<void> {
  if (user.isBootstrapAdmin) {
    throw forbidden("Bootstrap admin paroli faqat .env orqali almashtiriladi");
  }

  const bucket = `password-change:${user.id}`;
  // Avval atomar hisob, keyin tekshiruv — parallel so'rovlar limitdan oshib parol tanlay olmaydi
  const attempts = await recordHit(bucket, PASSWORD_CHANGE_WINDOW_SECONDS);
  if (attempts > MAX_PASSWORD_CHANGE_FAILS) await assertNotLimited(bucket, MAX_PASSWORD_CHANGE_FAILS, PASSWORD_CHANGE_WINDOW_SECONDS);

  const valid =
    user.passwordHash !== null &&
    (await verifyPassword(user.passwordHash, user.passwordAlgo, currentPassword));
  if (!valid) {
    // 401 emas: frontend 401 ni "sessiya tugadi" deb tushunadi
    throw forbidden("Joriy parol noto'g'ri");
  }
}

export async function changeOwnPassword(
  tx: Tx,
  user: SessionUser,
  currentPassword: string,
  newPassword: string,
  meta: RequestMeta,
): Promise<void> {
  if (newPassword === currentPassword) throw badRequest("Yangi parol eskisidan farq qilishi kerak");

  const target = await loadUserForUpdate(tx, user.id);
  await applyNewPassword(tx, target, newPassword);
  await auditUserAction(tx, user, meta, {
    action: "PASSWORD_CHANGED",
    targetId: user.id,
    companyId: user.activeCompanyId,
    details: { sessionsRevoked: true },
  });
}
