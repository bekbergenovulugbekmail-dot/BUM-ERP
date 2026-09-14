/**
 * Dostavka real-time mijozi (`/api/delivery/ws`).
 *
 * Server faqat "nima o'zgardi" (ID, holat) ni yuboradi — mijoz tegishli so'rovlarni React Query orqali qayta oladi
 * (ma'lumot REST'dan, ruxsat bilan). Xabarlar 1 soniyada birlashtiriladi, lokatsiya — 5 soniyada. Ulanish uzilsa
 * eksponensial kutish bilan qayta ulanadi (1–30 s), internet yo'q paytda urinmaydi; sessiya tugagan (4401) yoki ruxsat
 * yo'q (4403) bo'lsa qayta urinmaydi. Jonli ulanishda davriy so'rovlar 5 daqiqagacha siyraklashadi, uzilganda odatiy
 * oraliq qaytadi.
 */
import { createContext, useContext, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { DeliveryRealtimeMessage } from "@bum/shared";
import { apiUrl } from "@/lib/api.ts";
import { notifyInBackground } from "@/lib/native/notifications.ts";

export type RealtimeStatus = "connecting" | "live" | "offline";

const BATCH_MS = 1000;
const LOCATION_BATCH_MS = 5000;
const PING_MS = 25_000;
/** Jonli ulanishda ham shu oraliqda bir marta yangilanadi (xabar yo'qolgan holat uchun). */
export const LIVE_FALLBACK_MS = 300_000;
const NO_RETRY_CODES = new Set([4401, 4403]);

const TASK_PREFIXES = [
  "/api/delivery/tasks",
  "/api/delivery/dashboard",
  "/api/delivery/ready-orders",
  "/api/delivery/reports",
  "/api/delivery/agents/live",
  "/api/delivery/agent/dashboard",
  "/api/delivery/agent/tasks",
  "/api/delivery/agent/customers",
  "/api/delivery/agent/debts",
  "/api/delivery/agent/reports",
];

/** Xabar → yangilanadigan so'rovlar (yo'l prefikslari). */
export function invalidationPrefixes(message: DeliveryRealtimeMessage): string[] {
  switch (message.type) {
    case "task":
      return TASK_PREFIXES;
    case "location":
      return ["/api/delivery/agents/live"];
    case "session":
      return ["/api/delivery/agents/live", "/api/delivery/agent/work-session", "/api/delivery/agent/dashboard"];
    case "agents":
      return ["/api/delivery/agents", "/api/delivery/dashboard"];
    case "policy":
      return ["/api/delivery/policy"];
    case "ready":
    case "resync":
      return ["/api/delivery"];
    case "pong":
      return [];
  }
}

/** Yetkazuvchi telefoniga bildirishnoma beriladigan yetkazma hodisalari (Android ilova fonda bo'lganda). */
export type AgentNotice = "assigned" | "changed" | "cancelled";

export function agentNoticeOf(message: DeliveryRealtimeMessage): AgentNotice | null {
  if (message.type !== "task") return null;
  if (message.action === "ASSIGNED") return "assigned";
  if (message.action === "CANCELLED") return "cancelled";
  return message.action === "REASSIGNED" || message.action === "UNASSIGNED" || message.action === "RESCHEDULED" ? "changed" : null;
}

/** Bir paketdagi hodisalar — bitta bildirishnoma matni. */
export function agentNoticeText(counts: Record<AgentNotice, number>): { title: string; body: string } | null {
  if (counts.assigned > 0) return { title: "Yangi yetkazma", body: `Sizga ${counts.assigned} ta yangi yetkazma biriktirildi` };
  if (counts.cancelled > 0) return { title: "Yetkazma bekor qilindi", body: `${counts.cancelled} ta yetkazma bekor qilindi` };
  if (counts.changed > 0) return { title: "Yetkazmalar o'zgardi", body: "Yetkazmalar ro'yxati yoki sanasi o'zgardi — ilovani oching" };
  return null;
}

/** Bildirishnoma bosilganda ochiladigan yetkazmalar sahifasi — joriy biznes (yoki til) segmenti saqlanadi. */
export function agentTasksPath(pathname: string): string {
  const base = pathname.split("/").filter(Boolean)[0];
  return base ? `/${encodeURIComponent(decodeURIComponent(base))}/delivery-agent/tasks` : "/";
}

/** Qayta ulanish kutishi: 1, 2, 4 … 30 s, yarmi tasodifiy (hamma bir vaqtda ulanmasin). */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 1000 * 2 ** Math.max(0, attempt));
  return Math.round(base / 2 + (random() * base) / 2);
}

