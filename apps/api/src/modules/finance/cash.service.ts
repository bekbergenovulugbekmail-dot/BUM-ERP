/**
 * Kassa va bank hisoblari (convex/finance/cashAccounts.ts, journalHelper.recordCashTransaction).
 *
 * `recordCashTransaction` — kassa balansini o'zgartiradigan YAGONA yo'l; xarajat,
 * xarid, savdo va POS to'lovlari shuni chaqiradi. Qator `FOR UPDATE` bilan
 * qulflanadi, balans manfiyga tushmaydi, bir hujjatga takroriy yozuv qilinmaydi.
 *
 * Convex'dan farqlar:
 *  - `type: "transfer"` balansni faqat kamaytirib, pul hech qayerga tushmasdi —
 *    endi alohida o'tkazma: manbadan chiqim + qabul qiluvchiga kirim (+ kassa↔bank jurnal yozuvi)
 *  - yordamchi (xarid/savdo to'lovlari) balansni manfiyga tushirishga yo'l qo'yardi
 *  - boshlang'ich qoldiq tranzaksiyasiz balansga yozilardi — endi kirim tranzaksiyasi
 *    va DR kassa / CR ustav kapitali
 *  - qo'lda kirim/chiqimda qarshi hisob tanlansa jurnal yozuvi ham qilinadi
 *  - asosiy kassa bazada ham yagona (0005); kassani tahrirlash va faolsizlantirish qo'shildi
 *  - `list`, `getTransactions`, `getDashboardStats` ruxsat tekshirmasdi — `finance.view`
 */
import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { badRequest, conflict, forbidden, notFound } from "@bum/shared";
import { accounts, cashAccounts, cashTransactions, companyCurrencies } from "../../db/schema/finance.js";
import { employees } from "../../db/schema/hr.js";
import { purchaseOrders } from "../../db/schema/purchase.js";
import { salesOrders } from "../../db/schema/sales.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { UUID_RE, decodeCursor, encodeCursor } from "../../shared/cursor.js";
import { fromMinor, rescale, toMinor } from "../../shared/decimal.js";
import type { TenantContext } from "../company/tenant.js";
import { companyCurrency, financeAudit } from "./accounts.service.js";
import { currencyRate } from "./currencies.service.js";
import { MANUAL_BLOCKED_SUBTYPES, assertPeriodOpen, ensureAccountBySubtype, findAccountBySubtype, postJournalEntry, requireAccountBySubtype } from "./journal.service.js";
import { applyOutgoingBankCommission } from "./bank-commission.service.js";

const { legacyId: _l1, companyId: _c1, ...cashAccountFields } = getTableColumns(cashAccounts);
const { legacyId: _l2, companyId: _c2, ...transactionFields } = getTableColumns(cashTransactions);

export type CashAccountType = (typeof cashAccounts.type.enumValues)[number];

/** Hisobotlarda aylanma sifatida sanalmaydigan kategoriyalar. */
export const TRANSFER_CATEGORY = "transfer";
export const OPENING_BALANCE_CATEGORY = "opening_balance";

/**
 * Biznes kuni O'zbekiston vaqtida (UTC+5) sanaladi — server qayerda turganidan qat'i nazar.
 *
 * Production konteyneri UTC da ishlaydi, shuning uchun oddiy `toISOString()` mahalliy vaqt bilan
 * 00:00–05:00 oralig'ida KECHAGI sanani berardi: o'sha soatlarda yozilgan kassa harakati,
 * agentning marshruti, tashrifi va KPI kuni bir kun orqaga tushib ketardi. Kodning boshqa
 * joylarida kun chegarasi allaqachon `+05:00` / `Asia/Tashkent` bilan olinadi
 * (`supervisor.service.ts`, `delivery/reports.service.ts`) — bu funksiya ularga zid edi.
 *
 * O'zbekistonda yozgi vaqt yo'q, shuning uchun siljish doimiy. Boshqa mintaqa kerak bo'lsa
 * `BUSINESS_UTC_OFFSET_MINUTES` muhit o'zgaruvchisi bilan almashtiriladi.
 */
const BUSINESS_UTC_OFFSET_MINUTES = Number(process.env.BUSINESS_UTC_OFFSET_MINUTES ?? 300);

export function todayIso(now: Date = new Date()): string {
  return new Date(now.getTime() + BUSINESS_UTC_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

/**
 * Kassa/bank hisobi → hisoblar rejasidagi hisob: hisobga alohida buxgalteriya hisobi bog'langan bo'lsa (masalan, 1021
 * "X bank UZS") — o'sha, aks holda turi bo'yicha umumiy 1010 naqd / 1020 bank. Kirim va chiqim bir xil qoidada —
 * bog'langan hisobning qoldig'i buxgalteriyada alohida ko'rinadi.
 */
export async function ledgerAccountFor(
  conn: DbOrTx,
  companyId: string,
  account: CashAccountType | { type: CashAccountType; ledgerAccountId?: string | null },
): Promise<string> {
  const type = typeof account === "string" ? account : account.type;
  const linked = typeof account === "string" ? null : (account.ledgerAccountId ?? null);
  if (linked) {
    const [row] = await conn
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.id, linked), eq(accounts.companyId, companyId), eq(accounts.type, "asset"), eq(accounts.isActive, true)))
      .limit(1);
    if (row) return row.id;
  }
  // Kutilayotgan hisob (karta/hamyon) — 1030 "Kutilayotgan to'lovlar"; bu hisob ochilmagan eski kompaniyada bank hisobi
  if (isPendingAccountType(type)) {
    return (await findAccountBySubtype(conn, companyId, "clearing", "asset")) ?? requireAccountBySubtype(conn, companyId, "bank", "asset", "Bank hisobi");
  }
  return requireAccountBySubtype(conn, companyId, type, "asset", type === "cash" ? "Naqd kassa" : "Bank hisobi");
}

