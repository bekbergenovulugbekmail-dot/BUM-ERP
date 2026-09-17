/**
 * Har brauzer yugurishidan oldin demo kompaniyani tayyorlaydi.
 * Seeder idempotent: yangi yozuv qo'shadi va qoldiqni to'ldiradi,
 * hech narsani o'chirmaydi va mavjud tranzaksiyalarga tegmaydi.
 * Testlar qayta-qayta yugurganda zaxira tugab qolmasligi uchun kerak.
 */
import { execFileSync } from "node:child_process";

export default function globalSetup() {
  if (process.env.E2E_SKIP_SEED === "1") return;
  execFileSync("pnpm", ["--filter", "@bum/api", "db:seed-demo"], {
    stdio: ["ignore", "ignore", "inherit"],
    shell: process.platform === "win32",
  });
}
