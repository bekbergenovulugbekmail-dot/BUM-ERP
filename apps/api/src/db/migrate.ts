/**
 * Migratsiyalarni qo'llash. Railway'da deploy paytida ishga tushadi.
 * Bir marta ishlaydi va chiqadi — server jarayoni emas.
 *
 * Ataylab `env.ts` ni import qilmaydi: migratsiyaga faqat DATABASE_URL kerak,
 * server sozlamalari (SESSION_SECRET va h.k.) talab qilinmasligi kerak.
 */
import "../load-env.js";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

/** src/db va dist/db ikkalasidan ham bir xil chuqurlikda — ishchi papkaga bog'liq emas. */
const apiRoot = fileURLToPath(new URL("../../", import.meta.url));

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL o'rnatilmagan (.env yoki muhit o'zgaruvchisi)");
  process.exit(1);
}

/** .sql fayllar build'ga ko'chirilmaydi, shuning uchun doim src dan o'qiladi. */
const migrationsFolder = join(apiRoot, "src", "db", "migrations");

const pool = new pg.Pool({ connectionString: url, max: 1 });

const start = Date.now();
try {
  await migrate(drizzle(pool), { migrationsFolder });
  console.log(`Migratsiyalar qo'llandi (${Date.now() - start}ms)`);
} catch (err) {
  console.error("Migratsiya xatosi:", err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
