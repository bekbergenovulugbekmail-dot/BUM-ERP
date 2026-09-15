#!/usr/bin/env node
/**
 * BUM POS KASSA relizini imzolash (Ed25519, bepul, tashqi xizmatsiz).
 *
 * Kassa yangilanishni faqat ilova ichiga qurilgan ochiq kalit bilan tekshirilgan imzo bo'lsa o'rnatadi: server yoki
 * platforma admini hisobi buzilsa ham begona o'rnatuvchi kassalarda ishga tushmaydi.
 *
 *   node scripts/release-sign.mjs generate
 *       Maxfiy kalitni %USERPROFILE%\.bum-erp\release-signing-ed25519.pem ga yozadi (bor bo'lsa — to'xtaydi) va ochiq
 *       kalitni chiqaradi (apps/desktop/src/main/release-signature.ts va API ga qo'yiladi).
 *       MAXFIY KALIT GIT'GA QO'SHILMAYDI, zaxira nusxasini xavfsiz joyda saqlang: yo'qolsa yangi kalit bilan faqat
 *       yangi o'rnatuvchini qo'lda tarqatish mumkin bo'ladi.
 *
 *   node scripts/release-sign.mjs sign <o'rnatuvchi.exe> <versiya> [maxfiy-kalit.pem]
 *       SHA-256 va imzoni chiqaradi — platforma admini relizni e'lon qilishda imzoni kiritadi.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const DEFAULT_KEY = path.join(homedir(), ".bum-erp", "release-signing-ed25519.pem");
const SEMVER = /^\d+\.\d+\.\d+$/;

/** Kassa va server bilan bir xil imzolanadigan matn. */
export const releaseMessage = (version, sha256) => `BUM-POS-KASSA-RELEASE\n${version}\n${sha256.toLowerCase()}`;

const publicKeyBase64 = (privateKey) => createPublicKey(privateKey).export({ type: "spki", format: "der" }).toString("base64");

async function fileSha256(file) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    createReadStream(file).on("data", (chunk) => hash.update(chunk)).on("end", resolve).on("error", reject);
  });
  return hash.digest("hex");
}

const [command, ...args] = process.argv.slice(2);

if (command === "generate") {
  const target = args[0] ?? DEFAULT_KEY;
  if (existsSync(target)) {
    console.error(`Kalit allaqachon bor: ${target} — ustiga yozilmaydi`);
    process.exit(1);
  }
  mkdirSync(path.dirname(target), { recursive: true });
  const { privateKey } = generateKeyPairSync("ed25519");
  writeFileSync(target, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600, flag: "wx" });
  console.log(`Maxfiy kalit: ${target}`);
  console.log(`Ochiq kalit (SPKI, base64): ${publicKeyBase64(privateKey)}`);
} else if (command === "sign") {
  const [installer, version, keyFile = DEFAULT_KEY] = args;
  if (!installer || !version || !SEMVER.test(version)) {
    console.error("Foydalanish: node scripts/release-sign.mjs sign <o'rnatuvchi.exe> <1.2.3> [maxfiy-kalit.pem]");
    process.exit(1);
  }
  const privateKey = createPrivateKey(readFileSync(keyFile));
  const sha256 = await fileSha256(installer);
  const signature = sign(null, Buffer.from(releaseMessage(version, sha256)), privateKey).toString("base64");
  console.log(`Versiya: ${version}`);
  console.log(`SHA-256: ${sha256}`);
  console.log(`Ochiq kalit: ${publicKeyBase64(privateKey)}`);
  console.log(`Imzo: ${signature}`);
} else {
  console.error("Buyruq: generate | sign");
  process.exit(1);
}
