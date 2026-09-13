import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  TrendingUp, ShoppingCart, DollarSign, Package,
  AlertTriangle, Wallet, Building2, ShieldAlert,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import { errorMessage } from "@/lib/api.ts";
import { useApiQuery } from "@/lib/query.ts";
import { usePermissions } from "@/hooks/use-company.ts";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button.tsx";
import { useCurrentUser } from "@/hooks/use-auth.ts";
import { formatDay, subscriptionBlocked } from "@/lib/subscription.ts";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

/** `GET /api/analytics/dashboard` javobi — summalar numeric satr. */
type DashboardKpi = {
  todaySalesCount: number;
  todaySalesTotal: string;
  todayReceipts: string;
  monthRevenue: string;
  cogs: string;
  grossProfit: string;
  stockValue: string;
  lowStockCount: number;
  supplierDebt: string;
  customerDebt: string;
  cashBalance: string;
  bankBalance: string;
  recentSales: {
    id: string; number: string; customerName: string | null; amount: string;
    paidAmount: string; status: string; orderDate: string; isPos: boolean;
  }[];
  recentPurchases: { id: string; number: string; supplierName: string; amount: string; status: string; orderDate: string }[];
  lowStockItems: { productId: string; productName: string; warehouseName: string; quantity: string; minStock: string; unit: string }[];
  weeklyRevenue: { date: string; revenue: string }[];
};

const num = (value: string | number | null | undefined) => Number(value ?? 0) || 0;

const fmt = (value: string | number) => {
  const n = num(value);
  return Math.abs(n) >= 1_000_000
    ? (n / 1_000_000).toFixed(1) + " mln"
    : Math.abs(n) >= 1_000
    ? (n / 1_000).toFixed(0) + " ming"
    : String(Math.round(n));
};

const fmtFull = (n: number) =>
  new Intl.NumberFormat("uz-UZ").format(Math.round(n)) + " so'm";

/** "2026-09-11" → "Pay" (hafta kuni, mahalliy). */
const weekdayLabel = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString("uz-UZ", { weekday: "short" });

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  confirmed: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  shipped: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  delivered: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  cancelled: "bg-destructive/10 text-destructive",
  returned: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
  partial: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  received: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  invoiced: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  paid: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
};
const STATUS_LABELS: Record<string, string> = {
  draft: "Qoralama", confirmed: "Tasdiqlangan", shipped: "Jo'natildi",
  delivered: "Yetkazildi", cancelled: "Bekor", returned: "Qaytarildi",
  partial: "Qisman qabul", received: "Qabul qilindi", invoiced: "Hisob-faktura", paid: "To'langan",
};

