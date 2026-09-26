/**
 * Supervayzer "agent nomidan" rejimi — alohida savdo ekrani EMAS: mavjud agent ish joyi (`/sales-agent`) shu agent
 * kontekstida ochiladi. So'rovlarga `x-act-as-sales-rep` sarlavhasi qo'shiladi (faqat `/api/sales-agent/*`, nazorat
 * endpointlaridan tashqari). Ruxsat, jamoa chegarasi va qaysi amal mumkinligi — SERVERDA; bu yerda faqat tanlov.
 * Tab bo'yicha (sessionStorage): boshqa oynada supervayzer o'zi sifatida qoladi.
 */
import { useMemo, useSyncExternalStore } from "react";

export const ACT_AS_HEADER = "x-act-as-sales-rep";
const KEY = "bum:act-as-sales-rep";
export const ACT_AS_EVENT = "bum:act-as";

export type ActAs = { salesRepId: string; name: string };

export function getActAs(): ActAs | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<ActAs>;
    return typeof value.salesRepId === "string" && typeof value.name === "string" ? { salesRepId: value.salesRepId, name: value.name } : null;
  } catch {
    return null;
  }
}

export function setActAs(value: ActAs | null): void {
  try {
    if (value) sessionStorage.setItem(KEY, JSON.stringify(value));
    else sessionStorage.removeItem(KEY);
  } catch {
    // saqlab bo'lmasa — rejim shu sahifa yuklanishigacha ham ishlamaydi (xavfsiz tomonga)
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(ACT_AS_EVENT));
}

/** Sarlavha qaysi so'rovlarga qo'shiladi: agent ish joyi API'si, supervayzer nazorati bundan mustasno. */
export function actAsHeaderFor(path: string): string | null {
  if (!path.startsWith("/api/sales-agent/") || path.startsWith("/api/sales-agent/supervisor")) return null;
  return getActAs()?.salesRepId ?? null;
}

function rawSnapshot(): string {
  try {
    return sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(ACT_AS_EVENT, onChange);
  return () => window.removeEventListener(ACT_AS_EVENT, onChange);
}

/** Joriy "agent nomidan" tanlovi (o'zgarsa komponent qayta chiziladi). */
export function useActAs(): ActAs | null {
  const raw = useSyncExternalStore(subscribe, rawSnapshot, () => "");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `raw` o'zgarganda qayta o'qiladi
  return useMemo(() => getActAs(), [raw]);
}
