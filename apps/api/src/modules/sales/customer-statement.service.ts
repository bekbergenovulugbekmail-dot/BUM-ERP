/**
 * MIJOZ HISOB-KITOBI (akt), ISTALGAN SANADAGI QARZ va OYMA-OY AYLANMA — audit AUD-005, topshiriqning 1-bo'limi.
 *
 * YAGONA MANBA — buxgalteriya jurnali: debitor (1100) va mijoz avansi (2300) hisoblari qatorlari, kontragent = mijoz
 * (`journal_lines.party_*`, migratsiya 0087). Alohida "qarzdorlik bazasi" YO'Q va qo'lda yuritilmaydi: sotuv, to'lov,
 * qaytarish, pul qaytarish, hamyon, keshbek, tuzatish va bekor qilish — hammasi jurnalda bor, shuning uchun:
 *   - istalgan sanadagi qarz = shu sanagacha bo'lgan qatorlar yig'indisi;
 *   - bekor qilingan operatsiya teskari yozuv bilan qaytgani uchun tarix o'zgarmaydi, yakuniy qoldiq esa to'g'ri;
 *   - `customers.total_debt` (kesh) har doim shu natija bilan solishtiriladi (`reconciliation`).
 *
 * Qarz belgisi: musbat — mijoz bizga qarzdor; manfiy — biz mijozga qarzdormiz (avans/ortiqcha to'lov).
 * Hamyon (2300) alohida ustun: mijozning oldindan qo'ygan puli.
 */
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { badRequest } from "@bum/shared";
import { users } from "../../db/schema/platform.js";
import { accounts, journalEntries, journalLines } from "../../db/schema/finance.js";
import {
  customerBalanceTransactions,
  customerCashbackTransactions,
  customerPayments,
  customers,
  salesOrders,
  salesReturns,
} from "../../db/schema/sales.js";
import type { DbOrTx } from "../../db/transaction.js";
import { fromMinor, toMinor } from "../../shared/decimal.js";
import type { TenantContext } from "../company/tenant.js";
import { todayIso } from "../finance/cash.service.js";
import { getCustomer } from "./customers.service.js";
import { dueDateSql, netAmountSql, openCondition } from "./receivables.service.js";

/** Egasi so'ragan qarz yoshi guruhlari (kun, muddatdan keyin). */
export const STATEMENT_AGING = ["not_due", "d0_7", "d8_30", "d31_60", "d61_90", "d90_plus"] as const;
export type StatementAgingBucket = (typeof STATEMENT_AGING)[number];

export function statementBucketOf(daysOverdue: number): StatementAgingBucket {
  if (daysOverdue <= 0) return "not_due";
  if (daysOverdue <= 7) return "d0_7";
  if (daysOverdue <= 30) return "d8_30";
  if (daysOverdue <= 60) return "d31_60";
  if (daysOverdue <= 90) return "d61_90";
  return "d90_plus";
}

const DEBT_SUBTYPES = ["receivable", "customer_advance"] as const;

/** Jurnal referens turi → foydalanuvchiga tushunarli operatsiya turi. */
export function operationKind(referenceType: string | null): { kind: string; label: string } {
  const type = referenceType ?? "";
  if (type === "sales_order") return { kind: "sale", label: "Sotuv" };
  if (type === "sales_return") return { kind: "return", label: "Qaytarish" };
  if (type.startsWith("sales_refund") || type.startsWith("sales_return_refund")) return { kind: "refund", label: "Pul qaytarildi" };
  if (type === "customer_payment") return { kind: "payment", label: "To'lov" };
  if (type === "customer_payment_reversal") return { kind: "payment_reversal", label: "To'lov bekor qilindi" };
  if (type === "customer_balance") return { kind: "wallet", label: "Hamyon harakati" };
  if (type === "cashback") return { kind: "cashback", label: "Keshbek" };
  if (type === "customer_debt_adjustment" || type === "customer_balance_adjustment") return { kind: "adjustment", label: "Tuzatish" };
  if (type === "customer_opening_balance") return { kind: "opening", label: "Boshlang'ich qoldiq" };
  return { kind: "other", label: type || "Boshqa" };
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "naqd", card: "karta", bank: "bank", transfer: "o'tkazma", balance: "hamyondan", cashback: "keshbekdan",
};

