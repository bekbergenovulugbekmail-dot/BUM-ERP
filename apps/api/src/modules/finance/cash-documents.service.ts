/**
 * KASSA HUJJATLARI va KASSA MAS'ULIYATI (egasining vazifasi, 2026-09-26; Z4 qarori).
 *
 * Hujjat turlari (har biri raqam, sana, sabab, mas'ul, kiritgan va tasdiqlagan bilan):
 *   transfer           — kassadan kassaga (bir valyuta, teng summa)
 *   method_correction  — to'lov usuli noto'g'ri tanlangan (masalan, karta to'lovi naqd deb kiritilgan): pul noto'g'ri
 *                        hisobdan to'g'risiga o'tadi, ASL yozuv o'zgarmaydi (hujjat unga havola qiladi)
 *   method_exchange    — to'lov usulini ayirboshlash (naqd ↔ karta/bank, bir valyuta); kelgan summa ketganidan farq
 *                        qilsa farq "boshqa daromad/xarajat"
 *   currency_exchange  — valyuta ayirboshlash: kelishilgan kurs va ikkala hisob kursi SNAPSHOT bo'lib saqlanadi, kurs
 *                        farqi 4200 (daromad) / 5700 (xarajat)
 *   income / expense   — kategoriyali kirim/chiqim: kategoriya → buxgalteriya qarshi hisobi, kontragent, mas'ul
 *
 * PUL faqat mavjud yagona manbada: `cash_transactions` (hisob qoldig'i) + jurnal, reference = (`cash_document`, id).
 * Hujjat jadvali — sabab va iz; alohida "kassa qoldig'i" yo'q. Bekor qilish — barcha kassa harakatlari va jurnal
 * qatorlarining teskarisi (reference = `cash_document_reversal`), hujjat `reversed`; hech narsa o'chirilmaydi.
 *
 * Mas'uliyat: `cash.own` ruxsati bor xodim FAQAT o'ziga biriktirilgan kassa(lar)ni ko'radi va ishlatadi (kirim,
 * chiqim, o'z kassasidan o'tkazma, o'z kassalari orasida ayirboshlash). Kassa ochish, mas'ul biriktirish, qoldiqni
 * o'rnatish, tuzatish va bekor qilish — rahbar (`finance.manage` / `finance.approve`).
 *
 * Mijoz va ta'minotchi kontragent bo'la olmaydi: ularning puli to'lov hujjatlari orqali (qarz va akt bilan bog'liq)
 * yuritiladi — aks holda qarz jurnaldan ajraladi.
 */
