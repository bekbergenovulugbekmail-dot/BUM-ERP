/**
 * Bazada saqlanadigan sirlar (masalan Telegram bot tokeni) uchun shifrlash.
 *
 * Kalit `SESSION_SECRET` dan HKDF bilan olinadi — alohida o'zgaruvchi talab qilmaydi va
 * sessiya kalitining o'zi hech qayerda takrorlanmaydi. AES-256-GCM: shifrlangan matn
 * o'zgartirilsa ochish xato beradi (butunlik kafolati).
 *
 * Baza nusxasi o'g'irlansa ham token ochilmaydi — buning uchun `SESSION_SECRET` ham kerak.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { env } from "../env.js";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (!cachedKey) {
    // Maqsadga xos kalit: sessiya kaliti bilan bir xil bo'lmaydi
    cachedKey = Buffer.from(hkdfSync("sha256", env.SESSION_SECRET, "bum-secret-box", "secret-box-v1", 32));
  }
  return cachedKey;
}

/** Sirni shifrlaydi: natija `base64(iv | tag | ciphertext)`. */
export function sealSecret(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}

/** Shifrlangan sirni ochadi; buzilgan yoki boshqa kalit bilan yozilgan bo'lsa xato. */
export function openSecret(sealed: string): string {
  const raw = Buffer.from(sealed, "base64");
  if (raw.length <= IV_BYTES + TAG_BYTES) throw new Error("Shifrlangan qiymat buzilgan");
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
}

/** Ko'rsatish uchun: `1234567890:AAE…xyz` → `1234567890:AA…xyz` (to'liq token hech qayerda chiqmaydi). */
export function maskToken(token: string): string {
  const [id = "", rest = ""] = token.split(":");
  if (rest.length <= 6) return `${id}:••••`;
  return `${id}:${rest.slice(0, 2)}…${rest.slice(-3)}`;
}
