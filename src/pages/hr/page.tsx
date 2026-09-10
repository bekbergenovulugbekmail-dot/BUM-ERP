import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { motion } from "motion/react";
import { Users, UserCheck, DollarSign, Building2, CalendarDays, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import EmployeesSection from "./_components/employees-section.tsx";
import DepartmentsSection from "./_components/departments-section.tsx";
import AttendanceSection from "./_components/attendance-section.tsx";
import SalarySection from "./_components/salary-section.tsx";

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

const TABS = [
  { key: "employees", label: "Xodimlar", icon: Users },
  { key: "departments", label: "Bo'limlar", icon: Building2 },
  { key: "attendance", label: "Davomat", icon: CalendarDays },
  { key: "salary", label: "Maosh", icon: DollarSign },
] as const;

export default function HRPage() {
  const [tab, setTab] = useState<typeof TABS[number]["key"]>("employees");
  const stats = useQuery(api.hr.employees.getStats, {});

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
      value: fmt(stats?.totalSalary ?? 0) + " so'm",
      sub: "Faol xodimlar bo'yicha",
      icon: DollarSign,
      color: "text-emerald-500",
      bg: "bg-emerald-500/10",
    },
    {
      label: "O'rtacha maosh",
      value: stats?.active ? fmt((stats.totalSalary ?? 0) / stats.active) + " so'm" : "—",
      sub: "Bir xodimga",
      icon: TrendingUp,
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
      </motion.div>
    </div>
  );
}