import { and, asc, desc, eq, gte, inArray, lt, lte, or, sql } from "drizzle-orm";
import { badRequest, conflict, forbidden, notFound } from "@bum/shared";
import { accounts, cashAccounts, cashCategories, cashDocuments, cashTransactions, journalLines } from "../../db/schema/finance.js";
import { employees } from "../../db/schema/hr.js";
import { users } from "../../db/schema/platform.js";
import { customerPayments } from "../../db/schema/sales.js";
import { withTransaction, type DbOrTx, type Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { fromMinor, mulDivRound, toMinor } from "../../shared/decimal.js";
import { nextDocumentNumber } from "../../shared/numbering.js";
import { effectivePermissions, type TenantContext } from "../company/tenant.js";
import { companyCurrency, financeAudit } from "./accounts.service.js";
import { ledgerAccountFor, recordCashTransaction, todayIso } from "./cash.service.js";
import { currencyRate } from "./currencies.service.js";
import { MANUAL_BLOCKED_SUBTYPES, assertPeriodOpen, ensureAccountBySubtype, postJournalEntry, requireAccountBySubtype } from "./journal.service.js";

export const CASH_DOCUMENT_KINDS = ["transfer", "method_correction", "method_exchange", "currency_exchange", "income", "expense"] as const;
export type CashDocumentKind = (typeof CASH_DOCUMENT_KINDS)[number];
export const COUNTERPARTY_TYPES = ["employee", "person", "other"] as const;

// ─── Kassa doirasi (Z4) ──────────────────────────────────────────────────────

/** `null` — barcha kassalar (rahbar/moliya); massiv — faqat shu kassalar (mas'ul xodim). */
export type CashScope = { all: true; canManage: boolean; canApprove: boolean } | { all: false; accountIds: string[]; canManage: false; canApprove: false };

export async function cashScope(conn: DbOrTx, tenant: TenantContext): Promise<CashScope> {
  const permissions = await effectivePermissions(conn, tenant);
  if (permissions.includes("finance.view")) {
    return { all: true, canManage: permissions.includes("finance.manage"), canApprove: permissions.includes("finance.approve") };
  }
  if (!permissions.includes("cash.own")) throw forbidden("Kassaga ruxsatingiz yo'q");
  const rows = await conn
    .select({ id: cashAccounts.id })
    .from(cashAccounts)
    .innerJoin(employees, eq(employees.id, cashAccounts.employeeId))
    .where(and(eq(cashAccounts.companyId, tenant.company.id), eq(employees.companyId, tenant.company.id), eq(employees.userId, tenant.user.id)));
  return { all: false, accountIds: rows.map((row) => row.id), canManage: false, canApprove: false };
}

export function assertInScope(scope: CashScope, accountId: string | null | undefined, what = "Bu kassa") {
  if (!accountId || scope.all) return;
  if (!scope.accountIds.includes(accountId)) throw forbidden(`${what} sizga biriktirilmagan`);
}

const registerFields = {
  id: cashAccounts.id,
  name: cashAccounts.name,
  type: cashAccounts.type,
  currency: cashAccounts.currency,
  balance: cashAccounts.balance,
  isDefault: cashAccounts.isDefault,
  isActive: cashAccounts.isActive,
  employeeId: cashAccounts.employeeId,
  employeeName: employees.name,
  employeeCode: employees.code,
};

/** Kassalar (mas'ul bilan) — doiradagilar. */
export async function listRegisters(conn: DbOrTx, tenant: TenantContext, scope: CashScope) {
  if (!scope.all && scope.accountIds.length === 0) return [];
  return conn
    .select(registerFields)
    .from(cashAccounts)
    .leftJoin(employees, eq(employees.id, cashAccounts.employeeId))
    .where(
      and(
        eq(cashAccounts.companyId, tenant.company.id),
        eq(cashAccounts.isActive, true),
        // Yetkazuvchi/savdo agentining "yo'ldagi naqd" hisoblari — o'z bo'limida (topshirish hujjati bilan)
        sql`${cashAccounts.deliveryAgentId} is null and ${cashAccounts.salesRepId} is null`,
        scope.all ? undefined : inArray(cashAccounts.id, scope.accountIds),
      ),
    )
    .orderBy(desc(cashAccounts.isDefault), asc(cashAccounts.type), asc(cashAccounts.name));
}

/**
 * O'tkazma qabul qiluvchilari: kompaniyaning faol kassalari — faqat nom va valyuta (QOLDIQSIZ). Mas'ul xodim o'z
 * kassasidan asosiy kassaga topshirishi uchun boshqa kassani tanlay oladi, lekin uning qoldig'ini ko'rmaydi.
 */
export async function transferTargets(conn: DbOrTx, tenant: TenantContext) {
  return conn
    .select({ id: cashAccounts.id, name: cashAccounts.name, type: cashAccounts.type, currency: cashAccounts.currency, isDefault: cashAccounts.isDefault })
    .from(cashAccounts)
    .where(
      and(
        eq(cashAccounts.companyId, tenant.company.id),
        eq(cashAccounts.isActive, true),
        sql`${cashAccounts.deliveryAgentId} is null and ${cashAccounts.salesRepId} is null`,
      ),
    )
    .orderBy(desc(cashAccounts.isDefault), asc(cashAccounts.name));
}

// ─── Kategoriyalar ───────────────────────────────────────────────────────────

const DEFAULT_CATEGORIES: { name: string; direction: "in" | "out"; subtype: string; type: "income" | "expense" | "equity"; fallback: string }[] = [
  { name: "Boshqa kirim", direction: "in", subtype: "other", type: "income", fallback: "Boshqa daromadlar" },
  { name: "Ta'sischi puli", direction: "in", subtype: "capital", type: "equity", fallback: "Ustav kapitali" },
  { name: "Boshqa chiqim", direction: "out", subtype: "other", type: "expense", fallback: "Boshqa xarajatlar" },
];

/** Kompaniyada kategoriya bo'lmasa — standartlari ochiladi (qarshi hisob hisoblar rejasidan). */
async function ensureDefaultCategories(tx: Tx, companyId: string) {
  const [any] = await tx.select({ id: cashCategories.id }).from(cashCategories).where(eq(cashCategories.companyId, companyId)).limit(1);
  if (any) return;
  for (const row of DEFAULT_CATEGORIES) {
    const counterAccountId = await requireAccountBySubtype(tx, companyId, row.subtype, row.type, row.fallback);
    await tx.insert(cashCategories).values({ companyId, name: row.name, direction: row.direction, counterAccountId }).onConflictDoNothing();
  }
}

export async function listCashCategories(conn: DbOrTx, tenant: TenantContext) {
  const [any] = await conn.select({ id: cashCategories.id }).from(cashCategories).where(eq(cashCategories.companyId, tenant.company.id)).limit(1);
  // Birinchi ochilishda standart kategoriyalar (hisoblar rejasidan) — ro'yxat bo'sh ko'rinmasin
  if (!any) await withTransaction((tx) => ensureDefaultCategories(tx, tenant.company.id));
  return conn
    .select({
      id: cashCategories.id,
      name: cashCategories.name,
      direction: cashCategories.direction,
      parentId: cashCategories.parentId,
      counterAccountId: cashCategories.counterAccountId,
      counterAccountCode: accounts.code,
      counterAccountName: accounts.name,
      isActive: cashCategories.isActive,
    })
    .from(cashCategories)
    .innerJoin(accounts, eq(accounts.id, cashCategories.counterAccountId))
    .where(eq(cashCategories.companyId, tenant.company.id))
    .orderBy(asc(cashCategories.direction), asc(cashCategories.name));
}

/** Qarshi hisob: faol, kassa emas, nazorat hisobi emas; kirimda daromad/kapital, chiqimda xarajat/kapital. */
async function assertCounterAccount(conn: DbOrTx, companyId: string, accountId: string, direction: "in" | "out") {
  const [row] = await conn
    .select({ id: accounts.id, type: accounts.type, subtype: accounts.subtype, isActive: accounts.isActive })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.companyId, companyId)))
    .limit(1);
  if (!row) throw notFound("Buxgalteriya hisobi topilmadi");
  if (!row.isActive) throw badRequest("Buxgalteriya hisobi faol emas");
  if (row.subtype && MANUAL_BLOCKED_SUBTYPES.has(row.subtype)) {
    throw badRequest("Nazorat hisobi (debitor, kreditor, zaxira, kassa, avans…) kategoriya bo'la olmaydi — tegishli hujjatdan foydalaning");
  }
  const allowed = direction === "in" ? ["income", "equity"] : ["expense", "equity"];
  if (!allowed.includes(row.type)) {
    throw badRequest(direction === "in" ? "Kirim kategoriyasi daromad yoki kapital hisobiga bog'lanadi" : "Chiqim kategoriyasi xarajat yoki kapital hisobiga bog'lanadi");
  }
}

