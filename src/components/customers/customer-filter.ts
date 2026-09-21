/**
 * Mijozlarni saralash holati va uni so'rov parametrlariga aylantirish
 * (UI — `customer-filters.tsx`; server tomoni — `GET /api/sales/customers`).
 */

/** Radix Select bo'sh qiymatni qabul qilmaydi — "barchasi" uchun sentinel. */
export const ALL = "__all__";

/** Hudud juftligi; hududi ko'rsatilmagan mijozlar `city: null` bo'lib keladi. */
export type CustomerRegion = { city: string | null; district: string | null; count: number };

export const CUSTOMER_SORTS = [
  { value: "name", label: "Nomi (A–Z)" },
  { value: "newest", label: "Oxirgi qo'shilganlar" },
  { value: "oldest", label: "Avval qo'shilganlar" },
  { value: "debt", label: "Qarzi ko'p" },
  { value: "purchases", label: "Xaridi ko'p" },
] as const;
export type CustomerSort = (typeof CUSTOMER_SORTS)[number]["value"];

export type CustomerFilter = { city: string; district: string; sort: CustomerSort; withDebt: boolean };

export const emptyCustomerFilter: CustomerFilter = { city: ALL, district: ALL, sort: "name", withDebt: false };

/** `useApiQuery` ga beriladigan parametrlar (standart qiymatlar so'rovga qo'shilmaydi). */
export function customerFilterParams(filter: CustomerFilter) {
  return {
    city: filter.city === ALL ? undefined : filter.city,
    district: filter.district === ALL ? undefined : filter.district,
    withDebt: filter.withDebt || undefined,
    sort: filter.sort === "name" ? undefined : filter.sort,
  };
}

export const isCustomerFilterActive = (filter: CustomerFilter) =>
  filter.city !== ALL || filter.district !== ALL || filter.withDebt || filter.sort !== "name";

/** Shahar → mijozlar soni (hududsizlar tanlovda ko'rsatilmaydi). */
export function cityTotals(regions: CustomerRegion[]) {
  const totals = new Map<string, number>();
  for (const region of regions) {
    if (!region.city) continue;
    totals.set(region.city, (totals.get(region.city) ?? 0) + region.count);
  }
  return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/** Mahalla → mijozlar soni; shahar tanlangan bo'lsa faqat o'shaniki. */
export function districtTotals(regions: CustomerRegion[], city: string) {
  const totals = new Map<string, number>();
  for (const region of regions) {
    if (!region.district) continue;
    if (city !== ALL && region.city !== city) continue;
    totals.set(region.district, (totals.get(region.district) ?? 0) + region.count);
  }
  return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b));
}
