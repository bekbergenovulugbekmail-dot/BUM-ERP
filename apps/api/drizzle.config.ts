import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit apps/api dan ishga tushadi (db:generate, db:studio), shuning
 * uchun ildizdagi .env yo'li ishchi papkaga nisbatan olinadi.
 * Mavjud o'zgaruvchilar ustiga yozilmaydi.
 */
const envFile = resolve(process.cwd(), "../../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
  strict: true,
  verbose: true,
});