export async function createCashCategory(
  tx: Tx,
  tenant: TenantContext,
  input: { name: string; direction: "in" | "out"; counterAccountId: string; parentId?: string | null },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  await ensureDefaultCategories(tx, companyId);
  await assertCounterAccount(tx, companyId, input.counterAccountId, input.direction);
  if (input.parentId) {
    const [parent] = await tx.select({ direction: cashCategories.direction }).from(cashCategories).where(and(eq(cashCategories.id, input.parentId), eq(cashCategories.companyId, companyId))).limit(1);
    if (!parent) throw notFound("Ota kategoriya topilmadi");
    if (parent.direction !== input.direction) throw badRequest("Ota kategoriya boshqa yo'nalishda");
  }
  const [dup] = await tx
    .select({ id: cashCategories.id })
    .from(cashCategories)
    .where(and(eq(cashCategories.companyId, companyId), eq(cashCategories.direction, input.direction), eq(cashCategories.name, input.name.trim())))
    .limit(1);
  if (dup) throw conflict(`"${input.name.trim()}" kategoriyasi allaqachon bor`);
  const [row] = await tx
    .insert(cashCategories)
    .values({ companyId, name: input.name.trim(), direction: input.direction, counterAccountId: input.counterAccountId, parentId: input.parentId ?? null, createdBy: tenant.user.id })
    .returning();
  await financeAudit(tx, tenant, meta, { action: "CASH_CATEGORY_CREATED", resource: "cash_categories", resourceId: row!.id, details: input });
  return row!;
}

export async function updateCashCategory(
  tx: Tx,
  tenant: TenantContext,
  categoryId: string,
  patch: { name?: string; counterAccountId?: string; isActive?: boolean },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const [current] = await tx.select().from(cashCategories).where(and(eq(cashCategories.id, categoryId), eq(cashCategories.companyId, companyId))).limit(1).for("update");
  if (!current) throw notFound("Kategoriya topilmadi");
  if (patch.counterAccountId) await assertCounterAccount(tx, companyId, patch.counterAccountId, current.direction as "in" | "out");
  // Eski hujjatlar o'z jurnal yozuvini saqlaydi — qarshi hisob o'zgarishi faqat yangi hujjatlarga ta'sir qiladi
  const [row] = await tx
    .update(cashCategories)
    .set({ ...patch, ...(patch.name ? { name: patch.name.trim() } : {}), updatedAt: new Date() })
    .where(eq(cashCategories.id, categoryId))
    .returning();
  await financeAudit(tx, tenant, meta, { action: "CASH_CATEGORY_UPDATED", resource: "cash_categories", resourceId: categoryId, details: patch });
  return row!;
}

// ─── Hujjat yaratish ─────────────────────────────────────────────────────────

export type CashDocumentInput = {
  kind: CashDocumentKind;
  docDate?: string;
  fromCashAccountId?: string | null;
  toCashAccountId?: string | null;
  amount: string;
  /** Kelgan summa (ayirboshlashda; o'tkazma va tuzatishda — `amount` ga teng). */
  toAmount?: string | null;
  categoryId?: string | null;
  counterpartyType?: (typeof COUNTERPARTY_TYPES)[number] | null;
  counterpartyName?: string | null;
  responsibleEmployeeId?: string | null;
  reason: string;
  reference?: string | null;
  notes?: string | null;
  /** Tuzatish: noto'g'ri usulda yozilgan mijoz to'lovi. */
  correctsPaymentId?: string | null;
  requestId?: string | null;
};

type Account = { id: string; name: string; type: "cash" | "bank" | "card" | "ewallet"; currency: string; isActive: boolean; ledgerAccountId: string | null };

async function lockAccounts(tx: Tx, companyId: string, ids: string[]) {
  const rows = await tx
    .select({ id: cashAccounts.id, name: cashAccounts.name, type: cashAccounts.type, currency: cashAccounts.currency, isActive: cashAccounts.isActive, ledgerAccountId: cashAccounts.ledgerAccountId })
    .from(cashAccounts)
    .where(and(eq(cashAccounts.companyId, companyId), inArray(cashAccounts.id, ids)))
    // Doimiy tartibda — qarama-qarshi hujjatlar deadlock bermaydi
    .orderBy(asc(cashAccounts.id))
    .for("update");
  const map = new Map<string, Account>(rows.map((row) => [row.id, row]));
  for (const id of ids) {
    const account = map.get(id);
    if (!account) throw notFound("Kassa topilmadi");
    if (!account.isActive) throw badRequest(`"${account.name}" faol emas`);
  }
  return map;
}

async function bookRate(tx: DbOrTx, companyId: string, currency: string) {
  return currency === (await companyCurrency(tx, companyId)) ? "1.0000" : currencyRate(tx, companyId, currency);
}

/** Summa × kurs (4 xona) → asosiy valyuta (2 xona). */
const toBase = (amount: bigint, rate: string) => mulDivRound(amount, toMinor(rate, 4), 10_000n);

async function assertResponsible(conn: DbOrTx, companyId: string, employeeId: string) {
  const [row] = await conn.select({ status: employees.status }).from(employees).where(and(eq(employees.id, employeeId), eq(employees.companyId, companyId))).limit(1);
  if (!row) throw notFound("Mas'ul xodim topilmadi");
  if (row.status !== "active") throw badRequest("Mas'ul xodim faol emas");
}

