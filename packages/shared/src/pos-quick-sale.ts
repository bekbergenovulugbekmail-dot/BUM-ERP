/**
 * Tezkor sotuv: kompaniya tanlagan mahsulotlar (tartibi bilan) — kassada katta rasmli kartalar, bosilganda savatga +1.
 * Sozlama `pos.quickSale`, qurilmalarga pull `config.quickSale` bilan boradi (offline ham ishlaydi).
 */
export const POS_QUICK_SALE_KEY = "pos.quickSale";
export const MAX_QUICK_SALE_ITEMS = 200;
export const QUICK_SALE_PERIODS = [7, 30, 90] as const;
export type QuickSalePeriod = (typeof QUICK_SALE_PERIODS)[number];

export type PosQuickSale = { productIds: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parsePosQuickSale(raw: string | null | undefined): PosQuickSale {
  if (!raw) return { productIds: [] };
  try {
    const data = JSON.parse(raw) as { productIds?: unknown };
    const ids = Array.isArray(data.productIds) ? data.productIds.filter((id): id is string => typeof id === "string" && UUID.test(id)) : [];
    return { productIds: [...new Set(ids)].slice(0, MAX_QUICK_SALE_ITEMS) };
  } catch {
    return { productIds: [] };
  }
}

/**
 * Aksiya narxi: belgilangan va muddati o'tmagan bo'lsa (`promoPriceEnd` — shu kun ham kiradi; yo'q — muddatsiz).
 * `date` — sotuv sanasi (YYYY-MM-DD). Narx valyutasi — sotuv narxiniki.
 */
export function activePromoPrice(product: { promoPrice?: string | null; promoPriceEnd?: string | null }, date: string): string | null {
  if (product.promoPrice === null || product.promoPrice === undefined || product.promoPrice === "") return null;
  if (product.promoPriceEnd && product.promoPriceEnd < date) return null;
  return product.promoPrice;
}
