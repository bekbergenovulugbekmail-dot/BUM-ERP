/**
 * Bootstrap adminni va platforma ma'lumotnomalarini .env dan seed qilish (idempotent).
 *
 *   pnpm --filter @bum/api db:seed
 *
 * O'qiydi: BOOTSTRAP_ADMIN_PHONE, BOOTSTRAP_ADMIN_PASSWORD (majburiy),
 * BOOTSTRAP_ADMIN_NAME (ixtiyoriy). Parolni almashtirish — .env dagi qiymatni
 * o'zgartirib, buyruqni qayta ishga tushirish; eski sessiyalar bekor qilinadi.
 * Standart o'lchov birliklari ham qo'shiladi (mavjudlari o'zgarmaydi).
 */
import { closeDb } from "../db/client.js";
import { withTransaction } from "../db/transaction.js";
import { env } from "../env.js";
import { seedDefaultUnits } from "../modules/catalog/units.service.js";
import { seedBootstrapAdmin, type SeedResult } from "../modules/platform/bootstrap.service.js";

function describe(result: SeedResult): string {
  switch (result.action) {
    case "created":
      return "yaratildi";
    case "promoted":
      return "mavjud hisob bootstrap admin qilindi";
    case "updated":
      return `yangilandi (${result.changes.join(", ")})`;
    case "unchanged":
      return "o'zgarish yo'q";
  }
}

try {
  const phone = env.BOOTSTRAP_ADMIN_PHONE;
  const password = env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!phone || !password) {
    throw new Error("BOOTSTRAP_ADMIN_PHONE va BOOTSTRAP_ADMIN_PASSWORD .env da bo'lishi kerak");
  }

  const { result, unitsSeeded } = await withTransaction(async (tx) => ({
    result: await seedBootstrapAdmin(
      tx,
      { phone, password, name: env.BOOTSTRAP_ADMIN_NAME ?? null },
      { ipAddress: "cli", userAgent: null },
    ),
    unitsSeeded: await seedDefaultUnits(tx),
  }));

  console.log(
    `Bootstrap admin ${result.user.phone}: ${describe(result)}. ` +
      `Qo'shilgan global rollar: ${result.rolesSeeded}, o'lchov birliklari: ${unitsSeeded}`,
  );
} catch (err) {
  console.error(`Xato: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