export async function createCashDocument(tx: Tx, tenant: TenantContext, input: CashDocumentInput, meta: RequestMeta) {
  const companyId = tenant.company.id;
  const scope = await cashScope(tx, tenant);
  if (scope.all && !scope.canManage) throw forbidden("Kassa hujjati uchun `finance.manage` yoki o'z kassangiz kerak");

  const reason = input.reason.trim();
  if (reason.length < 3) throw badRequest("Sababni yozing");
  const docDate = input.docDate ?? todayIso();
  if (docDate > todayIso()) throw badRequest("Kelajakdagi sana bilan kassa hujjati kiritilmaydi");
  await assertPeriodOpen(tx, companyId, docDate);
  const amount = toMinor(input.amount);
  if (amount <= 0n) throw badRequest("Summa musbat bo'lishi kerak");

  if (input.requestId) {
    const [existing] = await tx.select({ id: cashDocuments.id }).from(cashDocuments).where(and(eq(cashDocuments.companyId, companyId), eq(cashDocuments.requestId, input.requestId))).limit(1);
    if (existing) return { document: await getCashDocument(tx, tenant, existing.id), created: false };
  }

  const kind = input.kind;
  const needsFrom = kind !== "income";
  const needsTo = kind !== "expense";
  if (needsFrom && !input.fromCashAccountId) throw badRequest("Qaysi kassadan — tanlang");
  if (needsTo && !input.toCashAccountId) throw badRequest("Qaysi kassaga — tanlang");
  if (!needsFrom && input.fromCashAccountId) throw badRequest("Kirimda chiqim kassasi bo'lmaydi");
  if (!needsTo && input.toCashAccountId) throw badRequest("Chiqimda kirim kassasi bo'lmaydi");
  if (input.fromCashAccountId && input.fromCashAccountId === input.toCashAccountId) throw badRequest("Bir xil kassa tanlandi");

  // Mas'uliyat: mas'ul xodim o'z kassasidan chiqaradi / o'z kassasiga kiritadi; tuzatish — faqat rahbar
  if (!scope.all) {
    if (kind === "method_correction") throw forbidden("To'lov usulini tuzatish — rahbar yoki moliya xodimi");
    if (kind === "income") assertInScope(scope, input.toCashAccountId);
    else assertInScope(scope, input.fromCashAccountId);
    if (kind === "method_exchange" || kind === "currency_exchange") assertInScope(scope, input.toCashAccountId, "Qabul qiluvchi kassa");
  }

  const ids = [input.fromCashAccountId, input.toCashAccountId].filter((id): id is string => Boolean(id));
  const locked = await lockAccounts(tx, companyId, ids);
  const from = input.fromCashAccountId ? locked.get(input.fromCashAccountId)! : null;
  const to = input.toCashAccountId ? locked.get(input.toCashAccountId)! : null;

  if (input.responsibleEmployeeId) await assertResponsible(tx, companyId, input.responsibleEmployeeId);
  if (input.counterpartyType && !COUNTERPARTY_TYPES.includes(input.counterpartyType)) {
    throw badRequest("Mijoz yoki ta'minotchi puli to'lov hujjati orqali kiritiladi (qarz va akt bilan)");
  }

  // Summalar va kurslar
  let toAmount = amount;
  let currency = (from ?? to)!.currency;
  let toCurrency: string | null = null;
  let dealRate: string | null = null;
  const bookRateFrom = from ? await bookRate(tx, companyId, from.currency) : null;
  const bookRateTo = to ? await bookRate(tx, companyId, to.currency) : null;
  if (kind === "transfer" || kind === "method_correction" || kind === "method_exchange") {
    if (from!.currency !== to!.currency) throw badRequest("Bu hujjat bir xil valyutadagi kassalar orasida — valyuta uchun \"Valyuta ayirboshlash\"");
    if (kind === "method_exchange") {
      toAmount = input.toAmount ? toMinor(input.toAmount) : amount;
      if (toAmount <= 0n) throw badRequest("Kelgan summa musbat bo'lishi kerak");
    } else if (input.toAmount && toMinor(input.toAmount) !== amount) {
      throw badRequest("O'tkazma va tuzatishda summa ikki tomonda teng");
    }
  } else if (kind === "currency_exchange") {
    if (from!.currency === to!.currency) throw badRequest("Valyuta ayirboshlashda kassalar turli valyutada bo'ladi");
    if (!input.toAmount || toMinor(input.toAmount) <= 0n) throw badRequest("Olingan summani kiriting");
    toAmount = toMinor(input.toAmount);
    toCurrency = to!.currency;
    // Kelishilgan kurs: 1 birlik manba valyutasi = ? maqsad valyutasi (6 xona)
    dealRate = fromMinor(mulDivRound(toAmount, 1_000_000n, amount), 6);
  }
  if (kind === "income") currency = to!.currency;

  let category: { id: string; direction: string; counterAccountId: string; name: string } | null = null;
  if (kind === "income" || kind === "expense") {
    await ensureDefaultCategories(tx, companyId);
    if (!input.categoryId) throw badRequest("Kategoriyani tanlang");
    const [row] = await tx
      .select({ id: cashCategories.id, direction: cashCategories.direction, counterAccountId: cashCategories.counterAccountId, name: cashCategories.name, isActive: cashCategories.isActive })
      .from(cashCategories)
      .where(and(eq(cashCategories.id, input.categoryId), eq(cashCategories.companyId, companyId)))
      .limit(1);
    if (!row) throw notFound("Kategoriya topilmadi");
    if (!row.isActive) throw badRequest("Kategoriya faol emas");
    if (row.direction !== (kind === "income" ? "in" : "out")) throw badRequest("Kategoriya yo'nalishi hujjatga mos emas");
    // Qarshi hisob keyin nazorat hisobiga o'zgartirilgan bo'lsa ham — yozishdan oldin qayta tekshiriladi
    await assertCounterAccount(tx, companyId, row.counterAccountId, row.direction as "in" | "out");
    category = row;
  }

  let correctsId: string | null = null;
  if (kind === "method_correction" && input.correctsPaymentId) {
    const [payment] = await tx
      .select({ id: customerPayments.id, cashAccountId: customerPayments.cashAccountId, amount: customerPayments.amount, status: customerPayments.status })
      .from(customerPayments)
      .where(and(eq(customerPayments.id, input.correctsPaymentId), eq(customerPayments.companyId, companyId)))
      .limit(1);
    if (!payment) throw notFound("Tuzatiladigan to'lov topilmadi");
    if (payment.status !== "posted") throw badRequest("Bekor qilingan to'lov tuzatilmaydi");
    if (payment.cashAccountId !== from!.id) throw badRequest("To'lov tanlangan kassaga tushmagan — noto'g'ri hisob tanlandi");
    if (amount > toMinor(payment.amount)) throw badRequest("Tuzatish summasi to'lov summasidan ortiq");
    const [already] = await tx
      .select({ number: cashDocuments.number })
      .from(cashDocuments)
      .where(and(eq(cashDocuments.companyId, companyId), eq(cashDocuments.correctsId, payment.id), eq(cashDocuments.status, "posted")))
      .limit(1);
    if (already) throw conflict(`Bu to'lov ${already.number} hujjati bilan allaqachon tuzatilgan`);
    correctsId = payment.id;
  }

  // Asosiy valyutadagi qiymatlar (jurnal shu bilan)
  const baseOut = from ? toBase(amount, bookRateFrom!) : 0n;
  const baseIn = to ? toBase(toAmount, bookRateTo!) : 0n;
  const difference = kind === "method_exchange" || kind === "currency_exchange" ? baseIn - baseOut : 0n;
  const baseAmount = from ? baseOut : baseIn;

  const number = await nextDocumentNumber(tx, {
    table: cashDocuments,
    column: cashDocuments.number,
    companyColumn: cashDocuments.companyId,
    companyId,
    prefix: `KH-${docDate.slice(0, 4)}-`,
    width: 5,
  });
  const selfApproved = scope.all && scope.canManage;
  const [doc] = await tx
    .insert(cashDocuments)
    .values({
      companyId,
      number,
      kind,
      docDate,
      fromCashAccountId: from?.id ?? null,
      toCashAccountId: to?.id ?? null,
      amount: fromMinor(amount),
      currency,
      toAmount: to && from ? fromMinor(toAmount) : null,
      toCurrency,
      dealRate,
      bookRateFrom,
      bookRateTo,
      baseAmount: fromMinor(baseAmount),
      difference: fromMinor(difference),
      categoryId: category?.id ?? null,
      counterpartyType: input.counterpartyType ?? null,
      counterpartyName: input.counterpartyName?.trim() || null,
      responsibleEmployeeId: input.responsibleEmployeeId ?? null,
      reason,
      reference: input.reference?.trim() || null,
      notes: input.notes?.trim() || null,
      correctsType: correctsId ? "customer_payment" : null,
      correctsId,
      requestId: input.requestId ?? null,
      createdBy: tenant.user.id,
      approvedBy: selfApproved ? tenant.user.id : null,
      approvedAt: selfApproved ? new Date() : null,
    })
    .returning({ id: cashDocuments.id });

  const label = `${number}: ${reason}`;
  const move = { txDate: docDate, description: label, category: kind, referenceType: "cash_document", referenceId: doc!.id };
  if (from) await recordCashTransaction(tx, companyId, tenant.user.id, { ...move, cashAccountId: from.id, type: "out", amount: fromMinor(amount), currency: from.currency });
  if (to) await recordCashTransaction(tx, companyId, tenant.user.id, { ...move, cashAccountId: to.id, type: "in", amount: fromMinor(toAmount), currency: to.currency });

  // Jurnal (asosiy valyutada)
  const lines: { accountId: string; debit?: string; credit?: string; description?: string }[] = [];
  if (to) lines.push({ accountId: await ledgerAccountFor(tx, companyId, to), debit: fromMinor(baseIn) });
  if (from) lines.push({ accountId: await ledgerAccountFor(tx, companyId, from), credit: fromMinor(baseOut) });
  if (category) {
    if (kind === "income") lines.push({ accountId: category.counterAccountId, credit: fromMinor(baseIn), description: category.name });
    else lines.unshift({ accountId: category.counterAccountId, debit: fromMinor(baseOut), description: category.name });
  }
  if (difference !== 0n) {
    const gain = difference > 0n;
    const abs = fromMinor(gain ? difference : -difference);
    const accountId =
      kind === "currency_exchange"
        ? await ensureAccountBySubtype(tx, companyId, gain ? "fx_gain" : "fx_loss")
        : await requireAccountBySubtype(tx, companyId, "other", gain ? "income" : "expense", gain ? "Boshqa daromadlar" : "Boshqa xarajatlar");
    lines.push(gain ? { accountId, credit: abs, description: "Ayirboshlash farqi" } : { accountId, debit: abs, description: "Ayirboshlash farqi" });
  }
  // Bir xil buxgalteriya hisobidagi o'tkazma (masalan, ikki naqd kassa, ikkalasi 1010) — jurnalga ta'sir yo'q
  const nonZero = collapse(lines);
  let journalEntryId: string | null = null;
  if (nonZero.length > 0) {
    const { entry } = await postJournalEntry(tx, companyId, tenant.user.id, {
      entryDate: docDate,
      description: label,
      referenceType: "cash_document",
      referenceId: doc!.id,
      lines: nonZero,
    });
    journalEntryId = entry.id;
    await tx.update(cashDocuments).set({ journalEntryId }).where(eq(cashDocuments.id, doc!.id));
  }

  await financeAudit(tx, tenant, meta, {
    action: "CASH_DOCUMENT_POSTED",
    resource: "cash_documents",
    resourceId: doc!.id,
    details: { number, kind, from: from?.id ?? null, to: to?.id ?? null, amount: fromMinor(amount), toAmount: fromMinor(toAmount), difference: fromMinor(difference), dealRate, correctsId, journalEntryId },
  });
  return { document: await getCashDocument(tx, tenant, doc!.id), created: true };
}

