/**
 * Valyutalar va kurslar.
 *
 * Asosiy valyuta — kompaniya valyutasi (odatda UZS): kursi doim 1, jadvalda saqlanmaydi.
 * Qo'shimcha valyutalar `company_currencies` da; kurs qo'lda yoki Markaziy bankdan (CBU).
 * CBU yoqilgan bo'lsa (`settings`: `currency.cbu`) bank kursi sozlamalarda yonma-yon ko'rinadi,
 * manbasi "cbu" valyutalar kursi kuniga bir marta — birinchi o'qishda — yangilanadi.
 * Har kurs o'zgarishi `exchange_rates` tarixiga yoziladi.
 */
import { and, asc, eq } from "drizzle-orm";
import {
  MAX_COMPANY_CURRENCIES,
  badRequest,
  type CbuRate,
  type CompanyCurrency,
  type CurrencyRateSource,
  type CurrencySettings,
} from "@bum/shared";
import { db } from "../../db/client.js";
import { companyCurrencies, exchangeRates } from "../../db/schema/finance.js";
import { settings } from "../../db/schema/platform.js";
import { withTransaction, type DbOrTx, type Tx } from "../../db/transaction.js";
import { env } from "../../env.js";
import type { RequestMeta } from "../../shared/audit.js";
import { toMinor } from "../../shared/decimal.js";
import { upsertCompanySetting } from "../company/settings.service.js";
import type { TenantContext } from "../company/tenant.js";
import { companyCurrency, financeAudit } from "./accounts.service.js";

/** UTC sana (cash.service'dagi bilan bir xil) — kassa servisi bu modulni import qiladi, aylanma import bo'lmasin. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export const CBU_SETTING_KEY = "currency.cbu";
const CBU_CACHE_MS = 60 * 60 * 1000;

// ─── Markaziy bank ───────────────────────────────────────────────────────────

type CbuFetcher = () => Promise<unknown>;

const defaultFetcher: CbuFetcher = async () => {
  const response = await fetch(env.CBU_RATES_URL, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Markaziy bank javobi: ${response.status}`);
  return response.json();
};

let fetcher: CbuFetcher = defaultFetcher;
let cache: { at: number; rates: CbuRate[] } | null = null;

/** Testlar uchun tarmoqsiz manba; `null` — standart. Kesh tozalanadi. */
export function setCbuFetcher(next: CbuFetcher | null) {
  fetcher = next ?? defaultFetcher;
  cache = null;
}

/** "12650.50" / nominal → 4 kasrli satr (ortiqcha kasrlar tashlanadi). */
function perUnitRate(rate: string, nominal: bigint): string | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(rate.trim());
  if (!match || nominal <= 0n) return null;
  const minor = BigInt(match[1]! + ((match[2] ?? "") + "0000").slice(0, 4)) / nominal;
  if (minor <= 0n) return null;
  const text = minor.toString().padStart(5, "0");
  return `${text.slice(0, -4)}.${text.slice(-4)}`;
}

function parseCbu(data: unknown): CbuRate[] {
  if (!Array.isArray(data)) throw new Error("Markaziy bank javobi noto'g'ri");
  const rates: CbuRate[] = [];
  for (const item of data) {
    if (typeof item !== "object" || item === null) continue;
    const { Ccy, Rate, Nominal, Date: rawDate } = item as Record<string, unknown>;
    if (typeof Ccy !== "string" || typeof Rate !== "string") continue;
    const nominal = typeof Nominal === "string" && /^[1-9]\d*$/.test(Nominal) ? BigInt(Nominal) : 1n;
    const rate = perUnitRate(Rate, nominal);
    if (!rate) continue;
    const [day, month, year] = typeof rawDate === "string" ? rawDate.split(".") : [];
    const date = year && month && day ? `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}` : todayIso();
    rates.push({ code: Ccy.toUpperCase(), rate, date });
  }
  return rates;
}

export async function getCbuRates(options: { fresh?: boolean } = {}): Promise<CbuRate[]> {
  if (!options.fresh && cache && Date.now() - cache.at < CBU_CACHE_MS) return cache.rates;
  const rates = parseCbu(await fetcher());
  cache = { at: Date.now(), rates };
  return rates;
}

// ─── O'qish ──────────────────────────────────────────────────────────────────

async function isCbuEnabled(conn: DbOrTx, companyId: string) {
  const [row] = await conn
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.companyId, companyId), eq(settings.key, CBU_SETTING_KEY)))
    .limit(1);
  if (!row) return false;
  try {
    return (JSON.parse(row.value) as { enabled?: unknown }).enabled === true;
  } catch {
    return false;
  }
}

