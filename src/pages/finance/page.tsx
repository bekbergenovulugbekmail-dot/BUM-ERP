import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useConvexAuth } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { motion } from "motion/react";
import {
  DollarSign, TrendingUp, TrendingDown, Wallet,
  BarChart3, BookOpen,
  Receipt, Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import CashAccountsSection from "./_components/cash-accounts-section.tsx";
import ExpensesSection from "./_components/expenses-section.tsx";
import ProfitLossSection from "./_components/profit-loss-section.tsx";
import AccountsSection from "./_components/accounts-section.tsx";

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

const TABS = [
  { key: "overview", label: "Umumiy ko'rinish", icon: BarChart3 },
  { key: "cash", label: "Kassa & Bank", icon: Wallet },
  { key: "expenses", label: "Xarajatlar", icon: Receipt },
  { key: "pnl", label: "Daromad & Zarar", icon: TrendingUp },
  { key: "accounts", label: "Hisoblar rejasi", icon: BookOpen },
];

export default function FinancePage() {
  const [tab, setTab] = useState("overview");
  const stats = useQuery(api.finance.cashAccounts.getDashboardStats, {});
  const expStats = useQuery(api.finance.expenses.getStats, {});
  const seedAccounts = useMutation(api.finance.accounts.seedDefaultAccounts);
  const { isAuthenticated } = useConvexAuth();
  const seededRef = useRef(false);

  // Seed default accounts once — faqat Convex auth tasdiqlangach. Aks holda
  // sahifa login'ga yo'naltirilgunicha UNAUTHENTICATED xatosi konsolga tushadi.
  useEffect(() => {
    if (!isAuthenticated || seededRef.current) return;
    seededRef.current = true;
    seedAccounts().catch(() => {/* already seeded */});
  }, [isAuthenticated, seedAccounts]);

  const statCards = [
    {
      label: "Umumiy balans",
      value: fmt(stats?.totalBalance ?? 0) + " so'm",
      icon: Wallet,
      color: "text-blue-500",
      bg: "bg-blue-500/10",
      sub: `Naqd: ${fmt(stats?.totalCash ?? 0)} · Bank: ${fmt(stats?.totalBank ?? 0)}`,
    },
    {
      label: "Bu oy kirim",
      value: fmt(stats?.monthSalesTotal ?? 0) + " so'm",
      icon: TrendingUp,
      color: "text-emerald-500",
      bg: "bg-emerald-500/10",
      sub: "Sotuvdan",
    },
    {
      label: "Bu oy chiqim",
      value: fmt((stats?.monthPurchaseTotal ?? 0) + (expStats?.totalThisMonth ?? 0)) + " so'm",
      icon: TrendingDown,
      color: "text-rose-500",
      bg: "bg-rose-500/10",
      sub: "Xarid + Xarajat",
    },
    {
      label: "Sof foyda",
      value: fmt(
        (stats?.monthSalesTotal ?? 0) - (stats?.monthPurchaseTotal ?? 0) - (expStats?.totalThisMonth ?? 0)
      ) + " so'm",
      icon: DollarSign,
      color: "text-purple-500",
      bg: "bg-purple-500/10",
      sub: "Bu oy",
    },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
            <DollarSign className="h-5 w-5 text-blue-500" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Moliya moduli</h1>
            <p className="text-sm text-muted-foreground">Kassa, xarajatlar, P&L va hisoblar</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card, i) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className="bg-card border border-border rounded-2xl p-4"
          >
            <div className="flex items-center gap-2 mb-2">
              <div className={cn("h-7 w-7 rounded-lg flex items-center justify-center", card.bg)}>
                <card.icon className={cn("h-3.5 w-3.5", card.color)} />
              </div>
              <span className="text-xs text-muted-foreground">{card.label}</span>
            </div>
            {stats ? (
              <>
                <p className="text-lg font-bold">{card.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{card.sub}</p>
              </>
            ) : (
              <Skeleton className="h-7 w-36 mt-1" />
            )}
          </motion.div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer whitespace-nowrap",
              tab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "overview" && <OverviewTab stats={stats} expStats={expStats} />}
      {tab === "cash" && <CashAccountsSection />}
      {tab === "expenses" && <ExpensesSection />}
      {tab === "pnl" && <ProfitLossSection />}
      {tab === "accounts" && <AccountsSection />}
    </div>
  );
}

// ── Overview Tab ─────────────────────────────────────────────────────────────

