/**
 * BIR MARTALIK TUZATISH: kassaga turiga mos kelmaydigan buxgalteriya hisobi bog'langan holatni to'g'rilaydi.
 *
 * Muammo: `ledger_account_id` noto'g'ri bo'lsa (masalan naqd kassa → "1020 Bank hisobi"), o'sha kassaga tushgan
 * pul jurnalda boshqa hisobga yozilgan. `assertLedgerAccount` endi yangi va tahrirlangan bog'lanishni rad etadi,
 * lekin ALLAQACHON yozilgan satrlarni o'zgartirmaydi — shuning uchun shu tuzatish kerak.
 *
 * Nega UPDATE emas, kompensatsiya yozuvi:
 *  - `journal_lines` tahrirlanmaydi va o'chirilmaydi — jurnalga yozishning yagona yo'li `postJournalEntry`,
 *    bekor qilingan yozuv esa `voided` holatida saqlanadi (journal.service.ts sarlavhasiga qarang);
 *  - bu yozuvlarda `reference_type` bor, ya'ni `voidManualEntry` ularni rad etadi; hujjat orqali bekor qilish
 *    to'lovni va kassa harakatini ham qaytarib yuborardi — kassa qoldig'i buzilardi;
 *  - `createManualEntry` `cash`/`bank` subtype'larini va kassaga bog'langan hisoblarni bloklaydi.
 * Qoladigan yagona to'g'ri yo'l — reklassifikatsiya yozuvi: eski hisobdan yangisiga ko'chirish.
 *
 * Idempotentlik: yozuv `(company_id, reference_type, reference_id)` bo'yicha yagona indeks bilan himoyalangan
 * (`reference_type = cash_ledger_reclass`, `reference_id` = kassa id). Ikkinchi chaqiruv `already_repaired`
 * qaytaradi va yangi yozuv yaratmaydi.
 *
 * HTTP marshruti ATAYLAB yo'q — tuzatish faqat CLI orqali (`src/cli/repair-cash-ledger.ts`) ishga tushadi.
 */
import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { badRequest, notFound } from "@bum/shared";
import { accounts, cashAccounts, cashTransactions, journalEntries, journalLines } from "../../db/schema/finance.js";
import type { Tx } from "../../db/transaction.js";
import { writeAuditLog } from "../../shared/audit.js";
import { fromMinor, toMinor } from "../../shared/decimal.js";
import { assertLedgerAccount, ledgerAccountFor, ledgerSubtypeMatches, todayIso, type CashAccountType } from "./cash.service.js";
import { assertPeriodOpen, postJournalEntry } from "./journal.service.js";

/** Reklassifikatsiya yozuvining manba turi — takroriy ishga tushirishdan yagona indeks himoya qiladi. */
export const CASH_LEDGER_RECLASS = "cash_ledger_reclass";

export type CashLedgerRepairResult = {
  status: "repaired" | "already_repaired" | "nothing_to_repair";
  companyId: string;
  cashAccount: { id: string; name: string; type: CashAccountType; currency: string; balance: string };
  oldLedger: { id: string; code: string; name: string; subtype: string | null } | null;
  newLedger: { id: string; code: string; name: string; subtype: string | null } | null;
  /** Noto'g'ri hisobda qolgan, shu kassadan kelgan satrlar. */
  mispostedLines: number;
  /** Ko'chirilgan summa (doim musbat; 0 bo'lsa yozuv yaratilmaydi). */
  amount: string;
  correction: { entryId: string; number: string; debitAccountId: string; creditAccountId: string } | null;
};

type AccountRow = { id: string; code: string; name: string; subtype: string | null };

async function loadAccount(tx: Tx, companyId: string, accountId: string): Promise<AccountRow> {
  const [row] = await tx
    .select({ id: accounts.id, code: accounts.code, name: accounts.name, subtype: accounts.subtype })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.companyId, companyId)))
    .limit(1);
  if (!row) throw notFound("Buxgalteriya hisobi topilmadi");
  return row;
}

/**
 * Noto'g'ri hisobda turgan, AYNAN shu kassadan kelgan jurnal satrlari.
 *
 * Moslik IKKI kalit bo'yicha, chunki modullar jurnalga har xil yozadi:
 *  - hujjatdan kelgan harakat (mijoz to'lovi, ta'minotchidan qaytgan pul, qoldiq to'g'rilash, boshlang'ich qoldiq) —
 *    jurnal `reference_id` = kassa harakatining `reference_id` si. `reference_type` esa BIR XIL EMAS: kassa
 *    harakatida `purchase_return`, jurnalda `purchase_return_refund` — shuning uchun tur bo'yicha solishtirilmaydi;
 *  - qo'lda kassa kirim/chiqimi — jurnal `reference_type` = `cash_transaction`, `reference_id` = harakatning O'Z id'si.
 *
 * Faqat noto'g'ri hisobdagi satr olinadi, qarshi tomoni (masalan 1100 debitor) tegilmaydi.
 */
