/**
 * Kirish (login) va joriy foydalanuvchi.
 *
 * Tranzaksiya qoidasi (db/transaction.ts): tx ni controller ochadi.
 * `authenticate` ataylab tranzaksiyadan TASHQARIDA — muvaffaqiyatsiz
 * urinishlar hisobi xato tashlanganda ham saqlanib qolishi kerak.
 */
import { and, eq, ne } from "drizzle-orm";
import {
  badRequest,
  daysLeft,
  effectiveSubscriptionStatus,
  forbidden,
  isValidPhone,
  licenseDenial,
  normalizePhone,
  trialWarning,
  unauthenticated,
  type AccessDenialReason,
  type SubscriptionStatus,
} from "@bum/shared";
import { db } from "../../db/client.js";
import { companies, companyMembers, users } from "../../db/schema/platform.js";
import { licenses, subscriptions } from "../../db/schema/subscription.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import { consumeAttempt, releaseAttempt } from "../../shared/rate-limit.js";
import { burnPasswordCheck, hashPassword, verifyPassword } from "./password.js";
import { createSession, type SessionUser } from "./session.js";

const LOGIN_WINDOW_SECONDS = 15 * 60;
/** Bitta raqamga bitta IP dan 15 daqiqada 5 ta xato urinish. */
const MAX_FAILS_PER_PHONE_IP = 5;
/** Bitta raqamga barcha IP lardan 15 daqiqada 20 ta xato — tarqatilgan tanlashga qarshi (begona IP egani 5 ta xato bilan bloklay olmaydi). */
const MAX_FAILS_PER_PHONE = 20;
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
  /** Kompaniya holati (platforma admini qarori): faol emas — "suspended", tugatilgan — "cancelled". */
  companyStatus: string | null;
  companySuspendReason: string | null;
  isCompanyOwner: boolean;
  /** Obuna (server vaqti bo'yicha amaldagi holat). Tugagan bo'lsa — faqat Bosh sahifa va Obuna ochiq. */
  subscription: {
    status: SubscriptionStatus;
    /** Tugagan obuna trialmi (matn uchun). */
    isTrial: boolean;
    expiresAt: string | null;
    daysLeft: number | null;
    /** Trial ogohlantirishi: 10 / 5 / 3 / 1 yoki null. */
    trialWarning: number | null;
  } | null;
  /** Foydalanuvchi litsenziyasi bo'yicha kirish taqiqi (egasida doim null). */
  licenseDenial: AccessDenialReason | null;
  /** Ekran PIN bilan qulflangan (sessiya saqlanadi). */
  sessionLocked: boolean;
};

export async function authenticate(
  phoneRaw: string,
  password: string,
  meta: RequestMeta,
): Promise<Authenticated> {
  const phone = normalizePhone(phoneRaw);
  if (!phone || !isValidPhone(phone)) throw badRequest("Telefon raqam noto'g'ri formatda");

  // Urinish avval atomar hisoblanadi — parallel so'rovlar ham limitdan oshib parol tekshira olmaydi; to'g'ri parolda
  // hisob qaytariladi
  const buckets = [
    { bucket: `login:phone-ip:${phone}:${meta.ipAddress}`, limit: MAX_FAILS_PER_PHONE_IP },
    { bucket: `login:phone:${phone}`, limit: MAX_FAILS_PER_PHONE },
    { bucket: `login:ip:${meta.ipAddress}`, limit: MAX_FAILS_PER_IP },
  ];
  for (const { bucket, limit } of buckets) await consumeAttempt(bucket, limit, LOGIN_WINDOW_SECONDS);

  const [user] = await db.select().from(users).where(eq(users.phone, phone)).limit(1);

  let valid = false;
  if (user?.passwordHash) {
    valid = await verifyPassword(user.passwordHash, user.passwordAlgo, password);
  } else {
    await burnPasswordCheck(password);
  }

  if (!user || !valid) {
    // Ro'yxatdan o'tmagan raqamga urinish ham qayd etiladi (raqamni sanash hujumini ko'rish uchun); raqam qisman yashiriladi
    await writeAuditLog({
      userId: user?.id ?? null,
      userName: user?.name ?? null,
      companyId: user?.activeCompanyId ?? null,
      action: "login_failed",
      resource: "users",
      resourceId: user?.id ?? null,
      severity: "warning",
      ...(user ? {} : { details: { reason: "unknown_phone", phone: `${phone.slice(0, 6)}***${phone.slice(-2)}` } }),
      ...meta,
    });
    throw unauthenticated(INVALID_CREDENTIALS);
  }

  for (const { bucket } of buckets) await releaseAttempt(bucket, LOGIN_WINDOW_SECONDS);

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
export async function buildMe(conn: DbOrTx, user: SessionUser, options: { sessionLocked?: boolean } = {}): Promise<Me> {
  const companyId = user.activeCompanyId;
  const now = new Date();

  const [company] = companyId
    ? await conn
        .select({
          name: companies.name,
          currency: companies.currency,
          slug: companies.slug,
          status: companies.status,
          isActive: companies.isActive,
          suspendReason: companies.suspendReason,
          ownerId: companies.ownerId,
          subscriptionStatus: subscriptions.status,
          subscriptionExpiresAt: subscriptions.expiresAt,
        })
        .from(companies)
        .leftJoin(subscriptions, eq(subscriptions.companyId, companies.id))
        .where(eq(companies.id, companyId))
        .limit(1)
    : [];

  // tenant.ts dagi kirish tekshiruvi bilan bir xil qoida (obuna — alohida `subscription` maydonida)
  const blocked = !company
    ? null
    : company.status === "cancelled"
      ? { status: "cancelled", reason: company.suspendReason }
      : company.status === "suspended" || !company.isActive
        ? { status: "suspended", reason: company.suspendReason }
        : null;

  const [membership] = companyId
    ? await conn
        .select({
          companyRole: companyMembers.companyRole,
          licenseType: licenses.licenseType,
          licenseStatus: licenses.status,
          licenseExpiresAt: licenses.expiresAt,
        })
        .from(companyMembers)
        .leftJoin(
          licenses,
          and(eq(licenses.companyId, companyMembers.companyId), eq(licenses.userId, companyMembers.userId), ne(licenses.status, "revoked")),
        )
        .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, user.id)))
        .limit(1)
    : [];

  const isCompanyOwner = company?.ownerId === user.id;
  let subscription: Me["subscription"] = null;
  if (company?.subscriptionStatus) {
    const status = effectiveSubscriptionStatus({ status: company.subscriptionStatus, expiresAt: company.subscriptionExpiresAt }, now);
    subscription = {
      status,
      isTrial: company.subscriptionStatus === "trial",
      expiresAt: company.subscriptionExpiresAt?.toISOString() ?? null,
      daysLeft: daysLeft(company.subscriptionExpiresAt, now),
      trialWarning: trialWarning(status, company.subscriptionExpiresAt, now),
    };
  }
  const license =
    membership?.licenseType && membership.licenseStatus
      ? { type: membership.licenseType, status: membership.licenseStatus, expiresAt: membership.licenseExpiresAt }
      : null;

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
    companyStatus: company ? (blocked?.status ?? company.status) : null,
    companySuspendReason: blocked?.reason ?? null,
    isCompanyOwner,
    subscription,
    licenseDenial: membership && !isCompanyOwner ? licenseDenial(license, now) : null,
    sessionLocked: options.sessionLocked ?? false,
  };
}