async function currencyRows(conn: DbOrTx, companyId: string) {
  return conn
    .select({
      code: companyCurrencies.code,
      rate: companyCurrencies.rate,
      source: companyCurrencies.source,
      isActive: companyCurrencies.isActive,
      rateDate: companyCurrencies.rateDate,
      updatedAt: companyCurrencies.updatedAt,
    })
    .from(companyCurrencies)
    .where(eq(companyCurrencies.companyId, companyId))
    .orderBy(asc(companyCurrencies.code));
}

export async function getCurrencySettings(conn: DbOrTx, companyId: string): Promise<CurrencySettings> {
  const baseCurrency = await companyCurrency(conn, companyId);
  const cbuEnabled = await isCbuEnabled(conn, companyId);
  const rows = await currencyRows(conn, companyId);
  return {
    baseCurrency,
    cbuEnabled,
    currencies: rows.map(({ updatedAt: _updatedAt, ...row }): CompanyCurrency => row),
  };
}

/** Hujjat uchun joriy kurs (1 birlik = N asosiy valyuta). Asosiy valyuta — 1. */
export async function currencyRate(conn: DbOrTx, companyId: string, code: string): Promise<string> {
  if (code === (await companyCurrency(conn, companyId))) return "1.0000";
  const [row] = await conn
    .select({ rate: companyCurrencies.rate })
    .from(companyCurrencies)
    .where(and(eq(companyCurrencies.companyId, companyId), eq(companyCurrencies.code, code), eq(companyCurrencies.isActive, true)))
    .limit(1);
  if (!row) throw badRequest(`${code} valyutasi yoqilmagan — Sozlamalar → Valyutalar`);
  return row.rate;
}

// ─── Yozish ──────────────────────────────────────────────────────────────────