/** Bir hisobdagi debet va kreditni qisqartiradi; nol qatorlar tashlanadi (bir xil hisobli o'tkazma — yozuvsiz). */
function collapse(lines: { accountId: string; debit?: string; credit?: string; description?: string }[]) {
  const net = new Map<string, { value: bigint; description?: string }>();
  for (const line of lines) {
    const entry = net.get(line.accountId) ?? { value: 0n, description: line.description };
    entry.value += toMinor(line.debit ?? "0") - toMinor(line.credit ?? "0");
    net.set(line.accountId, entry);
  }
  return [...net.entries()]
    .filter(([, entry]) => entry.value !== 0n)
    .map(([accountId, entry]) => ({
      accountId,
      ...(entry.value > 0n ? { debit: fromMinor(entry.value) } : { credit: fromMinor(-entry.value) }),
      ...(entry.description ? { description: entry.description } : {}),
    }));
}

// ─── O'qish ──────────────────────────────────────────────────────────────────

export async function getCashDocument(conn: DbOrTx, tenant: TenantContext, documentId: string) {
  const [row] = await conn
    .select()
    .from(cashDocuments)
    .where(and(eq(cashDocuments.id, documentId), eq(cashDocuments.companyId, tenant.company.id)))
    .limit(1);
  if (!row) throw notFound("Kassa hujjati topilmadi");
  const accountIds = [row.fromCashAccountId, row.toCashAccountId].filter((id): id is string => Boolean(id));
  const names = accountIds.length ? await conn.select({ id: cashAccounts.id, name: cashAccounts.name }).from(cashAccounts).where(inArray(cashAccounts.id, accountIds)) : [];
  const userIds = [row.createdBy, row.approvedBy, row.reversedBy].filter((id): id is string => Boolean(id));
  const people = userIds.length ? await conn.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds)) : [];
  const [responsible] = row.responsibleEmployeeId
    ? await conn.select({ name: employees.name }).from(employees).where(eq(employees.id, row.responsibleEmployeeId)).limit(1)
    : [];
  const [category] = row.categoryId ? await conn.select({ name: cashCategories.name }).from(cashCategories).where(eq(cashCategories.id, row.categoryId)).limit(1) : [];
  const nameOf = (id: string | null) => (id ? (names.find((item) => item.id === id)?.name ?? null) : null);
  const personOf = (id: string | null) => (id ? (people.find((item) => item.id === id)?.name ?? null) : null);
  return {
    ...row,
    fromCashAccountName: nameOf(row.fromCashAccountId),
    toCashAccountName: nameOf(row.toCashAccountId),
    createdByName: personOf(row.createdBy),
    approvedByName: personOf(row.approvedBy),
    reversedByName: personOf(row.reversedBy),
    responsibleName: responsible?.name ?? null,
    categoryName: category?.name ?? null,
  };
}

