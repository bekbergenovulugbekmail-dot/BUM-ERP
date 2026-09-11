/**
 * Agent ish joyidagi yagona lokatsiya kuzatuvi (layout'da) — sahifalar o'z GPS so'rovini ochmaydi.
 */
import { createContext, useContext } from "react";
import type { AgentLocation } from "./use-location-tracking.ts";

export const AgentLocationContext = createContext<AgentLocation | null>(null);

export function useAgentLocation(): AgentLocation {
  const location = useContext(AgentLocationContext);
  if (!location) throw new Error("useAgentLocation faqat SalesAgentLayout ichida ishlaydi");
  return location;
}

/** API so'rovi parametrlari: barqaror nuqta bo'lsa `lat`/`lng` (masofa serverda hisoblanadi). */
export function originParams(location: Pick<AgentLocation, "origin">) {
  return location.origin ? { lat: location.origin.latitude, lng: location.origin.longitude } : undefined;
}
