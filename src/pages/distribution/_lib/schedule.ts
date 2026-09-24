import { toApiDay, type DistributionRoute } from "./types.ts";

/** Haftalik jadval tugmalari — dushanbadan boshlanadi (API esa yakshanbadan sanaydi). */
export const DAY_CHIPS = ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"];
export const DAY_NAMES = ["Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba", "Yakshanba"];

export type AgentScheduleRow = {
  id: string;
  name: string;
  /** UI kuni (0 — dushanba) bo'yicha o'sha kuni yuriladigan marshrutlar. */
  perDay: DistributionRoute[][];
  /** Kunlik do'kon soni (UI kuni bo'yicha). */
  perDayStores: number[];
  /** Haftada tashrif buyuriladigan do'konlar yig'indisi (bir do'kon ikki kun bo'lsa ikki marta). */
  stores: number;
  /** Ish kunlarining o'rtacha yuki — og'ir kunni shu bilan solishtiriladi. */
  averageStores: number;
};

/**
 * Og'ir kun chegarasi: ish kunlari o'rtachasidan shuncha baravar ko'p bo'lsa ajratib ko'rsatiladi.
 *
 * Bir kunda bir nechta marshrut bo'lishi ham, bir marshrutga haftada bir necha marta chiqish ham
 * NORMAL (egasi tasdiqladi) — shuning uchun marshrut SONI emas, aynan kunlik YUK o'lchanadi.
 */
export const HEAVY_DAY_RATIO = 1.5;

export function isHeavyDay(row: AgentScheduleRow, day: number): boolean {
  const stores = row.perDayStores[day] ?? 0;
  if (stores === 0 || row.averageStores === 0) return false;
  return stores >= row.averageStores * HEAVY_DAY_RATIO;
}

/**
 * Marshrutlarni AGENT kesimiga o'giradi.
 *
 * Jadval marshrutning o'zida (`days`) saqlanadi, shuning uchun bitta marshrutni tahrirlayotgan
 * odam agentning haftasi qanday ko'rinishini bilmaydi — bir kunda ikkita marshrut tushib qolgani
 * faqat agent ilovasida bilinardi. Shu funksiya o'sha ko'rinishni beradi.
 */
export function buildAgentRows(routes: DistributionRoute[]): AgentScheduleRow[] {
  const byAgent = new Map<string, AgentScheduleRow>();
  for (const route of routes) {
    if (!route.salesRepId) continue;
    let row = byAgent.get(route.salesRepId);
    if (!row) {
      row = {
        id: route.salesRepId,
        name: route.salesRepName ?? "—",
        perDay: Array.from({ length: 7 }, () => []),
        perDayStores: Array.from({ length: 7 }, () => 0),
        stores: 0,
        averageStores: 0,
      };
      byAgent.set(route.salesRepId, row);
    }
    for (let day = 0; day < 7; day += 1) {
      if (route.days.includes(toApiDay(day))) {
        row.perDay[day]!.push(route);
        row.perDayStores[day] += route.customerCount;
        row.stores += route.customerCount;
      }
    }
  }
  for (const row of byAgent.values()) {
    const workingDays = row.perDayStores.filter((stores) => stores > 0).length;
    row.averageStores = workingDays === 0 ? 0 : row.stores / workingDays;
  }
  return [...byAgent.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Jadvalga umuman tushmaydigan marshrutlar: agenti yo'q yoki hafta kuni belgilanmagan. */
export function offScheduleRoutes(routes: DistributionRoute[]): DistributionRoute[] {
  return routes.filter((route) => !route.salesRepId || route.days.length === 0);
}

export type DayTotal = { routes: number; agents: number; stores: number };

/** Kunlik yuk: o'sha kuni nechta agent, nechta marshrut va nechta do'kon. */
export function dayTotals(routes: DistributionRoute[]): DayTotal[] {
  return Array.from({ length: 7 }, (_, day) => {
    const onDay = routes.filter((route) => route.salesRepId && route.days.includes(toApiDay(day)));
    return {
      routes: onDay.length,
      agents: new Set(onDay.map((route) => route.salesRepId)).size,
      stores: onDay.reduce((sum, route) => sum + route.customerCount, 0),
    };
  });
}