export async function listCashDocuments(
  conn: DbOrTx,
  tenant: TenantContext,
  scope: CashScope,
  filters: { cashAccountId?: string; kind?: CashDocumentKind; dateFrom?: string; dateTo?: string; limit: number },
) {
  if (filters.cashAccountId) assertInScope(scope, filters.cashAccountId);
  if (!scope.all && scope.accountIds.length === 0) return [];
  const accountFilter = filters.cashAccountId
    ? or(eq(cashDocuments.fromCashAccountId, filters.cashAccountId), eq(cashDocuments.toCashAccountId, filters.cashAccountId))
    : scope.all
      ? undefined
      : or(inArray(cashDocuments.fromCashAccountId, scope.accountIds), inArray(cashDocuments.toCashAccountId, scope.accountIds));
  const rows = await conn
    .select({ id: cashDocuments.id })
    .from(cashDocuments)
    .where(
      and(
        eq(cashDocuments.companyId, tenant.company.id),
        accountFilter,
        filters.kind ? eq(cashDocuments.kind, filters.kind) : undefined,
        filters.dateFrom ? gte(cashDocuments.docDate, filters.dateFrom) : undefined,
        filters.dateTo ? lte(cashDocuments.docDate, filters.dateTo) : undefined,
      ),
    )
    .orderBy(desc(cashDocuments.docDate), desc(cashDocuments.createdAt))
    .limit(filters.limit);
  const result = [];
  for (const row of rows) result.push(await getCashDocument(conn, tenant, row.id));
  return result;
}

// ─── Tasdiq va bekor qilish ──────────────────────────────────────────────────

/** Mas'ul xodim kiritgan hujjatni rahbar tasdiqlaydi (imzo) — pul allaqachon ko'chgan, tasdiq faqat nazorat izi. */
export async function approveCashDocument(tx: Tx, tenant: TenantContext, documentId: string, meta: RequestMeta) {
  const [doc] = await tx.select().from(cashDocuments).where(and(eq(cashDocuments.id, documentId), eq(cashDocuments.companyId, tenant.company.id))).limit(1).for("update");
  if (!doc) throw notFound("Kassa hujjati topilmadi");
  if (doc.approvedBy) throw conflict("Hujjat allaqachon tasdiqlangan");
  if (doc.createdBy === tenant.user.id && tenant.company.ownerId !== tenant.user.id) throw forbidden("O'zingiz kiritgan hujjatni tasdiqlay olmaysiz");
  await tx.update(cashDocuments).set({ approvedBy: tenant.user.id, approvedAt: new Date(), updatedAt: new Date() }).where(eq(cashDocuments.id, doc.id));
  await financeAudit(tx, tenant, meta, { action: "CASH_DOCUMENT_APPROVED", resource: "cash_documents", resourceId: doc.id, details: { number: doc.number } });
  return getCashDocument(tx, tenant, doc.id);
}

