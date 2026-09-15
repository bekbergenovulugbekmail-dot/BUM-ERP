/**
 * Yangilanish imzosi (Ed25519): o'rnatuvchi faqat ilova ichiga qurilgan ochiq kalit bilan tekshirilgan imzo bo'lsa
 * yuklab olinadi va ishga tushiriladi. Server yoki platforma admini hisobi buzilsa ham begona o'rnatuvchi kassada
 * ishlamaydi (xesh ham, manzil ham serverdan keladi — imzo esa faqat reliz tuzuvchidagi maxfiy kalit bilan qo'yiladi).
 * Kalit juftligi `scripts/release-sign.mjs generate` bilan yaratiladi; maxfiy kalit repoda yo'q.
 */
import { createPublicKey, verify } from "node:crypto";

/** Rasmiy reliz imzolash kalitlari (SPKI DER, base64). Kalit almashtirilganda eskisi bir muddat ro'yxatda qoladi. */
export const RELEASE_PUBLIC_KEYS: readonly string[] = ["MCowBQYDK2VwAyEAmbEPWU45IIAfUKzObCok+CQh5fSmNCBGy4MxVb9LNa0="];

/** Imzolanadigan matn — `scripts/release-sign.mjs` va server bilan bir xil. */
export const releaseMessage = (version: string, sha256: string) => `BUM-POS-KASSA-RELEASE\n${version}\n${sha256.toLowerCase()}`;

/** Ed25519 imzosi — 64 bayt, base64 da 88 belgi. */
const SIGNATURE_PATTERN = /^[A-Za-z0-9+/]{86}==$/;

export function verifyReleaseSignature(
  version: string,
  sha256: string,
  signature: string | null | undefined,
  publicKeys: readonly string[] = RELEASE_PUBLIC_KEYS,
): boolean {
  if (!signature || !SIGNATURE_PATTERN.test(signature)) return false;
  const message = Buffer.from(releaseMessage(version, sha256));
  const bytes = Buffer.from(signature, "base64");
  return publicKeys.some((key) => {
    try {
      return verify(null, message, createPublicKey({ key: Buffer.from(key, "base64"), format: "der", type: "spki" }), bytes);
    } catch {
      return false;
    }
  });
}
