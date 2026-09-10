/**
 * NotificationsSection — settings for alert types + test trigger button.
 * Persists enabled/disabled state to localStorage.
 */
import { useState, useEffect } from "react";
import { motion } from "motion/react";
import {
  Bell, BellOff, PackageX, Clock, CreditCard,
  CalendarOff, ShieldCheck, RefreshCw, CheckCheck,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { cn } from "@/lib/utils.ts";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { uz } from "date-fns/locale";

const ALERT_TYPES = [
  {
    key: "low_stock",
    icon: PackageX,
    label: "Kam zaxira",
    desc: "Mahsulot zaxirasi minimal chegara ostiga tushganda",
    severity: "warning",
  },
  {
    key: "expiring_soon",
    icon: Clock,
    label: "Muddati tugayapti",
    desc: "Partiyaning muddati 30 kun ichida tugaganda",
    severity: "warning",
  },
  {
    key: "overdue_payment",
    icon: CreditCard,
    label: "Muddati o'tgan to'lov",
    desc: "Xarid buyurtmasi yoki sotuv to'lovi kechiktirilganda",
    severity: "error",
  },
  {
    key: "leave_request",
    icon: CalendarOff,
    label: "Ta'til so'rovi",
    desc: "Xodim ta'til so'rovi yuborganda",
    severity: "info",
  },
  {
    key: "pending_approval",
    icon: ShieldCheck,
    label: "Tasdiqlash kutilmoqda",
    desc: "Xarajat yoki buyurtma tasdiqlanishni kutganda",
    severity: "info",
  },
] as const;

const SEVERITY_COLORS = {
  info:    "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
  warning: "bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400",
  error:   "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400",
};

const STORAGE_KEY = "erp_notif_settings";

function loadSettings(): Record<string, boolean> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? (JSON.parse(stored) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export default function NotificationsSection() {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => {
    const stored = loadSettings();
    // Default all to true
    const defaults: Record<string, boolean> = {};
    ALERT_TYPES.forEach((t) => { defaults[t.key] = stored[t.key] ?? true; });
    return defaults;
  });

  const [refreshing, setRefreshing] = useState(false);
  const triggerAlerts = useMutation(api.notifications.triggerSmartAlerts);
  const markAllRead = useMutation(api.notifications.markAllRead);
  const notifications = useQuery(api.notifications.list, { limit: 5 });
  const unreadCount = useQuery(api.notifications.unreadCount, {});

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(enabled));
  }, [enabled]);

  const toggle = (key: string) => {
    setEnabled((prev) => ({ ...prev, [key]: !prev[key] }));
    toast.success(`${enabled[key] ? "O'chirildi" : "Yoqildi"}`);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await triggerAlerts({});
      toast.success("Bildirishnomalar yangilandi");
    } catch {
      toast.error("Xatolik yuz berdi");
    } finally {
      setTimeout(() => setRefreshing(false), 1500);
    }
  };

  const handleMarkAllRead = async () => {
    await markAllRead({});
    toast.success("Barchasi o'qilgan deb belgilandi");
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Status card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Bell className="h-4 w-4 text-primary" />
                Bildirishnoma markazi
              </CardTitle>
              <CardDescription>
                Joriy holat va tezkor boshqaruv
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {(unreadCount ?? 0) > 0 && (
                <Button variant="secondary" size="sm" onClick={handleMarkAllRead}>
                  <CheckCheck className="h-3.5 w-3.5 mr-1.5" />
                  Barchasini o'qilgan deb belgilash
                </Button>
              )}
              <Button size="sm" onClick={handleRefresh} disabled={refreshing}>
                <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", refreshing && "animate-spin")} />
                Yangilash
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-muted/50 rounded-xl px-4 py-3 text-center">
              <p className="text-2xl font-bold text-foreground">{notifications?.length ?? 0}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Jami</p>
            </div>
            <div className="bg-destructive/10 rounded-xl px-4 py-3 text-center">
              <p className="text-2xl font-bold text-destructive">{unreadCount ?? 0}</p>
              <p className="text-xs text-muted-foreground mt-0.5">O'qilmagan</p>
            </div>
            <div className="bg-green-50 dark:bg-green-900/20 rounded-xl px-4 py-3 text-center">
              <p className="text-2xl font-bold text-green-600">{(notifications?.length ?? 0) - (unreadCount ?? 0)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">O'qilgan</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Alert type settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ogohlantirishlar sozlamalari</CardTitle>
          <CardDescription>
            Qaysi ogohlantirishlar ko'rsatilishini boshqaring
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {ALERT_TYPES.map((alert, i) => {
            const Icon = alert.icon;
            const isEnabled = enabled[alert.key] ?? true;
            return (
              <motion.div
                key={alert.key}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className={cn(
                  "flex items-center justify-between p-4 rounded-xl border transition-colors",
                  isEnabled ? "border-border bg-card" : "border-border/50 bg-muted/30 opacity-60"
                )}
              >
                <div className="flex items-center gap-3">
                  <div className={cn("h-9 w-9 rounded-xl flex items-center justify-center", SEVERITY_COLORS[alert.severity])}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{alert.label}</p>
                      <Badge
                        variant="secondary"
                        className={cn("text-[10px] py-0 h-4 px-1.5", SEVERITY_COLORS[alert.severity])}
                      >
                        {alert.severity === "error" ? "Kritik" : alert.severity === "warning" ? "Ogohlantirish" : "Ma'lumot"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{alert.desc}</p>
                  </div>
                </div>

                {/* Toggle */}
                <button
                  onClick={() => toggle(alert.key)}
                  className={cn(
                    "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                    isEnabled ? "bg-primary" : "bg-muted"
                  )}
                >
                  <span
                    className={cn(
                      "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
                      isEnabled ? "translate-x-5" : "translate-x-0"
                    )}
                  />
                </button>
              </motion.div>
            );
          })}
        </CardContent>
      </Card>

      {/* Recent notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">So'nggi bildirishnomalar</CardTitle>
          <CardDescription>Eng yangi 5 ta bildirishnoma</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {!notifications ? (
            <div className="text-sm text-muted-foreground py-4 text-center">Yuklanmoqda...</div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-center">
              <BellOff className="h-8 w-8 text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">Bildirishnoma yo'q</p>
            </div>
          ) : (
            notifications.slice(0, 5).map((n) => (
              <div
                key={n._id}
                className={cn(
                  "flex items-start gap-3 p-3 rounded-xl border transition-colors",
                  !n.isRead ? "bg-primary/5 border-primary/20" : "bg-muted/30 border-transparent"
                )}
              >
                <div className={cn(
                  "h-2 w-2 rounded-full shrink-0 mt-2",
                  n.severity === "error" ? "bg-destructive" :
                  n.severity === "warning" ? "bg-amber-500" :
                  n.severity === "success" ? "bg-green-500" : "bg-blue-500"
                )} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold truncate">{n.title}</p>
                    <span className="text-[10px] text-muted-foreground/60 shrink-0">
                      {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true, locale: uz })}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{n.message}</p>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
