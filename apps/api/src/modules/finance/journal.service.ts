/**
 * Buxgalteriya jurnali (convex/finance/journalHelper.ts).
 *
 * `postJournalEntry` — jurnalga yozishning YAGONA yo'li; xarid, savdo, POS va
 * xarajatlar shuni chaqiradi. Qoidalar:
 *  - debet = kredit ANIQ (butun tiyinlarda; Convex float bilan ±1 so'm farqqa yo'l qo'yardi)
 *  - har qatorda debet yoki kreditdan faqat bittasi; kamida 2 qator
 *  - hisoblar shu kompaniyaniki va faol
 *  - bir hujjatga (referenceType + referenceId) bitta amaldagi yozuv — takroriy chaqiruv
 *    mavjudini qaytaradi; baza darajasida unique indeks ham bor
 *  - baza darajasida: kechiktirilgan trigger tranzaksiya oxirida balansni tekshiradi (0005)
 *  - hisob balanslari hisob turining normal tomonida yangilanadi, qulflar doimiy tartibda
 *
 * Bekor qilingan yozuv o'chirilmaydi — `voided` holatiga o'tadi, balanslar qaytariladi.
 */
import { and, asc, desc, eq, getTableColumns, gte, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { badRequest, notFound } from "@bum/shared";
import { accounts, cashAccounts, journalEntries, journalLines } from "../../db/schema/finance.js";
import { settings } from "../../db/schema/platform.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { UUID_RE, decodeCursor, encodeCursor } from "../../shared/cursor.js";
import { fromMinor, toMinor } from "../../shared/decimal.js";
import { nextDocumentNumber } from "../../shared/numbering.js";
import { upsertCompanySetting } from "../company/settings.service.js";
import type { TenantContext } from "../company/tenant.js";
import { DEFAULT_ACCOUNTS, companyCurrency, financeAudit, type AccountType } from "./accounts.service.js";

const { legacyId: _l1, companyId: _c1, ...entryFields } = getTableColumns(journalEntries);
const { legacyId: _l2, companyId: _c2, ...lineFields } = getTableColumns(journalLines);

export type JournalStatus = (typeof journalEntries.status.enumValues)[number];

export type JournalLineInput = {
  accountId: string;
  debit?: string;
  credit?: string;
  description?: string | null;
};

export type JournalParty = { type: "customer" | "supplier"; id: string };

export type JournalEntryInput = {
  entryDate: string;
  description: string;
  referenceType?: string | null;
  referenceId?: string | null;
  notes?: string | null;
  /**
   * Kontragent. Yozuvning shu kontragent turiga tegishli NAZORAT hisobi qatorlariga yoziladi:
   * mijoz — debitor (1100), mijoz avansi (2300), keshbek (2400); ta'minotchi — kreditor (2000).
   * Mijoz qarzi, akt va istalgan sanadagi qoldiq shu qatorlardan hisoblanadi.
   */
  party?: JournalParty | null;
  lines: JournalLineInput[];
};

/** Kontragent turiga tegishli nazorat hisoblari (subtype). */
export const PARTY_SUBTYPES: Record<JournalParty["type"], ReadonlySet<string>> = {
  customer: new Set(["receivable", "customer_advance", "cashback_liability"]),
  supplier: new Set(["payable"]),
};

export async function findAccountBySubtype(conn: DbOrTx, companyId: string, subtype: string, type?: AccountType) {
  const [account] = await conn
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.companyId, companyId),
        eq(accounts.subtype, subtype),
        eq(accounts.isActive, true),
        type ? eq(accounts.type, type) : undefined,
      ),
    )
    .orderBy(asc(accounts.code))
    .limit(1);
  return account?.id ?? null;
}

export async function requireAccountBySubtype(
  conn: DbOrTx,
  companyId: string,
  subtype: string,
  type: AccountType,
  label: string,
) {
  const id = await findAccountBySubtype(conn, companyId, subtype, type);
  if (!id) throw badRequest(`Hisoblar rejasida "${label}" hisobi yo'q — moliya sozlamalarini tekshiring`);
  return id;
}

/**
 * Keyinroq qo'shilgan standart hisob (2300 avanslar, 2400/5600 keshbek) eski kompaniyada bo'lmasa — shu yerda
 * ochiladi. Kod band bo'lsa (foydalanuvchi o'zi shu kod bilan hisob ochgan) — aniq xato.
 */
export async function ensureAccountBySubtype(tx: Tx, companyId: string, subtype: string) {
  const definition = DEFAULT_ACCOUNTS.find((account) => account.subtype === subtype);
  if (!definition) throw new Error(`Standart hisob ta'riflanmagan: ${subtype}`);
  const existing = await findAccountBySubtype(tx, companyId, subtype, definition.type);
  if (existing) return existing;
  await tx
    .insert(accounts)
    .values({ ...definition, companyId, currency: await companyCurrency(tx, companyId) })
    .onConflictDoNothing();
  return requireAccountBySubtype(tx, companyId, subtype, definition.type, definition.name);
}