/** Kassaga bog'lanadigan buxgalteriya hisobi: shu kompaniyaning faol aktiv hisobi. */
export async function assertLedgerAccount(conn: DbOrTx, companyId: string, ledgerAccountId: string) {
  const [row] = await conn
    .select({ id: accounts.id, type: accounts.type, isActive: accounts.isActive })
    .from(accounts)
    .where(and(eq(accounts.id, ledgerAccountId), eq(accounts.companyId, companyId)))
    .limit(1);
  if (!row) throw notFound("Buxgalteriya hisobi topilmadi");
  if (row.type !== "asset" || !row.isActive) throw badRequest("Kassaga faqat faol aktiv (asset) hisob bog'lanadi");
}

export type PaymentMethod = "cash" | "bank" | "card" | "transfer";

/**
 * To'lov usuli → kassa: aniq tanlangan hisob ustun; asosiy valyutada naqd — asosiy kassa (null);
 * karta, bank, o'tkazma — birinchi faol bank hisobi (karta tushumi bankka tushadi).
 * Boshqa valyutada — shu valyutadagi birinchi faol kassa (naqd) yoki bank hisobi.
 */
export async function resolvePaymentAccount(
  tx: Tx,
  companyId: string,
  method: PaymentMethod,
  cashAccountId?: string | null,
  currency?: string,
): Promise<string | null> {
  if (cashAccountId) return cashAccountId;
  const baseCurrency = await companyCurrency(tx, companyId);
  const code = currency ?? baseCurrency;
  if (method === "cash" && code === baseCurrency) return null;
  const type = method === "cash" ? "cash" : "bank";
  const [account] = await tx
    .select({ id: cashAccounts.id })
    .from(cashAccounts)
    .where(
      and(
        eq(cashAccounts.companyId, companyId),
        eq(cashAccounts.type, type),
        eq(cashAccounts.currency, code),
        eq(cashAccounts.isActive, true),
      ),
    )
    .orderBy(desc(cashAccounts.isDefault), asc(cashAccounts.name))
    .limit(1);
  if (!account) {
    throw badRequest(
      code === baseCurrency
        ? "Faol bank hisobi yo'q"
        : `${code} valyutasidagi faol ${type === "cash" ? "kassa" : "bank hisobi"} yo'q — Moliya bo'limida oching`,
    );
  }
  return account.id;
}

/** Summa × kurs → asosiy valyuta (2 kasr). */
export function toBaseAmount(amount: string, rate: string): string {
  return fromMinor(rescale(toMinor(amount) * toMinor(rate, 4), 6, 2));
}

async function accountRate(tx: DbOrTx, companyId: string, currency: string) {
  return currency === (await companyCurrency(tx, companyId)) ? "1.0000" : currencyRate(tx, companyId, currency);
}

export type CashMove = {
  /** null — kompaniyaning asosiy kassasi. */
  cashAccountId?: string | null;
  type: "in" | "out";
  amount: string;
  txDate: string;
  description: string;
  category?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  /** Summa qaysi valyutada; kassa shu valyutada bo'lishi shart. Standart — asosiy valyuta. */
  currency?: string;
  /**
   * ESKIRGAN — endi e'tiborga olinmaydi. Ilgari oflayn kassa sinxroni qoldiqni manfiyga tushira olardi;
   * bu hisobotda bo'lmagan pulni ko'rsatardi. Endi qoldiq hech qayerda manfiy bo'lmaydi: yetmasa amal rad etiladi
   * va oflayn kassada nomuvofiqlik sifatida qayd etiladi (kassir ko'rib chiqadi).
   */
  allowOverdraft?: boolean;
};

