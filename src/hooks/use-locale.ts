import { useTranslation } from "react-i18next";

/**
 * Locale-aware number, currency, and date formatting hook.
 * Uses the current i18n language to pick the right locale.
 */

const LOCALE_MAP: Record<string, string> = {
  uz: "uz-UZ",
  ru: "ru-RU",
  kk: "kk-KZ",
};

const CURRENCY_MAP: Record<string, string> = {
  uz: "UZS",
  ru: "RUB",
  kk: "KZT",
};

export function useLocale() {
  const { i18n } = useTranslation();
  const lang = i18n.language as "uz" | "ru" | "kk";
  const locale = LOCALE_MAP[lang] ?? "uz-UZ";
  const currency = CURRENCY_MAP[lang] ?? "UZS";

  const fmtNumber = (n: number, opts?: Intl.NumberFormatOptions) =>
    new Intl.NumberFormat(locale, opts).format(n);

  const fmtCompact = (n: number) =>
    new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(n);

  const fmtCurrency = (n: number, overrideCurrency?: string) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency: overrideCurrency ?? "UZS",
      maximumFractionDigits: 0,
    }).format(n);

  const fmtCurrencyCompact = (n: number) =>
    fmtCompact(n) + " " + (lang === "ru" ? "сум" : lang === "kk" ? "сом" : "so'm");

  const fmtDate = (d: string | Date, opts?: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, opts ?? { dateStyle: "medium" }).format(
      typeof d === "string" ? new Date(d) : d
    );

  const fmtDateTime = (d: string | Date) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(
      typeof d === "string" ? new Date(d) : d
    );

  const fmtPercent = (n: number) =>
    new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(n / 100);

  return {
    locale,
    lang,
    currency,
    fmtNumber,
    fmtCompact,
    fmtCurrency,
    fmtCurrencyCompact,
    fmtDate,
    fmtDateTime,
    fmtPercent,
  };
}
