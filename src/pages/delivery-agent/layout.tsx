/**
 * Yetkazuvchi (DELIVERY_AGENT) ish joyi — mobil birinchi: yuqorida agent, lokatsiya holati va til; oflayn va navbat
 * holati; pastda Bosh sahifa, Yetkazmalar, Mijozlar, Qarz/To'lovlar (`delivery.view_debt` bo'lsa), Hisobotlar.
 * ERP menyusi ko'rinmaydi. Kirish: `delivery.accept` + bog'langan faol yetkazuvchi (`GET /api/delivery/agent/me`).
 * Lokatsiya faqat faol ish sessiyasida kuzatiladi. Asosiy himoya — serverda.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, Navigate, Outlet, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  AlertTriangle, BarChart3, CloudUpload, LayoutDashboard, Loader2, LogOut, MapPin, MapPinOff, PackageCheck, RefreshCw, UserX, Users,
  Wallet, WifiOff, type LucideIcon,
} from "lucide-react";
import { DEFAULT_DELIVERY_POLICY, type DeliveryPolicy, type Permission } from "@bum/shared";
import { Button } from "@/components/ui/button.tsx";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet.tsx";
import { useAuth, useCurrentUser } from "@/hooks/use-auth.ts";
import { usePermissions } from "@/hooks/use-company.ts";
import { formatMoney } from "@/hooks/use-currencies.ts";
import { ApiError, errorMessage } from "@/lib/api.ts";
import { deliveryErrorMessage } from "@/lib/delivery/errors.ts";
import { formatDateTime } from "@/lib/delivery/format.ts";
import { RealtimeBadge } from "@/components/delivery/badges.tsx";
import { DeliveryRealtimeContext, LIVE_FALLBACK_MS, useDeliveryRealtime } from "@/lib/delivery/realtime.ts";
import { num, type DeliveryMe, type WorkSession } from "@/lib/delivery/types.ts";
import { prepareNotifications } from "@/lib/native/notifications.ts";
import { useApiQuery } from "@/lib/query.ts";
import { cn } from "@/lib/utils.ts";
import { LanguageMenu } from "@/pages/sales-agent/layout.tsx";
import { useOnline } from "@/pages/sales-agent/_lib/use-online.ts";
import type { DeliveryAgentOutlet } from "./_lib/context.ts";
import { discardAction, retryAction, type SendResult } from "./_lib/offline-queue.ts";
import { useDeliveryTracking, type DeliveryLocation } from "./_lib/use-delivery-tracking.ts";
import { useDeliveryQueue, type DeliveryQueue } from "./_lib/use-queue.ts";

const NAV: { path: string; labelKey: string; icon: LucideIcon; permission?: Permission }[] = [
  { path: "dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { path: "tasks", labelKey: "nav.tasks", icon: PackageCheck },
  { path: "customers", labelKey: "nav.customers", icon: Users },
  { path: "debts", labelKey: "nav.debts", icon: Wallet, permission: "delivery.view_debt" },
  { path: "reports", labelKey: "nav.reports", icon: BarChart3 },
];

function Spinner() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

/** Sarlavhadagi lokatsiya belgisi: yashil — faol, sariq — server rad etdi, qizil — o'chiq. */
function LocationIndicator({ location, onDuty }: { location: DeliveryLocation; onDuty: boolean }) {
  const { t } = useTranslation("delivery");
  const off = !onDuty || location.status === "denied" || location.status === "unavailable";
  const label = !onDuty
    ? t("location.status.off_duty")
    : off
      ? t("location.status.off")
      : location.status === "active"
        ? t("location.status.active")
        : location.status === "rejected"
          ? t("location.status.problem")
          : t("location.locating");
  const Icon = off ? MapPinOff : MapPin;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        "flex h-10 w-10 items-center justify-center",
        !onDuty
          ? "text-muted-foreground"
          : off
            ? "text-destructive"
            : location.status === "active"
              ? "text-emerald-600"
              : location.status === "rejected"
                ? "text-amber-600"
                : "text-muted-foreground",
      )}
    >
      <Icon className={cn("h-5 w-5", location.status === "locating" && "animate-pulse")} />
    </span>
  );
}

function LocationRequired({ onRequest }: { onRequest: () => void }) {
  const { t } = useTranslation("delivery");
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10">
        <MapPinOff className="h-8 w-8 text-destructive" />
      </div>
      <h2 className="text-lg font-semibold">{t("location.required.title")}</h2>
      <p className="mt-1 max-w-xs text-sm">{t("location.denied")}</p>
      <p className="mt-2 max-w-xs text-xs text-muted-foreground">{t("location.required.help")}</p>
      <Button className="mt-6 h-12 w-full max-w-xs text-base" onClick={onRequest}>
        <MapPin className="mr-2 h-5 w-5" /> {t("location.enable")}
      </Button>
    </div>
  );
}

