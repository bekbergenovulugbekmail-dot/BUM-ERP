import { useState } from "react";
import { motion } from "motion/react";
import { BarChart2, Package, TrendingUp, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { useTranslation } from "react-i18next";
import OverviewSection from "./_components/overview-section.tsx";
import StockAnalysisSection from "./_components/stock-analysis-section.tsx";
import SalesReportSection from "./_components/sales-report-section.tsx";
import AIAssistantSection from "./_components/ai-assistant-section.tsx";

const DAY_OPTIONS = [7, 14, 30, 60, 90];

export default function AnalyticsPage() {
  const { t } = useTranslation("modules");
  const [tab, setTab] = useState<"overview" | "sales" | "stock" | "ai">("overview");
  const [days, setDays] = useState(30);

  const TABS = [
    { key: "overview" as const, label: t("analytics.tab.overview"), icon: BarChart2 },
    { key: "sales" as const, label: t("analytics.tab.sales"), icon: TrendingUp },
    { key: "stock" as const, label: t("analytics.tab.stock"), icon: Package },
    { key: "ai" as const, label: t("analytics.tab.ai"), icon: Sparkles },
  ];

  const periodLabel = (d: number) => {
    const key = `analytics.period.${d}` as const;
    const val = t(key as Parameters<typeof t>[0]);
    return val !== key ? val : `Oxirgi ${d} kun`;
  };

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between gap-3 flex-wrap"
      >
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-indigo-500/10 flex items-center justify-center">
            <BarChart2 className="h-5 w-5 text-indigo-500" />
          </div>
          <div>
            <h1 className="text-xl font-bold">{t("analytics.title")}</h1>
            <p className="text-sm text-muted-foreground">{t("analytics.subtitle")}</p>
          </div>
        </div>
        {tab !== "ai" && (
          <Select value={String(days)} onValueChange={(v) => setDays(parseInt(v))}>
            <SelectTrigger className="w-40 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DAY_OPTIONS.map((d) => (
                <SelectItem key={d} value={String(d)}>{periodLabel(d)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </motion.div>

      {/* Tabs */}
      <div className="border-b border-border">
        <div className="flex gap-1 overflow-x-auto">
          {TABS.map((t_item) => (
            <button
              key={t_item.key}
              onClick={() => setTab(t_item.key)}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-all cursor-pointer whitespace-nowrap",
                tab === t_item.key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <t_item.icon className={cn("h-4 w-4", t_item.key === "ai" ? "text-violet-500" : "")} />
              {t_item.label}
              {t_item.key === "ai" && (
                <span className="text-xs bg-violet-500/20 text-violet-600 dark:text-violet-400 px-1.5 py-0.5 rounded-full">AI</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <motion.div
        key={tab}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15 }}
      >
        {tab === "overview" && <OverviewSection days={days} />}
        {tab === "sales" && <SalesReportSection days={days} />}
        {tab === "stock" && <StockAnalysisSection days={days} />}
        {tab === "ai" && <AIAssistantSection />}
      </motion.div>
    </div>
  );
}