async function findMispostedLines(tx: Tx, companyId: string, cashAccountId: string, ledgerAccountId: string) {
  const movements = await tx
    .select({ id: cashTransactions.id, referenceId: cashTransactions.referenceId })
    .from(cashTransactions)
    .where(eq(cashTransactions.cashAccountId, cashAccountId));
  const keys = [...new Set(movements.flatMap((m) => (m.referenceId ? [m.id, m.referenceId] : [m.id])))];
  if (!keys.length) return [];

  return tx
    .select({ id: journalLines.id, entryId: journalLines.entryId, debit: journalLines.debit, credit: journalLines.credit })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(
      and(
        eq(journalLines.accountId, ledgerAccountId),
        eq(journalEntries.companyId, companyId),
        ne(journalEntries.status, "voided"),
        isNotNull(journalEntries.referenceId),
        inArray(journalEntries.referenceId, keys),
      ),
    );
}

/**
 * Kassa ↔ hisob bog'lanishini to'g'rilaydi va noto'g'ri hisobga tushgan summani reklassifikatsiya yozuvi bilan
 * ko'chiradi. HAMMASI chaqiruvchi ochgan BITTA tranzaksiyada: biror qadam xato bersa, hammasi rollback bo'ladi.
 *
 * `targetLedgerAccountId`: `null` — bog'lanish olib tashlanadi (kassa turi bo'yicha umumiy 1010/1020 ishlatiladi).
 */
