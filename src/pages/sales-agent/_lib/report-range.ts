/** Hisobot davri (FROM/TO) — mahalliy sana, `YYYY-MM-DD`. Server ham tekshiradi (93 kungacha). */
export type ReportRange = { from: string; to: string };
export type ReportPreset = "today" | "week" | "month" | "last_month";

export const REPORT_PRESETS: ReportPreset[] = ["today", "week", "month", "last_month"];

const pad = (value: number) => String(value).padStart(2, "0");
const isoOf = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export function presetRange(preset: ReportPreset, now = new Date()): ReportRange {
  const today = isoOf(now);
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "week":
      return { from: isoOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)), to: today };
    case "month":
      return { from: isoOf(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
    case "last_month":
      return {
        from: isoOf(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        to: isoOf(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
  }
}
