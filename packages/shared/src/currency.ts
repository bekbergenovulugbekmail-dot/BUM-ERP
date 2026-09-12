/**
 * Valyutalar — tanlash ro'yxati va umumiy turlar.
 * Kurs: 1 birlik valyuta necha asosiy valyuta (kompaniya valyutasi, odatda so'm); numeric satr, 4 kasr.
 */

export const CURRENCY_OPTIONS: { code: string; name: string; symbol: string }[] = [
  { code: "UZS", name: "O'zbek so'mi", symbol: "so'm" },
  { code: "USD", name: "AQSH dollari", symbol: "$" },
  { code: "EUR", name: "Yevro", symbol: "€" },
  { code: "RUB", name: "Rossiya rubli", symbol: "₽" },
  { code: "KZT", name: "Qozog'iston tengesi", symbol: "₸" },
  { code: "CNY", name: "Xitoy yuani", symbol: "¥" },
  { code: "GBP", name: "Angliya funti", symbol: "£" },
  { code: "TRY", name: "Turk lirasi", symbol: "₺" },
  { code: "KGS", name: "Qirg'iz somi", symbol: "KGS" },
  { code: "AED", name: "BAA dirhami", symbol: "AED" },
  { code: "JPY", name: "Yapon iyenasi", symbol: "JPY" },
  { code: "CHF", name: "Shveytsariya franki", symbol: "CHF" },
];

/** Asosiy valyutadan tashqari ko'pi bilan shuncha valyuta. */
export const MAX_COMPANY_CURRENCIES = 10;

export type CurrencyRateSource = "manual" | "cbu";

export type CompanyCurrency = {
  code: string;
  rate: string;
  source: CurrencyRateSource;
  isActive: boolean;
  rateDate: string;
};

export type CurrencySettings = {
  baseCurrency: string;
  /** Markaziy bank kurslari yoqilgan: sozlamalarda ko'rinadi, manbasi "cbu" valyutalar kuniga bir marta yangilanadi. */
  cbuEnabled: boolean;
  currencies: CompanyCurrency[];
};

/** Kurs o'zgarishi tarixi: kim, qachon, qaysi valyuta, eski va yangi kurs (kassadan bo'lsa — qurilma). */
export type CurrencyRateChange = {
  id: string;
  code: string;
  oldRate: string | null;
  rate: string;
  source: CurrencyRateSource;
  rateDate: string;
  createdAt: string;
  createdByName: string | null;
  deviceName: string | null;
};

/** Markaziy bank kursi: 1 birlik uchun (nominal hisobga olingan). */
export type CbuRate = { code: string; rate: string; date: string };

export const currencySymbol = (code: string) => CURRENCY_OPTIONS.find((c) => c.code === code)?.symbol ?? code;
