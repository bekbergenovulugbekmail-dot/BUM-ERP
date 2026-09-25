/**
 * Dostavka boshqaruvi (supervayzer / menejer): bugungi holat, yetkazmalar (server filtrlari, sahifalash), yetkazma
 * yaratiladigan buyurtmalar, yetkazuvchilar, xarita (jonli joy va kunlik iz), nazorat (to'lov farqi, qaytgan mahsulot,
 * kechikkanlar), hisobotlar va siyosat. Real-time (WebSocket) ulanishi o'zgarishlarni darhol keltiradi; ulanish bo'lmasa
 * odatiy davriy yangilanish. Avtomatik biriktirish — `delivery.assign`. Har bo'lim o'z ruxsati bilan; asosiy himoya — serverda.
 */
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BarChart3, ClipboardList, LayoutDashboard, MapPinned, PackageCheck, PackagePlus, Route, ShieldCheck, SlidersHorizontal, Sparkles, Users,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@bum/shared";
import { RealtimeBadge } from "@/components/delivery/badges.tsx";
import { Button } from "@/components/ui/button.tsx";
import { useActiveCompany, usePermissions } from "@/hooks/use-company.ts";
import { formatMoney } from "@/hooks/use-currencies.ts";
import { DeliveryRealtimeContext, useDeliveryRealtime } from "@/lib/delivery/realtime.ts";
import { num } from "@/lib/delivery/types.ts";
import { cn } from "@/lib/utils.ts";
import PageTabs from "@/components/page-tabs.tsx";
import AgentsSection from "./_components/agents-section.tsx";
import AutoAssignDialog from "./_components/auto-assign-dialog.tsx";
import ControlSection from "./_components/control-section.tsx";
import MapSection from "./_components/map-section.tsx";
import PolicySection from "./_components/policy-section.tsx";
import ReadySection from "./_components/ready-section.tsx";
import ReportsSection from "./_components/reports-section.tsx";
import TaskDrawer from "./_components/task-drawer.tsx";
import TasksSection from "./_components/tasks-section.tsx";
import TripsSection from "./_components/trips-section.tsx";
import TodaySection from "./_components/today-section.tsx";
import { EMPTY_FILTERS, type TaskFilters } from "./_lib/filters.ts";

type TabKey = "today" | "tasks" | "trips" | "ready" | "agents" | "map" | "control" | "reports" | "policy";

const TABS: { key: TabKey; icon: LucideIcon; permission: Permission }[] = [
  { key: "today", icon: LayoutDashboard, permission: "delivery.view" },
  { key: "tasks", icon: ClipboardList, permission: "delivery.view" },
  /** Reyslar: "Yetkazishga chiqadiganlar", 3 hujjat (nakladnoy, yig'ma ro'yxat ×2, marshrut varag'i), terish/yuklash. */
  { key: "trips", icon: Route, permission: "delivery.view" },
  { key: "ready", icon: PackagePlus, permission: "delivery.manage" },
  { key: "agents", icon: Users, permission: "delivery.view" },
  { key: "map", icon: MapPinned, permission: "delivery.view_location" },
  { key: "control", icon: ShieldCheck, permission: "delivery.view" },
  { key: "reports", icon: BarChart3, permission: "delivery.view_reports" },
  { key: "policy", icon: SlidersHorizontal, permission: "delivery.manage" },
];

export default function DeliveryPage() {
  const { t } = useTranslation("delivery");
  const { can } = usePermissions();
  const currency = useActiveCompany().data?.company.currency ?? "UZS";
  const [tab, setTab] = useState<TabKey>("today");
  const [filters, setFilters] = useState<TaskFilters>(EMPTY_FILTERS);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [autoAssignOpen, setAutoAssignOpen] = useState(false);
  const realtime = useDeliveryRealtime(can("delivery.view"));
  const money = useCallback((value: string | number) => formatMoney(num(value), currency), [currency]);

  const tabs = TABS.filter((item) => can(item.permission));
  const active = tabs.some((item) => item.key === tab) ? tab : (tabs[0]?.key ?? "today");

  const openTasks = (partial: Partial<TaskFilters>) => {
    setFilters({ ...EMPTY_FILTERS, ...partial });
    setTab("tasks");
  };

  return (
    <DeliveryRealtimeContext.Provider value={realtime}>
      <div className="mx-auto max-w-[1600px] space-y-5 p-4 md:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/10">
            <PackageCheck className="h-5 w-5 text-rose-500" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold">{t("sv.title")}</h1>
            <p className="text-sm text-muted-foreground">{t("sv.subtitle")}</p>
          </div>
          <RealtimeBadge status={realtime} />
          {can("delivery.assign") && (
            <Button size="sm" onClick={() => setAutoAssignOpen(true)}>
              <Sparkles className="mr-1.5 h-4 w-4" /> {t("auto.button")}
            </Button>
          )}
        </div>

        <PageTabs
          tabs={tabs.map((item) => ({ key: item.key, label: t(`sv.tab.${item.key}`), icon: item.icon }))}
          value={active}
          onChange={setTab}
        />

        {active === "today" && <TodaySection money={money} onOpenTasks={openTasks} onOpenControl={() => setTab("control")} />}
        {active === "tasks" && <TasksSection filters={filters} onFiltersChange={setFilters} money={money} onOpenTask={setOpenTaskId} />}
        {active === "trips" && <TripsSection money={money} />}
        {active === "ready" && <ReadySection money={money} onOpenTask={setOpenTaskId} />}
        {active === "agents" && <AgentsSection />}
        {active === "map" && <MapSection onOpenTask={setOpenTaskId} />}
        {active === "control" && <ControlSection money={money} onOpenTask={setOpenTaskId} />}
        {active === "reports" && <ReportsSection money={money} />}
        {active === "policy" && <PolicySection />}

        <TaskDrawer taskId={openTaskId} money={money} onClose={() => setOpenTaskId(null)} />
        {autoAssignOpen && <AutoAssignDialog onClose={() => setAutoAssignOpen(false)} />}
      </div>
    </DeliveryRealtimeContext.Provider>
  );
}
