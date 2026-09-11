/** ISO sanaga kun qo'shish (UTC) — "2026-09-11" + (-6) → "2026-09-05". */
export function shiftDate(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** "2.0000" → "2", "10.5000" → "10.5" — xabar matnlari uchun. */
export function trimDecimal(value: string): string {
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}
