/**
 * Kassa ↔ buxgalteriya hisobi bog'lanishini tuzatish (bir martalik, moliyaviy).
 *
 * HTTP marshruti ATAYLAB yo'q: tuzatish faqat shu CLI orqali, server konteyneriga kira oladigan odam tomonidan
 * bajariladi. Oddiy foydalanuvchi (hatto `finance.manage` ruxsati bilan ham) buni API orqali chaqira olmaydi.
 *
 * Ko'rish (hech narsa yozmaydi — ro'yxat):
 *   node --import tsx src/cli/repair-cash-ledger.ts --list
 *
 * Sinov (tranzaksiya ochiladi, natija chiqadi, oxirida ROLLBACK):
 *   node --import tsx src/cli/repair-cash-ledger.ts --cash-account <uuid> --unlink --reason "..."
 *
 * Haqiqiy tuzatish (COMMIT) — faqat `--apply` bilan:
 *   node --import tsx src/cli/repair-cash-ledger.ts --cash-account <uuid> --unlink --reason "..." --apply
 */
import { closeDb, db } from "../db/client.js";
import { withTransaction } from "../db/transaction.js";
import { findMismatchedCashAccounts, repairCashLedgerMapping } from "../modules/finance/cash-ledger-repair.service.js";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const value = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

/** `--apply` bo'lmasa tranzaksiya ataylab bekor qilinadi — natija ko'rinadi, baza o'zgarmaydi. */
class DryRun extends Error {
  constructor(readonly result: unknown) {
    super("dry-run");
  }
}

async function main() {
  if (flag("list") || argv.length === 0) {
    const rows = await findMismatchedCashAccounts(db as never, value("company"));
    console.log(JSON.stringify({ mismatched: rows.length, rows }, null, 2));
    return;
  }

  const cashAccountId = value("cash-account");
  if (!cashAccountId) throw new Error("--cash-account <uuid> kerak (yoki --list)");
  const companyId = value("company");
  if (!companyId) throw new Error("--company <uuid> kerak");
  const reason = value("reason");
  if (!reason) throw new Error('--reason "nima uchun" kerak — audit iziga yoziladi');

  const unlink = flag("unlink");
  const to = value("to");
  if (unlink === Boolean(to)) throw new Error("--unlink yoki --to <ledger-account-uuid> dan bittasi ko'rsatilsin");

  const apply = flag("apply");
  const actorName = value("actor") ?? "CLI repair";

  try {
    const result = await withTransaction(async (tx) => {
      const repaired = await repairCashLedgerMapping(tx, {
        companyId,
        cashAccountId,
        targetLedgerAccountId: unlink ? null : to!,
        reason,
        actor: { userId: null, userName: actorName },
      });
      if (!apply) throw new DryRun(repaired);
      return repaired;
    });
    console.log(JSON.stringify({ applied: true, result }, null, 2));
  } catch (error) {
    if (error instanceof DryRun) {
      console.log(JSON.stringify({ applied: false, note: "DRY RUN — tranzaksiya bekor qilindi, baza o'zgarmadi", result: error.result }, null, 2));
      return;
    }
    throw error;
  }
}

try {
  await main();
} finally {
  await closeDb();
}
