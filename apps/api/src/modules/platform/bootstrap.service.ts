/**
 * Birinchi platforma adminini yaratish (bootstrap).
 *
 * Convex'dagi companies.platformSetAdminByEmail muqobili, lekin:
 *  - ochiq ro'yxatdan o'tish yo'q, shuning uchun foydalanuvchi shu yerda
 *    yaratiladi; raqam band bo'lsa — hisob egasining paroli talab qilinadi;
 *  - faqat hali birorta platforma admini YO'Q bo'lsa ishlaydi;
 *  - kalit doimiy vaqtda solishtiriladi (Convex'da oddiy `!==` edi);
 *  - global standart rollar (DEFAULT_ROLES) shu yerda qo'shiladi — Convex'da
 *    bu birinchi foydalanuvchi kirganda (users.updateCurrentUser) bo'lardi.
 *
 * Ikki kirish yo'li shu servisni chaqiradi: HTTP (PLATFORM_BOOTSTRAP_KEY bilan)
 * va CLI (`platform:bootstrap` — bazaga kirish huquqining o'zi yetarli).
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  DEFAULT_ROLES,
  badRequest,
  conflict,
  isValidPhone,
  normalizePhone,
  unauthenticated,
} from "@bum/shared";
import { db } from "../../db/client.js";
import { roles, users } from "../../db/schema/platform.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import type { SessionUser } from "../auth/session.js";

/** Convex'dagi userAdmin.MIN_PASSWORD bilan bir xil. */
export const MIN_PASSWORD_LENGTH = 8;

export type BootstrapInput = {
  phone: string;
  password: string;
  name?: string | null;
};

export type BootstrapResult = {
  user: SessionUser;
  /** false — mavjud hisobga admin huquqi berildi. */
  created: boolean;
  rolesSeeded: number;
};

export function bootstrapKeyMatches(provided: string, expected: string | undefined): boolean {
  if (!expected) return false;
  // Avval xeshlanadi — timingSafeEqual teng uzunlik talab qiladi va kalit uzunligi oshkor bo'lmaydi
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function hasPlatformAdmin(conn: DbOrTx = db): Promise<boolean> {
  const [row] = await conn
    .select({ id: users.id })
    .from(users)
    .where(eq(users.isPlatformAdmin, true))
    .limit(1);
  return row !== undefined;
}

/**
 * Global (company_id NULL) standart rollarni qo'shadi, mavjudlariga tegmaydi.
 * Takroriy chaqiruv xavfsiz — `roles_company_name_key` NULLS NOT DISTINCT.
 */
export async function seedGlobalRoles(conn: DbOrTx): Promise<number> {
  const inserted = await conn
    .insert(roles)
    .values(
      DEFAULT_ROLES.map((role) => ({
        companyId: null,
        name: role.name,
        description: role.description,
        color: role.color,
        permissions: [...role.permissions],
        isSystem: role.isSystem,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: roles.id });
  return inserted.length;
}

/** Tranzaksiyani chaqiruvchi ochadi (HTTP controller yoki CLI). */
export async function bootstrapPlatformAdmin(
  tx: Tx,
  input: BootstrapInput,
  meta: RequestMeta & { via: "http" | "cli" },
): Promise<BootstrapResult> {
  const phone = normalizePhone(input.phone);
  if (!phone || !isValidPhone(phone)) throw badRequest("Telefon raqam noto'g'ri formatda");
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(`Parol kamida ${MIN_PASSWORD_LENGTH} ta belgidan iborat bo'lishi kerak`);
  }

  // Ikki parallel bootstrap ikkita admin yaratib qo'ymasligi uchun
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('platform-bootstrap'))`);
  if (await hasPlatformAdmin(tx)) throw conflict("Platforma admini allaqachon mavjud");

  const name = input.name?.trim() || null;
  const [existing] = await tx.select().from(users).where(eq(users.phone, phone)).limit(1).for("update");

  let user: SessionUser;
  if (existing) {
    // Kalit egasi boshqa odamning hisobini egallab olmasligi uchun
    const ownsAccount =
      existing.passwordHash !== null &&
      (await verifyPassword(existing.passwordHash, existing.passwordAlgo, input.password));
    if (!ownsAccount) throw unauthenticated("Bu raqam band. Hisob egasining parolini kiriting");
    if (!existing.isActive) throw badRequest("Hisob faol emas");

    const [updated] = await tx
      .update(users)
      .set({ isPlatformAdmin: true, ...(name && !existing.name ? { name } : {}) })
      .where(eq(users.id, existing.id))
      .returning();
    user = updated!;
  } else {
    const [inserted] = await tx
      .insert(users)
      .values({ phone, name, passwordHash: await hashPassword(input.password), isPlatformAdmin: true })
      .returning();
    user = inserted!;
  }

  const rolesSeeded = await seedGlobalRoles(tx);
  const created = !existing;

  await writeAuditLog(
    {
      userId: user.id,
      userName: user.name,
      action: "PLATFORM_ADMIN_BOOTSTRAP",
      resource: "users",
      resourceId: user.id,
      severity: "warning",
      details: { via: meta.via, created, rolesSeeded },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    },
    tx,
  );

  return { user, created, rolesSeeded };
}
