import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BarChart3 } from "lucide-react";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { formatMoney } from "@/hooks/use-currencies.ts";
import { errorMessage } from "@/lib/api.ts";
import { useApiQuery } from "@/lib/query.ts";
import { cn } from "@/lib/utils.ts";
import EmptyState from "../_components/empty-state.tsx";
import { REPORT_PRESETS, presetRange, type ReportRange } from "../_lib/report-range.ts";
import { num, type AgentMe, type AgentReport, type NoOrderReason } from "../_lib/types.ts";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Stats({ items }: { items: { label: string; value: string; tone?: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map((item) => (
        <div key={item.label} className="rounded-xl bg-muted/50 px-3 py-2">
          <p className="text-[11px] text-muted-foreground">{item.label}</p>
          <p className={cn("text-sm font-semibold tabular-nums", item.tone)}>{item.value}</p>
        </div>
      ))}
    </div>
  );
}

/** Hisobotlar (FROM/TO): sotuv, plan, tashriflar, qarzlar, aksiyalar — faqat agentning o'zi, server hisoblaydi. */
export default function AgentReportsPage() {
  const { t } = useTranslation("agent");
  const { company } = useOutletContext<AgentMe>();
  const [range, setRange] = useState<ReportRange>(() => presetRange("month"));
  const valid = Boolean(range.from && range.to && range.from <= range.to);
  const query = useApiQuery<AgentReport>(valid ? "/api/sales-agent/reports" : null, range, { placeholderData: (previous) => previous });
  const report = query.data;
  const money = (value: string) => formatMoney(num(value), report?.currency ?? company.currency);

  const setDate = (key: keyof ReportRange, value: string) => value && setRange((current) => ({ ...current, [key]: value }));

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-bold">{t("reports.title")}</h1>

      <div className="rounded-2xl border border-border bg-card p-3 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="report-from">{t("reports.from")}</Label>
            <Input id="report-from" type="date" className="h-11" value={range.from} max={range.to} onChange={(e) => setDate("from", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="report-to">{t("reports.to")}</Label>
            <Input id="report-to" type="date" className="h-11" value={range.to} min={range.from} onChange={(e) => setDate("to", e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {REPORT_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setRange(presetRange(preset))}
              className="h-9 rounded-lg border border-border bg-background text-[11px] font-medium text-muted-foreground cursor-pointer active:bg-accent"
            >
              {t(`reports.preset.${preset}`)}
            </button>
          ))}
        </div>
      </div>

      {query.isError && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{errorMessage(query.error)}</p>}

      {!report ? (
        query.isError ? null : (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}
          </div>
        )
      ) : report.sales.orderCount === 0 && report.visits.total === 0 ? (
        <EmptyState icon={BarChart3} title={t("reports.title")} message={t("reports.empty")} />
      ) : (
        <ReportBody report={report} money={money} />
      )}
    </div>
  );
}