type StatsType = {
  totalCash: number; totalBank: number; totalBalance: number;
  monthIncome: number; monthExpense: number; monthNetCash: number;
  monthSalesTotal: number; monthPurchaseTotal: number;
  accounts: Array<{ _id: string; name: string; type: string; balance: number; currency: string }>;
} | undefined;

type ExpStatsType = {
  totalThisMonth: number; countThisMonth: number;
  pendingCount: number; pendingAmount: number;
  byCategory: Record<string, number>;
} | undefined;

function OverviewTab({ stats, expStats }: { stats: StatsType; expStats: ExpStatsType }) {
  const recentSales = useQuery(api.sales.orders.list, { limit: 8, isPOS: false });
  const recentExpenses = useQuery(api.finance.expenses.list, { limit: 8 });

  const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Cash accounts summary */}
      <div className="lg:col-span-1 space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Kassa & Bank</h3>
        <div className="space-y-2">
          {stats?.accounts.map((acct) => (
            <div key={acct._id} className="bg-card border border-border rounded-xl p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={cn(
                  "h-8 w-8 rounded-lg flex items-center justify-center",
                  acct.type === "cash" ? "bg-emerald-500/10" : "bg-blue-500/10"
                )}>
                  {acct.type === "cash"
                    ? <Wallet className="h-4 w-4 text-emerald-500" />
                    : <Building2 className="h-4 w-4 text-blue-500" />}
                </div>
                <div>
                  <p className="text-sm font-medium">{acct.name}</p>
                  <p className="text-xs text-muted-foreground">{acct.type === "cash" ? "Naqd" : "Bank"}</p>
                </div>
              </div>
              <p className="font-bold text-sm">{fmt(acct.balance)} so'm</p>
            </div>
          ))}
        </div>

        {/* Expense by category */}
        {expStats && Object.keys(expStats.byCategory).length > 0 && (
          <div className="bg-card border border-border rounded-2xl p-4">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Bu oy xarajatlar
            </h4>
            <div className="space-y-2">
              {Object.entries(expStats.byCategory)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 6)
                .map(([cat, amount]) => {
                  const total = expStats.totalThisMonth || 1;
                  const pct = (amount / total) * 100;
                  return (
                    <div key={cat}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-muted-foreground capitalize">{cat}</span>
                        <span className="font-medium">{fmt(amount)} so'm</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}
      </div>

      {/* Recent transactions */}
      <div className="lg:col-span-2 space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">So'nggi sotuvlar</h3>
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          {!recentSales ? (
            <div className="p-4 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : recentSales.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Sotuvlar yo'q</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Raqam</th>
                  <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Mijoz</th>
                  <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Summa</th>
                  <th className="text-center px-4 py-2.5 text-xs text-muted-foreground font-medium">Holat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recentSales.map((order) => (
                  <tr key={order._id} className="hover:bg-muted/20">
                    <td className="px-4 py-2.5 font-mono text-xs">{order.number}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{order.customerName}</td>
                    <td className="px-4 py-2.5 text-right font-semibold">{fmt(order.totalAmount)} so'm</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={cn(
                        "text-xs px-2 py-0.5 rounded-full",
                        order.paidAmount >= order.totalAmount
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                          : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                      )}>
                        {order.paidAmount >= order.totalAmount ? "To'langan" : "Kutilmoqda"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">So'nggi xarajatlar</h3>
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          {!recentExpenses ? (
            <div className="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : recentExpenses.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Xarajatlar yo'q</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Tavsif</th>
                  <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Kategoriya</th>
                  <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Summa</th>
                  <th className="text-center px-4 py-2.5 text-xs text-muted-foreground font-medium">Holat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recentExpenses.map((exp) => (
                  <tr key={exp._id} className="hover:bg-muted/20">
                    <td className="px-4 py-2.5">{exp.description}</td>
                    <td className="px-4 py-2.5 text-muted-foreground capitalize">{exp.category}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-rose-600 dark:text-rose-400">
                      -{fmt(exp.amount)} so'm
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={cn(
                        "text-xs px-2 py-0.5 rounded-full",
                        exp.status === "paid"
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                          : exp.status === "approved"
                            ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                            : "bg-muted text-muted-foreground"
                      )}>
                        {exp.status === "paid" ? "To'langan" : exp.status === "approved" ? "Tasdiqlangan" : "Kutilmoqda"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
