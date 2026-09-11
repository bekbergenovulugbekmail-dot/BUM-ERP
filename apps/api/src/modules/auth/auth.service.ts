/**
 * Kirish (login) va joriy foydalanuvchi.
 *
 * Tranzaksiya qoidasi (db/transaction.ts): tx ni controller ochadi.
 * `authenticate` ataylab tranzaksiyadan TASHQARIDA — muvaffaqiyatsiz
 * urinishlar hisobi xato tashlanganda ham saqlanib qolishi kerak.
 */
import { and, eq } from "drizzle-orm";
import {
  badRequest,
  forbidden,
  isValidPhone,
  normalizePhone,
  unauthenticated,
} from "@bum/shared";
import { db } from "../../db/client.js";
import { companies, companyMembers, users } from "../../db/schema/platform.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import { assertNotLimited, recordHit } from "../../shared/rate-limit.js";
import { burnPasswordCheck, hashPassword, verifyPassword } from "./password.js";
import { createSession, type SessionUser } from "./session.js";

const LOGIN_WINDOW_SECONDS = 15 * 60;
/** Bitta raqamga 15 daqiqada 5 ta xato urinish. */
const MAX_FAILS_PER_PHONE = 5;
/** Bitta IP dan 15 daqiqada 30 ta xato — ko'p raqamni ketma-ket sinashga qarshi. */
const MAX_FAILS_PER_IP = 30;

/** Raqam ro'yxatdan o'tganini oshkor qilmaslik uchun ikkala holatda bir xil. */
const INVALID_CREDENTIALS = "Telefon raqam yoki parol noto'g'ri";

export type Authenticated = {
  user: SessionUser;
  /** Eski scrypt xeshi bo'lsa — argon2id dagi yangi xesh (tx dan oldin hisoblanadi). */
  upgradedHash: string | null;
};

export type Me = {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  isPlatformAdmin: boolean;
  activeCompanyId: string | null;
  hasCompany: boolean;
  companyName: string | null;
  companyCurrency: string | null;
  companySlug: string | null;
  companyRole: string | null;
};

export async function authenticate(
  phoneRaw: string,
  password: string,
  meta: RequestMeta,
): Promise<Authenticated> {
  const phone = normalizePhone(phoneRaw);
  if (!phone || !isValidPhone(phone)) throw badRequest("Telefon raqam noto'g'ri formatda");

  const phoneBucket = `login:phone:${phone}`;
  const ipBucket = `login:ip:${meta.ipAddress}`;
  await assertNotLimited(phoneBucket, MAX_FAILS_PER_PHONE, LOGIN_WINDOW_SECONDS);
  await assertNotLimited(ipBucket, MAX_FAILS_PER_IP, LOGIN_WINDOW_SECONDS);

  const [user] = await db.select().from(users).where(eq(users.phone, phone)).limit(1);

  let valid = false;
  if (user?.passwordHash) {
    valid = await verifyPassword(user.passwordHash, user.passwordAlgo, password);
  } else {
    await burnPasswordCheck(password);
  }

  if (!user || !valid) {
    await recordHit(phoneBucket, LOGIN_WINDOW_SECONDS);
    await recordHit(ipBucket, LOGIN_WINDOW_SECONDS);
    if (user) {
      await writeAuditLog({
        userId: user.id,
        userName: user.name,
        companyId: user.activeCompanyId,
        action: "login_failed",
        resource: "users",
        resourceId: user.id,
        severity: "warning",
        ...meta,
      });
    }
    throw unauthenticated(INVALID_CREDENTIALS);
  }

  // Parol to'g'ri bo'lgandan keyingina — aks holda bloklangan raqamlarni aniqlash mumkin bo'lardi
  if (!user.isActive) throw forbidden("Hisob faol emas. Administratorga murojaat qiling");

  const upgradedHash = user.passwordAlgo === "argon2id" ? null : await hashPassword(password);
  return { user, upgradedHash };
}

export async function startSession(tx: Tx, auth: Authenticated, meta: RequestMeta) {
  const { user } = auth;

  await tx
    .update(users)
    .set({
      lastSeenAt: new Date(),
      ...(auth.upgradedHash
        ? { passwordHash: auth.upgradedHash, passwordAlgo: "argon2id" as const }
        : {}),
    })
    .where(eq(users.id, user.id));

  const session = await createSession(tx, { userId: user.id, ...meta });

  await writeAuditLog(
    {
      userId: user.id,
      userName: user.name,
      companyId: user.activeCompanyId,
      action: "login_success",
      resource: "users",
      resourceId: user.id,
      ...(auth.upgradedHash ? { details: { passwordRehashed: true } } : {}),
      ...meta,
    },
    tx,
  );

  return { session, me: await buildMe(tx, user) };
}

/** Convexdagi users.getCurrentUser javobiga mos — xeshlar hech qachon chiqmaydi. */
export async function buildMe(conn: DbOrTx, user: SessionUser): Promise<Me> {
  const companyId = user.activeCompanyId;

  const [company] = companyId
    ? await conn
        .select({ name: companies.name, currency: companies.currency, slug: companies.slug })
        .from(companies)
        .where(eq(companies.id, companyId))
        .limit(1)
    : [];

  const [membership] = companyId
    ? await conn
        .select({ companyRole: companyMembers.companyRole })
        .from(companyMembers)
        .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, user.id)))
        .limit(1)
    : [];

  return {
    id: user.id,
    phone: user.phone,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    isPlatformAdmin: user.isPlatformAdmin,
    activeCompanyId: companyId,
    hasCompany: companyId !== null,
    companyName: company?.name ?? null,
    companyCurrency: company?.currency ?? null,
    companySlug: company?.slug ?? null,
    companyRole: membership?.companyRole ?? null,
  };
}