function ReportBody({ report, money }: { report: AgentReport; money: (value: string) => string }) {
  const { t } = useTranslation("agent");
  const { sales, visits, plan, debt, promotions } = report;
  const total = num(sales.total);
  const split = (["cash", "card", "credit"] as const).map((key) => ({ key, amount: num(sales[key]) }));
  const SPLIT_TONES = { cash: "bg-emerald-500", card: "bg-sky-500", credit: "bg-amber-500" } as const;
  const maxDay = Math.max(1, ...sales.byDay.map((day) => num(day.amount)));
  const reasons = Object.entries(visits.reasons).sort((a, b) => b[1] - a[1]) as [NoOrderReason, number][];

  return (
    <div className="space-y-4">
      <Section title={t("reports.section.sales")}>
        <p className="text-2xl font-bold tabular-nums">{money(sales.total)}</p>
        <Stats
          items={[
            { label: t("reports.sales.orders"), value: String(sales.orderCount) },
            { label: t("reports.sales.average"), value: money(sales.averageOrder) },
            { label: t("reports.sales.customers"), value: String(sales.customerCount) },
            { label: t("reports.sales.credit"), value: money(sales.credit), tone: num(sales.credit) > 0 ? "text-amber-600" : undefined },
          ]}
        />
        {total > 0 && (
          <div className="space-y-1.5">
            <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
              {split.map((part) => (
                <div key={part.key} className={SPLIT_TONES[part.key]} style={{ width: `${(part.amount / total) * 100}%` }} />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              {split.map((part) => (
                <span key={part.key} className="flex items-center gap-1">
                  <span className={cn("h-2 w-2 rounded-full", SPLIT_TONES[part.key])} />
                  {t(`reports.sales.${part.key}`)}: {money(String(part.amount))}
                </span>
              ))}
            </div>
          </div>
        )}
        {sales.byDay.length > 1 && (
          <div className="space-y-1">
            <p className="text-[11px] text-muted-foreground">{t("reports.sales.by_day")}</p>
            <div className="flex h-24 items-end gap-0.5" role="img" aria-label={t("reports.sales.by_day")}>
              {sales.byDay.map((day) => (
                <div
                  key={day.date}
                  title={`${day.date}: ${money(day.amount)}`}
                  className="flex-1 min-w-0 rounded-t bg-primary/70"
                  style={{ height: `${Math.max(4, (num(day.amount) / maxDay) * 100)}%` }}
                />
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
              <span>{sales.byDay[0]!.date}</span>
              <span>{sales.byDay[sales.byDay.length - 1]!.date}</span>
            </div>
          </div>
        )}
        {sales.topProducts.length > 0 && (
          <div className="space-y-1">
            <p className="text-[11px] text-muted-foreground">{t("reports.sales.top_products")}</p>
            <ol className="divide-y divide-border text-sm">
              {sales.topProducts.map((product) => (
                <li key={product.productId} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="min-w-0 truncate">{product.name}</span>
                  <span className="shrink-0 text-right tabular-nums">
                    <span className="font-semibold">{money(product.amount)}</span>
                    <span className="block text-[11px] text-muted-foreground">{Number(product.quantity)}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
        {sales.topCustomers.length > 0 && (
          <div className="space-y-1">
            <p className="text-[11px] text-muted-foreground">{t("reports.sales.top_customers")}</p>
            <ol className="divide-y divide-border text-sm">
              {sales.topCustomers.map((customer) => (
                <li key={customer.customerId} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="min-w-0 truncate">{customer.name}</span>
                  <span className="shrink-0 font-semibold tabular-nums">{money(customer.amount)}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </Section>

      <Section title={t("reports.section.plan")}>
        {num(plan.target) > 0 ? (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-2xl font-bold tabular-nums">{plan.percent}%</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {money(plan.achieved)} / {money(plan.target)}
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full", plan.percent >= 100 ? "bg-emerald-500" : "bg-primary")}
                style={{ width: `${Math.min(100, plan.percent)}%` }}
              />
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t("reports.plan.no_target")}</p>
        )}
      </Section>

      <Section title={t("reports.section.visits")}>
        <Stats
          items={[
            { label: t("reports.visits.total"), value: String(visits.total) },
            { label: t("reports.visits.ordered"), value: String(visits.ordered), tone: "text-emerald-600" },
            { label: t("reports.visits.no_order"), value: String(visits.noOrder), tone: visits.noOrder > 0 ? "text-amber-600" : undefined },
            {
              label: t("reports.visits.average"),
              value: visits.averageMinutes === null ? "—" : t("reports.visits.minutes", { count: visits.averageMinutes }),
            },
          ]}
        />
        {visits.invalid > 0 && <p className="text-xs text-destructive">{t("reports.visits.invalid", { count: visits.invalid })}</p>}
        {reasons.length > 0 && (
          <ul className="space-y-1 text-sm">
            {reasons.map(([reason, count]) => (
              <li key={reason} className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{t(`visit.reason.${reason}`)}</span>
                <span className="font-semibold tabular-nums">{count}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t("reports.section.debt")}>
        <Stats
          items={[
            { label: t("reports.debt.total"), value: money(debt.total), tone: num(debt.total) > 0 ? "text-amber-600" : undefined },
            { label: t("reports.debt.customers"), value: String(debt.customers) },
            { label: t("reports.debt.overdue"), value: String(debt.overdueCustomers), tone: debt.overdueCustomers > 0 ? "text-destructive" : undefined },
            { label: t("reports.debt.collected"), value: money(debt.collected), tone: "text-emerald-600" },
          ]}
        />
        <p className="text-[11px] text-muted-foreground">{t("reports.debt.note")}</p>
      </Section>

      <Section title={t("reports.section.promotions")}>
        <Stats
          items={[
            { label: t("reports.promotions.applied"), value: String(promotions.applied) },
            { label: t("reports.promotions.discount"), value: money(promotions.discountTotal) },
          ]}
        />
        {promotions.items.length > 0 && (
          <ul className="divide-y divide-border text-sm">
            {promotions.items.map((item) => (
              <li key={item.promotionId} className="flex items-center justify-between gap-3 py-1.5">
                <span className="min-w-0 truncate">{item.name}</span>
                <span className="shrink-0 text-right tabular-nums">
                  <span className="font-semibold">{item.count}×</span>
                  <span className="block text-[11px] text-muted-foreground">{money(item.discountAmount)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
