/**
 * PIN — qulflangan ekranni tez ochish.
 *
 * PIN sessiya YARATMAYDI va boshqa foydalanuvchi yoki kompaniyaga
 * o'tkazmaydi — faqat joriy sessiyaning UI qulfini ochadi (convex/pin.ts
 * bilan bir xil xatti-harakat va `reason` kodlari).
 *
 * Convexdan farqlar:
 *  - xesh argon2id (Convexda SHA-256 + alohida salt edi);
 *  - noto'g'ri PIN hisobi va bloklash change/remove da ham ishlaydi —
 *    Convexda shu yo'llar orqali bloklashni chetlab o'tib PIN tanlash mumkin edi;
 *  - PIN o'rnatilgan bo'lsa `setPin` uni ustidan yozmaydi (CONFLICT).
 *
 * Tekshiruv natijasi xato TASHLAMAYDI, qaytariladi: urinishlar hisobi
 * tranzaksiya bilan saqlanishi kerak, tx ichidagi xato esa uni bekor qiladi.
 * Controller xatoni commit'dan keyin tashlaydi (`pinFailureError`).
 */
import { eq } from "drizzle-orm";
import { AppError, badRequest, conflict, forbidden, notFound, rateLimited } from "@bum/shared";
import { users } from "../../db/schema/platform.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type AuditEntry, type RequestMeta } from "../../shared/audit.js";
import { hashPassword, verifyPassword } from "./password.js";
import type { SessionUser } from "./session.js";

export const MAX_PIN_ATTEMPTS = 5;
export const PIN_LOCK_SECONDS = 5 * 60;
const PIN_RE = /^\d{4,8}$/;

export type PinResult = { success: true } | { success: false; reason: string };

type PinPurpose = "unlock" | "change" | "remove";

async function loadForUpdate(tx: Tx, userId: string): Promise<SessionUser> {
  // Parallel urinishlar hisobni yo'qotmasligi uchun qator qulflanadi
  const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
  if (!user) throw notFound("Foydalanuvchi topilmadi");
  return user;
}

function audit(
  tx: Tx,
  user: SessionUser,
  meta: RequestMeta,
  entry: Pick<AuditEntry, "action" | "severity" | "details">,
): Promise<void> {
  return writeAuditLog(
    {
      userId: user.id,
      userName: user.name,
      companyId: user.activeCompanyId,
      resource: "users",
      resourceId: user.id,
      ...meta,
      ...entry,
    },
    tx,
  );
}

async function checkPin(
  tx: Tx,
  user: SessionUser,
  pinHash: string,
  pin: string,
  meta: RequestMeta,
  purpose: PinPurpose,
): Promise<PinResult> {
  const now = Date.now();

  if (user.pinLockedUntil && user.pinLockedUntil.getTime() > now) {
    const remaining = Math.ceil((user.pinLockedUntil.getTime() - now) / 1000);
    await audit(tx, user, meta, {
      action: "pin_locked",
      severity: "warning",
      details: { purpose, remainingSeconds: remaining },
    });
    return { success: false, reason: `PIN_LOCKED:${remaining}` };
  }

  // Blok muddati o'tgan bo'lsa hisob noldan boshlanadi
  const previous = user.pinLockedUntil ? 0 : user.pinFailedAttempts;

  if (await verifyPassword(pinHash, "argon2id", pin)) {
    await tx
      .update(users)
      .set({ pinFailedAttempts: 0, pinLockedUntil: null })
      .where(eq(users.id, user.id));
    return { success: true };
  }

  const attempts = previous + 1;
  const locked = attempts >= MAX_PIN_ATTEMPTS;
  await tx
    .update(users)
    .set({
      pinFailedAttempts: locked ? 0 : attempts,
      pinLockedUntil: locked ? new Date(now + PIN_LOCK_SECONDS * 1000) : null,
    })
    .where(eq(users.id, user.id));
  await audit(tx, user, meta, {
    action: locked ? "pin_locked" : "pin_unlock_failed",
    severity: locked ? "warning" : "info",
    details: { purpose, attempts, locked },
  });

  return {
    success: false,
    reason: locked ? `PIN_LOCKED:${PIN_LOCK_SECONDS}` : `WRONG_PIN:${MAX_PIN_ATTEMPTS - attempts}`,
  };
}

/** change/remove da muvaffaqiyatsiz tekshiruvni HTTP xatoga aylantiradi. */
export function pinFailureError(reason: string): AppError {
  if (reason.startsWith("PIN_LOCKED:")) {
    const seconds = Number(reason.split(":")[1]) || PIN_LOCK_SECONDS;
    return rateLimited(`PIN ${Math.ceil(seconds / 60)} daqiqaga bloklangan`);
  }
  return forbidden("PIN noto'g'ri");
}

