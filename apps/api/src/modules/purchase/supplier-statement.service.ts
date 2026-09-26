/**
 * TA'MINOTCHI BILAN SOLISHTIRISH AKTI (audit AUD-020) — mijoz aktining ta'minotchi tomoni.
 *
 * YAGONA MANBA — buxgalteriya jurnali: kreditorlar (2000) qatorlari, kontragent = ta'minotchi (`journal_lines.party_*`,
 * migratsiya 0087). Xarid qabuli, to'lov, qaytarish, pul qaytishi, kurs farqi, tuzatish va bekor qilish — hammasi
 * jurnalda, shuning uchun istalgan sanadagi qarz = shu sanagacha qatorlar yig'indisi, `suppliers.total_debt` (kesh)
 * esa shu natija bilan solishtiriladi. Summalar asosiy valyutada (kitob qiymati); valyuta bo'yicha qoldiq alohida.
 *
 * Qarz belgisi: musbat — biz ta'minotchiga qarzdormiz; manfiy — ta'minotchi bizga (avans/ortiqcha to'lov).
 */
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { badRequest, notFound } from "@bum/shared";
import { accounts, journalEntries, journalLines } from "../../db/schema/finance.js";
import { users } from "../../db/schema/platform.js";
import { purchaseOrders, purchaseReceipts, purchaseReturns, supplierBalances, supplierPayments, suppliers } from "../../db/schema/purchase.js";
import type { DbOrTx } from "../../db/transaction.js";
import { fromMinor, toMinor } from "../../shared/decimal.js";
import type { TenantContext } from "../company/tenant.js";
import { todayIso } from "../finance/cash.service.js";

export function supplierOperationKind(referenceType: string | null): { kind: string; label: string } {
  const type = referenceType ?? "";
  if (type === "purchase_receipt") return { kind: "receipt", label: "Xarid qabuli" };
  if (type === "supplier_payment") return { kind: "payment", label: "To'lov" };
  if (type.startsWith("supplier_payment_reversal")) return { kind: "payment_reversal", label: "To'lov bekor qilindi" };
  if (type === "purchase_return") return { kind: "return", label: "Ta'minotchiga qaytarish" };
  if (type === "purchase_return_refund") return { kind: "refund", label: "Qaytarishdan pul qaytdi" };
  if (type === "supplier_fx") return { kind: "fx", label: "Kurs farqi" };
  if (type === "supplier_debt_adjustment") return { kind: "adjustment", label: "Tuzatish" };
  if (type === "supplier_opening_balance") return { kind: "opening", label: "Boshlang'ich qoldiq" };
  return { kind: "other", label: type || "Boshqa" };
}

type RawLine = {
  entryId: string;
  entryNumber: string;
  entryDate: string;
  description: string;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: Date;
  createdBy: string | null;
  debit: string;
  credit: string;
};

async function rawLines(conn: DbOrTx, companyId: string, supplierId: string, to: string): Promise<RawLine[]> {
  return conn
    .select({
      entryId: journalEntries.id,
      entryNumber: journalEntries.number,
      entryDate: journalEntries.entryDate,
      description: journalEntries.description,
      referenceType: journalEntries.referenceType,
      referenceId: journalEntries.referenceId,
      createdAt: journalEntries.createdAt,
      createdBy: users.name,
      debit: journalLines.debit,
      credit: journalLines.credit,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .leftJoin(users, eq(users.id, journalEntries.createdBy))
    .where(
      and(
        eq(journalLines.companyId, companyId),
        eq(journalLines.partyType, "supplier"),
        eq(journalLines.partyId, supplierId),
        eq(accounts.subtype, "payable"),
        eq(journalEntries.status, "posted"),
        lte(journalEntries.entryDate, to),
      ),
    )
    .orderBy(asc(journalEntries.entryDate), asc(journalEntries.createdAt), asc(journalEntries.id));
}

/** Kreditor qatori ta'siri: kredit — qarz oshdi, debet — kamaydi. */
const effectOf = (line: RawLine) => toMinor(line.credit) - toMinor(line.debit);

async function documentNumbers(conn: DbOrTx, companyId: string, lines: RawLine[]) {
  const ids = [...new Set(lines.map((line) => line.referenceId).filter((id): id is string => Boolean(id)))];
  const docs = new Map<string, string>();
  if (ids.length === 0) return docs;
  const receipts = await conn
    .select({ id: purchaseReceipts.id, number: purchaseOrders.number })
    .from(purchaseReceipts)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseReceipts.orderId))
    .where(and(eq(purchaseReceipts.companyId, companyId), inArray(purchaseReceipts.id, ids)));
  for (const row of receipts) docs.set(row.id, row.number);
  const returns = await conn
    .select({ id: purchaseReturns.id, number: purchaseReturns.number })
    .from(purchaseReturns)
    .where(and(eq(purchaseReturns.companyId, companyId), inArray(purchaseReturns.id, ids)));
  for (const row of returns) docs.set(row.id, row.number);
  const payments = await conn
    .select({ id: supplierPayments.id, method: supplierPayments.method, reference: supplierPayments.reference, orderNumber: purchaseOrders.number })
    .from(supplierPayments)
    .leftJoin(purchaseOrders, eq(purchaseOrders.id, supplierPayments.orderId))
    .where(and(eq(supplierPayments.companyId, companyId), inArray(supplierPayments.id, ids)));
  for (const row of payments) docs.set(row.id, [row.method, row.orderNumber, row.reference].filter(Boolean).join(" · "));
  return docs;
}