export async function recordCashTransaction(tx: Tx, companyId: string, createdBy: string | null, move: CashMove) {
  if (toMinor(move.amount) <= 0n) throw badRequest("Summa musbat bo'lishi kerak");

  const [account] = await tx
    .select(cashAccountFields)
    .from(cashAccounts)
    .where(
      and(
        eq(cashAccounts.companyId, companyId),
        move.cashAccountId
          ? eq(cashAccounts.id, move.cashAccountId)
          : and(eq(cashAccounts.isDefault, true), eq(cashAccounts.isActive, true)),
      ),
    )
    .limit(1)
    .for("update");
  if (!account) throw move.cashAccountId ? notFound("Kassa topilmadi") : badRequest("Asosiy kassa belgilanmagan");
  if (!account.isActive) throw badRequest("Kassa faol emas");
  // Chaqiruvchi jurnalni shu valyuta bo'yicha yozadi — boshqa valyutadagi kassaga tushirib bo'lmaydi
  const expectedCurrency = move.currency ?? (await companyCurrency(tx, companyId));
  if (account.currency !== expectedCurrency) {
    throw badRequest(`"${account.name}" ${account.currency} valyutasida — bu amal ${expectedCurrency} da`);
  }

  if (move.referenceType && move.referenceId) {
    const [existing] = await tx
      .select(transactionFields)
      .from(cashTransactions)
      .where(
        and(
          eq(cashTransactions.companyId, companyId),
          eq(cashTransactions.cashAccountId, account.id),
          eq(cashTransactions.type, move.type),
          eq(cashTransactions.referenceType, move.referenceType),
          eq(cashTransactions.referenceId, move.referenceId),
        ),
      )
      .limit(1);
    if (existing) return { transaction: existing, account, created: false };
  }

  const delta = move.type === "in" ? move.amount : `-${move.amount}`;
  const [updated] = await tx
    .update(cashAccounts)
    .set({ balance: sql`${cashAccounts.balance} + ${delta}::numeric`, updatedAt: new Date() })
    .where(
      and(
        eq(cashAccounts.id, account.id),
        // Manfiy qoldiq HECH QAYERDA bo'lmaydi — oflayn kassa sinxroni ham istisno emas:
        // kassada bo'lmagan pul hujjatda ham ko'rinmasligi kerak.
        sql`${cashAccounts.balance} + ${delta}::numeric >= 0`,
      ),
    )
    .returning({ balance: cashAccounts.balance });
  if (!updated) throw badRequest("Kassada yetarli mablag' yo'q");

  const [transaction] = await tx
    .insert(cashTransactions)
    .values({
      companyId,
      cashAccountId: account.id,
      type: move.type,
      amount: move.amount,
      currency: account.currency,
      txDate: move.txDate,
      description: move.description,
      category: move.category ?? null,
      referenceType: move.referenceType ?? null,
      referenceId: move.referenceId ?? null,
      balanceAfter: updated.balance,
      createdBy,
      // Kursor millisekund aniqligida — now() mikrosekundi sahifalashni buzardi
      createdAt: new Date(),
    })
    .returning(transactionFields);

  return { transaction: transaction!, account, created: true };
}

// ─── Kassalar ────────────────────────────────────────────────────────────────

/** Kassalar ro'yxati — asosiy (rahbar) kassa birinchi, keyin mas'ul xodimi bilan qolganlari. */
export async function listCashAccounts(conn: DbOrTx, tenant: TenantContext, includeInactive = false) {
  return conn
    .select({ ...cashAccountFields, employeeName: employees.name, employeeCode: employees.code })
    .from(cashAccounts)
    .leftJoin(employees, eq(employees.id, cashAccounts.employeeId))
    .where(
      and(eq(cashAccounts.companyId, tenant.company.id), includeInactive ? undefined : eq(cashAccounts.isActive, true)),
    )
    .orderBy(desc(cashAccounts.isDefault), asc(cashAccounts.type), asc(cashAccounts.name));
}

async function clearDefault(tx: Tx, companyId: string) {
  await tx
    .update(cashAccounts)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(and(eq(cashAccounts.companyId, companyId), eq(cashAccounts.isDefault, true)));
}

export type CashAccountInput = {
  name: string;
  type: CashAccountType;
  bankName?: string | null;
  accountNumber?: string | null;
  isDefault?: boolean;
  openingBalance?: string;
  /** Standart — asosiy valyuta; boshqasi kompaniyada yoqilgan bo'lishi kerak. */
  currency?: string;
  /** Alohida buxgalteriya hisobi (bo'lmasa 1010 / 1020). */
  ledgerAccountId?: string | null;
  /** Bank hisobi kassada to'lov usuli sifatida ko'rinadi. */
  showInPos?: boolean;
  /** Bank hisobidan pul chiqarish komissiyasi, %. */
  outgoingCommissionPercent?: string;
  /** Kutilayotgan hisob (karta/hamyon) qaysi bank hisobiga qirqiladi. */
  settlesToCashAccountId?: string | null;
  /** Qirqim komissiyasi, % — kutilayotgan hisobdan bankka o'tkazishda ushlanadi. */
  settlementCommissionPercent?: string;
  /** Kassaning mas'ul xodimi (rahbar kassasi mas'ulsiz bo'lishi mumkin). */
  employeeId?: string | null;
};

/**
 * Kassaning mas'ul xodimi shu kompaniyaning faol xodimi bo'lishi shart —
 * begona kompaniya xodimi biriktirilmaydi (FK yo'q, tekshiruv shu yerda).
 */