export type StatementLine = {
  date: string;
  entryId: string;
  entryNumber: string;
  kind: string;
  label: string;
  /** Manba hujjat: raqami va turi (sotuv, to'lov, qaytarish…). */
  document: { type: string | null; id: string | null; number: string | null; orderNumber: string | null; status: string | null };
  description: string;
  /** Qarz oshdi (sotuv, pul qaytarish, to'lov bekor qilindi). */
  debit: string;
  /** Qarz kamaydi (to'lov, qaytarish). */
  credit: string;
  /** Operatsiyadan keyingi qarz. */
  balance: string;
  /** Hamyon (avans) o'zgarishi: + mijoz pul qo'ydi, − hamyondan ishlatildi. */
  walletChange: string;
  walletBalance: string;
  createdBy: string | null;
  createdAt: string;
};

type RawLine = {
  entryId: string;
  entryNumber: string;
  entryDate: string;
  description: string;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: Date;
  createdBy: string | null;
  subtype: string | null;
  debit: string;
  credit: string;
};

/** Mijoz subhisobining xom qatorlari (bekor qilinmagan yozuvlar), `to` gacha. */
async function rawLines(conn: DbOrTx, companyId: string, customerId: string, to: string): Promise<RawLine[]> {
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
      subtype: accounts.subtype,
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
        eq(journalLines.partyType, "customer"),
        eq(journalLines.partyId, customerId),
        inArray(accounts.subtype, [...DEBT_SUBTYPES]),
        eq(journalEntries.status, "posted"),
        lte(journalEntries.entryDate, to),
      ),
    )
    .orderBy(asc(journalEntries.entryDate), asc(journalEntries.createdAt), asc(journalEntries.number));
}

/** Qarz (debitor DR−CR) va hamyon (avans CR−DR) o'zgarishi — bitta qatordan. */
const effectOf = (line: RawLine) => {
  const debit = toMinor(line.debit);
  const credit = toMinor(line.credit);
  return line.subtype === "receivable" ? { debt: debit - credit, wallet: 0n } : { debt: 0n, wallet: credit - debit };
};

/** Manba hujjatlarning raqami va holati — bitta so'rov bilan har tur uchun. */
async function resolveDocuments(conn: DbOrTx, companyId: string, lines: RawLine[]) {
  const ids = [...new Set(lines.map((line) => line.referenceId).filter((id): id is string => Boolean(id)))];
  const docs = new Map<string, StatementLine["document"]>();
  if (ids.length === 0) return docs;
  const orders = await conn
    .select({ id: salesOrders.id, number: salesOrders.number, status: salesOrders.status })
    .from(salesOrders)
    .where(and(eq(salesOrders.companyId, companyId), inArray(salesOrders.id, ids)));
  for (const row of orders) docs.set(row.id, { type: "sales_order", id: row.id, number: row.number, orderNumber: row.number, status: row.status });
  const returns = await conn
    .select({ id: salesReturns.id, number: salesReturns.number, orderNumber: salesOrders.number })
    .from(salesReturns)
    .innerJoin(salesOrders, eq(salesOrders.id, salesReturns.orderId))
    .where(and(eq(salesReturns.companyId, companyId), inArray(salesReturns.id, ids)));
  for (const row of returns) docs.set(row.id, { type: "sales_return", id: row.id, number: row.number, orderNumber: row.orderNumber, status: null });
  const payments = await conn
    .select({
      id: customerPayments.id,
      method: customerPayments.method,
      reference: customerPayments.reference,
      status: customerPayments.status,
      orderNumber: salesOrders.number,
    })
    .from(customerPayments)
    .leftJoin(salesOrders, eq(salesOrders.id, customerPayments.orderId))
    .where(and(eq(customerPayments.companyId, companyId), inArray(customerPayments.id, ids)));
  for (const row of payments) {
    docs.set(row.id, {
      type: "customer_payment",
      id: row.id,
      number: `${PAYMENT_METHOD_LABELS[row.method] ?? row.method}${row.reference ? ` · ${row.reference}` : ""}`,
      orderNumber: row.orderNumber,
      status: row.status,
    });
  }
  const wallet = await conn
    .select({ id: customerBalanceTransactions.id, type: customerBalanceTransactions.type })
    .from(customerBalanceTransactions)
    .where(and(eq(customerBalanceTransactions.companyId, companyId), inArray(customerBalanceTransactions.id, ids)));
  for (const row of wallet) docs.set(row.id, { type: "customer_balance", id: row.id, number: row.type, orderNumber: null, status: null });
  const cashback = await conn
    .select({ id: customerCashbackTransactions.id, type: customerCashbackTransactions.type })
    .from(customerCashbackTransactions)
    .where(and(eq(customerCashbackTransactions.companyId, companyId), inArray(customerCashbackTransactions.id, ids)));
  for (const row of cashback) docs.set(row.id, { type: "cashback", id: row.id, number: row.type, orderNumber: null, status: null });
  return docs;
}

