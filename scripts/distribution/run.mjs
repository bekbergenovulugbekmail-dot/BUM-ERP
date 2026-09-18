/**
 * 0→100 distributsiya simulyatsiyasini ishga tushiradi va natijani yozadi.
 *
 *   node scripts/distribution/run.mjs            — hammasi
 *   node scripts/distribution/run.mjs 1 2 3      — faqat tanlangan bosqichlar
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { results, OUT, state, sectionCompany, sectionEmployees, sectionInfrastructure, sectionCatalog } from "./lib.mjs";
import { sectionMarketing, sectionTerritory, sectionPurchase, sectionCustomerA, sectionCustomerB, sectionCustomerC } from "./flows.mjs";
import { sectionPos, sectionDeliveryFailure, sectionPartialDelivery, sectionReturn, sectionTransfer, sectionReports, sectionNegative, sectionConcurrency, sectionReconciliation } from "./flows2.mjs";

const STAGES = [
  ["1", sectionCompany],
  ["2", sectionEmployees],
  ["3", sectionInfrastructure],
  ["4", sectionCatalog],
  ["5", sectionMarketing],
  ["6", sectionTerritory],
  ["7", sectionPurchase],
  ["8", sectionCustomerA],
  ["9", sectionCustomerB],
  ["10", sectionCustomerC],
  ["11", sectionPos],
  ["12", sectionDeliveryFailure],
  ["13", sectionPartialDelivery],
  ["14", sectionReturn],
  ["15", sectionTransfer],
  ["16", sectionReports],
  ["17", sectionNegative],
  ["18", sectionConcurrency],
  ["21", sectionReconciliation],
];

const wanted = process.argv.slice(2);
const stages = wanted.length ? STAGES.filter(([key]) => wanted.includes(key)) : STAGES;

const started = Date.now();
for (const [, run] of stages) {
  try {
    await run();
  } catch (error) {
    results.push({
      section: "BOSQICH XATOSI",
      name: run.name,
      status: "FAIL",
      detail: `bosqich to'xtadi: ${error?.message ?? error}`,
    });
    console.log(`  FAIL bosqich to'xtadi (${run.name}): ${error?.message ?? error}`);
  }
}

const summary = results.reduce((acc, row) => ({ ...acc, [row.status]: (acc[row.status] ?? 0) + 1 }), {});
writeFileSync(
  path.join(OUT, "results.json"),
  JSON.stringify({ startedAt: new Date(started).toISOString(), summary, state: { companyId: state.companyId, slug: state.slug }, results }, null, 2),
);

const lines = ["# Distributsiya simulyatsiyasi — jurnal", "", `Sana: ${new Date().toISOString()}`, "", `Xulosa: ${JSON.stringify(summary)}`, ""];
let last = "";
for (const row of results) {
  if (row.section !== last) {
    lines.push("", `## ${row.section}`, "");
    last = row.section;
  }
  lines.push(`- **${row.status}** — ${row.name}${row.detail ? ` — ${row.detail}` : ""}`);
}
writeFileSync(path.join(OUT, "sim-log.md"), lines.join("\n") + "\n");

console.log(`\n=== XULOSA === ${JSON.stringify(summary)} (${Math.round((Date.now() - started) / 1000)} s)`);
console.log(`Natija: ${path.join(OUT, "results.json")}`);
if ((summary.FAIL ?? 0) > 0) process.exitCode = 0; // xato bo'lsa ham to'xtatmaymiz — hisobot uchun
