/**
 * Bootstrap admin — tizimning ildiz platforma admini.
 *
 * Manba: .env dagi BOOTSTRAP_ADMIN_PHONE / BOOTSTRAP_ADMIN_PASSWORD
 * (`pnpm --filter @bum/api db:seed`). Seed idempotent: .env ni o'zgartirib qayta
 * ishga tushirish telefon va parolni yangilaydi. Parol faqat argon2id xeshi
 * sifatida saqlanadi; almashganda eski sessiyalar bekor qilinadi.
 *
 * Himoya ikki qatlamda:
 *  - API: hech bir endpoint bootstrap adminni o'zgartira olmaydi (users/user-admin.service.ts);
 *  - baza (0002 migratsiya): CHECK — bootstrap admin doim faol platforma admini;
 *    partial unique — bittadan ortiq bo'lmaydi; trigger — o'chirish va
 *    bootstrap maqomini olish taqiqlangan.
 *
 * Convex'dagi PLATFORM_BOOTSTRAP_KEY oqimi (platformSetAdminByEmail) shu bilan almashtirildi.
 */
import { eq, sql } from "drizzle-orm";
import { DEFAULT_ROLES, conflict } from "@bum/shared";
import { roles, users } from "../../db/schema/platform.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { revokeUserSessions, type SessionUser } from "../auth/session.js";
import { assertPasswordPolicy, normalizePhoneOrThrow } from "../users/user-admin.service.js";

export type SeedAction = "created" | "promoted" | "updated" | "unchanged";

export type SeedResult = {
  user: SessionUser;
  action: SeedAction;
  /** Nima o'zgardi: "phone", "name", "password" — qiymatlarning o'zi emas. */
  changes: string[];
  rolesSeeded: number;
};

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

async function passwordIsCurrent(user: SessionUser, password: string): Promise<boolean> {
  return (
    user.passwordHash !== null &&
    user.passwordAlgo === "argon2id" &&
    (await verifyPassword(user.passwordHash, "argon2id", password))
  );
}

export async function seedBootstrapAdmin(
  tx: Tx,
  input: { phone: string; password: string; name?: string | null },
  meta: RequestMeta,
): Promise<SeedResult> {
  const phone = normalizePhoneOrThrow(input.phone);
  assertPasswordPolicy(input.password);
  const name = input.name?.trim() || null;

  // Bir vaqtda ikki seed (masalan, parallel deploy) bir-birini buzmasligi uchun
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('bootstrap-admin-seed'))`);

  const [root] = await tx
    .select()
    .from(users)
    .where(eq(users.isBootstrapAdmin, true))
    .limit(1)
    .for("update");
  const [phoneOwner] = await tx.select().from(users).where(eq(users.phone, phone)).limit(1).for("update");

  if (root && phoneOwner && phoneOwner.id !== root.id) {
    throw conflict("BOOTSTRAP_ADMIN_PHONE boshqa foydalanuvchiga tegishli");
  }

  const target = root ?? phoneOwner;
  const changes: string[] = [];
  let user: SessionUser;
  let action: SeedAction;

  if (!target) {
    const [inserted] = await tx
      .insert(users)
      .values({
        phone,
        name,
        passwordHash: await hashPassword(input.password),
        passwordChangedAt: new Date(),
        isPlatformAdmin: true,
        isBootstrapAdmin: true,
      })
      .returning();
    user = inserted!;
    action = "created";
  } else {
    const set: Partial<typeof users.$inferInsert> = {};
    if (target.phone !== phone) {
      set.phone = phone;
      changes.push("phone");
    }
    if (name && target.name !== name) {
      set.name = name;
      changes.push("name");
    }
    if (!(await passwordIsCurrent(target, input.password))) {
      set.passwordHash = await hashPassword(input.password);
      set.passwordAlgo = "argon2id";
      set.passwordChangedAt = new Date();
      changes.push("password");
    }

    // Mavjud hisob (shu raqamdagi) bootstrap adminga aylantiriladi
    const promoting = !target.isBootstrapAdmin;
    if (promoting) Object.assign(set, { isBootstrapAdmin: true, isPlatformAdmin: true, isActive: true });

    if (Object.keys(set).length > 0) {
      const [updated] = await tx.update(users).set(set).where(eq(users.id, target.id)).returning();
      user = updated!;
    } else {
      user = target;
    }

    if (changes.includes("password")) await revokeUserSessions(tx, user.id);
    action = promoting ? "promoted" : changes.length > 0 ? "updated" : "unchanged";
  }

  const rolesSeeded = await seedGlobalRoles(tx);

  if (action !== "unchanged") {
    await writeAuditLog(
      {
        userId: user.id,
        userName: user.name,
        action: "BOOTSTRAP_ADMIN_SEEDED",
        resource: "users",
        resourceId: user.id,
        severity: "warning",
        details: { action, changes },
        ...meta,
      },
      tx,
    );
  }

  return { user, action, changes, rolesSeeded };
}
