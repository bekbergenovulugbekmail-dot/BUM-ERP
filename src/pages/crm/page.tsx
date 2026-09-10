import { useState, useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { motion } from "motion/react";
import {
  Users, TrendingUp, Route, Activity,
  Target, Trophy, Phone,
} from "lucide-react";
import { cn } from "@/lib/utils.ts";
import LeadsPipeline from "./_components/leads-pipeline.tsx";
import SalesRepsSection from "./_components/sales-reps-section.tsx";
import DistributionSection from "./_components/distribution-section.tsx";
import ActivitiesSection from "./_components/activities-section.tsx";

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

const TABS = [
  { key: "pipeline", label: "Pipeline", icon: TrendingUp },
  { key: "distribution", label: "Distribyutsiya", icon: Route },
  { key: "activities", label: "Faoliyatlar", icon: Activity },
  { key: "reps", label: "Savdo vakillari", icon: Users },
] as const;

export default function CRMPage() {
  const [tab, setTab] = useState<typeof TABS[number]["key"]>("pipeline");

  const leadStats = useQuery(api.crm.leads.getStats, {});
  const reps = useQuery(api.crm.salesReps.list, { onlyActive: true });
  const routes = useQuery(api.crm.distribution.listRoutes, { onlyActive: true });
  const recentActivities = useQuery(api.crm.activities.listRecent, { limit: 5 });

  const statsCards = [
    {
      label: "Jami leadlar",
      value: leadStats?.total ?? 0,
      sub: `${leadStats?.byStage?.["won"] ?? 0} ta yutilgan`,
      icon: Target,
      color: "text-indigo-500",
      bg: "bg-indigo-500/10",
    },
    {
      label: "Taxminiy qiymat",
      value: fmt(leadStats?.totalValue ?? 0) + " so'm",
      sub: `Pipeline: ${leadStats?.total ?? 0}`,
      icon: Trophy,
      color: "text-amber-500",
      bg: "bg-amber-500/10",
    },
    {
      label: "Faol marshrutlar",
      value: routes?.length ?? 0,
      sub: "Distribyutsiya",
      icon: Route,
      color: "text-emerald-500",
      bg: "bg-emerald-500/10",
    },
    {
      label: "Savdo vakillari",
      value: reps?.length ?? 0,
      sub: "Faol",
      icon: Phone,
      color: "text-blue-500",
      bg: "bg-blue-500/10",
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
        <div className="h-10 w-10 rounded-xl bg-indigo-500/10 flex items-center justify-center">
          <Users className="h-5 w-5 text-indigo-500" />
        </div>
        <div>
          <h1 className="text-xl font-bold">CRM & Distribyutsiya</h1>
          <p className="text-sm text-muted-foreground">Mijozlar, lead pipeline, marshrut boshqaruvi</p>
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
        {tab === "pipeline" && <LeadsPipeline />}
        {tab === "distribution" && <DistributionSection />}
        {tab === "activities" && <ActivitiesSection />}
        {tab === "reps" && <SalesRepsSection />}
      </motion.div>
    </div>
  );
}
