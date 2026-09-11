/**
 * Test bazasini tayyorlaydi: yo'q bo'lsa yaratadi va migratsiyalarni qo'llaydi.
 * Butun test ishga tushishida bir marta.
 */
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { testDatabaseUrl } from "./database-url.js";

export default async function setup(): Promise<void> {
  const url = new URL(testDatabaseUrl());
  const dbName = decodeURIComponent(url.pathname.slice(1));
  if (!dbName.endsWith("_test")) {
    throw new Error(`Test bazasi nomi "_test" bilan tugashi kerak: ${dbName}`);
  }

  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const { rowCount } = await admin.query("select 1 from pg_database where datname = $1", [dbName]);
    if (!rowCount) await admin.query(`create database "${dbName.replaceAll('"', '""')}"`);
  } finally {
    await admin.end();
  }

  const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
  try {
    await migrate(drizzle(pool), {
      migrationsFolder: fileURLToPath(new URL("../src/db/migrations", import.meta.url)),
    });
  } finally {
    await pool.end();
  }
}
