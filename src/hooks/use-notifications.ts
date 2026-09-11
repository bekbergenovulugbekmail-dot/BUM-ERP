/**
 * useNotifications — `/api/notifications` (o'qilgan/yopilgan holati har foydalanuvchi uchun serverda).
 *
 * - aqlli ogohlantirishlar har kompaniya uchun sessiyada bir marta so'raladi (server 5 daqiqada bir bajaradi)
 * - Convex jonli obunasi o'rniga har daqiqada va oyna fokusida yangilanadi
 * - to'xtatilgan kompaniyada so'rov yuborilmaydi (tenant so'rovlari 403)
 */
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { useCurrentUser } from "@/hooks/use-auth.ts";

export type NotificationSeverity = "info" | "warning" | "error" | "success";

export type AppNotification = {
  id: string;
  type: string;
  severity: NotificationSeverity;
  title: string;
  message: string;
  isGlobal: boolean;
  relatedType: string | null;
  relatedId: string | null;
  /** Tilsiz ichki yo'l (`/warehouse`) — frontend til prefiksini qo'shadi. */
  link: string | null;
  createdAt: string;
  isRead: boolean;
};

const POLL_MS = 60_000;
const NOTIFICATIONS = ["/api/notifications"];

export function useNotifications() {
  const currentUser = useCurrentUser();
  const companyId =
    currentUser?.hasCompany && currentUser.companyStatus !== "suspended" && currentUser.companyStatus !== "cancelled"
      ? currentUser.activeCompanyId
      : null;
  const enabled = companyId !== null;

  const notifications = useApiQuery<{ notifications: AppNotification[] }>(
    enabled ? "/api/notifications" : null,
    { limit: 60 },
    { refetchInterval: POLL_MS },
  ).data?.notifications;
  const unreadCount = useApiQuery<{ count: number }>(
    enabled ? "/api/notifications/unread-count" : null,
    undefined,
    { refetchInterval: POLL_MS },
  ).data?.count;

  const markRead = useApiMutation((id: string) => api.post(`/api/notifications/${id}/read`), { invalidate: NOTIFICATIONS });
  const remove = useApiMutation((id: string) => api.delete(`/api/notifications/${id}`), { invalidate: NOTIFICATIONS });
  const markAllRead = useApiMutation(() => api.post("/api/notifications/read-all"), { invalidate: NOTIFICATIONS });
  const clearRead = useApiMutation(() => api.post("/api/notifications/clear-read"), { invalidate: NOTIFICATIONS });
  const triggerAlerts = useApiMutation(
    () => api.post<{ throttled?: boolean }>("/api/notifications/refresh"),
    { invalidate: NOTIFICATIONS },
  );

  // Aqlli ogohlantirishlar — kompaniya almashtirilganda yangi kompaniya uchun ham
  const { mutate: refreshAlerts } = triggerAlerts;
  const triggeredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!companyId || triggeredFor.current === companyId) return;
    triggeredFor.current = companyId;
    refreshAlerts();
  }, [companyId, refreshAlerts]);

  // Yangi o'qilmaganlarni toast qilish (faqat son oshganda, shu kompaniya ichida)
  const previous = useRef<{ companyId: string | null; count: number } | null>(null);
  useEffect(() => {
    if (unreadCount === undefined) return;
    const last = previous.current;
    if (last && last.companyId === companyId && unreadCount > last.count) {
      const newOnes = (notifications ?? []).filter((n) => !n.isRead).slice(0, Math.min(3, unreadCount - last.count));
      for (const n of newOnes) {
        if (n.severity === "error") toast.error(n.title, { description: n.message });
        else if (n.severity === "success") toast.success(n.title, { description: n.message });
        else toast.info(n.title, { description: n.message });
      }
    }
    previous.current = { companyId, count: unreadCount };
  }, [unreadCount, notifications, companyId]);

  return {
    notifications: notifications ?? [],
    unreadCount: unreadCount ?? 0,
    isLoading: enabled && notifications === undefined,
    markRead: (id: string) => markRead.mutateAsync(id),
    markAllRead: () => markAllRead.mutateAsync(),
    remove: (id: string) => remove.mutateAsync(id),
    clearRead: () => clearRead.mutateAsync(),
    triggerAlerts: () => triggerAlerts.mutateAsync(),
  };
}