export async function supplierStatement(conn: DbOrTx, tenant: TenantContext, supplierId: string, options: { from?: string; to?: string }) {
  const companyId = tenant.company.id;
  const [supplier] = await conn
    .select({ id: suppliers.id, name: suppliers.name, code: suppliers.code, phone: suppliers.phone, totalDebt: suppliers.totalDebt })
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.companyId, companyId)))
    .limit(1);
  if (!supplier) throw notFound("Ta'minotchi topilmadi");
  const to = options.to ?? todayIso();
  const from = options.from ?? `${to.slice(0, 7)}-01`;
  if (from > to) throw badRequest("Boshlanish sanasi tugash sanasidan keyin bo'lmaydi");

  const all = await rawLines(conn, companyId, supplier.id, to);
  const docs = await documentNumbers(conn, companyId, all.filter((line) => line.entryDate >= from));

  let opening = 0n;
  const grouped = new Map<string, { line: RawLine; change: bigint }>();
  for (const line of all) {
    if (line.entryDate < from) {
      opening += effectOf(line);
      continue;
    }
    const current = grouped.get(line.entryId) ?? { line, change: 0n };
    current.change += effectOf(line);
    grouped.set(line.entryId, current);
  }

  let balance = opening;
  let increased = 0n;
  let decreased = 0n;
  const lines = [...grouped.values()].map(({ line, change }) => {
    balance += change;
    if (change > 0n) increased += change;
    else decreased -= change;
    const { kind, label } = supplierOperationKind(line.referenceType);
    return {
      date: line.entryDate,
      entryId: line.entryId,
      entryNumber: line.entryNumber,
      kind,
      label,
      document: line.referenceId ? (docs.get(line.referenceId) ?? null) : null,
      description: line.description,
      /** Qarz oshdi (xarid qabuli, to'lov bekor qilindi, kurs farqi −). */
      increase: fromMinor(change > 0n ? change : 0n),
      /** Qarz kamaydi (to'lov, qaytarish). */
      decrease: fromMinor(change < 0n ? -change : 0n),
      balance: fromMinor(balance),
      createdBy: line.createdBy,
    };
  });

  const currentLines = to >= todayIso() ? all : await rawLines(conn, companyId, supplier.id, todayIso());
  const ledgerDebt = currentLines.reduce((sum, line) => sum + effectOf(line), 0n);
  const byCurrency = await conn
    .select({ currency: supplierBalances.currency, debt: supplierBalances.debt, bookValue: supplierBalances.bookValue })
    .from(supplierBalances)
    .where(and(eq(supplierBalances.companyId, companyId), eq(supplierBalances.supplierId, supplier.id)))
    .orderBy(asc(supplierBalances.currency));

  return {
    supplier: { id: supplier.id, name: supplier.name, code: supplier.code, phone: supplier.phone },
    from,
    to,
    opening: fromMinor(opening),
    lines,
    totals: { increase: fromMinor(increased), decrease: fromMinor(decreased) },
    closing: fromMinor(balance),
    byCurrency,
    reconciliation: {
      ledgerDebt: fromMinor(ledgerDebt),
      cachedDebt: supplier.totalDebt,
      difference: fromMinor(toMinor(supplier.totalDebt) - ledgerDebt),
      ok: toMinor(supplier.totalDebt) === ledgerDebt,
    },
  };
}

/** Barcha ta'minotchilar: kesh (`total_debt`) va jurnal subhisobi solishtiruvi — nomuvofiqlar ro'yxati. */
export async function supplierDebtReconciliation(conn: DbOrTx, tenant: TenantContext) {
  const rows = await conn.execute<{ id: string; name: string; cached: string; ledger: string }>(sql`
    with ledger as (
      select jl.party_id, sum(jl.credit - jl.debit) debt
      from ${journalLines} jl
      join ${journalEntries} je on je.id = jl.entry_id
      join ${accounts} a on a.id = jl.account_id
      where jl.company_id = ${tenant.company.id} and a.subtype = 'payable' and je.status = 'posted' and jl.party_type = 'supplier'
      group by 1)
    select s.id, s.name, s.total_debt::text cached, coalesce(l.debt, 0)::numeric(18,2)::text ledger
    from ${suppliers} s left join ledger l on l.party_id = s.id
    where s.company_id = ${tenant.company.id}`);
  const list = rows.rows;
  const mismatched = list.filter((row) => toMinor(row.cached) !== toMinor(row.ledger));
  return { suppliers: list.length, mismatched: mismatched.map((row) => ({ ...row, difference: fromMinor(toMinor(row.cached) - toMinor(row.ledger)) })) };
}
