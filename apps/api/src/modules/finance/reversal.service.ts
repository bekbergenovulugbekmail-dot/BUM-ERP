/**
 * Umumiy BEKOR QILISH qatlami (audit AUD-013): hujjatning kassa harakatlari va jurnal yozuvlarining AYNAN teskarisi.
 *
 * Hech narsa o'chirilmaydi: asl kassa harakati va jurnal yozuvi joyida qoladi, ularga qarama-qarshi yozuv qo'shiladi
 * (kassa — qarama-qarshi yo'nalishda o'sha hisobda, o'sha summa va valyutada; jurnal — debet ↔ kredit, asl summalarda,
 * kontragent bilan). Chaqiruvchi hujjat qatorini `FOR UPDATE` bilan qulflaydi, holatini tekshiradi, sabab va davr
 * qulfini tekshiradi va hujjat holatini `reversed` qiladi — bu yerda faqat pul va buxgalteriya.
 */
import { and, asc, eq } from "drizzle-orm";
import { badRequest } from "@bum/shared";
import { cashAccounts, cashTransactions, journalEntries, journalLines } from "../../db/schema/finance.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { toMinor } from "../../shared/decimal.js";
import { recordCashTransaction, todayIso } from "./cash.service.js";
import { postJournalEntry } from "./journal.service.js";

export type SourceRef = { type: string; id: string };

/** Hujjat kassa harakatlarini qaytarish mumkinmi: kirim teskarisi (chiqim) uchun hisobda pul yetarlimi. */
export async function mirrorBlockers(conn: DbOrTx, companyId: string, refs: SourceRef[]) {
  const blockers: string[] = [];
  for (const ref of refs) {
    const moves = await conn
      .select({ cashAccountId: cashTransactions.cashAccountId, type: cashTransactions.type, amount: cashTransactions.amount })
      .from(cashTransactions)
      .where(and(eq(cashTransactions.companyId, companyId), eq(cashTransactions.referenceType, ref.type), eq(cashTransactions.referenceId, ref.id)));
    for (const move of moves.filter((row) => row.type === "in")) {
      const [account] = await conn.select({ name: cashAccounts.name, balance: cashAccounts.balance }).from(cashAccounts).where(eq(cashAccounts.id, move.cashAccountId)).limit(1);
      if (!account || toMinor(account.balance) < toMinor(move.amount)) {
        blockers.push(`"${account?.name ?? "kassa"}" da yetarli pul yo'q (qoldiq ${account?.balance ?? "0"}, kerak ${move.amount})`);
      }
    }
  }
  return blockers;
}

/**
 * `refs` bo'yicha barcha kassa harakatlari va jurnal yozuvlarining teskarisini yozadi. Teskari yozuvlar
 * (`reversalType`, asl hujjat id si) havolasi bilan — takroriy chaqiruvda kassa harakati takrorlanmaydi.
 * Qaytadi: yaratilgan teskari jurnal yozuvlari id lari.
 */
export async function mirrorReferences(
  tx: Tx,
  companyId: string,
  userId: string,
  input: { refs: SourceRef[]; reversalType: string; label: string; date?: string },
) {
  const date = input.date ?? todayIso();
  const entries: string[] = [];
  for (const ref of input.refs) {
    const moves = await tx
      .select()
      .from(cashTransactions)
      .where(and(eq(cashTransactions.companyId, companyId), eq(cashTransactions.referenceType, ref.type), eq(cashTransactions.referenceId, ref.id)))
      .orderBy(asc(cashTransactions.createdAt));
    // Avval kirimlar teskarisi (chiqim) — pul yetmasa aniq xato va hech narsa yozilmaydi
    for (const move of [...moves.filter((row) => row.type === "in"), ...moves.filter((row) => row.type === "out")]) {
      await recordCashTransaction(tx, companyId, userId, {
        cashAccountId: move.cashAccountId,
        type: move.type === "in" ? "out" : "in",
        amount: move.amount,
        currency: move.currency,
        txDate: date,
        description: input.label,
        category: move.category,
        referenceType: `${input.reversalType}:${ref.type}`.slice(0, 50),
        referenceId: ref.id,
      });
    }

    const originals = await tx
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(and(eq(journalEntries.companyId, companyId), eq(journalEntries.referenceType, ref.type), eq(journalEntries.referenceId, ref.id), eq(journalEntries.status, "posted")));
    for (const original of originals) {
      const lines = await tx.select().from(journalLines).where(eq(journalLines.entryId, original.id));
      if (lines.length === 0) continue;
      const partyLine = lines.find((line) => line.partyType && line.partyId);
      const { entry } = await postJournalEntry(tx, companyId, userId, {
        party: partyLine ? { type: partyLine.partyType as "customer" | "supplier", id: partyLine.partyId! } : null,
        entryDate: date,
        description: input.label,
        referenceType: `${input.reversalType}:${ref.type}`.slice(0, 50),
        referenceId: ref.id,
        lines: lines.map((line) => ({
          accountId: line.accountId,
          ...(toMinor(line.debit) > 0n ? { credit: line.debit } : { debit: line.credit }),
          ...(line.description ? { description: line.description } : {}),
        })),
      });
      entries.push(entry.id);
    }
  }
  if (input.refs.length > 0 && entries.length === 0) {
    // Jurnalsiz hujjat (eski import) — pul qaytdi, lekin buxgalteriya yozuvi topilmadi: bu holat aniq ko'rinsin
    throw badRequest("Hujjatning buxgalteriya yozuvi topilmadi — bekor qilish uchun moliya bo'limiga murojaat qiling");
  }
  return entries;
}