const monthOf = (date: string) => date.slice(0, 7);

function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  let [year, month] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))];
  const end = monthOf(to);
  for (let guard = 0; guard < 240; guard += 1) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    months.push(key);
    if (key >= end) break;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

/**
 * Mijoz akti: boshlang'ich qoldiq (FROM dan oldin) + har bir operatsiya + yakuniy qoldiq (TO holatiga);
 * oyma-oy aylanma; bugungi ochiq hujjatlar bo'yicha qarz yoshi; kesh bilan solishtirish.
 */
export async function customerStatement(
  conn: DbOrTx,
  tenant: TenantContext,
  customerId: string,
  options: { from?: string; to?: string; responsibleIds?: string[] | null },
) {
  const companyId = tenant.company.id;
  const customer = await getCustomer(conn, tenant, customerId, options.responsibleIds ?? null);
  const to = options.to ?? todayIso();
  const from = options.from ?? `${to.slice(0, 7)}-01`;
  if (from > to) throw badRequest("Boshlanish sanasi tugash sanasidan keyin bo'lmaydi");

  const all = await rawLines(conn, companyId, customerId, to);
  const docs = await resolveDocuments(conn, companyId, all.filter((line) => line.entryDate >= from));

  let openingDebt = 0n;
  let openingWallet = 0n;
  for (const line of all) {
    if (line.entryDate >= from) break;
    const effect = effectOf(line);
    openingDebt += effect.debt;
    openingWallet += effect.wallet;
  }

  // Bitta jurnal yozuvi (masalan, hamyondan to'lov: 2300 va 1100) — akt'da BITTA qator
  const grouped = new Map<string, { line: RawLine; debt: bigint; wallet: bigint }>();
  for (const line of all) {
    if (line.entryDate < from) continue;
    const effect = effectOf(line);
    const current = grouped.get(line.entryId) ?? { line, debt: 0n, wallet: 0n };
    current.debt += effect.debt;
    current.wallet += effect.wallet;
    grouped.set(line.entryId, current);
  }

  let debt = openingDebt;
  let wallet = openingWallet;
  let totalDebit = 0n;
  let totalCredit = 0n;
  const lines: StatementLine[] = [];
  const monthly = new Map<string, { debit: bigint; credit: bigint; walletIn: bigint; walletOut: bigint }>();
  for (const { line, debt: change, wallet: walletChange } of grouped.values()) {
    debt += change;
    wallet += walletChange;
    const debit = change > 0n ? change : 0n;
    const credit = change < 0n ? -change : 0n;
    totalDebit += debit;
    totalCredit += credit;
    const month = monthly.get(monthOf(line.entryDate)) ?? { debit: 0n, credit: 0n, walletIn: 0n, walletOut: 0n };
    month.debit += debit;
    month.credit += credit;
    if (walletChange > 0n) month.walletIn += walletChange;
    else month.walletOut -= walletChange;
    monthly.set(monthOf(line.entryDate), month);
    const { kind, label } = operationKind(line.referenceType);
    lines.push({
      date: line.entryDate,
      entryId: line.entryId,
      entryNumber: line.entryNumber,
      kind,
      label,
      document: (line.referenceId ? docs.get(line.referenceId) : undefined) ?? { type: line.referenceType, id: line.referenceId, number: null, orderNumber: null, status: null },
      description: line.description,
      debit: fromMinor(debit),
      credit: fromMinor(credit),
      balance: fromMinor(debt),
      walletChange: fromMinor(walletChange),
      walletBalance: fromMinor(wallet),
      createdBy: line.createdBy,
      createdAt: line.createdAt.toISOString(),
    });
  }

  // Oyma-oy: boshlang'ich + sotuv/oshish − to'lov/kamayish = oy oxiri
  let running = openingDebt;
  const months = monthsBetween(from, to).map((month) => {
    const row = monthly.get(month) ?? { debit: 0n, credit: 0n, walletIn: 0n, walletOut: 0n };
    const opening = running;
    running = opening + row.debit - row.credit;
    return {
      month,
      opening: fromMinor(opening),
      debit: fromMinor(row.debit),
      credit: fromMinor(row.credit),
      closing: fromMinor(running),
    };
  });

  // Hozirgi qarz (bugungacha) — kesh bilan solishtirish uchun
  const currentLines = to >= todayIso() ? all : await rawLines(conn, companyId, customerId, todayIso());
  const currentDebt = currentLines.reduce((sum, line) => sum + effectOf(line).debt, 0n);

  return {
    customer: { id: customer.id, name: customer.name, code: customer.code, phone: customer.phone, paymentTermDays: customer.paymentTermDays },
    from,
    to,
    opening: { debt: fromMinor(openingDebt), wallet: fromMinor(openingWallet) },
    lines,
    totals: { debit: fromMinor(totalDebit), credit: fromMinor(totalCredit) },
    closing: { debt: fromMinor(debt), wallet: fromMinor(wallet) },
    months,
    aging: await customerAging(conn, companyId, customerId, currentDebt),
    reconciliation: {
      ledgerDebt: fromMinor(currentDebt),
      cachedDebt: customer.totalDebt,
      difference: fromMinor(toMinor(customer.totalDebt) - currentDebt),
      ok: toMinor(customer.totalDebt) === currentDebt,
    },
  };
}

