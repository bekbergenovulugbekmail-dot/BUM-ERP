/**
 * Tashrif vaqti — serverdagi hisob bilan bir xil: taymer vitrina rasmidan boshlanadi, "pause" siyosatida hududdan
 * tashqaridagi vaqt hisoblanmaydi. Minimal vaqt server tomonidan tekshiriladi; bu faqat ekrandagi ko'rsatkich.
 */
import type { VisitExitPolicy } from "@bum/shared";
import type { AgentVisit } from "./types.ts";

type TimedVisit = Pick<AgentVisit, "timerStartedAt" | "pausedSeconds" | "outsideSince">;

export function effectiveVisitSeconds(visit: TimedVisit, now: number, exitPolicy: VisitExitPolicy): number {
  if (!visit.timerStartedAt) return 0;
  const outside = exitPolicy === "pause" && visit.outsideSince ? Math.max(0, now - new Date(visit.outsideSince).getTime()) / 1000 : 0;
  const elapsed = (now - new Date(visit.timerStartedAt).getTime()) / 1000 - visit.pausedSeconds - outside;
  return Math.max(0, Math.floor(elapsed));
}

export function remainingVisitSeconds(visit: TimedVisit, now: number, exitPolicy: VisitExitPolicy, minVisitMinutes: number): number {
  if (!visit.timerStartedAt) return minVisitMinutes * 60;
  return Math.max(0, minVisitMinutes * 60 - effectiveVisitSeconds(visit, now, exitPolicy));
}
