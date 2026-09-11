import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

/**
 * Testlar alohida `<baza>_test` bazasida ishlaydi — lokal ishchi ma'lumotga
 * tegmaydi. TEST_DATABASE_URL berilsa, o'sha ishlatiladi.
 */
export function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;

  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("Testlar uchun DATABASE_URL yoki TEST_DATABASE_URL kerak");

  const url = new URL(base);
  const name = decodeURIComponent(url.pathname.slice(1));
  url.pathname = "/" + encodeURIComponent(name.endsWith("_test") ? name : `${name}_test`);
  return url.toString();
}
