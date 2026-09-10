/**
 * useNotifications — wraps Convex notification queries/mutations.
 * Also triggers smart-alert generation once per session.
 */
import { useEffect, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { toast } from "sonner";

export function useNotifications() {
  const notifications = useQuery(api.notifications.list, { limit: 60 });
  const unreadCount = useQuery(api.notifications.unreadCount, {});
  const markRead = useMutation(api.notifications.markRead);
  const markAllRead = useMutation(api.notifications.markAllRead);
  const remove = useMutation(api.notifications.remove);
  const clearRead = useMutation(api.notifications.clearRead);
  const triggerAlerts = useMutation(api.notifications.triggerSmartAlerts);

  // Trigger smart alerts once per session
  const triggered = useRef(false);
  useEffect(() => {
    if (!triggered.current) {
      triggered.current = true;
      void triggerAlerts({});
    }
  }, [triggerAlerts]);

  // Toast new unread notifications (only when count increases)
  const prevCount = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (unreadCount === undefined) return;
    if (prevCount.current !== undefined && unreadCount > prevCount.current) {
      const newOnes = (notifications ?? []).filter((n) => !n.isRead).slice(0, 3);
      for (const n of newOnes) {
        const variant = n.severity === "error" ? "error" : n.severity === "success" ? "success" : "info";
        if (variant === "error") toast.error(n.title, { description: n.message });
        else if (variant === "success") toast.success(n.title, { description: n.message });
        else toast.info(n.title, { description: n.message });
      }
    }
    prevCount.current = unreadCount;
  }, [unreadCount, notifications]);

  return {
    notifications: notifications ?? [],
    unreadCount: unreadCount ?? 0,
    isLoading: notifications === undefined,
    markRead,
    markAllRead,
    remove,
    clearRead,
    triggerAlerts,
  };
}
