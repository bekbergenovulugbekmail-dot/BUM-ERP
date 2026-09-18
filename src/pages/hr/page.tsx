import { useState } from "react";
import { motion } from "motion/react";
import { Users, DollarSign, Building2, CalendarDays, TrendingUp, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import PageTabs from "@/components/page-tabs.tsx";
import { useApiQuery } from "@/lib/query.ts";
import EmployeesSection from "./_components/employees-section.tsx";
import DepartmentsSection from "./_components/departments-section.tsx";
import AttendanceSection from "./_components/attendance-section.tsx";
import SalarySection from "./_components/salary-section.tsx";
import KpiSection from "./_components/kpi-section.tsx";
import { fmt, toNum, type EmployeeStats } from "./_lib/types.ts";

const TABS = [
  { key: "employees", label: "Xodimlar", icon: Users },
  { key: "departments", label: "Bo'limlar", icon: Building2 },
  { key: "attendance", label: "Davomat", icon: CalendarDays },
  { key: "salary", label: "Maosh", icon: DollarSign },
  { key: "kpi", label: "KPI", icon: TrendingUp },
] as const;

export default function HRPage() {
  const [tab, setTab] = useState<typeof TABS[number]["key"]>("employees");
  const statsQuery = useApiQuery<EmployeeStats>("/api/hr/employees/stats");
  const stats = statsQuery.data;

  if (statsQuery.error?.status === 403) {
    return (
      <div className="p-6">
        <div className="flex flex-col items-center py-16 text-center text-muted-foreground">
          <ShieldAlert className="h-10 w-10 mb-3 opacity-40" />
          <p>HR bo'limini ko'rish uchun ruxsat yo'q</p>
        </div>
      </div>
    );
  }

  const totalSalary = toNum(stats?.totalSalary);

  const statCards = [
    {
      label: "Jami xodimlar",
      value: stats?.total ?? 0,
      sub: `${stats?.active ?? 0} ta faol`,
      icon: Users,
      color: "text-indigo-500",
      bg: "bg-indigo-500/10",
    },
    {
      label: "Ta'tilda",
      value: stats?.onLeave ?? 0,
      sub: `${stats?.terminated ?? 0} ta ishdan ketgan`,
      icon: CalendarDays,
      color: "text-amber-500",
      bg: "bg-amber-500/10",
    },
    {
      label: "Oylik maosh fondi",
      value: fmt(totalSalary) + " so'm",
      sub: "Oylik maoshli xodimlar bo'yicha",
      icon: DollarSign,
      color: "text-emerald-500",
      bg: "bg-emerald-500/10",
    },
    {
      label: "O'rtacha maosh",
      value: stats?.active ? fmt(totalSalary / stats.active) + " so'm" : "—",
      sub: "Bir xodimga",
      icon: TrendingUp,
      color: "text-blue-500",
      bg: "bg-blue-500/10",
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
          <h1 className="text-xl font-bold">HR — Xodimlar boshqaruvi</h1>
          <p className="text-sm text-muted-foreground">Bo'limlar, xodimlar, davomat va maosh hisoblash</p>
        </div>
      </motion.div>

      {/* Stats */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="grid grid-cols-2 lg:grid-cols-4 gap-4"
      >
        {statCards.map((card, i) => (
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

      <PageTabs tabs={TABS.map((item) => ({ key: item.key, label: item.label, icon: item.icon }))} value={tab} onChange={setTab} />

      {/* Content */}
      <motion.div
        key={tab}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15 }}
      >
        {tab === "employees" && <EmployeesSection />}
        {tab === "departments" && <DepartmentsSection />}
        {tab === "attendance" && <AttendanceSection />}
        {tab === "salary" && <SalarySection />}
        {tab === "kpi" && <KpiSection />}
      </motion.div>
    </div>
  );
}