/** Oflayn navbat: nechta amal kutmoqda yoki rad etildi; ro'yxatda qayta yuborish yoki bekor qilish. */
function QueuePanel({ queue, online }: { queue: DeliveryQueue; online: boolean }) {
  const { t, i18n } = useTranslation("delivery");
  const { lng = "uz" } = useParams<{ lng: string }>();
  const [open, setOpen] = useState(false);
  if (queue.items.length === 0) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex w-full items-center gap-2 px-4 py-2 text-left text-xs font-medium text-white",
          queue.failed > 0 ? "bg-destructive" : "bg-sky-600",
        )}
      >
        {queue.syncing ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        ) : queue.failed > 0 ? (
          <AlertTriangle className="h-4 w-4 shrink-0" />
        ) : (
          <CloudUpload className="h-4 w-4 shrink-0" />
        )}
        <span className="flex-1">
          {queue.failed > 0 ? t("queue.failed", { count: queue.failed }) : t("queue.pending", { count: queue.pending })}
        </span>
        <span className="underline underline-offset-2">{t("queue.open")}</span>
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t("queue.title")}</SheetTitle>
            <SheetDescription>{t("queue.hint")}</SheetDescription>
          </SheetHeader>
          <ul className="space-y-2 px-4">
            {queue.items.map((item) => (
              <li key={item.id} className="space-y-2 rounded-xl border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{t(`queue.action.${item.action}`)}</p>
                  <span className={cn("text-[11px] font-semibold", item.state === "failed" ? "text-destructive" : "text-sky-700 dark:text-sky-400")}>
                    {item.state === "failed" ? t("queue.state.failed") : t("queue.state.pending")}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{formatDateTime(item.body.occurredAt, i18n.language)}</p>
                {item.state === "failed" && item.error && (
                  <p className="text-xs text-destructive">
                    {deliveryErrorMessage(new ApiError(item.error.status, item.error.code, item.error.message, item.error.details), t)}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="ghost" className="h-9">
                    <Link to={`/${lng}/delivery-agent/tasks/${item.taskId}`} onClick={() => setOpen(false)}>
                      {t("queue.open_task")}
                    </Link>
                  </Button>
                  {item.state === "failed" && (
                    <>
                      <Button size="sm" variant="secondary" className="h-9" onClick={() => retryAction(item.id)}>
                        <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> {t("queue.retry")}
                      </Button>
                      <Button size="sm" variant="destructive" className="h-9" onClick={() => discardAction(item.id)}>
                        {t("queue.discard")}
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <SheetFooter>
            <Button className="h-12" disabled={!online || queue.syncing || queue.pending === 0} onClick={() => void queue.sync()}>
              {queue.syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CloudUpload className="mr-2 h-4 w-4" />}
              {online ? t("queue.sync") : t("queue.waiting_network")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

export default function DeliveryAgentLayout() {
  const { t } = useTranslation("delivery");
  const { lng = "uz" } = useParams<{ lng: string }>();
  const { signout } = useAuth();
  const currentUser = useCurrentUser();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const allowed = can("delivery.accept");
  const meQuery = useApiQuery<DeliveryMe>(allowed ? "/api/delivery/agent/me" : null);
  const policy = useApiQuery<{ policy: DeliveryPolicy }>(meQuery.data ? "/api/delivery/policy" : null).data?.policy ?? DEFAULT_DELIVERY_POLICY;
  const sessionPath = meQuery.data ? "/api/delivery/agent/work-session" : null;
  const workSession = useApiQuery<{ session: WorkSession | null }>(sessionPath).data?.session;
  const onDuty = workSession?.status === "active";
  // Ish vaqtida fonda ham jonli (yangi yetkazma bildirishnomasi); ish vaqti tashqarisida fonda ulanish yopiladi
  const realtime = useDeliveryRealtime(Boolean(meQuery.data), onDuty);
  // Shu so'rovning davriy yangilanishi (bir xil kalit — ma'lumot va so'rov umumiy): jonli ulanishda siyrak
  useApiQuery<{ session: WorkSession | null }>(sessionPath, undefined, { refetchInterval: realtime === "live" ? LIVE_FALLBACK_MS : 60_000 });
  const queryClient = useQueryClient();
  const onSessionEnded = useCallback(() => void queryClient.invalidateQueries({ queryKey: ["/api/delivery/agent/work-session"] }), [queryClient]);
  const location = useDeliveryTracking(onDuty, policy.trackingIntervalSeconds, policy.trackingDistanceMeters, {
    maxAccuracyMeters: policy.maxAccuracyMeters,
    onSessionEnded,
  });
  // Android ilova: bildirishnoma ruxsati ish boshlanganda (ilova ochiq) so'raladi — birinchi xabar fonda yo'qolmasin
  useEffect(() => {
    if (onDuty) prepareNotifications();
  }, [onDuty]);
  const online = useOnline();
  const onSynced = useCallback(
    (result: SendResult) => {
      if (result.sent > 0) toast.success(t("queue.synced", { count: result.sent }));
      if (result.failed > 0) toast.error(t("queue.rejected", { count: result.failed }));
    },
    [t],
  );
  const queue = useDeliveryQueue(Boolean(meQuery.data), onSynced);
  const currency = meQuery.data?.company.currency ?? "UZS";
  const money = useCallback((value: string | number) => formatMoney(num(value), currency), [currency]);

  if (currentUser === null) return <Navigate to={`/${lng}/login`} replace />;
  if (currentUser === undefined) return <Spinner />;
  if (!currentUser.hasCompany) return <Navigate to={`/${lng}/dashboard`} replace />;
  if (permissionsLoading) return <Spinner />;
  if (!allowed) return <Navigate to={`/${lng}/dashboard`} replace />;

  const header = (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-1 border-b border-border bg-card/95 px-4 backdrop-blur">
      <div className="min-w-0 flex-1 pr-2">
        <p className="truncate text-sm font-semibold">{meQuery.data?.agent.name ?? currentUser.name ?? t("title")}</p>
        <p className="truncate text-[11px] text-muted-foreground">
          {t("title")} · {currentUser.companyName}
        </p>
      </div>
      {meQuery.data && <RealtimeBadge status={realtime} compact />}
      {meQuery.data && <LocationIndicator location={location} onDuty={onDuty} />}
      <LanguageMenu />
      <Button variant="ghost" size="icon" className="h-10 w-10" title={t("logout")} onClick={() => signout()}>
        <LogOut className="h-5 w-5" />
      </Button>
    </header>
  );

  if (meQuery.isError) {
    const notLinked = meQuery.error instanceof ApiError && (meQuery.error.status === 403 || meQuery.error.status === 404);
    return (
      <div className="min-h-screen bg-background">
        {header}
        <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/10">
            <UserX className="h-8 w-8 text-amber-600" />
          </div>
          <h2 className="text-lg font-semibold">{notLinked ? t("not_linked.title") : t("error.title")}</h2>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">{notLinked ? t("not_linked.message") : errorMessage(meQuery.error)}</p>
          {!notLinked && (
            <Button variant="secondary" className="mt-5 h-11" onClick={() => void meQuery.refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" /> {t("error.retry")}
            </Button>
          )}
        </div>
      </div>
    );
  }

  const nav = NAV.filter((item) => !item.permission || can(item.permission));
  const outlet: DeliveryAgentOutlet | null = meQuery.data ? { me: meQuery.data, policy, location, queue, onDuty, can, money } : null;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {header}
      <div className="sticky top-14 z-20">
        {!online && (
          <div role="status" className="flex items-center gap-2 bg-amber-500 px-4 py-2 text-xs font-medium text-white">
            <WifiOff className="h-4 w-4 shrink-0" /> {policy.offlineActionsAllowed ? t("offline.banner") : t("offline.banner_no_queue")}
          </div>
        )}
        <QueuePanel queue={queue} online={online} />
      </div>
      <main className="flex-1 pb-24">
        {!outlet ? (
          <Spinner />
        ) : onDuty && location.status === "denied" ? (
          <LocationRequired onRequest={location.request} />
        ) : (
          <DeliveryRealtimeContext.Provider value={realtime}>
            <Outlet context={outlet} />
          </DeliveryRealtimeContext.Provider>
        )}
      </main>
      <nav className={cn("fixed inset-x-0 bottom-0 z-30 grid border-t border-border bg-card pb-safe", nav.length === 5 ? "grid-cols-5" : "grid-cols-4")}>
        {nav.map((item) => (
          <NavLink
            key={item.path}
            to={`/${lng}/delivery-agent/${item.path}`}
            className={({ isActive }) =>
              cn("flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors", isActive ? "text-primary" : "text-muted-foreground")
            }
          >
            <item.icon className="h-6 w-6" />
            <span className="max-w-full truncate px-1">{t(item.labelKey)}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