async function assertEmployee(conn: DbOrTx, companyId: string, employeeId: string) {
  const [employee] = await conn
    .select({ id: employees.id, status: employees.status })
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.companyId, companyId)))
    .limit(1);
  if (!employee) throw notFound("Xodim topilmadi");
  if (employee.status !== "active") throw badRequest("Xodim faol emas");
}

/**
 * Z4: kassaning mas'uli O'Z kassasining qoldig'ini o'rnatmaydi, mas'ulini almashtirmaydi va uni yopmaydi — bu
 * boshqa rahbarning ishi (vazifalar ajratimi). Kompaniya egasi istisno.
 */
async function assertNotOwnRegister(conn: DbOrTx, tenant: TenantContext, employeeId: string | null) {
  if (!employeeId || tenant.company.ownerId === tenant.user.id) return;
  const [row] = await conn
    .select({ userId: employees.userId })
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.companyId, tenant.company.id)))
    .limit(1);
  if (row?.userId === tenant.user.id) throw forbidden("O'zingiz mas'ul bo'lgan kassada bu amalni boshqa rahbar bajaradi");
}

/** Kutilayotgan hisob (karta terminali, elektron hamyon): pul qirqimgacha shu hisobda turadi. */
export function isPendingAccountType(type: CashAccountType) {
  return type === "card" || type === "ewallet";
}

/** Qirqim manzili: shu kompaniyaning faol bank hisobi, hisobning o'zi emas va bir xil valyutada. */
async function assertSettlementTarget(conn: DbOrTx, companyId: string, targetId: string, currency: string, selfId?: string) {
  if (selfId && targetId === selfId) throw badRequest("Hisob o'zini o'ziga qirqolmaydi");
  const [target] = await conn
    .select({ type: cashAccounts.type, isActive: cashAccounts.isActive, currency: cashAccounts.currency })
    .from(cashAccounts)
    .where(and(eq(cashAccounts.id, targetId), eq(cashAccounts.companyId, companyId)))
    .limit(1);
  if (!target) throw notFound("Bank hisobi topilmadi");
  if (target.type !== "bank") throw badRequest("Qirqim faqat bank hisobiga o'tkaziladi");
  if (!target.isActive) throw badRequest("Bank hisobi faol emas");
  if (target.currency !== currency) throw badRequest("Qirqim bir xil valyutadagi bank hisobiga o'tkaziladi");
}

export async function createCashAccount(tx: Tx, tenant: TenantContext, input: CashAccountInput, meta: RequestMeta) {
  const companyId = tenant.company.id;
  const { openingBalance, currency: requestedCurrency, ...fields } = input;
  if (input.ledgerAccountId) await assertLedgerAccount(tx, companyId, input.ledgerAccountId);
  if (input.employeeId) await assertEmployee(tx, companyId, input.employeeId);
  const baseCurrency = await companyCurrency(tx, companyId);
  const currency = requestedCurrency ?? baseCurrency;
  const rate = await accountRate(tx, companyId, currency);
  if (input.isDefault && currency !== baseCurrency) {
    throw badRequest(`Asosiy kassa ${baseCurrency} valyutasida bo'lishi kerak`);
  }
  if (isPendingAccountType(input.type)) {
    if (input.isDefault) throw badRequest("Kutilayotgan hisob asosiy kassa bo'la olmaydi");
    if (currency !== baseCurrency) throw badRequest("Kutilayotgan hisob asosiy valyutada bo'ladi");
    if (input.settlesToCashAccountId) await assertSettlementTarget(tx, companyId, input.settlesToCashAccountId, currency);
    // 1030 "Kutilayotgan to'lovlar" — eski kompaniyada bo'lmasa shu yerda ochiladi
    await ensureAccountBySubtype(tx, companyId, "clearing");
  } else if (input.settlesToCashAccountId || toMinor(input.settlementCommissionPercent ?? "0") > 0n) {
    throw badRequest("Qirqim sozlamasi faqat kutilayotgan hisobda (karta, hamyon) bo'ladi");
  }
  if (input.isDefault) await clearDefault(tx, companyId);

  const [account] = await tx
    .insert(cashAccounts)
    .values({ ...fields, isDefault: input.isDefault ?? false, companyId, currency })
    .returning(cashAccountFields);

  if (openingBalance && toMinor(openingBalance) > 0n) {
    const txDate = todayIso();
    await recordCashTransaction(tx, companyId, tenant.user.id, {
      cashAccountId: account!.id,
      type: "in",
      amount: openingBalance,
      currency,
      txDate,
      description: "Boshlang'ich qoldiq",
      category: OPENING_BALANCE_CATEGORY,
      referenceType: "cash_opening_balance",
      referenceId: account!.id,
    });
    // Jurnal asosiy valyutada — valyutali kassa joriy kurs bilan
    const baseAmount = toBaseAmount(openingBalance, rate);
    await postJournalEntry(tx, companyId, tenant.user.id, {
      entryDate: txDate,
      description: `Boshlang'ich qoldiq: ${account!.name}`,
      referenceType: "cash_opening_balance",
      referenceId: account!.id,
      lines: [
        { accountId: await ledgerAccountFor(tx, companyId, account!), debit: baseAmount },
        {
          accountId: await requireAccountBySubtype(tx, companyId, "capital", "equity", "Ustav kapitali"),
          credit: baseAmount,
        },
      ],
    });
  }

  await financeAudit(tx, tenant, meta, {
    action: "CASH_ACCOUNT_CREATED",
    resource: "cash_accounts",
    resourceId: account!.id,
    details: { name: account!.name, type: account!.type, openingBalance: openingBalance ?? "0" },
  });

  const [fresh] = await tx.select(cashAccountFields).from(cashAccounts).where(eq(cashAccounts.id, account!.id));
  return fresh!;
}

