/**
 * SMS orqali parol tiklash — Convex'da yo'q edi; Eskiz ulanguncha (PHASE 4) qoldirilgan edi.
 *
 * Xavfsizlik:
 *  - javob raqam ro'yxatdan o'tgan-o'tmaganidan qat'i nazar bir xil — foydalanuvchilarni aniqlab bo'lmaydi
 *  - kod 6 xonali (`crypto.randomInt`); bazada faqat SHA-256 (foydalanuvchi ID si bilan); 10 daqiqa, bir martalik
 *  - yangi so'rov oldingi kodlarni bekor qiladi; 5 ta xato urinishdan keyin kod yoqib yuboriladi
 *  - so'rov: raqamga 15 daqiqada 3 ta, IP dan soatiga 10 ta (har so'rov — pullik SMS);
 *    tasdiqlash: raqamga 15 daqiqada 10 ta xato
 *  - bootstrap admin (faqat .env orqali) va bloklangan hisoblarga kod yuborilmaydi
 *  - parol almashsa foydalanuvchining barcha sessiyalari bekor qilinadi; avtomatik kirish yo'q
 */
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { badRequest } from "@bum/shared";
import { db } from "../../db/client.js";
import { passwordResetCodes, users } from "../../db/schema/platform.js";
import { withTransaction } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import { logger } from "../../shared/logger.js";
import { assertNotLimited, recordHit } from "../../shared/rate-limit.js";
import type { SmsClient } from "../../shared/sms.js";
import { applyNewPassword, assertPasswordPolicy, normalizePhoneOrThrow } from "../users/user-admin.service.js";

export const RESET_CODE_TTL_SECONDS = 10 * 60;
export const MAX_CODE_ATTEMPTS = 5;
const WINDOW_SECONDS = 15 * 60;
const INVALID_CODE = "Kod noto'g'ri yoki muddati o'tgan";

const hashCode = (userId: string, code: string) => createHash("sha256").update(`${userId}:${code}`).digest("hex");

export async function requestPasswordReset(phoneRaw: string, meta: RequestMeta, sms: SmsClient): Promise<void> {
  const phone = normalizePhoneOrThrow(phoneRaw);
  const phoneBucket = `reset-request:phone:${phone}`;
  const ipBucket = `reset-request:ip:${meta.ipAddress}`;
  await assertNotLimited(phoneBucket, 3, WINDOW_SECONDS);
  await assertNotLimited(ipBucket, 10, 3600);
  await recordHit(phoneBucket, WINDOW_SECONDS);
  await recordHit(ipBucket, 3600);

  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      isActive: users.isActive,
      isBootstrapAdmin: users.isBootstrapAdmin,
      activeCompanyId: users.activeCompanyId,
    })
    .from(users)
    .where(eq(users.phone, phone))
    .limit(1);
  if (!user || !user.isActive || user.isBootstrapAdmin) return;

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await withTransaction(async (tx) => {
    await tx
      .update(passwordResetCodes)
      .set({ consumedAt: new Date() })
      .where(and(eq(passwordResetCodes.userId, user.id), isNull(passwordResetCodes.consumedAt)));
    await tx.insert(passwordResetCodes).values({
      userId: user.id,
      codeHash: hashCode(user.id, code),
      expiresAt: new Date(Date.now() + RESET_CODE_TTL_SECONDS * 1000),
    });
    await writeAuditLog(
      {
        userId: user.id,
        userName: user.name,
        companyId: user.activeCompanyId,
        action: "PASSWORD_RESET_REQUESTED",
        resource: "users",
        resourceId: user.id,
        severity: "warning",
        ...meta,
      },
      tx,
    );
  });

  try {
    await sms(phone, `BUM ERP: parolni tiklash kodi ${code}. 10 daqiqa amal qiladi. Kodni hech kimga bermang.`);
  } catch (error) {
    // Javob bir xil qoladi — aks holda raqam ro'yxatdan o'tgani oshkor bo'lardi
    logger.error({ err: error, userId: user.id }, "Parol tiklash SMS yuborilmadi");
  }
}

export async function confirmPasswordReset(
  input: { phone: string; code: string; newPassword: string },
  meta: RequestMeta,
): Promise<void> {
  const phone = normalizePhoneOrThrow(input.phone);
  assertPasswordPolicy(input.newPassword);
  const bucket = `reset-confirm:phone:${phone}`;
  await assertNotLimited(bucket, 10, WINDOW_SECONDS);

  const [user] = await db.select().from(users).where(eq(users.phone, phone)).limit(1);
  const [record] = user
    ? await db
        .select()
        .from(passwordResetCodes)
        .where(
          and(
            eq(passwordResetCodes.userId, user.id),
            isNull(passwordResetCodes.consumedAt),
            gt(passwordResetCodes.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(passwordResetCodes.createdAt))
        .limit(1)
    : [];
  if (!user || !record || !user.isActive || user.isBootstrapAdmin) {
    await recordHit(bucket, WINDOW_SECONDS);
    throw badRequest(INVALID_CODE);
  }

  const matches = timingSafeEqual(Buffer.from(record.codeHash, "hex"), Buffer.from(hashCode(user.id, input.code), "hex"));
  if (!matches) {
    await recordHit(bucket, WINDOW_SECONDS);
    const attempts = record.attempts + 1;
    await db
      .update(passwordResetCodes)
      .set({ attempts, ...(attempts >= MAX_CODE_ATTEMPTS ? { consumedAt: new Date() } : {}) })
      .where(eq(passwordResetCodes.id, record.id));
    throw badRequest(INVALID_CODE);
  }

  await withTransaction(async (tx) => {
    // Bir kod parallel so'rovlarda ikki marta ishlatilmasin
    const [claimed] = await tx
      .update(passwordResetCodes)
      .set({ consumedAt: new Date() })
      .where(and(eq(passwordResetCodes.id, record.id), isNull(passwordResetCodes.consumedAt)))
      .returning({ id: passwordResetCodes.id });
    if (!claimed) throw badRequest(INVALID_CODE);

    await applyNewPassword(tx, user, input.newPassword);
    await writeAuditLog(
      {
        userId: user.id,
        userName: user.name,
        companyId: user.activeCompanyId,
        action: "PASSWORD_RESET_COMPLETED",
        resource: "users",
        resourceId: user.id,
        severity: "warning",
        details: { by: "sms_code", sessionsRevoked: true },
        ...meta,
      },
      tx,
    );
  });
}
