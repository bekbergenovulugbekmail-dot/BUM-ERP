import { useState } from "react";
import { motion } from "motion/react";
import { Factory, Package, Cog, TrendingUp, Layers } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { useApiQuery } from "@/lib/query.ts";
import BOMSection from "./_components/bom-section.tsx";
import OrdersSection from "./_components/orders-section.tsx";
import WorkCentersSection from "./_components/work-centers-section.tsx";
import { num, type Bom, type ProductionStats, type ProductionStatus } from "./_lib/types.ts";

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

const TABS = [
  { key: "orders", label: "Buyurtmalar", icon: Factory },
  { key: "boms", label: "BOM", icon: Layers },
  { key: "workcenters", label: "Ish markazlari", icon: Cog },
] as const;

export default function ManufacturingPage() {
  const [tab, setTab] = useState<typeof TABS[number]["key"]>("orders");
  const stats = useApiQuery<ProductionStats>("/api/manufacturing/orders/stats").data;
  const boms = useApiQuery<{ boms: Bom[] }>("/api/manufacturing/boms").data?.boms;

  const countOf = (status: ProductionStatus) => stats?.byStatus.find((s) => s.status === status)?.count ?? 0;

  const statCards = [
    {
      label: "Jami buyurtmalar",
      value: stats?.total ?? 0,
      sub: `${countOf("completed")} ta yakunlangan`,
      icon: Factory,
      color: "text-indigo-500",
      bg: "bg-indigo-500/10",
    },
    {
      label: "Jarayonda",
      value: countOf("in_progress") + countOf("confirmed"),
      sub: `${countOf("draft")} ta qoralama`,
      icon: TrendingUp,
      color: "text-amber-500",
      bg: "bg-amber-500/10",
    },
    {
      label: "BOM soni",
      value: boms?.length ?? 0,
      sub: "Ishlab chiqarish rejalari",
      icon: Layers,
      color: "text-blue-500",
      bg: "bg-blue-500/10",
    },
    {
      label: "Jami ishlab chiqarish narxi",
      value: fmt(num(stats?.completedCost)) + " so'm",
      sub: "Yakunlangan buyurtmalar bo'yicha",
      icon: Package,
      color: "text-emerald-500",
      bg: "bg-emerald-500/10",
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
          <Factory className="h-5 w-5 text-indigo-500" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Ishlab chiqarish moduli</h1>
          <p className="text-sm text-muted-foreground">BOM, buyurtmalar, xom ashyo sarfi va tayyor mahsulot</p>
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
        {tab === "orders" && <OrdersSection />}
        {tab === "boms" && <BOMSection />}
        {tab === "workcenters" && <WorkCentersSection />}
      </motion.div>
    </div>
  );
}