export async function repairCashLedgerMapping(
  tx: Tx,
  params: {
    companyId: string;
    cashAccountId: string;
    targetLedgerAccountId: string | null;
    reason: string;
    actor: { userId: string | null; userName: string };
    entryDate?: string;
  },
): Promise<CashLedgerRepairResult> {
  const { companyId, cashAccountId, targetLedgerAccountId, reason } = params;

  // Kassa qatorini qulflaymiz: parallel tuzatish yoki bir vaqtdagi tahrir ikki marta yozmasin
  const [cash] = await tx
    .select({
      id: cashAccounts.id,
      name: cashAccounts.name,
      type: cashAccounts.type,
      currency: cashAccounts.currency,
      balance: cashAccounts.balance,
      ledgerAccountId: cashAccounts.ledgerAccountId,
    })
    .from(cashAccounts)
    .where(and(eq(cashAccounts.id, cashAccountId), eq(cashAccounts.companyId, companyId)))
    .limit(1)
    .for("update");
  if (!cash) throw notFound("Kassa topilmadi");

  const cashInfo = { id: cash.id, name: cash.name, type: cash.type, currency: cash.currency, balance: cash.balance };

  // 1. Allaqachon tuzatilganmi — yagona indeks ham himoya qiladi, lekin javobni aniq qaytaramiz
  const [existing] = await tx
    .select({ id: journalEntries.id, number: journalEntries.number })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, companyId),
        eq(journalEntries.referenceType, CASH_LEDGER_RECLASS),
        eq(journalEntries.referenceId, cashAccountId),
        ne(journalEntries.status, "voided"),
      ),
    )
    .limit(1);
  if (existing) {
    const current = cash.ledgerAccountId ? await loadAccount(tx, companyId, cash.ledgerAccountId) : null;
    // Tuzatilgan, lekin bog'lanish YANA buzilgan: yagona indeks ikkinchi reklass yozuviga yo'l qo'ymaydi, shuning
    // uchun jimgina "tuzatilgan" deb qaytarish xato bo'lardi — odam aralashuvi kerak
    if (current && !ledgerSubtypeMatches(cash.type, current.subtype)) {
      throw badRequest(
        `"${cash.name}" kassasi allaqachon tuzatilgan (${existing.number}), lekin bog'lanish yana "${current.code} ${current.name}" ga o'zgartirilgan — qo'lda tekshiring`,
        { reason: "repaired_but_remapped", cashAccountId, correctionEntryId: existing.id, ledgerAccountId: current.id },
      );
    }
    return {
      status: "already_repaired",
      companyId,
      cashAccount: cashInfo,
      oldLedger: null,
      newLedger: current,
      mispostedLines: 0,
      amount: "0",
      correction: null,
    };
  }

  // 2. Hozirgi bog'lanish turiga mos bo'lsa — tuzatadigan narsa yo'q (Ezo'ning ikkinchi ishga tushishi shu yo'ldan)
  const old = cash.ledgerAccountId ? await loadAccount(tx, companyId, cash.ledgerAccountId) : null;
  if (!old || ledgerSubtypeMatches(cash.type, old.subtype)) {
    return {
      status: "nothing_to_repair",
      companyId,
      cashAccount: cashInfo,
      oldLedger: old,
      newLedger: old,
      mispostedLines: 0,
      amount: "0",
      correction: null,
    };
  }

  // 3. Nishon hisob kassa turiga mos bo'lsin (null — umumiy 1010/1020)
  if (targetLedgerAccountId) await assertLedgerAccount(tx, companyId, targetLedgerAccountId, cash.type);

  // 4. Noto'g'ri hisobda qolgan satrlar — bog'lanish o'zgartirilishidan OLDIN topiladi
  const lines = await findMispostedLines(tx, companyId, cashAccountId, old.id);
  let netMinor = 0n;
  for (const line of lines) netMinor += toMinor(line.debit) - toMinor(line.credit);

  // 5. Bog'lanishni to'g'rilash
  await tx
    .update(cashAccounts)
    .set({ ledgerAccountId: targetLedgerAccountId, updatedAt: new Date() })
    .where(and(eq(cashAccounts.id, cashAccountId), eq(cashAccounts.companyId, companyId)));

  // Bog'lanishdan keyingi HAQIQIY hisob (null bo'lsa turi bo'yicha umumiy 1010/1020)
  const newLedgerId = await ledgerAccountFor(tx, companyId, { type: cash.type, ledgerAccountId: targetLedgerAccountId });
  const newLedger = await loadAccount(tx, companyId, newLedgerId);
  if (newLedger.id === old.id) throw badRequest("Yangi hisob eskisi bilan bir xil — tuzatish ma'nosiz");

  // 6. Reklassifikatsiya yozuvi (summa 0 bo'lsa — faqat bog'lanish to'g'rilanadi)
  let correction: CashLedgerRepairResult["correction"] = null;
  if (netMinor !== 0n) {
    const entryDate = params.entryDate ?? todayIso();
    await assertPeriodOpen(tx, companyId, entryDate);
    const amount = fromMinor(netMinor < 0n ? -netMinor : netMinor);
    // net > 0: eski hisob ortiqcha DEBET olgan → yangisiga debet, eskisiga kredit. net < 0 — teskarisi.
    const debitAccountId = netMinor > 0n ? newLedger.id : old.id;
    const creditAccountId = netMinor > 0n ? old.id : newLedger.id;
    const { entry } = await postJournalEntry(tx, companyId, params.actor.userId, {
      entryDate,
      description: `Tuzatish: "${cash.name}" kassasi tushumi ${old.code} o'rniga ${newLedger.code} hisobiga (bog'lanish xato edi)`,
      referenceType: CASH_LEDGER_RECLASS,
      referenceId: cashAccountId,
      notes: reason,
      lines: [
        { accountId: debitAccountId, debit: amount, description: `Tuzatish: ${cash.name}` },
        { accountId: creditAccountId, credit: amount, description: `Tuzatish: ${cash.name}` },
      ],
    });
    correction = { entryId: entry.id, number: entry.number, debitAccountId, creditAccountId };
  }

  // 7. Audit izi — kim, qachon, qaysi kassa, eski/yangi hisob, summa, sabab, tuzatuvchi yozuv
  await writeAuditLog(
    {
      companyId,
      userId: params.actor.userId,
      userName: params.actor.userName,
      action: "CASH_LEDGER_REPAIRED",
      resource: "cash_accounts",
      resourceId: cashAccountId,
      severity: "warning",
      details: {
        cashAccountName: cash.name,
        cashAccountType: cash.type,
        oldLedger: { id: old.id, code: old.code, name: old.name, subtype: old.subtype },
        newLedger: { id: newLedger.id, code: newLedger.code, name: newLedger.name, subtype: newLedger.subtype },
        mispostedLines: lines.length,
        amount: fromMinor(netMinor < 0n ? -netMinor : netMinor),
        reason,
        correctionEntryId: correction?.entryId ?? null,
        correctionEntryNumber: correction?.number ?? null,
      },
    },
    tx,
  );

  return {
    status: "repaired",
    companyId,
    cashAccount: cashInfo,
    oldLedger: old,
    newLedger,
    mispostedLines: lines.length,
    amount: fromMinor(netMinor < 0n ? -netMinor : netMinor),
    correction,
  };
}

/** Tuzatish kerak bo'lgan kassalar ro'yxati (faqat o'qish) — CLI shu bilan nima qilishini oldindan ko'rsatadi. */
export async function findMismatchedCashAccounts(tx: Tx, companyId?: string) {
  const rows = await tx
    .select({
      companyId: cashAccounts.companyId,
      cashAccountId: cashAccounts.id,
      cashAccountName: cashAccounts.name,
      cashAccountType: cashAccounts.type,
      ledgerAccountId: accounts.id,
      ledgerCode: accounts.code,
      ledgerName: accounts.name,
      ledgerSubtype: accounts.subtype,
    })
    .from(cashAccounts)
    .innerJoin(accounts, eq(accounts.id, cashAccounts.ledgerAccountId))
    .where(companyId ? eq(cashAccounts.companyId, companyId) : sql`true`);
  return rows.filter((row) => !ledgerSubtypeMatches(row.cashAccountType, row.ledgerSubtype));
}
