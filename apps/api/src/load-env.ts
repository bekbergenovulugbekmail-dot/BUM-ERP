/**
 * Lokal ishlab chiqishda repo ildizidagi .env ni yuklaydi.
 * Side-effect modul — boshqa importlardan oldin import qilinishi kerak.
 *
 * Fayl yo'q bo'lsa (Railway) hech narsa qilmaydi. Mavjud o'zgaruvchilar
 * ustiga yozilmaydi — platforma yoki shell bergan qiymat ustun.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** src/load-env.ts va dist/load-env.js ikkalasidan ham ildiz uch daraja yuqorida. */
const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));

if (existsSync(envFile)) process.loadEnvFile(envFile);