function StatCard({
  title, value, sub, icon, color, index,
}: {
  title: string; value: string; sub?: string;
  icon: React.ReactNode; color: string; index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.35 }}
    >
      <Card className="hover:shadow-md transition-shadow">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium mb-1">{title}</p>
              <p className="text-xl font-bold tracking-tight">{value}</p>
              {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
            </div>
            <div className={cn("p-2.5 rounded-xl", color)}>{icon}</div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default function DashboardPage() {
  const { t } = useTranslation(["dashboard", "common"]);
  const { can, isLoading: permissionsLoading } = usePermissions();
  const { lng = "uz" } = useParams<{ lng: string }>();
  const me = useCurrentUser();
  // Obuna tugagan: ma'lumot saqlangan, ish bo'limlari yopiq — shu yerdan uzaytirishga yo'l
  const expiredNotice = subscriptionBlocked(me?.subscription) ? (
    <Card className="border-destructive/40 bg-destructive/5">
      <CardContent className="py-5 flex flex-col sm:flex-row sm:items-center gap-4">
        <ShieldAlert className="h-8 w-8 text-destructive shrink-0" />
        <div className="flex-1">
          <p className="font-semibold">BUM ERP obunangiz muddati tugagan.</p>
          <p className="text-sm text-muted-foreground">
            Tugagan sana: {formatDay(me?.subscription?.expiresAt)}. Ma'lumotlaringiz saqlangan — obuna uzaytirilgach barcha bo'limlar qayta ochiladi.
          </p>
        </div>
        {can("subscription.view") ? (
          <Button asChild>
            <Link to={`/${lng}/subscription`}>OBUNANI UZAYTIRISH</Link>
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">Kompaniya egasiga murojaat qiling.</p>
        )}
      </CardContent>
    </Card>
  ) : null;
  // Moliyaviy ko'rsatkichlar (foyda, kassa, qarzlar) faqat `analytics.view` bilan
  const canView = can("analytics.view");
  const query = useApiQuery<DashboardKpi>(canView ? "/api/analytics/dashboard" : null);
  const kpi = query.data;
  const loading = kpi === undefined;

  const header = (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center justify-between"
    >
      <div>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {new Date().toLocaleDateString("uz-UZ", {
            weekday: "long", year: "numeric", month: "long", day: "numeric",
          })}
        </p>
      </div>
    </motion.div>
  );

  if ((!permissionsLoading && !canView) || query.isError) {
    return (
      <div className="p-4 md:p-6 space-y-6">
        {header}
        {expiredNotice}
        <Card>
          <CardContent className="py-10 flex flex-col items-center text-center gap-2">
            <ShieldAlert className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">
              {query.isError ? "Ko'rsatkichlarni yuklab bo'lmadi" : "Moliyaviy ko'rsatkichlarni ko'rish uchun ruxsat yo'q"}
            </p>
            <p className="text-xs text-muted-foreground">
              {query.isError
                ? errorMessage(query.error)
                : "Chap menyudagi bo'limlardan foydalaning yoki administratordan \"Tahlil\" ruxsatini so'rang."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const weekly = (kpi?.weeklyRevenue ?? []).map((d) => ({
    day: weekdayLabel(d.date),
    date: d.date,
    revenue: num(d.revenue),
  }));

  return (
    <div className="p-4 md:p-6 space-y-6">
      {header}
      {expiredNotice}

      {/* KPI cards */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <StatCard index={0} title="Bugungi sotuv" value={`${kpi.todaySalesCount} ta`}
            sub={`${fmt(kpi.todaySalesTotal)} so'm · tushgan: ${fmt(kpi.todayReceipts)}`}
            icon={<ShoppingCart className="h-5 w-5 text-blue-600" />}
            color="bg-blue-50 dark:bg-blue-900/30" />
          <StatCard index={1} title="Bu oy tushum" value={fmt(kpi.monthRevenue) + " so'm"}
            icon={<DollarSign className="h-5 w-5 text-green-600" />}
            color="bg-green-50 dark:bg-green-900/30" />
          <StatCard index={2} title="Yalpi foyda" value={fmt(kpi.grossProfit) + " so'm"}
            sub={num(kpi.monthRevenue) > 0 ? `${((num(kpi.grossProfit) / num(kpi.monthRevenue)) * 100).toFixed(1)}%` : "—"}
            icon={<TrendingUp className="h-5 w-5 text-violet-600" />}
            color="bg-violet-50 dark:bg-violet-900/30" />
          <StatCard index={3} title="Stok qiymati" value={fmt(kpi.stockValue) + " so'm"}
            sub={kpi.lowStockCount > 0 ? `${kpi.lowStockCount} ta kam` : "Normal"}
            icon={<Package className="h-5 w-5 text-amber-600" />}
            color={cn("bg-amber-50 dark:bg-amber-900/30", kpi.lowStockCount > 0 && "ring-1 ring-amber-400/50")} />
          <StatCard index={4} title="Naqd kassa" value={fmt(kpi.cashBalance) + " so'm"}
            sub={`Bank: ${fmt(kpi.bankBalance)}`}
            icon={<Wallet className="h-5 w-5 text-cyan-600" />}
            color="bg-cyan-50 dark:bg-cyan-900/30" />
          <StatCard index={5} title="Yetkazuvchi qarzi" value={fmt(kpi.supplierDebt) + " so'm"}
            sub={num(kpi.customerDebt) > 0 ? `Mijoz: ${fmt(kpi.customerDebt)}` : "Mijoz qarzi yo'q"}
            icon={<Building2 className="h-5 w-5 text-rose-600" />}
            color={cn("bg-rose-50 dark:bg-rose-900/30", num(kpi.supplierDebt) > 0 && "ring-1 ring-rose-400/50")} />
        </div>
      )}

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Weekly revenue chart */}
        <motion.div className="lg:col-span-2" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">{t("sales_trend")} (7 kun)</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-[220px] w-full rounded-lg" />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={weekly} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="oklch(0.55 0.18 260)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="oklch(0.55 0.18 260)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.88 0.01 240)" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000000).toFixed(0)}M`} />
                    <Tooltip
                      formatter={(v) => fmtFull(Number(v))}
                      labelFormatter={(_, payload) => String(payload?.[0]?.payload?.date ?? "")}
                    />
                    <Area type="monotone" dataKey="revenue" stroke="oklch(0.55 0.18 260)" fill="url(#revGrad)" strokeWidth={2} name="Sotuv" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Low stock alerts */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <Card className="h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                {t("low_stock")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
              ) : kpi.lowStockItems.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">Kam stok yo'q</p>
              ) : (
                <div className="space-y-3">
                  {kpi.lowStockItems.map((item) => (
                    <div key={`${item.productId}-${item.warehouseName}`} className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{item.productName}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{item.warehouseName}</p>
                        <div className="mt-0.5">
                          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full bg-amber-500"
                              style={{ width: `${Math.min((num(item.quantity) / Math.max(num(item.minStock), 1)) * 100, 100)}%` }}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs font-bold text-amber-600">{num(item.quantity)}</p>
                        <p className="text-[10px] text-muted-foreground">{item.unit}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-4 pt-3 border-t space-y-1">
                <p className="text-xs font-semibold text-muted-foreground">Moliyaviy holat</p>
                {loading ? (
                  <Skeleton className="h-10 w-full" />
                ) : (
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Naqd</span>
                      <span className="font-medium">{fmt(kpi.cashBalance)} so'm</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Bank</span>
                      <span className="font-medium">{fmt(kpi.bankBalance)} so'm</span>
                    </div>
                    <div className="flex justify-between border-t pt-1">
                      <span className="font-medium">Jami</span>
                      <span className="font-bold">{fmt(num(kpi.cashBalance) + num(kpi.bankBalance))} so'm</span>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent sales */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">{t("recent_transactions")}</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : kpi.recentSales.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">Hozircha sotuv yo'q</p>
              ) : (
                <div className="space-y-2">
                  {kpi.recentSales.map((tx) => (
                    <div key={tx.id} className="flex items-center gap-3 py-1.5 border-b border-border/50 last:border-0">
                      <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <ShoppingCart className="h-3.5 w-3.5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{tx.customerName ?? (tx.isPos ? "Chakana (POS)" : "—")}</p>
                        <p className="text-[10px] text-muted-foreground">{tx.number} · {tx.orderDate}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs font-bold">{fmt(tx.amount)} so'm</p>
                        <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium", STATUS_COLORS[tx.status] ?? "bg-muted text-muted-foreground")}>
                          {STATUS_LABELS[tx.status] ?? tx.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Recent purchases + COGS summary */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">So'nggi xaridlar</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : kpi.recentPurchases.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">Hozircha xarid yo'q</p>
              ) : (
                <div className="space-y-2">
                  {kpi.recentPurchases.map((po) => (
                    <div key={po.id} className="flex items-center gap-3 py-1.5 border-b border-border/50 last:border-0">
                      <div className="h-7 w-7 rounded-full bg-green-500/10 flex items-center justify-center shrink-0">
                        <Package className="h-3.5 w-3.5 text-green-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{po.supplierName}</p>
                        <p className="text-[10px] text-muted-foreground">{po.number} · {po.orderDate}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs font-bold">{fmt(po.amount)} so'm</p>
                        <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium", STATUS_COLORS[po.status] ?? "bg-muted text-muted-foreground")}>
                          {STATUS_LABELS[po.status] ?? po.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* COGS summary */}
              {!loading && (
                <div className="mt-4 pt-3 border-t space-y-1.5 text-xs">
                  <p className="font-semibold text-muted-foreground">Bu oy P&L</p>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Sotuv</span>
                    <span className="font-medium">{fmt(kpi.monthRevenue)} so'm</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tannarx (COGS)</span>
                    <span className="font-medium text-red-500">−{fmt(kpi.cogs)} so'm</span>
                  </div>
                  <div className="flex justify-between border-t pt-1">
                    <span className="font-semibold">Yalpi foyda</span>
                    <span className={cn("font-bold", num(kpi.grossProfit) >= 0 ? "text-green-600" : "text-red-500")}>
                      {num(kpi.grossProfit) >= 0 ? "+" : ""}{fmt(kpi.grossProfit)} so'm
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