async function applyBalances(
  tx: Tx,
  companyId: string,
  lines: { accountId: string; debit: bigint; credit: bigint }[],
  direction: 1n | -1n,
) {
  const ids = [...new Set(lines.map((l) => l.accountId))];
  const types = await tx
    .select({ id: accounts.id, type: accounts.type })
    .from(accounts)
    .where(and(eq(accounts.companyId, companyId), inArray(accounts.id, ids)));
  const typeOf = new Map(types.map((t) => [t.id, t.type]));

  const deltas = new Map<string, bigint>();
  for (const line of lines) {
    const type = typeOf.get(line.accountId);
    const normal = type === "asset" || type === "expense" ? line.debit - line.credit : line.credit - line.debit;
    deltas.set(line.accountId, (deltas.get(line.accountId) ?? 0n) + normal * direction);
  }

  // Parallel yozuvlar bir-birini kutadi, lekin deadlock bermaydi
  for (const accountId of [...deltas.keys()].sort()) {
    const delta = deltas.get(accountId)!;
    if (delta === 0n) continue;
    await tx
      .update(accounts)
      .set({ balance: sql`${accounts.balance} + ${fromMinor(delta)}::numeric`, updatedAt: new Date() })
      .where(eq(accounts.id, accountId));
  }
}

export async function postJournalEntry(tx: Tx, companyId: string, createdBy: string | null, input: JournalEntryInput) {
  if (input.referenceType && input.referenceId) {
    const [existing] = await tx
      .select(entryFields)
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.companyId, companyId),
          eq(journalEntries.referenceType, input.referenceType),
          eq(journalEntries.referenceId, input.referenceId),
          ne(journalEntries.status, "voided"),
        ),
      )
      .limit(1);
    if (existing) return { entry: existing, created: false };
  }

  if (input.lines.length < 2) throw badRequest("Buxgalteriya yozuvida kamida 2 ta qator bo'lishi kerak");
  const parsed = input.lines.map((line, i) => {
    const debit = toMinor(line.debit ?? "0");
    const credit = toMinor(line.credit ?? "0");
    if (debit < 0n || credit < 0n || (debit === 0n) === (credit === 0n)) {
      throw badRequest(`${i + 1}-qator: debet yoki kreditdan faqat bittasi musbat bo'lishi kerak`);
    }
    return { accountId: line.accountId, description: line.description ?? null, debit, credit };
  });

  const totalDebit = parsed.reduce((s, l) => s + l.debit, 0n);
  const totalCredit = parsed.reduce((s, l) => s + l.credit, 0n);
  if (totalDebit !== totalCredit) {
    throw badRequest(`Yozuv balanslanmagan: debet ${fromMinor(totalDebit)} ≠ kredit ${fromMinor(totalCredit)}`);
  }

  const accountIds = [...new Set(parsed.map((l) => l.accountId))];
  const found = await tx
    .select({ id: accounts.id, isActive: accounts.isActive, subtype: accounts.subtype })
    .from(accounts)
    .where(and(eq(accounts.companyId, companyId), inArray(accounts.id, accountIds)));
  if (found.length !== accountIds.length) throw badRequest("Hisob topilmadi");
  if (found.some((a) => !a.isActive)) throw badRequest("Hisob faol emas");
  const subtypeOf = new Map(found.map((a) => [a.id, a.subtype]));
  const partyFor = (accountId: string) => {
    const party = input.party;
    if (!party) return { partyType: null, partyId: null };
    const subtype = subtypeOf.get(accountId);
    return subtype && PARTY_SUBTYPES[party.type].has(subtype)
      ? { partyType: party.type, partyId: party.id }
      : { partyType: null, partyId: null };
  };

  const number = await nextDocumentNumber(tx, {
    table: journalEntries,
    column: journalEntries.number,
    companyColumn: journalEntries.companyId,
    companyId,
    prefix: `JE-${input.entryDate.slice(0, 4)}-`,
    width: 5,
  });

  const [entry] = await tx
    .insert(journalEntries)
    .values({
      companyId,
      number,
      entryDate: input.entryDate,
      description: input.description,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      notes: input.notes ?? null,
      status: "posted",
      totalDebit: fromMinor(totalDebit),
      totalCredit: fromMinor(totalCredit),
      createdBy,
    })
    .returning(entryFields);

  await tx.insert(journalLines).values(
    parsed.map((l) => ({
      companyId,
      entryId: entry!.id,
      accountId: l.accountId,
      debit: fromMinor(l.debit),
      credit: fromMinor(l.credit),
      description: l.description,
      ...partyFor(l.accountId),
    })),
  );
  await applyBalances(tx, companyId, parsed, 1n);

  return { entry: entry!, created: true };
}