async function applyRate(
  tx: Tx,
  companyId: string,
  input: { code: string; rate: string; source: CurrencyRateSource; rateDate: string; isActive?: boolean },
  userId: string | null,
) {
  const [current] = await tx
    .select({ rate: companyCurrencies.rate, rateDate: companyCurrencies.rateDate, source: companyCurrencies.source })
    .from(companyCurrencies)
    .where(and(eq(companyCurrencies.companyId, companyId), eq(companyCurrencies.code, input.code)))
    .limit(1)
    .for("update");

  if (!current) {
    await tx.insert(companyCurrencies).values({
      companyId,
      code: input.code,
      rate: input.rate,
      source: input.source,
      rateDate: input.rateDate,
      isActive: input.isActive ?? true,
      updatedBy: userId,
    });
  } else {
    await tx
      .update(companyCurrencies)
      .set({
        rate: input.rate,
        source: input.source,
        rateDate: input.rateDate,
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(userId ? { updatedBy: userId } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(companyCurrencies.companyId, companyId), eq(companyCurrencies.code, input.code)));
  }

  const changed = !current || toMinor(current.rate, 4) !== toMinor(input.rate, 4) || current.rateDate !== input.rateDate;
  if (changed) {
    await tx.insert(exchangeRates).values({
      companyId,
      code: input.code,
      rate: input.rate,
      source: input.source,
      rateDate: input.rateDate,
      createdBy: userId,
    });
  }
}

async function requireCbuRates(fresh = false) {
  try {
    return await getCbuRates({ fresh });
  } catch {
    throw badRequest("Markaziy bank kurslarini olib bo'lmadi — keyinroq urinib ko'ring yoki kursni qo'lda kiriting");
  }
}

export type CurrencySettingsInput = {
  cbuEnabled: boolean;
  currencies: { code: string; rate?: string; source: CurrencyRateSource; isActive: boolean }[];
};

export async function saveCurrencySettings(tx: Tx, tenant: TenantContext, input: CurrencySettingsInput, meta: RequestMeta) {
  const companyId = tenant.company.id;
  const baseCurrency = await companyCurrency(tx, companyId);
  const codes = input.currencies.map((c) => c.code);
  if (new Set(codes).size !== codes.length) throw badRequest("Valyuta ikki marta ko'rsatilgan");
  if (codes.includes(baseCurrency)) throw badRequest(`${baseCurrency} — asosiy valyuta, kursi doim 1`);
  if (codes.length > MAX_COMPANY_CURRENCIES) throw badRequest(`Ko'pi bilan ${MAX_COMPANY_CURRENCIES} ta valyuta`);

  const usesCbu = input.currencies.some((c) => c.source === "cbu");
  if (usesCbu && !input.cbuEnabled) throw badRequest("Markaziy bank kursidan foydalanish uchun uni yoqing");
  const cbuRates = usesCbu ? await requireCbuRates() : [];
  const today = todayIso();

  for (const currency of input.currencies) {
    if (currency.source === "cbu") {
      const cbu = cbuRates.find((r) => r.code === currency.code);
      if (!cbu) throw badRequest(`${currency.code}: Markaziy bankda bu valyuta kursi yo'q`);
      await applyRate(tx, companyId, { ...currency, rate: cbu.rate, rateDate: cbu.date }, tenant.user.id);
    } else {
      if (!currency.rate || toMinor(currency.rate, 4) <= 0n) throw badRequest(`${currency.code}: kurs kiritilishi kerak`);
      const [existing] = await tx
        .select({ rate: companyCurrencies.rate, rateDate: companyCurrencies.rateDate })
        .from(companyCurrencies)
        .where(and(eq(companyCurrencies.companyId, companyId), eq(companyCurrencies.code, currency.code)))
        .limit(1);
      // Kurs o'zgarmagan bo'lsa sanasi ham o'zgarmaydi (tarixga yozilmaydi)
      const unchanged = existing && toMinor(existing.rate, 4) === toMinor(currency.rate, 4);
      await applyRate(
        tx,
        companyId,
        { ...currency, rate: currency.rate, rateDate: unchanged ? existing.rateDate : today },
        tenant.user.id,
      );
    }
  }

  // Ro'yxatdan olib tashlangan valyuta o'chirilmaydi — faolsizlantiriladi (hujjatlar va narxlar unga bog'liq bo'lishi mumkin)
  const removed = (await currencyRows(tx, companyId)).filter((row) => row.isActive && !codes.includes(row.code));
  for (const row of removed) {
    await tx
      .update(companyCurrencies)
      .set({ isActive: false, updatedBy: tenant.user.id, updatedAt: new Date() })
      .where(and(eq(companyCurrencies.companyId, companyId), eq(companyCurrencies.code, row.code)));
  }

  await upsertCompanySetting(
    tx,
    tenant,
    {
      key: CBU_SETTING_KEY,
      value: JSON.stringify({ enabled: input.cbuEnabled }),
      group: "currency",
      description: "Markaziy bank kurslari",
    },
    meta,
  );
  await financeAudit(tx, tenant, meta, {
    action: "CURRENCIES_UPDATED",
    resource: "company_currencies",
    resourceId: companyId,
    details: {
      cbuEnabled: input.cbuEnabled,
      currencies: input.currencies.map((c) => ({ code: c.code, source: c.source, isActive: c.isActive })),
    },
  });
  return getCurrencySettings(tx, companyId);
}

/** "Hozir yangilash": manbasi "cbu" valyutalarga Markaziy bankning eng so'nggi kursi. */
export async function refreshCbuRates(tx: Tx, tenant: TenantContext, meta: RequestMeta) {
  const companyId = tenant.company.id;
  if (!(await isCbuEnabled(tx, companyId))) throw badRequest("Markaziy bank kurslari o'chirilgan");
  const rows = (await currencyRows(tx, companyId)).filter((row) => row.source === "cbu");
  if (rows.length > 0) {
    const rates = await requireCbuRates(true);
    for (const row of rows) {
      const cbu = rates.find((r) => r.code === row.code);
      if (cbu) await applyRate(tx, companyId, { code: row.code, rate: cbu.rate, source: "cbu", rateDate: cbu.date }, tenant.user.id);
    }
    await financeAudit(tx, tenant, meta, {
      action: "CURRENCY_RATES_REFRESHED",
      resource: "company_currencies",
      resourceId: companyId,
      details: { codes: rows.map((row) => row.code) },
    });
  }
  return getCurrencySettings(tx, companyId);
}

/**
 * Manbasi "cbu" valyutalar kursi bugun yangilanmagan bo'lsa — Markaziy bankdan olinadi.
 * O'qishda chaqiriladi; xatoda jim (eski kurs qoladi, sozlamalarda sanasi ko'rinadi).
 */
export async function refreshStaleCbuRates(companyId: string): Promise<void> {
  const startOfToday = new Date(`${todayIso()}T00:00:00.000Z`);
  if (!(await isCbuEnabled(db, companyId))) return;
  const stale = (await currencyRows(db, companyId)).filter(
    (row) => row.source === "cbu" && row.isActive && row.updatedAt < startOfToday,
  );
  if (stale.length === 0) return;

  let rates: CbuRate[];
  try {
    rates = await getCbuRates();
  } catch {
    return;
  }
  await withTransaction(async (tx) => {
    for (const row of stale) {
      const cbu = rates.find((r) => r.code === row.code);
      if (cbu) await applyRate(tx, companyId, { code: row.code, rate: cbu.rate, source: "cbu", rateDate: cbu.date }, null);
    }
  });
}
