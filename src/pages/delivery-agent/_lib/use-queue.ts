/**
 * Oflayn navbat holati (barcha oynalarda bir xil — `localStorage` hodisalari) va avtomatik yuborish: internet bor va
 * navbatda amal bo'lsa — darhol va har 30 soniyada.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api.ts";
import { useOnline } from "@/pages/sales-agent/_lib/use-online.ts";
import { actionPath, classifyQueueError, invalidateDelivery } from "./actions.ts";
import { QUEUE_EVENT, flushQueue, queueStorageKey, type QueuedAction, type SendResult } from "./offline-queue.ts";

const RETRY_MS = 30_000;

function subscribe(callback: () => void) {
  window.addEventListener(QUEUE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(QUEUE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function snapshot() {
  try {
    return localStorage.getItem(queueStorageKey()) ?? "[]";
  } catch {
    return "[]";
  }
}

export type DeliveryQueue = {
  items: QueuedAction[];
  pending: number;
  failed: number;
  syncing: boolean;
  sync: () => Promise<SendResult | null>;
};

export function useDeliveryQueue(enabled: boolean, onSynced?: (result: SendResult) => void): DeliveryQueue {
  const raw = useSyncExternalStore(subscribe, snapshot, () => "[]");
  const items = useMemo(() => {
    try {
      const parsed = JSON.parse(raw) as QueuedAction[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [raw]);
  const online = useOnline();
  const queryClient = useQueryClient();
  const running = useRef(false);
  const callback = useRef(onSynced);
  const [syncing, setSyncing] = useState(false);
  const pending = items.filter((item) => item.state === "pending").length;

  useEffect(() => {
    callback.current = onSynced;
  }, [onSynced]);

  const sync = useCallback(async () => {
    if (running.current) return null;
    running.current = true;
    setSyncing(true);
    try {
      const result = await flushQueue(async (item) => {
        await api.post(actionPath(item.taskId, item.action), item.body);
      }, classifyQueueError);
      if (result.sent > 0 || result.failed > 0) {
        await invalidateDelivery(queryClient);
        callback.current?.(result);
      }
      return result;
    } finally {
      running.current = false;
      setSyncing(false);
    }
  }, [queryClient]);

  useEffect(() => {
    if (!enabled || !online || pending === 0) return;
    void sync();
    const timer = window.setInterval(() => void sync(), RETRY_MS);
    return () => window.clearInterval(timer);
  }, [enabled, online, pending, sync]);

  return { items, pending, failed: items.length - pending, syncing, sync };
}
