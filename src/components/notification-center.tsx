/**
 * NotificationCenter — bell icon + popover panel.
 * Shows unread badge, filterable list, mark-all-read, clear buttons.
 */
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Bell, BellRing, Check, CheckCheck, Trash2, X,
  PackageX, Clock, CreditCard, CalendarOff, ShieldCheck,
  Package, Factory, Info, Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import { useNotifications } from "@/hooks/use-notifications.ts";
import { formatDistanceToNow } from "date-fns";
import { uz } from "date-fns/locale";

type NotifType =
  | "low_stock" | "expiring_soon" | "pending_approval"
  | "overdue_payment" | "leave_request" | "po_received"
  | "production_complete" | "system";

type Severity = "info" | "warning" | "error" | "success";

const TYPE_META: Record<NotifType, { icon: React.ReactNode; label: string }> = {
  low_stock:           { icon: <PackageX className="h-4 w-4" />, label: "Kam zaxira" },
  expiring_soon:       { icon: <Clock className="h-4 w-4" />, label: "Muddati tugayapti" },
  pending_approval:    { icon: <ShieldCheck className="h-4 w-4" />, label: "Tasdiqlash" },
  overdue_payment:     { icon: <CreditCard className="h-4 w-4" />, label: "To'lov" },
  leave_request:       { icon: <CalendarOff className="h-4 w-4" />, label: "Ta'til" },
  po_received:         { icon: <Package className="h-4 w-4" />, label: "Qabul" },
  production_complete: { icon: <Factory className="h-4 w-4" />, label: "Ishlab chiqarish" },
  system:              { icon: <Info className="h-4 w-4" />, label: "Tizim" },
};

const SEVERITY_COLORS: Record<Severity, string> = {
  info:    "text-blue-500 bg-blue-50 dark:bg-blue-900/30",
  warning: "text-amber-500 bg-amber-50 dark:bg-amber-900/30",
  error:   "text-red-500 bg-red-50 dark:bg-red-900/30",
  success: "text-green-500 bg-green-50 dark:bg-green-900/30",
};

type FilterTab = "all" | "unread";

export default function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<FilterTab>("all");
  const {
    notifications,
    unreadCount,
    isLoading,
    markRead,
    markAllRead,
    remove,
    clearRead,
  } = useNotifications();

  const displayed = filter === "unread"
    ? notifications.filter((n) => !n.isRead)
    : notifications;

  const handleMarkRead = async (id: string) => {
    await markRead(id);
  };

  const handleRemove = async (id: string) => {
    await remove(id);
  };

  const handleMarkAllRead = async () => {
    await markAllRead();
  };

  const handleClearRead = async () => {
    await clearRead();
  };

  return (
    <div className="relative">
      {/* Bell button */}
      <button
        className="relative p-2 rounded-xl hover:bg-muted transition-colors cursor-pointer"
        onClick={() => setOpen((o) => !o)}
        aria-label="Bildirishnomalar"
      >
        {unreadCount > 0 ? (
          <BellRing className="h-5 w-5 text-foreground" />
        ) : (
          <Bell className="h-5 w-5 text-muted-foreground" />
        )}
        {unreadCount > 0 && (
          <motion.span
            key={unreadCount}
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white leading-none"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </motion.span>
        )}
      </button>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -8 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="absolute right-0 top-12 z-50 w-[380px] max-h-[560px] flex flex-col rounded-2xl border border-border bg-popover shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-primary" />
                <span className="font-semibold text-sm">Bildirishnomalar</span>
                {unreadCount > 0 && (
                  <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">
                    {unreadCount}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1">
                {unreadCount > 0 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title="Barchasini o'qilgan deb belgilash"
                    onClick={handleMarkAllRead}
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title="O'qilganlarni tozalash"
                  onClick={handleClearRead}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setOpen(false)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Filter tabs */}
            <div className="flex gap-1 px-4 py-2 border-b border-border shrink-0">
              {(["all", "unread"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setFilter(tab)}
                  className={cn(
                    "px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer",
                    filter === tab
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  {tab === "all" ? "Barchasi" : "O'qilmagan"}
                  {tab === "unread" && unreadCount > 0 && (
                    <span className="ml-1.5 bg-primary-foreground/20 text-primary-foreground rounded px-1">
                      {unreadCount}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto">
              {isLoading ? (
                <div className="p-4 space-y-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full rounded-xl" />
                  ))}
                </div>
              ) : displayed.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                  <div className="h-12 w-12 rounded-2xl bg-muted flex items-center justify-center mb-3">
                    <Bell className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium">
                    {filter === "unread" ? "O'qilmagan xabar yo'q" : "Bildirishnoma yo'q"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Muhim hodisalar bu yerda ko'rinadi
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {displayed.map((notif) => {
                    const meta = TYPE_META[notif.type as NotifType] ?? TYPE_META.system;
                    const sev = SEVERITY_COLORS[notif.severity as Severity] ?? SEVERITY_COLORS.info;
                    const timeAgo = formatDistanceToNow(new Date(notif.createdAt), {
                      addSuffix: true,
                      locale: uz,
                    });

                    return (
                      <motion.div
                        key={notif.id}
                        layout
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 10 }}
                        className={cn(
                          "flex items-start gap-3 px-4 py-3 hover:bg-muted/40 transition-colors group",
                          !notif.isRead && "bg-primary/5"
                        )}
                      >
                        {/* Icon */}
                        <div className={cn("mt-0.5 h-8 w-8 rounded-xl flex items-center justify-center shrink-0", sev)}>
                          {meta.icon}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className={cn("text-xs font-semibold leading-tight", !notif.isRead && "text-foreground")}>
                              {notif.title}
                            </p>
                            {!notif.isRead && (
                              <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0 mt-1" />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 leading-snug line-clamp-2">
                            {notif.message}
                          </p>
                          <p className="text-[10px] text-muted-foreground/60 mt-1">{timeAgo}</p>
                        </div>

                        {/* Actions */}
                        <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          {!notif.isRead && (
                            <button
                              onClick={() => handleMarkRead(notif.id)}
                              className="h-6 w-6 rounded-md hover:bg-muted flex items-center justify-center cursor-pointer"
                              title="O'qilgan deb belgilash"
                            >
                              <Check className="h-3 w-3 text-muted-foreground" />
                            </button>
                          )}
                          <button
                            onClick={() => handleRemove(notif.id)}
                            className="h-6 w-6 rounded-md hover:bg-destructive/10 flex items-center justify-center cursor-pointer"
                            title="O'chirish"
                          >
                            <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                          </button>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            {displayed.length > 0 && (
              <div className="px-4 py-2.5 border-t border-border shrink-0 bg-muted/30">
                <p className="text-[11px] text-muted-foreground text-center">
                  {displayed.length} ta bildirishnoma
                  {unreadCount > 0 && ` • ${unreadCount} ta o'qilmagan`}
                </p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
