import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { TrendingUp, TrendingDown, DollarSign } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));
const MONTHS = ["Yan", "Fev", "Mar", "Apr", "May", "Iyun", "Iyul", "Avg", "Sen", "Okt", "Noy", "Dek"];

export default function ProfitLossSection() {
  const sales = useQuery(api.sales.orders.list, { limit: 500 });
  const purchases = useQuery(api.purchase.orders.list, { limit: 500 });
  const expenses = useQuery(api.finance.expenses.list, { limit: 500 });

  if (!sales || !purchases || !expenses) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}
      </div>
    );
  }

  // Build monthly P&L for last 6 months
  const now = new Date();
  const months = Array.from({ length: 6 }).map((_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    const key = d.toISOString().slice(0, 7); // YYYY-MM
    return { key, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}` };
  });

  const monthlyData = months.map(({ key, label }) => {
    const monthSales = sales
      .filter((o) => o.orderDate.startsWith(key) && !["cancelled"].includes(o.status))
      .reduce((s, o) => s + o.totalAmount, 0);
    const monthPurchases = purchases
      .filter((o) => o.orderDate.startsWith(key) && !["cancelled"].includes(o.status))
      .reduce((s, o) => s + o.totalAmount, 0);
    const monthExpenses = expenses
      .filter((e) => e.date.startsWith(key))
      .reduce((s, e) => s + e.amount, 0);
    const grossProfit = monthSales - monthPurchases;
    const netProfit = grossProfit - monthExpenses;
    return { key, label, monthSales, monthPurchases, monthExpenses, grossProfit, netProfit };
  });

  const current = monthlyData[monthlyData.length - 1];
  const maxVal = Math.max(...monthlyData.map((m) => Math.max(m.monthSales, m.monthPurchases + m.monthExpenses)));

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          {
            label: "Bu oy daromad",
            value: fmt(current?.monthSales ?? 0) + " so'm",
            icon: TrendingUp, color: "text-emerald-500", bg: "bg-emerald-500/10",
          },
          {
            label: "Bu oy xarajatlar jami",
            value: fmt((current?.monthPurchases ?? 0) + (current?.monthExpenses ?? 0)) + " so'm",
            icon: TrendingDown, color: "text-rose-500", bg: "bg-rose-500/10",
          },
          {
            label: "Sof foyda",
            value: fmt(current?.netProfit ?? 0) + " so'm",
            icon: DollarSign,
            color: (current?.netProfit ?? 0) >= 0 ? "text-blue-500" : "text-orange-500",
            bg: (current?.netProfit ?? 0) >= 0 ? "bg-blue-500/10" : "bg-orange-500/10",
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
            const salesH = maxVal > 0 ? (m.monthSales / maxVal) * 100 : 0;
            const costH = maxVal > 0 ? ((m.monthPurchases + m.monthExpenses) / maxVal) * 100 : 0;
            return (
              <div key={m.key} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex items-end gap-0.5 h-32 justify-center">
                  <div
                    className="flex-1 bg-emerald-500/70 rounded-t-sm transition-all"
                    style={{ height: `${salesH}%` }}
                    title={`Daromad: ${fmt(m.monthSales)}`}
                  />
                  <div
                    className="flex-1 bg-rose-500/60 rounded-t-sm transition-all"
                    style={{ height: `${costH}%` }}
                    title={`Xarajat: ${fmt(m.monthPurchases + m.monthExpenses)}`}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground text-center leading-tight">{m.label}</p>
                <p className={cn(
                  "text-[10px] font-bold",
                  m.netProfit >= 0 ? "text-emerald-500" : "text-rose-500"
                )}>
                  {m.netProfit >= 0 ? "+" : ""}{fmt(m.netProfit / 1_000_000).replace(".", ",")} M
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
            <div className="h-2.5 w-2.5 rounded-sm bg-rose-500/60" /> Xarajatlar
          </div>
        </div>
      </div>

      {/* Monthly table */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/30 border-b border-border">
              <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Oy</th>
              <th className="text-right px-4 py-3 text-xs text-muted-foreground font-medium">Sotuv</th>
              <th className="text-right px-4 py-3 text-xs text-muted-foreground font-medium">Xarid</th>
              <th className="text-right px-4 py-3 text-xs text-muted-foreground font-medium">Xarajat</th>
              <th className="text-right px-4 py-3 text-xs text-muted-foreground font-medium">Foyda</th>
              <th className="text-right px-4 py-3 text-xs text-muted-foreground font-medium">Marj %</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {[...monthlyData].reverse().map((m) => {
              const margin = m.monthSales > 0 ? (m.netProfit / m.monthSales) * 100 : 0;
              return (
                <tr key={m.key} className="hover:bg-muted/20">
                  <td className="px-4 py-3 font-medium">{m.label}</td>
                  <td className="px-4 py-3 text-right text-emerald-600 dark:text-emerald-400 font-medium">{fmt(m.monthSales)} so'm</td>
                  <td className="px-4 py-3 text-right text-muted-foreground">{fmt(m.monthPurchases)} so'm</td>
                  <td className="px-4 py-3 text-right text-rose-500">{fmt(m.monthExpenses)} so'm</td>
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
    </div>
  );
}
