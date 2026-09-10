/**
 * Migratsiyalarni qo'llash. Railway'da deploy paytida ishga tushadi.
 * Bir marta ishlaydi va chiqadi — server jarayoni emas.
 */
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDb, db } from "./client.js";

const start = Date.now();
try {
  await migrate(db, { migrationsFolder: "./src/db/migrations" });
  console.log(`Migratsiyalar qo'llandi (${Date.now() - start}ms)`);
} catch (err) {
  console.error("Migratsiya xatosi:", err);
  process.exitCode = 1;
} finally {
  await closeDb();
}