/**
 * Qarz yoshi (bugungi ochiq hujjatlar, muddat = hujjat sanasi + to'lov muddati). Hujjatga bog'lanmagan qarz
 * (boshlang'ich qoldiq, tuzatish) alohida ko'rsatiladi — u jurnalda bor, lekin hujjatlar ro'yxatida yo'q.
 */
async function customerAging(conn: DbOrTx, companyId: string, customerId: string, ledgerDebt: bigint) {
  const today = todayIso();
  const rows = await conn
    .select({ id: salesOrders.id, number: salesOrders.number, orderDate: salesOrders.orderDate, dueDate: dueDateSql, net: netAmountSql, paid: salesOrders.paidAmount })
    .from(salesOrders)
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(and(eq(salesOrders.companyId, companyId), eq(salesOrders.customerId, customerId), openCondition))
    .orderBy(asc(salesOrders.orderDate));
  const buckets = Object.fromEntries(STATEMENT_AGING.map((bucket) => [bucket, 0n])) as Record<StatementAgingBucket, bigint>;
  const documents = rows.map((row) => {
    const outstanding = toMinor(row.net) - toMinor(row.paid);
    const days = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${row.dueDate}T00:00:00Z`)) / 86_400_000);
    const bucket = statementBucketOf(days);
    buckets[bucket] += outstanding;
    return { id: row.id, number: row.number, orderDate: row.orderDate, dueDate: row.dueDate, outstanding: fromMinor(outstanding), daysOverdue: Math.max(0, days), bucket };
  });
  const documented = documents.reduce((sum, doc) => sum + toMinor(doc.outstanding), 0n);
  return {
    asOf: today,
    buckets: Object.fromEntries(Object.entries(buckets).map(([key, value]) => [key, fromMinor(value)])) as Record<StatementAgingBucket, string>,
    documents,
    /** Jurnaldagi qarz − ochiq hujjatlar: boshlang'ich qoldiq/tuzatish (yoki hujjatsiz avans, manfiy). */
    undocumented: fromMinor(ledgerDebt - documented),
  };
}

/**
 * Hamma mijozlar: berilgan SANAGA qarz va hamyon (jurnaldan) — "2026-03-01 holatiga kim qancha qarzdor edi".
 * `unassigned` — 1100 hisobidagi mijozga bog'lanmagan qatorlar (eski tuzatishlar) — hisob bilan to'liq solishtirish uchun.
 */
export async function receivablesAsOf(conn: DbOrTx, tenant: TenantContext, options: { date?: string; responsibleIds?: string[] | null; includeZero?: boolean }) {
  const companyId = tenant.company.id;
  const date = options.date ?? todayIso();
  const scope = options.responsibleIds;
  if (scope && scope.length === 0) return { date, customers: [], totals: { debt: "0.00", wallet: "0.00", overpaid: "0.00" }, ledger: null };
  const debtSql = sql<string>`coalesce(sum(case when ${accounts.subtype} = 'receivable' then ${journalLines.debit} - ${journalLines.credit} else 0 end), 0)::numeric(18,2)`;
  const walletSql = sql<string>`coalesce(sum(case when ${accounts.subtype} = 'customer_advance' then ${journalLines.credit} - ${journalLines.debit} else 0 end), 0)::numeric(18,2)`;
  const rows = await conn
    .select({
      customerId: customers.id,
      name: customers.name,
      code: customers.code,
      phone: customers.phone,
      debt: debtSql,
      wallet: walletSql,
      lastOperation: sql<string | null>`max(${journalEntries.entryDate})::text`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .innerJoin(customers, eq(customers.id, journalLines.partyId))
    .where(
      and(
        eq(journalLines.companyId, companyId),
        eq(journalLines.partyType, "customer"),
        inArray(accounts.subtype, [...DEBT_SUBTYPES]),
        eq(journalEntries.status, "posted"),
        lte(journalEntries.entryDate, date),
        scope ? inArray(customers.id, scope) : undefined,
      ),
    )
    .groupBy(customers.id, customers.name, customers.code, customers.phone)
    .orderBy(sql`${debtSql} desc`, asc(customers.name));

  const list = options.includeZero ? rows : rows.filter((row) => toMinor(row.debt) !== 0n || toMinor(row.wallet) !== 0n);
  const debt = list.reduce((sum, row) => sum + (toMinor(row.debt) > 0n ? toMinor(row.debt) : 0n), 0n);
  const overpaid = list.reduce((sum, row) => sum + (toMinor(row.debt) < 0n ? -toMinor(row.debt) : 0n), 0n);
  const wallet = list.reduce((sum, row) => sum + toMinor(row.wallet), 0n);

  // Butun kompaniya (chegara yo'q) — 1100 hisobining o'zi bilan solishtirish
  let ledger: { account1100: string; assigned: string; unassigned: string } | null = null;
  if (!scope) {
    const [total] = await conn
      .select({
        all: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)::numeric(18,2)`,
        unassigned: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}) filter (where ${journalLines.partyId} is null), 0)::numeric(18,2)`,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .where(and(eq(journalLines.companyId, companyId), eq(accounts.subtype, "receivable"), eq(journalEntries.status, "posted"), lte(journalEntries.entryDate, date)));
    ledger = {
      account1100: total!.all,
      assigned: fromMinor(toMinor(total!.all) - toMinor(total!.unassigned)),
      unassigned: total!.unassigned,
    };
  }
  return {
    date,
    customers: list,
    totals: { debt: fromMinor(debt), overpaid: fromMinor(overpaid), wallet: fromMinor(wallet) },
    ledger,
  };
}

/**
 * Oyma-oy tarix: har mijozning har oy OXIRIDAGI qarzi (FROM..TO, ko'pi bilan 24 oy) —
 * "qaysi oygacha qarzdor bo'lgan" savoliga javob.
 */
export async function receivablesHistory(conn: DbOrTx, tenant: TenantContext, options: { from: string; to: string; responsibleIds?: string[] | null }) {
  const companyId = tenant.company.id;
  const months = monthsBetween(options.from, options.to);
  if (months.length > 24) throw badRequest("Ko'pi bilan 24 oy");
  const scope = options.responsibleIds;
  if (scope && scope.length === 0) return { months, customers: [] };
  const monthEnd = (month: string) => {
    const [year, mon] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
    return new Date(Date.UTC(year, mon, 0)).toISOString().slice(0, 10);
  };
  const end = monthEnd(months.at(-1)!);
  const rows = await conn
    .select({
      customerId: customers.id,
      name: customers.name,
      code: customers.code,
      month: sql<string>`to_char(${journalEntries.entryDate}, 'YYYY-MM')`,
      change: sql<string>`sum(${journalLines.debit} - ${journalLines.credit})::numeric(18,2)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .innerJoin(customers, eq(customers.id, journalLines.partyId))
    .where(
      and(
        eq(journalLines.companyId, companyId),
        eq(journalLines.partyType, "customer"),
        eq(accounts.subtype, "receivable"),
        eq(journalEntries.status, "posted"),
        lte(journalEntries.entryDate, end),
        scope ? inArray(customers.id, scope) : undefined,
      ),
    )
    .groupBy(customers.id, customers.name, customers.code, sql`to_char(${journalEntries.entryDate}, 'YYYY-MM')`);

  const byCustomer = new Map<string, { customerId: string; name: string; code: string | null; changes: Map<string, bigint> }>();
  for (const row of rows) {
    const entry = byCustomer.get(row.customerId) ?? { customerId: row.customerId, name: row.name, code: row.code, changes: new Map() };
    entry.changes.set(row.month, toMinor(row.change));
    byCustomer.set(row.customerId, entry);
  }
  const first = months[0]!;
  const result = [...byCustomer.values()].map((entry) => {
    let running = [...entry.changes.entries()].filter(([month]) => month < first).reduce((sum, [, value]) => sum + value, 0n);
    const opening = running;
    const closings = months.map((month) => {
      running += entry.changes.get(month) ?? 0n;
      return { month, closing: fromMinor(running) };
    });
    // Oxirgi marta qachon qarzdor bo'lgan (oy oxiri holatiga)
    const lastInDebt = [...closings].reverse().find((row) => toMinor(row.closing) > 0n)?.month ?? null;
    return { customerId: entry.customerId, name: entry.name, code: entry.code, opening: fromMinor(opening), months: closings, lastInDebt };
  });
  return {
    months,
    customers: result
      .filter((row) => toMinor(row.opening) !== 0n || row.months.some((month) => toMinor(month.closing) !== 0n))
      .sort((a, b) => Number(toMinor(b.months.at(-1)!.closing) - toMinor(a.months.at(-1)!.closing)) || a.name.localeCompare(b.name)),
  };
}

