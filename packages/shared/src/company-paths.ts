/**
 * Biznes manzili: `app.bum-erp.uz/{biznes}/{bo'lim}` (masalan `/bonnu-market/purchase`).
 * Birinchi bo'lak — kompaniya slug'i; ilova yo'llari va til kodlari slug bo'la olmaydi. Slug bo'lmasa yoki band so'z bo'lsa —
 * kompaniya id'si ishlatiladi (manzil baribir ishlaydi).
 */

/** Ilova yo'llari, til kodlari va xizmat nomlari — kompaniya slug'i sifatida berilmaydi. */
export const RESERVED_COMPANY_PATHS: readonly string[] = [
  "admin", "app", "auth", "www", "api", "mail", "ftp", "support", "billing", "status", "dev", "staging",
  "help", "docs", "blog", "t", "tenant", "platform",
  "uz", "ru", "kk", "kz", "en",
  "login", "onboarding", "select-company", "sales-agent", "delivery-agent", "dashboard", "settings", "subscription",
  "assets", "icon", "offline", "manifest",
];

export const COMPANY_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** URL'dagi biznes bo'lagi: yaroqli va band bo'lmagan slug, aks holda id. */
export function companyPathKey(slug: string | null | undefined, id: string | null | undefined): string | null {
  if (!id) return null;
  const key = slug?.trim().toLowerCase();
  return key && COMPANY_SLUG_PATTERN.test(key) && !RESERVED_COMPANY_PATHS.includes(key) ? key : id;
}
