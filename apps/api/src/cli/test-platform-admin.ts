/**
 * FAQAT LOKAL SINOV: vaqtinchalik platforma admini. Brauzer testlari admin panelini ocha olishi uchun.
 *
 *   node --import tsx src/cli/test-platform-admin.ts grant <telefon>
 *   node --import tsx src/cli/test-platform-admin.ts revoke <telefon>
 *
 * Xavfsizlik:
 *  - masofaviy bazada ISHLAMAYDI (faqat localhost) — production'da admin yaratib bo'lmaydi;
 *  - bootstrap adminga tegmaydi;
 *  - parol o'zgartirilmaydi, yangi hisob yaratilmaydi — faqat mavjud foydalanuvchining bayrog'i.
 */
import { pool } from "../db/client.js";
import { env } from "../env.js";

const [action, phone] = process.argv.slice(2);
if (action !== "grant" && action !== "revoke") {
  console.error("Foydalanish: test-platform-admin.ts grant|revoke <telefon>");
  process.exit(2);
}
if (!phone) {
  console.error("Telefon kerak");
  process.exit(2);
}

const host = new URL(env.DATABASE_URL).hostname;
if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
  console.error(`Baza lokal emas (${host}) — bu buyruq faqat lokal sinov uchun.`);
  process.exit(3);
}

const { rowCount } = await pool.query(
  `update users set is_platform_admin = $1, updated_at = now()
    where phone = $2 and is_bootstrap_admin = false`,
  [action === "grant", phone],
);
console.log(rowCount === 0 ? `Topilmadi: ${phone}` : `${phone} → platforma admini: ${action === "grant"}`);
await pool.end();
process.exit(rowCount === 0 ? 1 : 0);