/** Bekor qilishni ko'rib chiqish: qaytadigan pul qabul qilgan kassada bormi. */
export async function previewCashDocumentReversal(conn: DbOrTx, tenant: TenantContext, documentId: string) {
  const doc = await getCashDocument(conn, tenant, documentId);
  const blockers: string[] = [];
  if (doc.status === "reversed") blockers.push("Hujjat allaqachon bekor qilingan");
  const moves = await conn
    .select({ cashAccountId: cashTransactions.cashAccountId, type: cashTransactions.type, amount: cashTransactions.amount })
    .from(cashTransactions)
    .where(and(eq(cashTransactions.companyId, tenant.company.id), eq(cashTransactions.referenceType, "cash_document"), eq(cashTransactions.referenceId, doc.id)));
  for (const move of moves.filter((row) => row.type === "in")) {
    const [account] = await conn.select({ name: cashAccounts.name, balance: cashAccounts.balance }).from(cashAccounts).where(eq(cashAccounts.id, move.cashAccountId)).limit(1);
    if (!account || toMinor(account.balance) < toMinor(move.amount)) {
      blockers.push(`"${account?.name ?? "kassa"}" da yetarli pul yo'q (qoldiq ${account?.balance ?? "0"}, kerak ${move.amount})`);
    }
  }
  return { document: doc, moves, blockers };
}

export async function reverseCashDocument(tx: Tx, tenant: TenantContext, documentId: string, reason: string, meta: RequestMeta) {
  const companyId = tenant.company.id;
  const cleanReason = reason.trim();
  if (cleanReason.length < 3) throw badRequest("Bekor qilish sababini yozing");
  const today = todayIso();
  await assertPeriodOpen(tx, companyId, today);
  const [doc] = await tx.select().from(cashDocuments).where(and(eq(cashDocuments.id, documentId), eq(cashDocuments.companyId, companyId))).limit(1).for("update");
  if (!doc) throw notFound("Kassa hujjati topilmadi");
  if (doc.status === "reversed") throw conflict("Hujjat allaqachon bekor qilingan");

  const label = `${doc.number} bekor qilindi: ${cleanReason}`;
  const moves = await tx
    .select()
    .from(cashTransactions)
    .where(and(eq(cashTransactions.companyId, companyId), eq(cashTransactions.referenceType, "cash_document"), eq(cashTransactions.referenceId, doc.id)))
    .orderBy(desc(cashTransactions.type));
  // Avval kirimlar qaytariladi (pul yetmasa — aniq xato, hech narsa yozilmaydi), keyin chiqimlar
  for (const move of [...moves.filter((row) => row.type === "in"), ...moves.filter((row) => row.type === "out")]) {
    await recordCashTransaction(tx, companyId, tenant.user.id, {
      cashAccountId: move.cashAccountId,
      type: move.type === "in" ? "out" : "in",
      amount: move.amount,
      currency: move.currency,
      txDate: today,
      description: label,
      category: doc.kind,
      referenceType: "cash_document_reversal",
      referenceId: doc.id,
    });
  }

  let reversalJournalEntryId: string | null = null;
  if (doc.journalEntryId) {
    const lines = await tx.select().from(journalLines).where(eq(journalLines.entryId, doc.journalEntryId));
    const { entry } = await postJournalEntry(tx, companyId, tenant.user.id, {
      entryDate: today,
      description: label,
      referenceType: "cash_document_reversal",
      referenceId: doc.id,
      // Asl yozuvning aynan teskarisi — asl summalarda (kurs o'zgargan bo'lsa ham)
      lines: lines.map((line) => ({
        accountId: line.accountId,
        ...(toMinor(line.debit) > 0n ? { credit: line.debit } : { debit: line.credit }),
        ...(line.description ? { description: line.description } : {}),
      })),
    });
    reversalJournalEntryId = entry.id;
  }

  await tx
    .update(cashDocuments)
    .set({ status: "reversed", reversedAt: new Date(), reversedBy: tenant.user.id, reversalReason: cleanReason, reversalJournalEntryId, updatedAt: new Date() })
    .where(eq(cashDocuments.id, doc.id));
  await financeAudit(tx, tenant, meta, {
    action: "CASH_DOCUMENT_REVERSED",
    resource: "cash_documents",
    resourceId: doc.id,
    details: { number: doc.number, kind: doc.kind, reason: cleanReason, reversalJournalEntryId },
  });
  return getCashDocument(tx, tenant, doc.id);
}

// ─── Kassa hisoboti ──────────────────────────────────────────────────────────

const REFERENCE_LABELS: Record<string, string> = {
  customer_payment: "Mijoz to'lovlari",
  customer_payment_reversal: "Mijoz to'lovi bekor qilindi",
  customer_balance: "Mijoz avansi (hamyon)",
  customer_balance_reversal: "Mijoz avansi bekor qilindi",
  supplier_payment: "Ta'minotchiga to'lov",
  expense: "Xarajatlar",
  bank_fee: "Bank komissiyasi",
  cash_transfer: "O'tkazma (eski)",
  cash_adjustment: "Qoldiqni to'g'rilash",
  cash_opening_balance: "Boshlang'ich qoldiq",
  cash_transaction: "Qo'lda kirim/chiqim",
  cash_handover: "Agentdan topshirish",
  settlement: "Qirqim (karta → bank)",
};

const KIND_GROUPS: Record<string, { in: string; out: string; label: string }> = {
  transfer: { in: "transfer_in", out: "transfer_out", label: "O'tkazma" },
  method_correction: { in: "correction_in", out: "correction_out", label: "To'lov usuli tuzatildi" },
  method_exchange: { in: "exchange_in", out: "exchange_out", label: "To'lov usulini ayirboshlash" },
  currency_exchange: { in: "exchange_in", out: "exchange_out", label: "Valyuta ayirboshlash" },
  income: { in: "income", out: "income", label: "Kategoriyali kirim" },
  expense: { in: "expense", out: "expense", label: "Kategoriyali chiqim" },
};

