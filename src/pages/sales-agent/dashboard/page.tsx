import { Link, useOutletContext, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Award, CalendarDays, CreditCard, HandCoins, Package, Receipt, ShoppingCart, Target, UserPlus, Users, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { formatMoney } from "@/hooks/use-currencies.ts";
import { useApiQuery } from "@/lib/query.ts";
import WorkSessionCard from "../_components/work-session-card.tsx";
import { AgentCashCard } from "../_components/payment-panel.tsx";
import { num, type AgentDashboard, type AgentMe } from "../_lib/types.ts";

function Progress({ value }: { value: number }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

/**
 * Agent bosh sahifasi: bugungi savdo va plan, buyurtmalar, nasiya, yig'ilgan to'lov, tashriflar, oylik plan
 * (bajarilgan, qolgan, kuniga kerak) va professional ko'rsatkichlar (oy bo'yicha o'rin, eng yaxshi kun). Hisob serverda.
 */
export default function AgentDashboardPage() {
  const { t } = useTranslation("agent");
  const { lng = "uz" } = useParams<{ lng: string }>();
  const { agent, company } = useOutletContext<AgentMe>();
  const data = useApiQuery<AgentDashboard>("/api/sales-agent/dashboard", undefined, { refetchInterval: 120_000 }).data;
  const money = (value: string | number) => formatMoney(num(value), company.currency);

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-xl font-bold">{t("greeting", { name: agent.name })}</h1>
        <p className="text-xs text-muted-foreground">
          {agent.code}
          {agent.region ? ` · ${agent.region}` : ""}
        </p>
      </div>

      <WorkSessionCard />

      {!data ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
      ) : (
        <>
          <div className="space-y-3 rounded-2xl bg-primary p-4 text-primary-foreground">
            <div>
              <p className="text-xs opacity-80">{t("dash.today_sales")}</p>
              <p className="text-3xl font-bold">{money(data.today.salesAmount)}</p>
            </div>
            {num(data.today.dailyTarget) > 0 && (
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-xs opacity-80">{t("dash.today_plan")}</p>
                  <p className="font-semibold">{money(data.today.dailyTarget)}</p>
                </div>
                <div>
                  <p className="text-xs opacity-80">{t("dash.left")}</p>
                  <p className="font-semibold">{money(data.today.remainingToday)}</p>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              { icon: ShoppingCart, label: t("dash.orders"), value: String(data.today.orderCount) },
              { icon: Receipt, label: t("dash.average_order"), value: money(data.averageOrderToday) },
              { icon: CreditCard, label: t("dash.credit_sales"), value: money(data.today.creditSalesAmount) },
              { icon: HandCoins, label: t("dash.collected"), value: money(data.today.collectedAmount) },
            ].map((card) => (
              <div key={card.label} className="rounded-2xl border border-border bg-card p-3">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <card.icon className="h-3.5 w-3.5" /> {card.label}
                </p>
                <p className="mt-1 text-lg font-bold">{card.value}</p>
              </div>
            ))}
          </div>

          <AgentCashCard currency={company.currency} />

          <div className="space-y-2 rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">{t("dash.visits")}</p>
              <p className="text-lg font-bold">
                {data.today.visitedStores} / {data.today.plannedStores}
              </p>
            </div>
            <Progress value={data.today.plannedStores > 0 ? (data.today.visitedStores / data.today.plannedStores) * 100 : 0} />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{t("dash.visits_done", { count: data.today.visitedStores })}</span>
              <span>{t("dash.visits_left", { count: data.today.remainingStores })}</span>
            </div>
          </div>

          <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Users className="h-4 w-4" /> {t("dash.customers")}
            </p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-muted/50 py-2">
                <p className="text-lg font-bold tabular-nums">{data.customers.planned}</p>
                <p className="text-[11px] text-muted-foreground">{t("dash.customers_planned")}</p>
              </div>
              <div className="rounded-xl bg-emerald-500/10 py-2">
                <p className="text-lg font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{data.customers.ordered}</p>
                <p className="text-[11px] text-muted-foreground">{t("dash.customers_ordered")}</p>
              </div>
              <div className="rounded-xl bg-amber-500/10 py-2">
                <p className="text-lg font-bold tabular-nums text-amber-700 dark:text-amber-400">{data.customers.notOrdered}</p>
                <p className="text-[11px] text-muted-foreground">{t("dash.customers_not_ordered")}</p>
              </div>
            </div>
            {data.customers.debtors > 0 && (
              <Link
                to={`/${lng}/sales-agent/customers?filter=debtors`}
                className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 px-3 py-2 text-sm active:bg-accent"
              >
                <span className="flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-amber-600" />
                  {t("dash.debtors", { count: data.customers.debtors })}
                  {data.customers.overdueDebtors > 0 && (
                    <span className="text-xs text-destructive">· {t("dash.debtors_overdue", { count: data.customers.overdueDebtors })}</span>
                  )}
                </span>
                <span className="font-semibold tabular-nums">{money(data.customers.debtTotal)}</span>
              </Link>
            )}
          </div>

          {data.topProducts.length > 0 && (
            <div className="space-y-2 rounded-2xl border border-border bg-card p-4">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Package className="h-4 w-4" /> {t("dash.top_products")}
              </p>
              <ol className="divide-y divide-border text-sm">
                {data.topProducts.map((product, index) => (
                  <li key={product.productId} className="flex items-center gap-3 py-1.5">
                    <span className="w-4 text-xs text-muted-foreground tabular-nums">{index + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{product.name}</span>
                    <span className="font-semibold tabular-nums">{money(product.amount)}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="space-y-2 rounded-2xl border border-border bg-card p-4">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Target className="h-4 w-4" /> {t("dash.month_plan")}
            </p>
            {num(data.month.target) > 0 ? (
              <>
                <div className="flex items-end justify-between gap-2">
                  <p className="text-sm">
                    <span className="text-lg font-bold">{money(data.month.achieved)}</span>
                    <span className="text-muted-foreground"> / {money(data.month.target)}</span>
                  </p>
                  <p className="text-2xl font-bold text-primary">{data.month.percent}%</p>
                </div>
                <Progress value={data.month.percent} />
                <div className="grid grid-cols-3 gap-2 pt-1 text-xs">
                  <div>
                    <p className="text-muted-foreground">{t("dash.plan_left")}</p>
                    <p className="font-semibold">{money(data.month.remaining)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t("dash.days_left")}</p>
                    <p className="font-semibold">{data.month.remainingDays}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t("dash.daily_needed")}</p>
                    <p className="font-semibold">{money(data.month.requiredDaily)}</p>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("dash.plan_not_set")} · {money(data.month.achieved)}
              </p>
            )}
          </div>

          <div className="space-y-2 rounded-2xl border border-border bg-card p-4 text-sm">
            <p className="flex items-center gap-2 font-semibold">
              <Award className="h-4 w-4" /> {t("dash.motivation")}
            </p>
            {data.rank && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("dash.rank")}</span>
                <span className="font-semibold">{t("dash.rank_value", data.rank)}</span>
              </div>
            )}
            {data.month.bestDay && (
              <div className="flex justify-between">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <CalendarDays className="h-3.5 w-3.5" /> {t("dash.best_day")}
                </span>
                <span className="font-semibold">
                  {data.month.bestDay.date} · {money(data.month.bestDay.amount)}
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("dash.month_orders")}</span>
              <span className="font-semibold">{data.month.orderCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("dash.prospects")}</span>
              <span className="font-semibold">{data.prospectsThisMonth}</span>
            </div>
          </div>

          <Button asChild variant="secondary" className="h-14 w-full text-base">
            <Link to={`/${lng}/sales-agent/prospects`}>
              <UserPlus className="mr-2 h-5 w-5" /> {t("dash.find_customer")}
            </Link>
          </Button>
        </>
      )}
    </div>
  );
}
