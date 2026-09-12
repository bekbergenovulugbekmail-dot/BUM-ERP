/**
 * Dostavka ko'rinish yordamchilari: holat va ustuvorlik ranglari, masofa, vaqt oynasi, sana-vaqt.
 */
import type { DeliveryPriority, DeliveryStatus } from "@bum/shared";

export const STATUS_TONE: Record<DeliveryStatus, string> = {
  ready: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
  assigned: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  accepted: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400",
  out_for_delivery: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  arrived: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400",
  delivering: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  delivered: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  partially_delivered: "bg-lime-500/15 text-lime-700 dark:text-lime-400",
  failed: "bg-red-500/10 text-red-700 dark:text-red-400",
  returned: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  cancelled: "bg-muted text-muted-foreground",
};

export const PRIORITY_TONE: Record<DeliveryPriority, string> = {
  low: "bg-muted text-muted-foreground",
  normal: "bg-muted text-muted-foreground",
  high: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  urgent: "bg-red-600 text-white",
};

/** Masofa: 1 km gacha metrda, keyin km (10 km dan — butun). */
export function formatDistance(meters: number | null | undefined): string | null {
  if (meters === null || meters === undefined || !Number.isFinite(meters)) return null;
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters >= 10_000 ? 0 : 1)} km`;
}

/** Bazadagi numeric koordinata juftligi → nuqta (biri yo'q yoki noto'g'ri bo'lsa — null). */
export function coordsOf(latitude: string | number | null | undefined, longitude: string | number | null | undefined) {
  if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) return null;
  const point = { latitude: Number(latitude), longitude: Number(longitude) };
  return Number.isFinite(point.latitude) && Number.isFinite(point.longitude) ? point : null;
}

export function timeWindow(start: string | null, end: string | null): string | null {
  return start && end ? `${start}–${end}` : null;
}

export function formatDateTime(value: string | Date | null | undefined, locale: string): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function formatTime(value: string | Date | null | undefined, locale: string): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