function assertPinFormat(pin: string, label = "PIN"): void {
  if (!PIN_RE.test(pin)) throw badRequest(`${label} 4-8 ta raqamdan iborat bo'lishi kerak`);
}

export function securitySettings(user: SessionUser) {
  const locked = user.pinLockedUntil !== null && user.pinLockedUntil.getTime() > Date.now();
  return {
    hasPIN: user.pinHash !== null,
    autoLockTimeoutSeconds: user.autoLockSeconds,
    isPinLocked: locked,
    pinLockedUntil: user.pinLockedUntil?.toISOString() ?? null,
    pinFailedAttempts: user.pinFailedAttempts,
  };
}

export async function setPin(tx: Tx, userId: string, pin: string, meta: RequestMeta): Promise<void> {
  assertPinFormat(pin);
  const user = await loadForUpdate(tx, userId);
  if (user.pinHash) {
    throw conflict("PIN allaqachon o'rnatilgan. O'zgartirish uchun joriy PIN kerak");
  }

  await tx
    .update(users)
    .set({ pinHash: await hashPassword(pin), pinFailedAttempts: 0, pinLockedUntil: null })
    .where(eq(users.id, user.id));
  await audit(tx, user, meta, { action: "pin_created" });
}

export async function changePin(
  tx: Tx,
  userId: string,
  oldPin: string,
  newPin: string,
  meta: RequestMeta,
): Promise<PinResult> {
  assertPinFormat(newPin, "Yangi PIN");
  const user = await loadForUpdate(tx, userId);
  if (!user.pinHash) throw badRequest("PIN hali o'rnatilmagan");

  const result = await checkPin(tx, user, user.pinHash, oldPin, meta, "change");
  if (!result.success) return result;

  await tx
    .update(users)
    .set({ pinHash: await hashPassword(newPin), pinFailedAttempts: 0, pinLockedUntil: null })
    .where(eq(users.id, user.id));
  await audit(tx, user, meta, { action: "pin_changed" });
  return result;
}

export async function removePin(
  tx: Tx,
  userId: string,
  currentPin: string,
  meta: RequestMeta,
): Promise<PinResult> {
  const user = await loadForUpdate(tx, userId);
  if (!user.pinHash) throw badRequest("PIN o'rnatilmagan");

  const result = await checkPin(tx, user, user.pinHash, currentPin, meta, "remove");
  if (!result.success) return result;

  await tx
    .update(users)
    .set({ pinHash: null, pinFailedAttempts: 0, pinLockedUntil: null })
    .where(eq(users.id, user.id));
  await audit(tx, user, meta, { action: "pin_removed" });
  return result;
}

export async function verifyPin(
  tx: Tx,
  userId: string,
  input: { pin: string; expectedUserId: string; expectedCompanyId?: string | null },
  meta: RequestMeta,
): Promise<PinResult> {
  const user = await loadForUpdate(tx, userId);

  // Boshqa foydalanuvchining qulfini ochishga urinish
  if (user.id !== input.expectedUserId) {
    await audit(tx, user, meta, {
      action: "pin_unlock_failed",
      severity: "error",
      details: { reason: "USER_MISMATCH" },
    });
    return { success: false, reason: "SESSION_MISMATCH" };
  }

  // Boshqa kompaniya kontekstida ochishga urinish
  if (input.expectedCompanyId && user.activeCompanyId !== input.expectedCompanyId) {
    await audit(tx, user, meta, {
      action: "pin_unlock_failed",
      severity: "error",
      details: { reason: "COMPANY_MISMATCH" },
    });
    return { success: false, reason: "COMPANY_MISMATCH" };
  }

  if (!user.pinHash) return { success: false, reason: "PIN_NOT_SET" };

  const result = await checkPin(tx, user, user.pinHash, input.pin, meta, "unlock");
  if (result.success) {
    await audit(tx, user, meta, {
      action: "pin_unlock_success",
      details: { companyId: user.activeCompanyId },
    });
  }
  return result;
}

export async function setAutoLockTimeout(conn: DbOrTx, userId: string, seconds: number): Promise<void> {
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 3600) {
    throw badRequest("Timeout 0-3600 soniya oralig'ida bo'lishi kerak");
  }
  await conn.update(users).set({ autoLockSeconds: seconds }).where(eq(users.id, userId));
}
