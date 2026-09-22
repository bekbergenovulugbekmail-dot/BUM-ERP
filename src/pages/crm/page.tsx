import { useState } from "react";
import { motion } from "motion/react";
import {
  Users, TrendingUp, Activity,
  Target, Trophy, CircleDollarSign, CalendarClock,
} from "lucide-react";
import { cn } from "@/lib/utils.ts";
import PageTabs from "@/components/page-tabs.tsx";
import { useApiQuery } from "@/lib/query.ts";
import LeadsPipeline from "./_components/leads-pipeline.tsx";
import ActivitiesSection from "./_components/activities-section.tsx";
import CustomersSection from "./_components/customers-section.tsx";
import { usePermissions } from "@/hooks/use-company.ts";
import { num, type Activity as ActivityRow, type LeadStats } from "./_lib/types.ts";

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

/** Mijozlar — CRM ning asosiy ro'yxati (ilgari Sotuv modulida edi). */
const TABS = [
  { key: "customers", label: "Mijozlar", icon: Users },
  { key: "pipeline", label: "Pipeline", icon: TrendingUp },
  { key: "activities", label: "Faoliyatlar", icon: Activity },
] as const;

export default function CRMPage() {
  const { can } = usePermissions();
  // Mijozlar ro'yxati `sales.view` bilan ochiladi; ruxsat bo'lmasa tab ham ko'rinmaydi
  const canViewCustomers = can("sales.view");
  const [tab, setTab] = useState<typeof TABS[number]["key"]>(canViewCustomers ? "customers" : "pipeline");

  const leadStats = useApiQuery<LeadStats>("/api/crm/leads/stats").data;
  const planned = useApiQuery<{ activities: ActivityRow[] }>("/api/crm/activities", { status: "planned", limit: 500 })
    .data?.activities;

  const wonCount = leadStats?.byStage.find((s) => s.stage === "won")?.count ?? 0;
  const openCount = (leadStats?.byStage ?? [])
    .filter((s) => s.stage !== "won" && s.stage !== "lost")
    .reduce((sum, s) => sum + s.count, 0);

  const statsCards = [
    {
      label: "Jami leadlar",
      value: leadStats?.total ?? 0,
      sub: `${openCount} ta ochiq`,
      icon: Target,
      color: "text-indigo-500",
      bg: "bg-indigo-500/10",
    },
    {
      label: "Ochiq qiymat",
      value: fmt(num(leadStats?.openValue)) + " so'm",
      sub: "Pipeline'dagi lidlar",
      icon: CircleDollarSign,
      color: "text-blue-500",
      bg: "bg-blue-500/10",
    },
    {
      label: "Yutilgan",
      value: fmt(num(leadStats?.wonValue)) + " so'm",
      sub: `${wonCount} ta lid`,
      icon: Trophy,
      color: "text-amber-500",
      bg: "bg-amber-500/10",
    },
    {
      label: "Rejadagi faoliyatlar",
      value: planned?.length ?? 0,
      sub: "Qo'ng'iroq, uchrashuv, vazifa",
      icon: CalendarClock,
      color: "text-emerald-500",
      bg: "bg-emerald-500/10",
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
        <div className="h-10 w-10 rounded-xl bg-indigo-500/10 flex items-center justify-center">
          <Users className="h-5 w-5 text-indigo-500" />
        </div>
        <div>
          <h1 className="text-xl font-bold">CRM</h1>
          <p className="text-sm text-muted-foreground">Mijozlar, lidlar va ular bilan faoliyat</p>
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

      <PageTabs
        tabs={TABS.filter((item) => item.key !== "customers" || canViewCustomers).map((item) => ({
          key: item.key,
          label: item.label,
          icon: item.icon,
        }))}
        value={tab}
        onChange={setTab}
      />

      {/* Tab content */}
      <motion.div
        key={tab}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15 }}
      >
        {tab === "customers" && canViewCustomers && <CustomersSection />}
        {tab === "pipeline" && <LeadsPipeline />}
        {tab === "activities" && <ActivitiesSection />}
      </motion.div>
    </div>
  );
}