export async function voidJournalEntry(tx: Tx, companyId: string, entryId: string, voidedBy: string | null) {
  const [entry] = await tx
    .select(entryFields)
    .from(journalEntries)
    .where(and(eq(journalEntries.id, entryId), eq(journalEntries.companyId, companyId)))
    .limit(1)
    .for("update");
  if (!entry) throw notFound("Buxgalteriya yozuvi topilmadi");
  if (entry.status === "voided") throw badRequest("Yozuv allaqachon bekor qilingan");

  if (entry.status === "posted") {
    const lines = await tx
      .select({ accountId: journalLines.accountId, debit: journalLines.debit, credit: journalLines.credit })
      .from(journalLines)
      .where(eq(journalLines.entryId, entryId));
    await applyBalances(
      tx,
      companyId,
      lines.map((l) => ({ accountId: l.accountId, debit: toMinor(l.debit), credit: toMinor(l.credit) })),
      -1n,
    );
  }

  const [updated] = await tx
    .update(journalEntries)
    .set({ status: "voided", voidedAt: new Date(), voidedBy, updatedAt: new Date() })
    .where(eq(journalEntries.id, entryId))
    .returning(entryFields);
  return updated!;
}

// ─── API ─────────────────────────────────────────────────────────────────────

export async function getJournalEntry(conn: DbOrTx, tenant: TenantContext, entryId: string) {
  const [entry] = await conn
    .select(entryFields)
    .from(journalEntries)
    .where(and(eq(journalEntries.id, entryId), eq(journalEntries.companyId, tenant.company.id)))
    .limit(1);
  if (!entry) throw notFound("Buxgalteriya yozuvi topilmadi");

  const lines = await conn
    .select({ ...lineFields, accountCode: accounts.code, accountName: accounts.name })
    .from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(eq(journalLines.entryId, entryId))
    .orderBy(desc(journalLines.debit), asc(accounts.code));
  return { ...entry, lines };
}

export async function listJournal(
  conn: DbOrTx,
  tenant: TenantContext,
  options: {
    dateFrom?: string;
    dateTo?: string;
    status?: JournalStatus;
    referenceType?: string;
    limit: number;
    cursor?: string;
  },
) {
  let after: { date: string; id: string } | null = null;
  if (options.cursor) {
    const [date, id] = decodeCursor(options.cursor, 2) as [string, string];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !UUID_RE.test(id)) throw badRequest("Kursor noto'g'ri");
    after = { date, id };
  }

  const rows = await conn
    .select(entryFields)
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, tenant.company.id),
        options.dateFrom ? gte(journalEntries.entryDate, options.dateFrom) : undefined,
        options.dateTo ? lte(journalEntries.entryDate, options.dateTo) : undefined,
        options.status ? eq(journalEntries.status, options.status) : undefined,
        options.referenceType === "manual"
          ? isNull(journalEntries.referenceType)
          : options.referenceType
            ? eq(journalEntries.referenceType, options.referenceType)
            : undefined,
        after
          ? or(
              lt(journalEntries.entryDate, after.date),
              and(eq(journalEntries.entryDate, after.date), lt(journalEntries.id, after.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(journalEntries.entryDate), desc(journalEntries.id))
    .limit(options.limit + 1);

  const page = rows.slice(0, options.limit);
  const last = page.at(-1);
  return {
    entries: page,
    nextCursor: rows.length > options.limit && last ? encodeCursor([last.entryDate, last.id]) : null,
  };
}

// ─── Yopilgan davr ───────────────────────────────────────────────────────────

/** Shu sanagacha (shu kun ham) qo'lda buxgalteriya hujjati kiritilmaydi va bekor qilinmaydi (hisobot topshirilgan davr). */
export const LOCK_DATE_KEY = "finance.lock_date";

export async function getLockDate(conn: DbOrTx, companyId: string): Promise<string | null> {
  const [row] = await conn
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.companyId, companyId), eq(settings.key, LOCK_DATE_KEY)))
    .limit(1);
  return row && /^\d{4}-\d{2}-\d{2}$/.test(row.value) ? row.value : null;
}

export async function assertPeriodOpen(conn: DbOrTx, companyId: string, date: string) {
  const lockDate = await getLockDate(conn, companyId);
  if (lockDate && date <= lockDate) {
    throw badRequest(`${lockDate} gacha bo'lgan davr yopilgan — ${date} sanali hujjat kiritilmaydi va o'zgartirilmaydi`, { reason: "period_locked", lockDate });
  }
}