export async function updateCashAccount(
  tx: Tx,
  tenant: TenantContext,
  cashAccountId: string,
  patch: {
    name?: string;
    bankName?: string | null;
    accountNumber?: string | null;
    isDefault?: boolean;
    isActive?: boolean;
    ledgerAccountId?: string | null;
    showInPos?: boolean;
    outgoingCommissionPercent?: string;
    settlesToCashAccountId?: string | null;
    settlementCommissionPercent?: string;
    employeeId?: string | null;
  },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  if (patch.ledgerAccountId) await assertLedgerAccount(tx, companyId, patch.ledgerAccountId);
  if (patch.employeeId) await assertEmployee(tx, companyId, patch.employeeId);
  const [current] = await tx
    .select(cashAccountFields)
    .from(cashAccounts)
    .where(and(eq(cashAccounts.id, cashAccountId), eq(cashAccounts.companyId, companyId)))
    .limit(1)
    .for("update");
  if (!current) throw notFound("Kassa topilmadi");
  if (patch.employeeId !== undefined || patch.isActive !== undefined) await assertNotOwnRegister(tx, tenant, current.employeeId);

  if (patch.settlesToCashAccountId !== undefined || patch.settlementCommissionPercent !== undefined) {
    if (!isPendingAccountType(current.type)) throw badRequest("Qirqim sozlamasi faqat kutilayotgan hisobda (karta, hamyon) bo'ladi");
    if (patch.settlesToCashAccountId) {
      await assertSettlementTarget(tx, companyId, patch.settlesToCashAccountId, current.currency, current.id);
    }
  }
  if (current.isDefault && patch.isDefault === false) {
    throw badRequest("Asosiy kassani olib bo'lmaydi — boshqa kassani asosiy qiling");
  }
  if ((patch.isDefault ?? current.isDefault) && !(patch.isActive ?? current.isActive)) {
    throw badRequest("Asosiy kassa faol bo'lishi kerak");
  }
  if (current.isActive && patch.isActive === false && toMinor(current.balance) !== 0n) {
    throw conflict("Kassada mablag' bor — avval boshqa kassaga o'tkazing");
  }
  if (patch.isDefault && current.currency !== (await companyCurrency(tx, companyId))) {
    throw badRequest("Asosiy kassa asosiy valyutada bo'lishi kerak");
  }
  if (patch.isDefault && !current.isDefault) await clearDefault(tx, companyId);

  const [updated] = await tx
    .update(cashAccounts)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(cashAccounts.id, cashAccountId))
    .returning(cashAccountFields);

  await financeAudit(tx, tenant, meta, {
    action: "CASH_ACCOUNT_UPDATED",
    resource: "cash_accounts",
    resourceId: cashAccountId,
    details: { changes: Object.keys(patch) },
  });
  return updated!;
}

/**
 * Kassa/bank qoldig'ini to'g'rilash: hisobdagi qoldiq haqiqiy puldan farq qilsa — to'g'ri qiymatga o'rnatiladi.
 * Farq oddiy kirim yoki chiqim tranzaksiyasi bo'lib yoziladi (hisob tarixida ko'rinadi), jurnalda esa "Boshqa
 * daromadlar" (qoldiq oshsa) yoki "Boshqa xarajatlar" (kamaysa) bilan yopiladi. Sabab majburiy va audit jurnaliga
 * tushadi; yopilgan davrga tuzatish kiritilmaydi.
 */
