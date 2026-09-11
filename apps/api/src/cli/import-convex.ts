/**
 * Convex eksportini PostgreSQL'ga ko'chirish.
 *
 *   npx convex export --path convex-export.zip   (Convex loyihasida)
 *   unzip convex-export.zip -d convex-export
 *   pnpm --filter @bum/api db:import-convex convex-export --dry-run
 *   pnpm --filter @bum/api db:import-convex convex-export --report import-report.json
 *
 * Qayta ishga tushirsa bo'ladi (legacy_id bo'yicha upsert). `--dry-run` hamma narsani
 * tranzaksiyada bajarib, oxirida bekor qiladi — hisobot haqiqiy import bilan bir xil.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { closeDb } from "../db/client.js";
import { importConvexExport } from "../migration/convex-import.js";

const args = process.argv.slice(2);
const dir = args.find((arg) => !arg.startsWith("--"));
const dryRun = args.includes("--dry-run");
const reportArg = args.find((arg) => arg.startsWith("--report"));
const reportPath = reportArg?.includes("=") ? reportArg.split("=")[1] : reportArg ? args[args.indexOf(reportArg) + 1] : undefined;

if (!dir) {
  console.error("Foydalanish: db:import-convex <eksport-papkasi> [--dry-run] [--report fayl.json]");
  process.exit(2);
}

try {
  const report = await importConvexExport(resolve(dir), { dryRun });
  const rows = Object.entries(report.tables)
    .filter(([, t]) => t.read > 0 || t.imported > 0)
    .map(([name, t]) => ({ jadval: name, oqildi: t.read, yozildi: t.imported, "o'tkazildi": t.skipped, ogohlantirish: Object.values(t.warnings).reduce((s, n) => s + n, 0) }));
  console.table(rows);

  for (const [name, table] of Object.entries(report.tables)) {
    for (const [reason, count] of Object.entries(table.reasons)) console.log(`  [o'tkazildi] ${name}: ${reason} — ${count}`);
    for (const [warning, count] of Object.entries(table.warnings)) console.log(`  [ogohlantirish] ${name}: ${warning} — ${count}`);
  }
  console.log("\nSolishtirish:", report.reconciliation);
  console.log(dryRun ? "\nQuruq ishga tushirish — bazaga hech narsa yozilmadi." : "\nImport yakunlandi.");

  const target = resolve(reportPath ?? `convex-import-report-${report.startedAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(target, JSON.stringify(report, null, 2));
  console.log(`Hisobot: ${target}`);
} catch (error) {
  console.error("Import to'xtadi — hech narsa yozilmadi:", error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
