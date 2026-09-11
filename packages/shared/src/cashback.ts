/**
 * Keshbek sozlamalari — API (tekshirish, hisoblash) va frontend (sozlamalar, POS) uchun umumiy tur.
 * Foizlar 0–100, summalar so'mda. Zod sxemasi API'da.
 */

export type CashbackAccrualBase = "paid" | "total";
export type CashbackTier = { minAmount: number; percent: number };
export type CashbackCategoryRate = { categoryId: string; percent: number };

export type CashbackSettings = {
  enabled: boolean;
  /** paid — faqat pul bilan to'langan qismiga (keshbek bilan to'langan va qarzga yozilganiga emas); total — butun chekka. */
  accrualBase: CashbackAccrualBase;
  /** Chekning necha foizigacha keshbek bilan to'lash mumkin; 100 — cheklovsiz. */
  maxUsagePercent: number;
  /** Chek summasi ≥ minAmount bo'lgan eng katta pog'ona foizi. */
  tiers: CashbackTier[];
  /** Kategoriya foizi pog'onadan ustun; ichki kategoriyalarga ham tegishli (eng yaqin ota kategoriya). */
  categoryRates: CashbackCategoryRate[];
};

export const CASHBACK_LIMITS = { maxTiers: 20, maxCategoryRates: 200, maxMinAmount: 1_000_000_000_000 };

export const DEFAULT_CASHBACK_SETTINGS: CashbackSettings = {
  enabled: false,
  accrualBase: "paid",
  maxUsagePercent: 100,
  tiers: [{ minAmount: 0, percent: 1 }],
  categoryRates: [],
};