export async function setCashAccountBalance(
  tx: Tx,
  tenant: TenantContext,
  cashAccountId: string,
  input: { balance: string; reason: string; txDate?: string },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const reason = input.reason.trim();
  if (reason.length < 3) throw badRequest("To'g'rilash sababi ko'rsatilishi kerak");
  const target = toMinor(input.balance);
  if (target < 0n) throw badRequest("Qoldiq manfiy bo'lmaydi");

  const txDate = input.txDate ?? todayIso();
  await assertPeriodOpen(tx, companyId, txDate);
  const [current] = await tx
    .select(cashAccountFields)
    .from(cashAccounts)
    .where(and(eq(cashAccounts.id, cashAccountId), eq(cashAccounts.companyId, companyId)))
    .limit(1)
    .for("update");
  if (!current) throw notFound("Kassa topilmadi");
  if (!current.isActive) throw badRequest("Kassa faol emas");
  await assertNotOwnRegister(tx, tenant, current.employeeId);

  const delta = target - toMinor(current.balance);
  if (delta === 0n) return { cashAccount: current, transaction: null, delta: "0.00" };

  const amount = fromMinor(delta > 0n ? delta : -delta);
  const referenceId = randomUUID();
  const description = `Qoldiq to'g'rilandi: ${reason}`;
  const { account, transaction } = await recordCashTransaction(tx, companyId, tenant.user.id, {
    cashAccountId,
    type: delta > 0n ? "in" : "out",
    amount,
    currency: current.currency,
    txDate,
    description,
    category: "tuzatish",
    referenceType: "cash_adjustment",
    referenceId,
  });
  // Jurnal asosiy valyutada — valyutali hisob joriy kurs bilan
  const baseAmount = toBaseAmount(amount, await accountRate(tx, companyId, current.currency));
  const ledger = await ledgerAccountFor(tx, companyId, account);
  await postJournalEntry(tx, companyId, tenant.user.id, {
    entryDate: txDate,
    description: `${description} (${current.name})`,
    referenceType: "cash_adjustment",
    referenceId,
    lines:
      delta > 0n
        ? [
            { accountId: ledger, debit: baseAmount },
            { accountId: await requireAccountBySubtype(tx, companyId, "other", "income", "Boshqa daromadlar"), credit: baseAmount },
          ]
        : [
            { accountId: await requireAccountBySubtype(tx, companyId, "other", "expense", "Boshqa xarajatlar"), debit: baseAmount },
            { accountId: ledger, credit: baseAmount },
          ],
  });

  await financeAudit(tx, tenant, meta, {
    action: "CASH_ACCOUNT_BALANCE_ADJUSTED",
    resource: "cash_accounts",
    resourceId: cashAccountId,
    details: { reason, before: current.balance, after: fromMinor(target), delta: fromMinor(delta) },
  });
  const [fresh] = await tx.select(cashAccountFields).from(cashAccounts).where(eq(cashAccounts.id, cashAccountId));
  return { cashAccount: fresh!, transaction, delta: fromMinor(delta) };
}

// ─── Tranzaksiyalar ──────────────────────────────────────────────────────────

