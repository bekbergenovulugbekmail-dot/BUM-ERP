/**
 * Daromad va zarar — buxgalteriya jurnalidan (`GET /api/finance/reports/profit-loss`).
 * Convex'da sotuv − xarid − xarajat ro'yxatlardan (500 ta chegara bilan) hisoblanardi;
 * endi o'tkazilgan yozuvlar bo'yicha: xarid emas, sotilgan tovar tannarxi xarajatga kiradi.
 */
import { useQueries } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, DollarSign } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import { api, type ApiError } from "@/lib/api.ts";
import { fmt, toNum, type ProfitLoss, type ProfitLossLine } from "../_lib/types.ts";

const MONTHS = ["Yan", "Fev", "Mar", "Apr", "May", "Iyun", "Iyul", "Avg", "Sen", "Okt", "Noy", "Dek"];
const PATH = "/api/finance/reports/profit-loss";

/** So'nggi 6 oy — mahalliy sana bo'yicha (UTC siljishisiz). */
function lastMonths(count: number) {
  const now = new Date();
  return Array.from({ length: count }).map((_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (count - 1 - i), 1);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const lastDay = String(new Date(year, d.getMonth() + 1, 0).getDate()).padStart(2, "0");
    return {
      key: `${year}-${month}`,
      label: `${MONTHS[d.getMonth()]} ${year}`,
      params: { dateFrom: `${year}-${month}-01`, dateTo: `${year}-${month}-${lastDay}` },
    };
  });
}

export default function ProfitLossSection() {
  const months = lastMonths(6);
  const results = useQueries({
    queries: months.map(({ params }) => ({
      queryKey: [PATH, params],
      queryFn: ({ signal }: { signal: AbortSignal }) => api.get<ProfitLoss>(PATH, params, signal),
    })),
  });

  const failed = results.find((r) => r.isError)?.error as ApiError | undefined;
  if (failed) {
    return <div className="py-12 text-center text-sm text-muted-foreground">{failed.message}</div>;
  }
  if (results.some((r) => !r.data)) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}
      </div>
    );
  }

  const monthlyData = months.map(({ key, label }, i) => {
    const report = results[i]!.data!;
    return {
      key,
      label,
      income: toNum(report.totalIncome),
      expense: toNum(report.totalExpense),
      netProfit: toNum(report.netProfit),
      report,
    };
  });

  const current = monthlyData[monthlyData.length - 1]!;
  const maxVal = Math.max(...monthlyData.map((m) => Math.max(m.income, m.expense)));

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          {
            label: "Bu oy daromad",
            value: fmt(current.income) + " so'm",
            icon: TrendingUp, color: "text-emerald-500", bg: "bg-emerald-500/10",
          },
          {
            label: "Bu oy xarajatlar jami",
            value: fmt(current.expense) + " so'm",
            icon: TrendingDown, color: "text-rose-500", bg: "bg-rose-500/10",
          },
          {
            label: "Sof foyda",
            value: fmt(current.netProfit) + " so'm",
            icon: DollarSign,
            color: current.netProfit >= 0 ? "text-blue-500" : "text-orange-500",
            bg: current.netProfit >= 0 ? "bg-blue-500/10" : "bg-orange-500/10",
          },
        ].map((card) => (
          <div key={card.label} className="bg-card border border-border rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className={cn("h-7 w-7 rounded-lg flex items-center justify-center", card.bg)}>
                <card.icon className={cn("h-3.5 w-3.5", card.color)} />
              </div>
              <span className="text-xs text-muted-foreground">{card.label}</span>
            </div>
            <p className={cn("text-xl font-bold", card.color)}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Monthly chart */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <h3 className="text-sm font-semibold mb-4">Oylik P&L (so'nggi 6 oy)</h3>
        <div className="flex items-end gap-3 h-40">
          {monthlyData.map((m) => {
            const incomeH = maxVal > 0 ? (m.income / maxVal) * 100 : 0;
            const costH = maxVal > 0 ? (m.expense / maxVal) * 100 : 0;
            return (
              <div key={m.key} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex items-end gap-0.5 h-32 justify-center">
                  <div
                    className="flex-1 bg-emerald-500/70 rounded-t-sm transition-all"
                    style={{ height: `${incomeH}%` }}
                    title={`Daromad: ${fmt(m.income)}`}
                  />
                  <div
                    className="flex-1 bg-rose-500/60 rounded-t-sm transition-all"
                    style={{ height: `${costH}%` }}
                    title={`Xarajat: ${fmt(m.expense)}`}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground text-center leading-tight">{m.label}</p>
                <p className={cn(
                  "text-[10px] font-bold",
                  m.netProfit >= 0 ? "text-emerald-500" : "text-rose-500"
                )}>
                  {m.netProfit >= 0 ? "+" : ""}{(m.netProfit / 1_000_000).toFixed(1).replace(".", ",")} M
                </p>
              </div>
            );
          })}
        </div>
        <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-sm bg-emerald-500/70" /> Daromad
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-sm bg-rose-500/60" /> Xarajatlar (tannarx bilan)
          </div>
        </div>
      </div>

      {/* Monthly table */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/30 border-b border-border">
              <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Oy</th>
              <th className="text-right px-4 py-3 text-xs text-muted-foreground font-medium">Daromad</th>
              <th className="text-right px-4 py-3 text-xs text-muted-foreground font-medium">Xarajat</th>
              <th className="text-right px-4 py-3 text-xs text-muted-foreground font-medium">Foyda</th>
              <th className="text-right px-4 py-3 text-xs text-muted-foreground font-medium">Marj %</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {[...monthlyData].reverse().map((m) => {
              const margin = m.income > 0 ? (m.netProfit / m.income) * 100 : 0;
              return (
                <tr key={m.key} className="hover:bg-muted/20">
                  <td className="px-4 py-3 font-medium">{m.label}</td>
                  <td className="px-4 py-3 text-right text-emerald-600 dark:text-emerald-400 font-medium">{fmt(m.income)} so'm</td>
                  <td className="px-4 py-3 text-right text-rose-500">{fmt(m.expense)} so'm</td>
                  <td className={cn(
                    "px-4 py-3 text-right font-bold",
                    m.netProfit >= 0 ? "text-blue-600 dark:text-blue-400" : "text-orange-600 dark:text-orange-400"
                  )}>
                    {fmt(m.netProfit)} so'm
                  </td>
                  <td className={cn(
                    "px-4 py-3 text-right text-xs font-semibold",
                    margin >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500"
                  )}>
                    {margin.toFixed(1)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Current month breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <BreakdownCard title={`Daromadlar — ${current.label}`} lines={current.report.income} tone="text-emerald-600 dark:text-emerald-400" />
        <BreakdownCard title={`Xarajatlar — ${current.label}`} lines={current.report.expenses} tone="text-rose-500" />
      </div>
    </div>
  );
}

function BreakdownCard({ title, lines, tone }: { title: string; lines: ProfitLossLine[]; tone: string }) {
  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border text-sm font-semibold">{title}</div>
      {lines.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">Yozuvlar yo'q</div>
      ) : (
        <table className="w-full text-sm">
          <tbody className="divide-y divide-border">
            {lines.map((line) => (
              <tr key={line.accountId}>
                <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground w-16">{line.code}</td>
                <td className="px-4 py-2.5">{line.name}</td>
                <td className={cn("px-4 py-2.5 text-right font-semibold", tone)}>{fmt(line.amount)} so'm</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