export function realtimeUrl(): string {
  const url = new URL(apiUrl("/api/delivery/ws"), window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export function parseRealtimeMessage(data: unknown): DeliveryRealtimeMessage | null {
  try {
    const message = JSON.parse(String(data)) as DeliveryRealtimeMessage;
    return message && typeof message === "object" && typeof message.type === "string" ? message : null;
  } catch {
    return null;
  }
}

export function useDeliveryRealtime(enabled: boolean): RealtimeStatus {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>("offline");

  useEffect(() => {
    if (!enabled || typeof WebSocket === "undefined") return;
    let socket: WebSocket | null = null;
    let stopped = false;
    let attempt = 0;
    let retryTimer: number | undefined;
    let batchTimer: number | undefined;
    let locationTimer: number | undefined;
    const pending = new Set<string>();
    // Faqat yetkazuvchi qurilmasi (boshqaruvchi emas) — o'z yetkazmalari haqida bildirishnoma
    let agentOnly = false;
    const notices: Record<AgentNotice, number> = { assigned: 0, changed: 0, cancelled: 0 };

    const flush = () => {
      batchTimer = undefined;
      const notice = agentNoticeText(notices);
      notices.assigned = 0;
      notices.changed = 0;
      notices.cancelled = 0;
      if (notice) void notifyInBackground(notice.title, notice.body, { url: agentTasksPath(window.location.pathname) });
      const prefixes = [...pending];
      pending.clear();
      if (prefixes.length === 0) return;
      void queryClient.invalidateQueries({
        predicate: (query) => {
          const path = query.queryKey[0];
          return typeof path === "string" && prefixes.some((prefix) => path.startsWith(prefix));
        },
      });
    };
    const schedule = (prefixes: string[]) => {
      for (const prefix of prefixes) pending.add(prefix);
      if (prefixes.length > 0 && batchTimer === undefined) batchTimer = window.setTimeout(flush, BATCH_MS);
    };

    const connect = () => {
      if (stopped || socket) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setStatus("offline");
        return;
      }
      setStatus("connecting");
      const current = new WebSocket(realtimeUrl());
      socket = current;
      current.onmessage = (event) => {
        const message = parseRealtimeMessage(event.data);
        if (!message) return;
        if (message.type === "ready") {
          attempt = 0;
          agentOnly = message.agent && !message.manager;
          setStatus("live");
        }
        const notice = agentOnly ? agentNoticeOf(message) : null;
        if (notice) notices[notice] += 1;
        if (message.type === "location") {
          if (locationTimer === undefined) {
            locationTimer = window.setTimeout(() => {
              locationTimer = undefined;
              schedule(invalidationPrefixes(message));
            }, LOCATION_BATCH_MS);
          }
          return;
        }
        schedule(invalidationPrefixes(message));
      };
      current.onclose = (event) => {
        if (socket === current) socket = null;
        setStatus("offline");
        if (stopped || NO_RETRY_CODES.has(event.code)) return;
        retryTimer = window.setTimeout(connect, reconnectDelay(attempt));
        attempt += 1;
      };
      current.onerror = () => current.close();
    };

    const onOnline = () => {
      window.clearTimeout(retryTimer);
      attempt = 0;
      connect();
    };
    const onOffline = () => socket?.close();
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const ping = window.setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN) socket.send("ping");
    }, PING_MS);
    connect();

    return () => {
      stopped = true;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.clearInterval(ping);
      window.clearTimeout(retryTimer);
      window.clearTimeout(batchTimer);
      window.clearTimeout(locationTimer);
      socket?.close();
      socket = null;
    };
  }, [enabled, queryClient]);

  return enabled ? status : "offline";
}

export const DeliveryRealtimeContext = createContext<RealtimeStatus>("offline");

export const useRealtimeStatus = () => useContext(DeliveryRealtimeContext);

/** Davriy so'rov oralig'i: jonli ulanishda — 5 daqiqa (xabarlar yangilaydi), aks holda berilgan oraliq. */
export function useLiveInterval(base: number): number {
  return useRealtimeStatus() === "live" ? Math.max(base, LIVE_FALLBACK_MS) : base;
}