/**
 * Kassa hisoboti: boshlang'ich + kirim − chiqim + o'tkazma kirdi − o'tkazma chiqdi ± ayirboshlash ± tuzatish = yakuniy.
 * Hammasi `cash_transactions` dan (tx_date bo'yicha) — alohida hisoblangan qoldiq yo'q. Yakuniy qoldiq oxirgi harakatning
 * `balance_after` i bilan solishtiriladi (`consistent`), davr bugungacha bo'lsa — hisobning joriy qoldig'i bilan ham.
 */
export async function cashRegisterReport(conn: DbOrTx, tenant: TenantContext, scope: CashScope, input: { cashAccountId: string; from: string; to: string }) {
  assertInScope(scope, input.cashAccountId);
  if (input.from > input.to) throw badRequest("Davr noto'g'ri");
  const companyId = tenant.company.id;
  const [account] = await conn
    .select({ ...registerFields })
    .from(cashAccounts)
    .leftJoin(employees, eq(employees.id, cashAccounts.employeeId))
    .where(and(eq(cashAccounts.id, input.cashAccountId), eq(cashAccounts.companyId, companyId)))
    .limit(1);
  if (!account) throw notFound("Kassa topilmadi");

  const signed = sql<string>`coalesce(sum(case when ${cashTransactions.type} = 'in' then ${cashTransactions.amount} else -${cashTransactions.amount} end), 0)::numeric(18,2)`;
  const [opening] = await conn
    .select({ value: signed })
    .from(cashTransactions)
    .where(and(eq(cashTransactions.companyId, companyId), eq(cashTransactions.cashAccountId, account.id), lt(cashTransactions.txDate, input.from)));

  const rows = await conn
    .select({
      type: cashTransactions.type,
      referenceType: cashTransactions.referenceType,
      kind: cashDocuments.kind,
      category: cashTransactions.category,
      categoryName: cashCategories.name,
      amount: sql<string>`sum(${cashTransactions.amount})::numeric(18,2)`,
      count: sql<number>`count(*)::int`,
    })
    .from(cashTransactions)
    .leftJoin(
      cashDocuments,
      and(inArray(cashTransactions.referenceType, ["cash_document", "cash_document_reversal"]), eq(cashDocuments.id, cashTransactions.referenceId)),
    )
    .leftJoin(cashCategories, eq(cashCategories.id, cashDocuments.categoryId))
    .where(
      and(
        eq(cashTransactions.companyId, companyId),
        eq(cashTransactions.cashAccountId, account.id),
        gte(cashTransactions.txDate, input.from),
        lte(cashTransactions.txDate, input.to),
      ),
    )
    .groupBy(cashTransactions.type, cashTransactions.referenceType, cashDocuments.kind, cashTransactions.category, cashCategories.name);

  const groups = new Map<string, { group: string; label: string; direction: "in" | "out"; amount: bigint; count: number }>();
  let totalIn = 0n;
  let totalOut = 0n;
  for (const row of rows) {
    const direction = row.type === "in" ? "in" : "out";
    const value = toMinor(row.amount);
    if (direction === "in") totalIn += value;
    else totalOut += value;
    let group: string;
    let label: string;
    if (row.referenceType === "cash_document_reversal") {
      group = direction === "in" ? "reversal_in" : "reversal_out";
      label = `Bekor qilingan hujjat: ${KIND_GROUPS[row.kind ?? ""]?.label ?? "kassa hujjati"}`;
    } else if (row.referenceType === "cash_document" && row.kind) {
      const def = KIND_GROUPS[row.kind]!;
      group = direction === "in" ? def.in : def.out;
      label = row.categoryName ? `${def.label}: ${row.categoryName}` : def.label;
    } else {
      group = direction === "in" ? "income" : "expense";
      label = REFERENCE_LABELS[row.referenceType ?? ""] ?? (row.category ? `Boshqa: ${row.category}` : "Boshqa");
    }
    const key = `${group}|${label}`;
    const entry = groups.get(key) ?? { group, label, direction, amount: 0n, count: 0 };
    entry.amount += value;
    entry.count += row.count;
    groups.set(key, entry);
  }

  const openingMinor = toMinor(opening!.value);
  const closing = openingMinor + totalIn - totalOut;
  const sum = (names: string[], direction: "in" | "out") =>
    fromMinor([...groups.values()].filter((row) => names.includes(row.group) && row.direction === direction).reduce((acc, row) => acc + row.amount, 0n));

  // Tekshiruv: davr bugungacha bo'lsa — hisoblangan yakuniy qoldiq hisobning haqiqiy qoldig'iga teng bo'lishi kerak
  const coversToday = input.to >= todayIso();
  const consistent = coversToday ? toMinor(account.balance) === closing : true;

  return {
    account,
    from: input.from,
    to: input.to,
    opening: fromMinor(openingMinor),
    lines: [...groups.values()]
      .sort((a, b) => a.group.localeCompare(b.group) || Number(b.amount - a.amount))
      .map((row) => ({ group: row.group, label: row.label, direction: row.direction, amount: fromMinor(row.amount), count: row.count })),
    totals: {
      in: fromMinor(totalIn),
      out: fromMinor(totalOut),
      income: sum(["income"], "in"),
      expense: sum(["expense"], "out"),
      transferIn: sum(["transfer_in"], "in"),
      transferOut: sum(["transfer_out"], "out"),
      exchangeIn: sum(["exchange_in"], "in"),
      exchangeOut: sum(["exchange_out"], "out"),
      correctionIn: sum(["correction_in"], "in"),
      correctionOut: sum(["correction_out"], "out"),
      reversalIn: sum(["reversal_in"], "in"),
      reversalOut: sum(["reversal_out"], "out"),
    },
    closing: fromMinor(closing),
    currentBalance: account.balance,
    consistent,
  };
}
