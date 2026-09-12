/**
 * Yetkazish OTP: 6 xonali bir martalik kod. Bazada faqat HMAC-SHA256 (server siri bilan, yetkazmaga bog'langan) —
 * kodning o'zi saqlanmaydi va auditga yozilmaydi. Tekshiruv doimiy vaqtli taqqoslash bilan.
 */
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { env } from "../../env.js";

export const OTP_RE = /^\d{6}$/;

export const generateOtp = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

export const hashOtp = (taskId: string, code: string) =>
  createHmac("sha256", env.SESSION_SECRET).update(`delivery-otp:${taskId}:${code}`).digest("hex");

export function verifyOtp(taskId: string, code: string, storedHash: string): boolean {
  if (!OTP_RE.test(code)) return false;
  const actual = Buffer.from(hashOtp(taskId, code), "hex");
  const expected = Buffer.from(storedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
