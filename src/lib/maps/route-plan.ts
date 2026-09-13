/** Server marshrut rejasi (`/api/delivery/route-plan`, `/api/delivery/agent/route`, distribyutsiya optimallashtirish). */
import type { TFunction } from "i18next";
import type { LatLng } from "./types.ts";

export type PlannedStop = LatLng & {
  id: string;
  /** Tashrif tartibi (1 dan). */
  position: number;
  legMeters: number;
  legSeconds: number;
};

export type RoutePlan = {
  /** `road` — yo'l tarmog'i bo'yicha, `straight` — to'g'ri chiziq bo'yicha taxmin. */
  source: "road" | "straight";
  origin: LatLng | null;
  stops: PlannedStop[];
  totalMeters: number;
  totalSeconds: number;
  /** [kenglik, uzunlik] — faqat yo'l bo'yicha rejada. */
  geometry: [number, number][] | null;
};

export type OriginSource = "given" | "agent_location" | "none";

/** Agentning kunlik marshruti (tavsiya etilgan tartib + reja). */
export type AgentDayRoute<Task> = {
  route: RoutePlan;
  taskIds: string[];
  unlocatedTaskIds: string[];
  originSource: OriginSource;
  tasks: Task[];
};

export function formatDuration(seconds: number, t: TFunction<"map">): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes < 60 ? t("duration_min", { minutes }) : t("duration_h", { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

/** Chizish uchun chiziq: yo'l geometriyasi, bo'lmasa boshlang'ich joy va nuqtalar orqali to'g'ri chiziq. */
export function routeLine(plan: RoutePlan): LatLng[] {
  if (plan.geometry) return plan.geometry.map(([latitude, longitude]) => ({ latitude, longitude }));
  return [...(plan.origin ? [plan.origin] : []), ...plan.stops];
}
