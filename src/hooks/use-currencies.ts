/**
 * Valyutalar va kurslar — `GET /api/finance/currencies`.
 * Narxni ko'rsatish va oldindan hisoblash uchun; aniq hisob serverda (hujjat kursi bilan).
 */
import { currencySymbol, type CurrencySettings } from "@bum/shared";
import { useApiQuery } from "@/lib/query.ts";

export const CURRENCIES_PATH = "/api/finance/currencies";

export function useCurrencies() {
  const data = useApiQuery<CurrencySettings>(CURRENCIES_PATH, undefined, { staleTime: 5 * 60_000 }).data;
  const base = data?.baseCurrency ?? "UZS";
  const active = (data?.currencies ?? []).filter((c) => c.isActive);

  /** 1 birlik `code` necha asosiy valyuta; yoqilmagan valyuta — NaN. */
  const rateOf = (code: string | null | undefined) =>
    !code || code === base ? 1 : Number(active.find((c) => c.code === code)?.rate ?? Number.NaN);

  /** Summa asosiy valyutada (4 kasrgacha yaxlitlangan). */
  const toBase = (amount: string | number, code: string | null | undefined) =>
    Math.round((Number(amount) || 0) * rateOf(code) * 10_000) / 10_000;

  return {
    loaded: data !== undefined,
    base,
    /** Asosiy valyuta birinchi, keyin yoqilganlari. */
    codes: [base, ...active.map((c) => c.code)],
    rateOf,
    toBase,
  };
}

/** "12 500 so'm", "10,5 $" */
export function formatMoney(amount: string | number, code: string) {
  const value = Number(amount) || 0;
  const digits = code === "UZS" ? 0 : 2;
  return `${new Intl.NumberFormat("uz-UZ", { maximumFractionDigits: digits }).format(value)} ${currencySymbol(code)}`;
}
