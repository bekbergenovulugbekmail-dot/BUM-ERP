/**
 * Parol (va PIN) xeshlash.
 *
 * Yangi xeshlar — argon2id (@node-rs/argon2 standart parametrlari:
 * m=19456 KiB, t=2, p=1 — OWASP tavsiyasi).
 *
 * Convex Auth'dan ko'chirilgan akkauntlarda lucia `Scrypt` xeshi bo'ladi
 * (lucia@3 dist/crypto.js): "<salt hex>:<kalit hex>", N=16384 r=16 p=1
 * dkLen=64. Salt sifatida hex SATRNING o'zi (UTF-8 baytlari) ishlatiladi,
 * parol NFKC. To'g'ri kirishda xesh argon2id ga almashtiriladi.
 */
import { scrypt, timingSafeEqual } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

export type PasswordAlgo = "argon2id" | "scrypt";

/** Bir xil parol turli qurilmada boshqa Unicode ko'rinishida kelmasligi uchun. */
const normalize = (s: string) => s.normalize("NFKC");

export function hashPassword(password: string): Promise<string> {
  return hash(normalize(password));
}

export async function verifyPassword(
  stored: string,
  algo: PasswordAlgo,
  password: string,
): Promise<boolean> {
  if (algo === "scrypt") return verifyLuciaScrypt(stored, normalize(password));
  try {
    return await verify(stored, normalize(password));
  } catch {
    // Buzilgan xesh — kirish yo'q, lekin 500 ham emas
    return false;
  }
}

function scryptKey(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // 128·N·r = 32 MiB — Node'ning standart maxmem chegarasida, zaxira bilan oshiriladi
    scrypt(password, salt, 64, { N: 16384, r: 16, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

async function verifyLuciaScrypt(stored: string, password: string): Promise<boolean> {
  const [salt, keyHex, ...rest] = stored.split(":");
  if (!salt || !keyHex || rest.length > 0 || !/^[0-9a-f]{128}$/i.test(keyHex)) return false;
  const actual = await scryptKey(password, salt);
  return timingSafeEqual(actual, Buffer.from(keyHex, "hex"));
}

let dummyHash: Promise<string> | undefined;

/**
 * Foydalanuvchi topilmaganda ham xuddi shuncha vaqt sarflanadi — javob
 * vaqtidan raqam ro'yxatdan o'tganini bilib bo'lmasligi uchun.
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hash("bum-erp-dummy-password");
  await verify(await dummyHash, normalize(password)).catch(() => false);
}
