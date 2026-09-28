#!/usr/bin/env node
/**
 * BUM POS KASSA relizini BITTA BUYRUQ bilan e'lon qilish (egasi qarori 2026-09-28: qo'lda yuklash bo'lmasin).
 *
 *   pnpm --filter @bum/desktop release:publish
 *
 * Nima qiladi: `release/` dagi o'rnatuvchini topadi → SHA-256 → Ed25519 imzo (maxfiy kalit shu kompyuterda) →
 * platforma admini bilan kiradi → serverga yuklaydi → e'lon qiladi. Shundan keyin kassalar 6 soat ichida
 * (yoki qayta kirganda) yangilanishni o'zi ko'radi, fonda yuklab oladi va kassirdan "Yangilaysizmi?" deb so'raydi.
 *
 * Kerakli muhit o'zgaruvchilari (parol kodda saqlanmaydi):
 *   BUM_ADMIN_PHONE, BUM_ADMIN_PASSWORD   — platforma admini
 *   BUM_API_URL                            — standart https://app.bum-erp.uz
 *   BUM_RELEASE_KEY                        — imzo kaliti (standart ~/.bum-erp/release-signing-ed25519.pem)
 *   BUM_RELEASE_FILE                       — o'rnatuvchi (standart — release/ dagi eng yangi .exe)
 *   BUM_RELEASE_NOTES, BUM_RELEASE_MANDATORY=1 — ixtiyoriy
 */
import { createHash, createPrivateKey, sign } from "node:crypto";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { releaseMessage } from "./release-sign.mjs";

const root = path.resolve(import.meta.dirname, "..");
const api = (process.env.BUM_API_URL ?? "https://app.bum-erp.uz").replace(/\/+$/, "");
const phone = process.env.BUM_ADMIN_PHONE;
const password = process.env.BUM_ADMIN_PASSWORD;
const keyFile = process.env.BUM_RELEASE_KEY ?? path.join(homedir(), ".bum-erp", "release-signing-ed25519.pem");

const die = (message) => {
  console.error(`XATO: ${message}`);
  process.exit(1);
};

if (!phone || !password) die("BUM_ADMIN_PHONE va BUM_ADMIN_PASSWORD berilmagan (platforma admini)");
if (!existsSync(keyFile)) die(`Imzo kaliti yo'q: ${keyFile} — \`node scripts/release-sign.mjs generate\``);

const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
const file =
  process.env.BUM_RELEASE_FILE ??
  (() => {
    const dir = path.join(root, "release");
    if (!existsSync(dir)) die("release/ papkasi yo'q — avval `pnpm --filter @bum/desktop dist:win`");
    const candidates = readdirSync(dir)
      .filter((name) => name.toLowerCase().endsWith(".exe"))
      .map((name) => ({ name, at: statSync(path.join(dir, name)).mtimeMs }))
      .sort((a, b) => b.at - a.at);
    if (candidates.length === 0) die("release/ da .exe topilmadi — avval `pnpm --filter @bum/desktop dist:win`");
    return path.join(dir, candidates[0].name);
  })();

const sha256 = await new Promise((resolve, reject) => {
  const hash = createHash("sha256");
  createReadStream(file).on("data", (chunk) => hash.update(chunk)).on("end", () => resolve(hash.digest("hex"))).on("error", reject);
});
const signature = sign(null, Buffer.from(releaseMessage(version, sha256)), createPrivateKey(readFileSync(keyFile, "utf8"))).toString("base64");
console.log(`Reliz: ${path.basename(file)} | versiya ${version} | SHA-256 ${sha256.slice(0, 16)}…`);

const login = await fetch(`${api}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ phone, password }),
});
if (!login.ok) die(`Kirish muvaffaqiyatsiz: ${login.status} ${await login.text()}`);
const cookie = (login.headers.getSetCookie?.() ?? []).map((row) => row.split(";")[0]).join("; ");
if (!cookie) die("Sessiya cookie'si kelmadi");

const upload = await fetch(`${api}/api/platform/desktop-releases?version=${encodeURIComponent(version)}&fileName=${encodeURIComponent(path.basename(file))}`, {
  method: "POST",
  headers: { cookie, "content-type": "application/octet-stream", "x-sha256": sha256, "content-length": String(statSync(file).size) },
  body: createReadStream(file),
  duplex: "half",
});
if (!upload.ok) die(`Yuklash muvaffaqiyatsiz: ${upload.status} ${await upload.text()}`);
const { release } = await upload.json();
console.log(`Yuklandi: ${release.id}`);

if (process.env.BUM_RELEASE_NOTES || process.env.BUM_RELEASE_MANDATORY === "1") {
  const patch = await fetch(`${api}/api/platform/desktop-releases/${release.id}`, {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      ...(process.env.BUM_RELEASE_NOTES ? { notes: process.env.BUM_RELEASE_NOTES } : {}),
      ...(process.env.BUM_RELEASE_MANDATORY === "1" ? { mandatory: true } : {}),
    }),
  });
  if (!patch.ok) die(`Izoh/majburiylikni yozib bo'lmadi: ${patch.status} ${await patch.text()}`);
}

const published = await fetch(`${api}/api/platform/desktop-releases/${release.id}/publish`, {
  method: "POST",
  headers: { cookie, "content-type": "application/json" },
  body: JSON.stringify({ signature }),
});
if (!published.ok) die(`E'lon qilinmadi: ${published.status} ${await published.text()}`);
console.log(`E'lon qilindi: ${version}. Kassalar yangilanishni o'zi topadi va kassirdan so'raydi.`);
