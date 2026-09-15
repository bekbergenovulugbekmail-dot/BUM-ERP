/**
 * Desktop kassa relizi imzosi (Ed25519). Imzo reliz tuzuvchi kompyuteridagi maxfiy kalit bilan
 * (`apps/desktop/scripts/release-sign.mjs sign`) qo'yiladi; server faqat ochiq kalit bilan tekshiradi — maxfiy kalit
 * serverda yo'q. Kassa imzoni o'z ichidagi ochiq kalit bilan qayta tekshiradi (server buzilsa ham begona fayl ishlamaydi).
 */
import { createPublicKey, verify } from "node:crypto";

/** Rasmiy ochiq kalitlar (SPKI DER, base64) — `apps/desktop/src/main/release-signature.ts` bilan bir xil. Testlar almashtiradi. */
export const releaseSigning: { publicKeys: readonly string[] } = {
  publicKeys: ["MCowBQYDK2VwAyEAmbEPWU45IIAfUKzObCok+CQh5fSmNCBGy4MxVb9LNa0="],
};

export const releaseMessage = (version: string, sha256: string) => `BUM-POS-KASSA-RELEASE\n${version}\n${sha256.toLowerCase()}`;

/** Ed25519 imzosi — 64 bayt, base64 da 88 belgi. */
const SIGNATURE_PATTERN = /^[A-Za-z0-9+/]{86}==$/;

export function isValidReleaseSignature(version: string, sha256: string, signature: string | null | undefined): boolean {
  if (!signature || !SIGNATURE_PATTERN.test(signature)) return false;
  const message = Buffer.from(releaseMessage(version, sha256));
  const bytes = Buffer.from(signature, "base64");
  return releaseSigning.publicKeys.some((key) => {
    try {
      return verify(null, message, createPublicKey({ key: Buffer.from(key, "base64"), format: "der", type: "spki" }), bytes);
    } catch {
      return false;
    }
  });
}
