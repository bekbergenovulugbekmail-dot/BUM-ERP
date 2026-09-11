import { useState } from "react";
import { motion } from "motion/react";
import {
  Truck, Route, Users, CalendarRange,
  MapPinned, UserCheck, CalendarCheck, CircleDollarSign,
} from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { useApiQuery } from "@/lib/query.ts";
import RoutesSection from "./_components/routes-section.tsx";
import AssignmentsSection from "./_components/assignments-section.tsx";
import SalesRepsSection from "./_components/sales-reps-section.tsx";
import { num, type DistributionRoute, type SalesRepStats } from "./_lib/types.ts";

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

const TABS = [
  { key: "routes", label: "Marshrutlar", icon: Route },
  { key: "assignments", label: "Hudud va kun", icon: CalendarRange },
  { key: "reps", label: "Savdo agentlari", icon: Users },
] as const;

export default function DistributionPage() {
  const [tab, setTab] = useState<typeof TABS[number]["key"]>("routes");

  const routes = useApiQuery<{ routes: DistributionRoute[] }>("/api/distribution/routes").data?.routes;
  const reps = useApiQuery<{ salesReps: SalesRepStats[] }>("/api/distribution/sales-reps/stats").data?.salesReps;

  const storeCount = (routes ?? []).reduce((sum, r) => sum + r.customerCount, 0);
  const visitsThisMonth = (reps ?? []).reduce((sum, r) => sum + r.visitsThisMonth, 0);
  const visitSales = (reps ?? []).reduce((sum, r) => sum + num(r.visitSalesThisMonth), 0);

  const statsCards = [
    {
      label: "Faol marshrutlar",
      value: routes?.length ?? 0,
      sub: `${storeCount} ta do'kon`,
      icon: MapPinned,
      color: "text-emerald-500",
      bg: "bg-emerald-500/10",
    },
    {
      label: "Savdo agentlari",
      value: reps?.length ?? 0,
      sub: "Faol",
      icon: UserCheck,
      color: "text-blue-500",
      bg: "bg-blue-500/10",
    },
    {
      label: "Tashriflar",
      value: visitsThisMonth,
      sub: "Bu oy yakunlangan",
      icon: CalendarCheck,
      color: "text-indigo-500",
      bg: "bg-indigo-500/10",
    },
    {
      label: "Tashrif savdosi",
      value: fmt(visitSales) + " so'm",
      sub: "Bu oy",
      icon: CircleDollarSign,
      color: "text-amber-500",
      bg: "bg-amber-500/10",
    },
  ];

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
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
          <h1 className="text-xl font-bold">Distributsiya</h1>
          <p className="text-sm text-muted-foreground">Marshrutlar, savdo agentlari va tashriflar</p>
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
      <div className="border-b border-border">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-all cursor-pointer",
                tab === t.key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <motion.div
        key={tab}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15 }}
      >
        {tab === "routes" && <RoutesSection />}
        {tab === "assignments" && <AssignmentsSection />}
        {tab === "reps" && <SalesRepsSection />}
      </motion.div>
    </div>
  );
}
