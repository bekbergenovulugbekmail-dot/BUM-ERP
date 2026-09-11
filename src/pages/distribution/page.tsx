import { useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  Truck, Route, Users, CalendarRange, Radar, SlidersHorizontal, ClipboardCheck,
  MapPinned, UserCheck, CalendarCheck, CircleDollarSign,
} from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { useApiQuery } from "@/lib/query.ts";
import { usePermissions } from "@/hooks/use-company.ts";
import RoutesSection from "./_components/routes-section.tsx";
import AssignmentsSection from "./_components/assignments-section.tsx";
import SalesRepsSection from "./_components/sales-reps-section.tsx";
import MonitoringSection from "./_components/monitoring-section.tsx";
import VisitsSection from "./_components/visits-section.tsx";
import AgentPolicySection from "./_components/agent-policy-section.tsx";
import { num, type DistributionRoute, type SalesRepStats } from "./_lib/types.ts";

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

type TabKey = "routes" | "assignments" | "reps" | "visits" | "monitoring" | "policy";

export default function DistributionPage() {
  const { t } = useTranslation("distribution");
  const { can } = usePermissions();
  const [tab, setTab] = useState<TabKey>("routes");

  const tabs = [
    { key: "routes" as const, icon: Route, visible: true },
    { key: "assignments" as const, icon: CalendarRange, visible: true },
    { key: "reps" as const, icon: Users, visible: true },
    // Tashriflar va siyosat — nazorat ruxsati; lokatsiya — alohida ruxsat (Supervayzer)
    { key: "visits" as const, icon: ClipboardCheck, visible: can("sales_agent.supervise") },
    { key: "monitoring" as const, icon: Radar, visible: can("sales_agent.location.view") },
    { key: "policy" as const, icon: SlidersHorizontal, visible: can("sales_agent.supervise") },
  ].filter((item) => item.visible);
  const activeTab = tabs.some((item) => item.key === tab) ? tab : "routes";

  const routes = useApiQuery<{ routes: DistributionRoute[] }>("/api/distribution/routes").data?.routes;
  const reps = useApiQuery<{ salesReps: SalesRepStats[] }>("/api/distribution/sales-reps/stats").data?.salesReps;

  const storeCount = (routes ?? []).reduce((sum, r) => sum + r.customerCount, 0);
  const visitsThisMonth = (reps ?? []).reduce((sum, r) => sum + r.visitsThisMonth, 0);
  const visitSales = (reps ?? []).reduce((sum, r) => sum + num(r.visitSalesThisMonth), 0);

  const statsCards = [
    {
      label: t("stats.routes"),
      value: routes?.length ?? 0,
      sub: t("stats.stores", { count: storeCount }),
      icon: MapPinned,
      color: "text-emerald-500",
      bg: "bg-emerald-500/10",
    },
    {
      label: t("stats.reps"),
      value: reps?.length ?? 0,
      sub: t("stats.active"),
      icon: UserCheck,
      color: "text-blue-500",
      bg: "bg-blue-500/10",
    },
    {
      label: t("stats.visits"),
      value: visitsThisMonth,
      sub: t("stats.visits_sub"),
      icon: CalendarCheck,
      color: "text-indigo-500",
      bg: "bg-indigo-500/10",
    },
    {
      label: t("stats.visit_sales"),
      value: fmt(visitSales) + " so'm",
      sub: t("stats.this_month"),
      icon: CircleDollarSign,
      color: "text-amber-500",
      bg: "bg-amber-500/10",
    },
  ];

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-3"
      >
        <div className="h-10 w-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
          <Truck className="h-5 w-5 text-emerald-500" />
        </div>
        <div>
          <h1 className="text-xl font-bold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
      </motion.div>

      {/* Stats */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="grid grid-cols-2 lg:grid-cols-4 gap-4"
      >
        {statsCards.map((card, i) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 + i * 0.05 }}
            className="bg-card border border-border rounded-2xl p-4"
          >
            <div className="flex items-center gap-2 mb-3">
              <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center", card.bg)}>
                <card.icon className={cn("h-4 w-4", card.color)} />
              </div>
              <p className="text-xs text-muted-foreground">{card.label}</p>
            </div>
            <p className="text-2xl font-bold">{card.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{card.sub}</p>
          </motion.div>
        ))}
      </motion.div>

      {/* Tabs */}
      <div className="border-b border-border overflow-x-auto">
        <div className="flex gap-1">
          {tabs.map((item) => (
            <button
              key={item.key}
              onClick={() => setTab(item.key)}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-all cursor-pointer whitespace-nowrap",
                activeTab === item.key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              {t(`tabs.${item.key}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <motion.div
        key={activeTab}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15 }}
      >
        {activeTab === "routes" && <RoutesSection />}
        {activeTab === "assignments" && <AssignmentsSection />}
        {activeTab === "reps" && <SalesRepsSection />}
        {activeTab === "visits" && <VisitsSection />}
        {activeTab === "monitoring" && <MonitoringSection />}
        {activeTab === "policy" && <AgentPolicySection />}
      </motion.div>
    </div>
  );
}
