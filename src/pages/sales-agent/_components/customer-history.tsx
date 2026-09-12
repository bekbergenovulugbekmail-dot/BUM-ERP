import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { formatMoney } from "@/hooks/use-currencies.ts";
import { cn } from "@/lib/utils.ts";
import { num, type CustomerHistory } from "../_lib/types.ts";

const TABS = ["orders", "payments", "visits"] as const;
type Tab = (typeof TABS)[number];

/** Mijoz tarixi: ko'rsatkichlar (buyurtmalar, o'rtacha, oraliq, to'lovlar, tashriflar) va ro'yxatlar. */
export default function CustomerHistorySection({ history, currency }: { history: CustomerHistory | undefined; currency: string }) {
  const { t } = useTranslation("agent");
  const [tab, setTab] = useState<Tab>("orders");
  if (!history) return <Skeleton className="h-48 rounded-2xl" />;

  const money = (value: string) => formatMoney(num(value), currency);
  const { stats } = history;
  const tiles: { label: string; value: string; hint?: string }[] = [
    { label: t("customer.stats.orders"), value: String(stats.orderCount), hint: t("customer.stats.my_orders", { count: stats.myOrderCount }) },
    { label: t("customer.stats.average"), value: stats.orderCount > 0 ? money(stats.averageOrder) : t("customer.stats.none") },
    {
      label: t("customer.stats.interval"),
      value: stats.averageIntervalDays === null ? t("customer.stats.none") : t("customer.stats.interval_days", { count: stats.averageIntervalDays }),
    },
    {
      label: t("customer.stats.payments"),
      value: money(stats.paymentsTotal),
      hint: stats.lastPaymentDate ? t("customer.stats.last_payment", { date: stats.lastPaymentDate }) : undefined,
    },
    { label: t("customer.stats.visits"), value: t("customer.stats.visits_value", { ordered: stats.orderedVisitCount, total: stats.visitCount }) },
    { label: t("customer.stats.last_order"), value: stats.lastOrderDate ?? t("customer.stats.none") },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("customer.history")}</p>
      <div className="grid grid-cols-2 gap-2">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-xl bg-muted/50 px-3 py-2">
            <p className="text-[11px] text-muted-foreground">{tile.label}</p>
            <p className="text-sm font-semibold tabular-nums">{tile.value}</p>
            {tile.hint && <p className="text-[11px] text-muted-foreground">{tile.hint}</p>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "h-9 rounded-lg text-xs font-medium transition-colors cursor-pointer",
              tab === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
            )}
          >
            {t(`customer.tab.${key}`)}
          </button>
        ))}
      </div>

      <div className="divide-y divide-border text-sm">
        {tab === "orders" &&
          (history.orders.length === 0 ? (
            <p className="py-2 text-muted-foreground">{t("store.never")}</p>
          ) : (
            history.orders.map((order) => (
              <div key={order.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="font-medium truncate">
                    {order.number}
                    {order.byMe && <span className="ml-2 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">{t("customer.by_me")}</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">{order.orderDate} · {t(`order.status.${order.status}`)}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular-nums">{money(order.totalAmount)}</p>
                  {num(order.paidAmount) < num(order.totalAmount) && order.status !== "confirmed" && (
                    <p className="text-[11px] text-amber-600 tabular-nums">{money(String(num(order.totalAmount) - num(order.paidAmount)))}</p>
                  )}
                </div>
              </div>
            ))
          ))}
        {tab === "payments" &&
          (history.payments.length === 0 ? (
            <p className="py-2 text-muted-foreground">{t("customer.empty")}</p>
          ) : (
            history.payments.map((payment) => (
              <div key={payment.id} className="flex items-center justify-between gap-3 py-2">
                <div>
                  <p className="font-medium">{t(`customer.payment_method.${payment.method}`, { defaultValue: payment.method })}</p>
                  <p className="text-xs text-muted-foreground">{payment.paymentDate}</p>
                </div>
                <p className="font-semibold text-emerald-600 tabular-nums">{money(payment.amount)}</p>
              </div>
            ))
          ))}
        {tab === "visits" &&
          (history.visits.length === 0 ? (
            <p className="py-2 text-muted-foreground">{t("customer.empty")}</p>
          ) : (
            history.visits.map((visit) => (
              <div key={visit.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="font-medium">
                    {visit.status === "in_progress"
                      ? t("visit.status.in_progress")
                      : visit.result === "ordered"
                        ? t("visit.result.ordered")
                        : `${t("visit.result.no_order")}${visit.noOrderReason ? `: ${t(`visit.reason.${visit.noOrderReason}`)}` : ""}`}
                  </p>
                  <p className="text-xs text-muted-foreground">{visit.visitDate}</p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  {visit.durationSeconds !== null && t("visit.minutes", { count: Math.max(1, Math.round(visit.durationSeconds / 60)) })}
                  {visit.invalidatedAt && <p className="text-destructive">{t("customer.visit_invalid")}</p>}
                </div>
              </div>
            ))
          ))}
      </div>
    </div>
  );
}
