/**
 * Dostavka boshqaruvi (supervayzer / menejer): bugungi holat, yetkazmalar (server filtrlari, sahifalash), yetkazma
 * yaratiladigan buyurtmalar, yetkazuvchilar, xarita (jonli joy va kunlik iz), nazorat (to'lov farqi, qaytgan mahsulot,
 * kechikkanlar), hisobotlar va siyosat. Har bo'lim o'z ruxsati bilan; asosiy himoya — serverda.
 */
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BarChart3, ClipboardList, LayoutDashboard, MapPinned, PackageCheck, PackagePlus, ShieldCheck, SlidersHorizontal, Users, type LucideIcon,
} from "lucide-react";
import type { Permission } from "@bum/shared";
import { useActiveCompany, usePermissions } from "@/hooks/use-company.ts";
import { formatMoney } from "@/hooks/use-currencies.ts";
import { num } from "@/lib/delivery/types.ts";
import { cn } from "@/lib/utils.ts";
import AgentsSection from "./_components/agents-section.tsx";
import ControlSection from "./_components/control-section.tsx";
import MapSection from "./_components/map-section.tsx";
import PolicySection from "./_components/policy-section.tsx";
import ReadySection from "./_components/ready-section.tsx";
import ReportsSection from "./_components/reports-section.tsx";
import TaskDrawer from "./_components/task-drawer.tsx";
import TasksSection from "./_components/tasks-section.tsx";
import TodaySection from "./_components/today-section.tsx";
import { EMPTY_FILTERS, type TaskFilters } from "./_lib/filters.ts";

type TabKey = "today" | "tasks" | "ready" | "agents" | "map" | "control" | "reports" | "policy";

const TABS: { key: TabKey; icon: LucideIcon; permission: Permission }[] = [
  { key: "today", icon: LayoutDashboard, permission: "delivery.view" },
  { key: "tasks", icon: ClipboardList, permission: "delivery.view" },
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
  const money = useCallback((value: string | number) => formatMoney(num(value), currency), [currency]);

  const tabs = TABS.filter((item) => can(item.permission));
  const active = tabs.some((item) => item.key === tab) ? tab : (tabs[0]?.key ?? "today");

  const openTasks = (partial: Partial<TaskFilters>) => {
    setFilters({ ...EMPTY_FILTERS, ...partial });
    setTab("tasks");
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-5 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/10">
          <PackageCheck className="h-5 w-5 text-rose-500" />
        </div>
        <div>
          <h1 className="text-xl font-bold">{t("sv.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("sv.subtitle")}</p>
        </div>
      </div>

      <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <div className="flex w-max gap-1 rounded-xl bg-muted p-1">
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={cn(
                "flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors",
                active === item.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <item.icon className="h-4 w-4" /> {t(`sv.tab.${item.key}`)}
            </button>
          ))}
        </div>
      </div>

      {active === "today" && <TodaySection money={money} onOpenTasks={openTasks} onOpenControl={() => setTab("control")} />}
      {active === "tasks" && <TasksSection filters={filters} onFiltersChange={setFilters} money={money} onOpenTask={setOpenTaskId} />}
      {active === "ready" && <ReadySection money={money} onOpenTask={setOpenTaskId} />}
      {active === "agents" && <AgentsSection />}
      {active === "map" && <MapSection onOpenTask={setOpenTaskId} />}
      {active === "control" && <ControlSection money={money} onOpenTask={setOpenTaskId} />}
      {active === "reports" && <ReportsSection money={money} />}
      {active === "policy" && <PolicySection />}

      <TaskDrawer taskId={openTaskId} money={money} onClose={() => setOpenTaskId(null)} />
    </div>
  );
}
