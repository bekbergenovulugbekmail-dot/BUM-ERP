/**
 * Kassa smenasi farqi BUXGALTERIYAGA — audit AUD-010 (oldingi auditda F-1).
 *
 * Ilgari smena yopilganda farq faqat `pos_shifts.cash_difference` ga yozilardi: kassir 100 000 kam topshirsa ham
 * tizimdagi kassa qoldig'i (va 1010) o'zgarmasdi — hisobotdagi pul qo'ldagi puldan ko'p bo'lib qolardi, P&L da esa
 * kamomad umuman ko'rinmasdi.
 *
 * Endi farq smena yopilgan kunning o'zida yoziladi (pul allaqachon yo'q yoki ortiqcha — rahbarning tasdig'i yozuvning
 * sharti EMAS, u faqat mas'uliyat belgisi):
 *   kamomad   — kassadan chiqim + DR 5900 "Kassa kamomadi"  / CR kassa
 *   ortiqcha  — kassaga kirim  + DR kassa / CR 4300 "Kassa ortiqchasi"
 * Chet valyuta naqdi — o'z valyutasidagi kassada, jurnalda joriy kurs bilan.
 *
 * Yozuv SAVEPOINT ichida: biror sabab bilan yozib bo'lmasa (masalan, 5900 kodi band), smena baribir yopiladi va
 * natija `posted: false` bilan qaytadi — chaqiruvchi rahbarga xabar beradi. Kassir smenani yopa olmay qolmasligi
 * muhimroq; yozilmay qolgan farq esa jim yo'qolmaydi.
 */
import { AppError } from "@bum/shared";
import type { Tx } from "../../db/transaction.js";
import { fromMinor, toMinor } from "../../shared/decimal.js";
import type { TenantContext } from "../company/tenant.js";
import { companyCurrency } from "../finance/accounts.service.js";
import { ledgerAccountFor, recordCashTransaction, resolvePaymentAccount, toBaseAmount } from "../finance/cash.service.js";
import { currencyRate } from "../finance/currencies.service.js";
import { ensureAccountBySubtype, postJournalEntry } from "../finance/journal.service.js";

export type ShiftDifferencePosting = { currency: string; difference: string; posted: boolean; error?: string };

async function postOne(tx: Tx, tenant: TenantContext, shiftId: string, label: string, date: string, currency: string, difference: bigint) {
  const companyId = tenant.company.id;
  const base = await companyCurrency(tx, companyId);
  const shortage = difference < 0n;
  const amount = fromMinor(shortage ? -difference : difference);
  const { account } = await recordCashTransaction(tx, companyId, tenant.user.id, {
    // Asosiy valyuta naqdi — asosiy kassa (POS naqd tushumi ham shu yerga tushadi); valyuta — o'z kassasi
    cashAccountId: await resolvePaymentAccount(tx, companyId, "cash", null, currency),
    type: shortage ? "out" : "in",
    amount,
    currency,
    txDate: date,
    description: `${shortage ? "Kassa kamomadi" : "Kassa ortiqchasi"}: ${label}`,
    category: shortage ? "Kassa kamomadi" : "Kassa ortiqchasi",
    referenceType: currency === base ? "pos_shift_difference" : `pos_shift_difference_${currency.toLowerCase()}`,
    referenceId: shiftId,
  });
  const baseAmount = currency === base ? amount : toBaseAmount(amount, await currencyRate(tx, companyId, currency));
  if (toMinor(baseAmount) <= 0n) return;
  const cash = await ledgerAccountFor(tx, companyId, account);
  const counter = await ensureAccountBySubtype(tx, companyId, shortage ? "cash_shortage" : "cash_overage");
  await postJournalEntry(tx, companyId, tenant.user.id, {
    entryDate: date,
    description: `${shortage ? "Kassa kamomadi" : "Kassa ortiqchasi"} (${currency}): ${label}`,
    referenceType: currency === base ? "pos_shift_difference" : `pos_shift_difference_${currency.toLowerCase()}`,
    referenceId: shiftId,
    lines: shortage
      ? [
          { accountId: counter, debit: baseAmount },
          { accountId: cash, credit: baseAmount },
        ]
      : [
          { accountId: cash, debit: baseAmount },
          { accountId: counter, credit: baseAmount },
        ],
  });
}

/** Smena farqlarini (asosiy va chet valyuta) yozadi. Chaqiruvchi: `closeShift`, o'sha tranzaksiyada. */
export async function postShiftDifferences(
  tx: Tx,
  tenant: TenantContext,
  input: { shiftId: string; label: string; date: string; baseDifference: bigint; foreign: { currency: string; difference: string }[] },
): Promise<ShiftDifferencePosting[]> {
  const base = await companyCurrency(tx, tenant.company.id);
  const rows = [
    { currency: base, difference: input.baseDifference },
    ...input.foreign.map((row) => ({ currency: row.currency, difference: toMinor(row.difference) })),
  ].filter((row) => row.difference !== 0n);

  const results: ShiftDifferencePosting[] = [];
  for (const row of rows) {
    try {
      // Savepoint: bitta yozuv yiqilsa ham smena yopilishi (tashqi tranzaksiya) saqlanadi
      await tx.transaction(async (inner) => {
        await postOne(inner as unknown as Tx, tenant, input.shiftId, input.label, input.date, row.currency, row.difference);
      });
      results.push({ currency: row.currency, difference: fromMinor(row.difference), posted: true });
    } catch (error) {
      results.push({
        currency: row.currency,
        difference: fromMinor(row.difference),
        posted: false,
        error: error instanceof AppError ? error.message : "Yozuvda xato",
      });
    }
  }
  return results;
}