export async function setLockDate(tx: Tx, tenant: TenantContext, lockDate: string | null, meta: RequestMeta) {
  // Biznes sanasi (Toshkent, `todayIso` bilan bir xil) — UTC sanasi 00:00–05:00 da bir kun orqada qolib, bugunni yopishga
  // yo'l qo'ymasdi. cash.service'ni import qilmaymiz (u bu modulni import qiladi — aylana bog'liqlik).
  const businessToday = new Date(Date.now() + Number(process.env.BUSINESS_UTC_OFFSET_MINUTES ?? 300) * 60_000).toISOString().slice(0, 10);
  if (lockDate && lockDate > businessToday) throw badRequest("Kelajakdagi sanani yopib bo'lmaydi");
  await upsertCompanySetting(tx, tenant, { key: LOCK_DATE_KEY, value: lockDate ?? "", group: "finance", description: "Yopilgan davr" }, meta);
  return lockDate;
}

/**
 * Qo'lda jurnal yozuvi tushmaydigan nazorat hisoblari: ular o'z hujjatlari bilan yuritiladi va qo'lda yozuv jurnalni
 * kassa/bank qoldig'i, mijoz va ta'minotchi qarzi, zaxira, avans va keshbek ro'yxatlaridan ajratib qo'yardi.
 */
export const MANUAL_BLOCKED_SUBTYPES = new Set([
  "cash",
  "bank",
  // 1030 kutilayotgan to'lovlar — kassa harakati va qirqim bilan yuritiladi
  "clearing",
  "receivable",
  "inventory",
  "payable",
  "customer_advance",
  "cashback_liability",
  "sales",
  "cogs",
]);

export async function createManualEntry(
  tx: Tx,
  tenant: TenantContext,
  input: Omit<JournalEntryInput, "referenceType" | "referenceId">,
  meta: RequestMeta,
) {
  await assertPeriodOpen(tx, tenant.company.id, input.entryDate);
  const accountIds = [...new Set(input.lines.map((line) => line.accountId))];
  const lineAccounts = accountIds.length
    ? await tx
        .select({ id: accounts.id, code: accounts.code, name: accounts.name, subtype: accounts.subtype })
        .from(accounts)
        .where(and(eq(accounts.companyId, tenant.company.id), inArray(accounts.id, accountIds)))
    : [];
  const linkedToCash = accountIds.length
    ? await tx
        .select({ ledgerAccountId: cashAccounts.ledgerAccountId })
        .from(cashAccounts)
        .where(and(eq(cashAccounts.companyId, tenant.company.id), inArray(cashAccounts.ledgerAccountId, accountIds)))
    : [];
  const cashLedgers = new Set(linkedToCash.map((row) => row.ledgerAccountId));
  const blocked = lineAccounts.find((account) => (account.subtype !== null && MANUAL_BLOCKED_SUBTYPES.has(account.subtype)) || cashLedgers.has(account.id));
  if (blocked) {
    throw badRequest(`${blocked.code} ${blocked.name}: bu hisob o'z hujjatlari (kassa harakati, sotuv, xarid, zaxira) bilan yuritiladi — qo'lda yozuv rad etildi`, {
      reason: "control_account",
      accountId: blocked.id,
    });
  }

  const { entry } = await postJournalEntry(tx, tenant.company.id, tenant.user.id, {
    ...input,
    referenceType: null,
    referenceId: null,
  });
  await financeAudit(tx, tenant, meta, {
    action: "JOURNAL_ENTRY_CREATED",
    resource: "journal_entries",
    resourceId: entry.id,
    details: { number: entry.number, total: entry.totalDebit },
  });
  return getJournalEntry(tx, tenant, entry.id);
}

/** Qo'lda kiritilgan yozuvni bekor qilish; hujjat yozuvlari hujjatning o'zi orqali bekor qilinadi. */
export async function voidManualEntry(tx: Tx, tenant: TenantContext, entryId: string, meta: RequestMeta) {
  const [entry] = await tx
    .select({ referenceType: journalEntries.referenceType, entryDate: journalEntries.entryDate })
    .from(journalEntries)
    .where(and(eq(journalEntries.id, entryId), eq(journalEntries.companyId, tenant.company.id)))
    .limit(1);
  if (!entry) throw notFound("Buxgalteriya yozuvi topilmadi");
  if (entry.referenceType) throw badRequest("Hujjatga bog'langan yozuvni hujjatning o'zi orqali bekor qiling");
  await assertPeriodOpen(tx, tenant.company.id, entry.entryDate);

  const voided = await voidJournalEntry(tx, tenant.company.id, entryId, tenant.user.id);
  await financeAudit(tx, tenant, meta, {
    action: "JOURNAL_ENTRY_VOIDED",
    resource: "journal_entries",
    resourceId: entryId,
    details: { number: voided.number },
  });
  return voided;
}
