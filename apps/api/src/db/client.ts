/**
 * PostgreSQL ulanish havzasi va Drizzle mijozi.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env, isProd } from "../env.js";
import * as schema from "./schema/index.js";

/**
 * numeric (DECIMAL) ni JS number ga aylantirmaymiz — string bo'lib qoladi.
 * Bu ataylab: float64 pul hisobida yaxlitlash xatosi beradi, aynan shu
 * muammo Convex versiyasida bor edi.
 */
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => v);
/** int8 ham string — 2^53 dan katta bo'lishi mumkin. */
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => v);

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: isProd ? 20 : 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on("error", (err) => {
  console.error("PostgreSQL havza xatosi:", err);
});

export const db = drizzle(pool, { schema, casing: "snake_case" });

export type Database = typeof db;

export async function closeDb(): Promise<void> {
  await pool.end();
}

export { schema };
