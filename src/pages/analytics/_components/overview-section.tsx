import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { TrendingUp, DollarSign, ShoppingCart, Users, Package, Percent } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import { useApiQuery } from "@/lib/query.ts";
import { num, type BiOverview, type SalesSummary, type StockSummary, type TopCustomer } from "../_lib/types.ts";

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const fmtFull = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

const ABC_COLORS = { A: "#6366f1", B: "#f59e0b", C: "#94a3b8" };

export default function OverviewSection({ days }: { days: number }) {
  const bi = useApiQuery<BiOverview>("/api/analytics/reports/overview", { days }).data;
  const salesSummary = useApiQuery<SalesSummary>("/api/analytics/reports/sales", { days }).data;
  const stockSummary = useApiQuery<StockSummary>("/api/analytics/reports/stock").data;
  const topCustomers = useApiQuery<{ customers: TopCustomer[] }>("/api/analytics/reports/top-customers", { days, limit: 8 }).data?.customers;

  const netProfit = num(bi?.netProfit);
  const kpis = bi ? [
    { label: "Daromad", value: fmt(num(bi.revenue)) + " so'm", icon: DollarSign, color: "text-emerald-500", bg: "bg-emerald-500/10", sub: `${bi.orderCount} buyurtma` },
    { label: "Xarajat", value: fmt(num(bi.expenses)) + " so'm", icon: TrendingUp, color: "text-rose-500", bg: "bg-rose-500/10", sub: "Tasdiqlangan xarajatlar" },
    { label: "Sof foyda", value: fmt(netProfit) + " so'm", icon: Percent, color: netProfit >= 0 ? "text-blue-500" : "text-rose-500", bg: netProfit >= 0 ? "bg-blue-500/10" : "bg-rose-500/10", sub: `Gross margin: ${num(bi.grossMargin).toFixed(1)}%` },
    { label: "Ombor qiymati", value: fmt(num(bi.stockValue)) + " so'm", icon: Package, color: "text-indigo-500", bg: "bg-indigo-500/10", sub: "Joriy qoldiq" },
    { label: "Faol mijozlar", value: bi.customerCount.toLocaleString(), icon: Users, color: "text-violet-500", bg: "bg-violet-500/10", sub: "Ro'yxatdan o'tgan" },
    { label: "Xodimlar", value: bi.employeeCount.toLocaleString(), icon: ShoppingCart, color: "text-amber-500", bg: "bg-amber-500/10", sub: "Faol ishchilar" },
  ] : [];

  // ABC pie data (API qiymati bo'yicha eng yirik 50 ta mahsulotni qaytaradi)
  const abcCounts = { A: 0, B: 0, C: 0 };
  for (const item of stockSummary?.abcData ?? []) abcCounts[item.abc]++;
  const abcPieData = [
    { name: "A — Asosiy (80%)", value: abcCounts.A, color: ABC_COLORS.A },
    { name: "B — O'rta (15%)", value: abcCounts.B, color: ABC_COLORS.B },
    { name: "C — Kam (5%)", value: abcCounts.C, color: ABC_COLORS.C },
  ];

  const dailyRevenue = (salesSummary?.dailyRevenue ?? []).map((d) => ({ date: d.date, amount: num(d.amount) }));
  const topMax = num(topCustomers?.[0]?.amount) || 1;

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {!bi
          ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)
          : kpis.map((k) => (
              <div key={k.label} className="bg-card border border-border rounded-2xl p-4">
                <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center mb-2", k.bg)}>
                  <k.icon className={cn("h-4 w-4", k.color)} />
                </div>
                <p className="text-lg font-bold leading-tight">{k.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{k.label}</p>
                <p className="text-xs text-muted-foreground/70 mt-0.5">{k.sub}</p>
              </div>
            ))}
      </div>

      {/* Revenue chart + top customers */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Daily revenue */}
        <div className="lg:col-span-2 bg-card border border-border rounded-2xl p-5">
          <p className="text-sm font-semibold mb-4">Kunlik daromad (so'm)</p>
          {!salesSummary ? (
            <Skeleton className="h-48 w-full rounded-xl" />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={dailyRevenue}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => String(v).slice(5)} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={fmt} width={60} />
                <Tooltip formatter={(v) => [fmtFull(Number(v)) + " so'm", "Daromad"]} labelFormatter={(l) => `Sana: ${l}`} />
                <Area type="monotone" dataKey="amount" stroke="#6366f1" fill="url(#revGrad)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Top customers */}
        <div className="bg-card border border-border rounded-2xl p-5">
          <p className="text-sm font-semibold mb-3">Top mijozlar</p>
          {!topCustomers ? (
            <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 rounded-lg" />)}</div>
          ) : topCustomers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">Mijozlar topilmadi</p>
          ) : (
            <div className="space-y-2">
              {topCustomers.map((c) => (
                <div key={c.customerId} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="truncate max-w-[120px] font-medium">{c.name}</span>
                    <span className="text-muted-foreground">{fmt(num(c.amount))}</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full">
                    <div className="h-full bg-primary rounded-full" style={{ width: `${(num(c.amount) / topMax) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ABC analysis + order status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* ABC Pie */}
        <div className="bg-card border border-border rounded-2xl p-5">
          <p className="text-sm font-semibold mb-1">ABC tahlil — mahsulotlar</p>
          <p className="text-xs text-muted-foreground mb-4">Ombor qiymati bo'yicha toifalashtirish</p>
          {!stockSummary ? (
            <Skeleton className="h-48 w-full rounded-xl" />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={abcPieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={3}>
                  {abcPieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip formatter={(v) => [Number(v) + " mahsulot", ""]} />
                <Legend iconSize={10} formatter={(v) => <span style={{ fontSize: 11 }}>{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Order status bar */}
        <div className="bg-card border border-border rounded-2xl p-5">
          <p className="text-sm font-semibold mb-1">Buyurtmalar holati</p>
          <p className="text-xs text-muted-foreground mb-4">Oxirgi {days} kun</p>
          {!salesSummary ? (
            <Skeleton className="h-48 w-full rounded-xl" />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={salesSummary.byStatus}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="status" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