/** Kesh (`customers.total_debt`) ≠ jurnal subhisobi bo'lgan mijozlar — yagona manbadan ajralishni topish uchun. */
export async function customerDebtReconciliation(conn: DbOrTx, tenant: TenantContext) {
  const companyId = tenant.company.id;
  const ledgerSql = sql<string>`coalesce((
    select sum(jl.debit - jl.credit) from ${journalLines} jl
    join ${journalEntries} je on je.id = jl.entry_id
    join ${accounts} a on a.id = jl.account_id
    where jl.company_id = ${companyId} and jl.party_type = 'customer' and jl.party_id = "customers"."id"
      and a.subtype = 'receivable' and je.status = 'posted'
  ), 0)::numeric(18,2)`;
  const rows = await conn
    .select({ customerId: customers.id, name: customers.name, code: customers.code, cachedDebt: customers.totalDebt, ledgerDebt: ledgerSql })
    .from(customers)
    .where(and(eq(customers.companyId, companyId), sql`${customers.totalDebt} <> ${ledgerSql}`))
    .orderBy(asc(customers.name))
    .limit(500);
  return {
    mismatches: rows.map((row) => ({ ...row, difference: fromMinor(toMinor(row.cachedDebt) - toMinor(row.ledgerDebt)) })),
  };
}