export async function listCashTransactions(
  conn: DbOrTx,
  tenant: TenantContext,
  options: { cashAccountId: string; dateFrom?: string; dateTo?: string; limit: number; cursor?: string },
) {
  const [account] = await conn
    .select({ id: cashAccounts.id })
    .from(cashAccounts)
    .where(and(eq(cashAccounts.id, options.cashAccountId), eq(cashAccounts.companyId, tenant.company.id)))
    .limit(1);
  if (!account) throw notFound("Kassa topilmadi");

  let after: { at: Date; id: string } | null = null;
  if (options.cursor) {
    const [iso, id] = decodeCursor(options.cursor, 2) as [string, string];
    const at = new Date(iso);
    if (Number.isNaN(at.getTime()) || !UUID_RE.test(id)) throw badRequest("Kursor noto'g'ri");
    after = { at, id };
  }

  const rows = await conn
    .select(transactionFields)
    .from(cashTransactions)
    .where(
      and(
        eq(cashTransactions.companyId, tenant.company.id),
        eq(cashTransactions.cashAccountId, account.id),
        options.dateFrom ? gte(cashTransactions.txDate, options.dateFrom) : undefined,
        options.dateTo ? lte(cashTransactions.txDate, options.dateTo) : undefined,
        after
          ? or(
              lt(cashTransactions.createdAt, after.at),
              and(eq(cashTransactions.createdAt, after.at), lt(cashTransactions.id, after.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(cashTransactions.createdAt), desc(cashTransactions.id))
    .limit(options.limit + 1);

  const page = rows.slice(0, options.limit);
  const last = page.at(-1);
  return {
    transactions: page,
    nextCursor: rows.length > options.limit && last ? encodeCursor([last.createdAt.toISOString(), last.id]) : null,
  };
}

export async function recordManualCashTransaction(
  tx: Tx,
  tenant: TenantContext,
  input: {
    cashAccountId: string;
    type: "in" | "out";
    amount: string;
    txDate?: string;
    description: string;
    category?: string | null;
    counterAccountId?: string | null;
  },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  await assertPeriodOpen(tx, companyId, input.txDate ?? todayIso());
  const txDate = input.txDate ?? todayIso();
  const [target] = await tx
    .select({ currency: cashAccounts.currency })
    .from(cashAccounts)
    .where(and(eq(cashAccounts.id, input.cashAccountId), eq(cashAccounts.companyId, companyId)))
    .limit(1);
  if (!target) throw notFound("Kassa topilmadi");
  const { transaction, account } = await recordCashTransaction(tx, companyId, tenant.user.id, {
    cashAccountId: input.cashAccountId,
    type: input.type,
    amount: input.amount,
    currency: target.currency,
    txDate,
    description: input.description,
    category: input.category ?? null,
  });

  // Qarshi hisob tanlanmasa — kirim "Boshqa daromadlar", chiqim "Boshqa xarajatlar": kassa qoldig'i va buxgalteriya
  // (1010/1020) har doim sinxron. Egasining puli bo'lsa formada "Ustav kapitali" tanlanadi
  const counterAccountId =
    input.counterAccountId ??
    (await requireAccountBySubtype(
      tx,
      companyId,
      "other",
      input.type === "in" ? "income" : "expense",
      input.type === "in" ? "Boshqa daromadlar" : "Boshqa xarajatlar",
    ));
  // Quyidagi blok yo yozuv yaratadi, yo xato tashlaydi — shuning uchun boshlang'ich qiymat keraksiz
  let journalEntryId: string;
  {
    const [counter] = await tx
      .select({ id: accounts.id, subtype: accounts.subtype })
      .from(accounts)
      .where(and(eq(accounts.id, counterAccountId), eq(accounts.companyId, companyId)))
      .limit(1);
    if (!counter) throw badRequest("Qarshi hisob topilmadi");
    // Audit AUD-012: nazorat hisoblari (debitor, kreditor, zaxira, boshqa kassa/bank, avans…) o'z hujjatlari bilan
    // yuritiladi — qo'lda kassa harakati ularni o'zgartirsa, mijoz/ta'minotchi qarzi va ombor jurnaldan ajraladi
    if (counter.subtype && MANUAL_BLOCKED_SUBTYPES.has(counter.subtype)) {
      throw badRequest("Bu hisob qo'lda kassa harakati uchun qarshi hisob bo'la olmaydi — mijoz/ta'minotchi to'lovi, o'tkazma yoki tegishli hujjatdan foydalaning");
    }
    const ledger = await ledgerAccountFor(tx, companyId, account);
    if (ledger === counter.id) throw badRequest("Qarshi hisob kassaning o'z hisobi bo'lishi mumkin emas");

    // Jurnal asosiy valyutada — valyutali kassa joriy kurs bilan
    const baseAmount = toBaseAmount(input.amount, await accountRate(tx, companyId, account.currency));
    const lines =
      input.type === "in"
        ? [{ accountId: ledger, debit: baseAmount }, { accountId: counter.id, credit: baseAmount }]
        : [{ accountId: counter.id, debit: baseAmount }, { accountId: ledger, credit: baseAmount }];
    const { entry } = await postJournalEntry(tx, companyId, tenant.user.id, {
      entryDate: txDate,
      description: input.description,
      referenceType: "cash_transaction",
      referenceId: transaction.id,
      lines,
    });
    journalEntryId = entry.id;
  }

  // Bank hisobidan qo'lda chiqim — hisob komissiyasi alohida "Bank komissiyasi" xarajati
  if (input.type === "out") {
    await applyOutgoingBankCommission(tx, tenant, {
      cashAccountId: account.id,
      amount: input.amount,
      date: txDate,
      description: input.description,
      sourceType: "cash_transaction",
      sourceId: transaction.id,
    });
  }

  await financeAudit(tx, tenant, meta, {
    action: "CASH_TRANSACTION_RECORDED",
    resource: "cash_transactions",
    resourceId: transaction.id,
    details: { cashAccountId: account.id, type: input.type, amount: input.amount, journalEntryId },
  });
  return { transaction, journalEntryId };
}

export async function transferCash(
  tx: Tx,
  tenant: TenantContext,
  input: { fromCashAccountId: string; toCashAccountId: string; amount: string; txDate?: string; description?: string | null },
  meta: RequestMeta,
) {
  if (input.fromCashAccountId === input.toCashAccountId) throw badRequest("Bir xil hisob tanlandi");
  const companyId = tenant.company.id;

  // Ikkala qator doimiy tartibda qulflanadi — qarama-qarshi o'tkazmalar deadlock bermaydi
  const pair = await tx
    .select(cashAccountFields)
    .from(cashAccounts)
    .where(and(eq(cashAccounts.companyId, companyId), inArray(cashAccounts.id, [input.fromCashAccountId, input.toCashAccountId])))
    .orderBy(asc(cashAccounts.id))
    .for("update");
  const source = pair.find((a) => a.id === input.fromCashAccountId);
  const target = pair.find((a) => a.id === input.toCashAccountId);
  if (!source || !target) throw notFound("Kassa topilmadi");
  if (source.currency !== target.currency) throw badRequest("O'tkazma faqat bir xil valyutadagi hisoblar orasida");

  const referenceId = randomUUID();
  const txDate = input.txDate ?? todayIso();
  // Audit AUD-011: foydalanuvchi tanlagan sana yopilgan davrga tushmasin (oflayn kassa sinxroni — istisno)
  await assertPeriodOpen(tx, companyId, txDate);
  const description = input.description || `${source.name} → ${target.name}`;
  const common = {
    amount: input.amount,
    currency: source.currency,
    txDate,
    description,
    category: TRANSFER_CATEGORY,
    referenceType: "cash_transfer",
    referenceId,
  };

  const out = await recordCashTransaction(tx, companyId, tenant.user.id, { ...common, cashAccountId: source.id, type: "out" });
  const into = await recordCashTransaction(tx, companyId, tenant.user.id, { ...common, cashAccountId: target.id, type: "in" });

  // Hisoblar rejasidagi hisob farq qilsa (kassa ↔ bank yoki alohida bog'langan bank hisoblari) — jurnalda ham pul ko'chadi
  let journalEntryId: string | null = null;
  const targetLedger = await ledgerAccountFor(tx, companyId, target);
  const sourceLedger = await ledgerAccountFor(tx, companyId, source);
  if (targetLedger !== sourceLedger) {
    const baseAmount = toBaseAmount(input.amount, await accountRate(tx, companyId, source.currency));
    const { entry } = await postJournalEntry(tx, companyId, tenant.user.id, {
      entryDate: txDate,
      description,
      referenceType: "cash_transfer",
      referenceId,
      lines: [
        { accountId: targetLedger, debit: baseAmount },
        { accountId: sourceLedger, credit: baseAmount },
      ],
    });
    journalEntryId = entry.id;
  }

  // Bank hisobidan o'tkazma (masalan, bankdan kassaga naqdlash) — manba hisob komissiyasi
  await applyOutgoingBankCommission(tx, tenant, {
    cashAccountId: source.id,
    amount: input.amount,
    date: txDate,
    description,
    sourceType: "cash_transfer",
    sourceId: referenceId,
  });

  await financeAudit(tx, tenant, meta, {
    action: "CASH_TRANSFERRED",
    resource: "cash_transactions",
    resourceId: referenceId,
    details: { from: source.id, to: target.id, amount: input.amount, journalEntryId },
  });
  return { referenceId, from: out.transaction, to: into.transaction, journalEntryId };
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export async function financeDashboard(conn: DbOrTx, tenant: TenantContext) {
  const companyId = tenant.company.id;
  const monthStart = `${todayIso().slice(0, 7)}-01`;

  const accountList = await listCashAccounts(conn, tenant);
  // Valyutali kassalar joriy kurs bilan asosiy valyutada qo'shiladi
  const baseCurrency = await companyCurrency(conn, companyId);
  const rateRows = await conn
    .select({ code: companyCurrencies.code, rate: companyCurrencies.rate })
    .from(companyCurrencies)
    .where(eq(companyCurrencies.companyId, companyId));
  const rateOf = new Map(rateRows.map((row) => [row.code, toMinor(row.rate, 4)]));
  const inBase = (account: { balance: string; currency: string }) =>
    account.currency === baseCurrency
      ? toMinor(account.balance)
      : rescale(toMinor(account.balance) * (rateOf.get(account.currency) ?? 0n), 6, 2);
  const totalOf = (type: CashAccountType) =>
    accountList.filter((a) => a.type === type).reduce((s, a) => s + inBase(a), 0n);

  // Tushum va chiqim hisob valyutasida — joriy kurs bilan asosiy valyutaga o'tkaziladi
  const cashRows = await conn
    .select({
      currency: cashAccounts.currency,
      income: sql<string>`coalesce(sum(${cashTransactions.amount}) filter (where ${cashTransactions.type} = 'in'), 0)::numeric(18,2)`,
      expense: sql<string>`coalesce(sum(${cashTransactions.amount}) filter (where ${cashTransactions.type} = 'out'), 0)::numeric(18,2)`,
    })
    .from(cashTransactions)
    .innerJoin(cashAccounts, eq(cashAccounts.id, cashTransactions.cashAccountId))
    .where(
      and(
        eq(cashTransactions.companyId, companyId),
        gte(cashTransactions.txDate, monthStart),
        or(isNull(cashTransactions.category), notInArray(cashTransactions.category, [TRANSFER_CATEGORY, OPENING_BALANCE_CATEGORY])),
      ),
    )
    .groupBy(cashAccounts.currency);
  const monthIncome = cashRows.reduce((sum, row) => sum + inBase({ balance: row.income, currency: row.currency }), 0n);
  const monthExpense = cashRows.reduce((sum, row) => sum + inBase({ balance: row.expense, currency: row.currency }), 0n);

  const [sales] = await conn
    .select({ total: sql<string>`coalesce(sum(${salesOrders.totalAmount}), 0)::numeric(18,2)` })
    .from(salesOrders)
    .where(and(eq(salesOrders.companyId, companyId), gte(salesOrders.orderDate, monthStart), ne(salesOrders.status, "cancelled")));

  const [purchases] = await conn
    .select({ total: sql<string>`coalesce(sum(${purchaseOrders.totalAmount}), 0)::numeric(18,2)` })
    .from(purchaseOrders)
    .where(
      and(eq(purchaseOrders.companyId, companyId), gte(purchaseOrders.orderDate, monthStart), ne(purchaseOrders.status, "cancelled")),
    );

  const totalCash = totalOf("cash");
  const totalBank = totalOf("bank");
  return {
    totalCash: fromMinor(totalCash),
    totalBank: fromMinor(totalBank),
    totalBalance: fromMinor(totalCash + totalBank),
    monthIncome: fromMinor(monthIncome),
    monthExpense: fromMinor(monthExpense),
    monthNetCash: fromMinor(monthIncome - monthExpense),
    monthSalesTotal: sales!.total,
    monthPurchaseTotal: purchases!.total,
    accounts: accountList,
  };
}
