import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { deliveryErrorMessage } from "@/lib/delivery/errors.ts";
import { formatDistance } from "@/lib/delivery/format.ts";
import { num, type AgentReport } from "@/lib/delivery/types.ts";
import { useApiQuery } from "@/lib/query.ts";
import { cn } from "@/lib/utils.ts";
import { REPORT_PRESETS, presetRange, type ReportPreset, type ReportRange } from "@/pages/sales-agent/_lib/report-range.ts";
import { useDeliveryAgent } from "../_lib/context.ts";

/** Hisobot — faqat o'z yetkazmalari, tanlangan davr (server 93 kungacha ruxsat beradi). */
export default function DeliveryReportsPage() {
  const { t } = useTranslation("delivery");
  const { money } = useDeliveryAgent();
  const [preset, setPreset] = useState<ReportPreset | null>("today");
  const [range, setRange] = useState<ReportRange>(() => presetRange("today"));
  const query = useApiQuery<{ report: AgentReport }>("/api/delivery/agent/reports", range);
  const report = query.data?.report;

  const choose = (value: ReportPreset) => {
    setPreset(value);
    setRange(presetRange(value));
  };

  const stats = report
    ? [
        { label: t("reports.total"), value: report.deliveries.total, tone: "" },
        { label: t("status.delivered"), value: report.deliveries.delivered, tone: "text-emerald-700 dark:text-emerald-400" },
        { label: t("status.partially_delivered"), value: report.deliveries.partiallyDelivered, tone: "text-lime-700 dark:text-lime-400" },
        { label: t("status.failed"), value: report.deliveries.failed, tone: "text-destructive" },
        { label: t("status.returned"), value: report.deliveries.returned, tone: "text-orange-700 dark:text-orange-400" },
        { label: t("reports.open"), value: report.deliveries.open, tone: "" },
        { label: t("reports.late"), value: report.deliveries.late, tone: report.deliveries.late > 0 ? "text-destructive" : "" },
        { label: t("status.cancelled"), value: report.deliveries.cancelled, tone: "text-muted-foreground" },
      ]
    : [];

  return (
    <div className="space-y-4 p-4">
      <h1 className="text-xl font-bold">{t("reports.title")}</h1>
      <div className="grid grid-cols-2 gap-2">
        {REPORT_PRESETS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => choose(item)}
            className={cn(
              "h-11 rounded-xl border text-sm font-medium",
              preset === item ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card",
            )}
          >
            {t(`reports.preset.${item}`)}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="report-from">{t("reports.from")}</Label>
          <Input
            id="report-from"
            type="date"
            className="h-11"
            value={range.from}
            max={range.to}
            onChange={(e) => {
              if (!e.target.value) return;
              setPreset(null);
              setRange((current) => ({ ...current, from: e.target.value }));
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="report-to">{t("reports.to")}</Label>
          <Input
            id="report-to"
            type="date"
            className="h-11"
            value={range.to}
            min={range.from}
            onChange={(e) => {
              if (!e.target.value) return;
              setPreset(null);
              setRange((current) => ({ ...current, to: e.target.value }));
            }}
          />
        </div>
      </div>

      {query.isError ? (
        <p className="rounded-2xl border border-border bg-card p-4 text-sm text-destructive">{deliveryErrorMessage(query.error, t)}</p>
      ) : !report ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            {stats.map((stat) => (
              <div key={stat.label} className="flex items-center justify-between rounded-2xl border border-border bg-card px-3 py-2.5">
                <span className="text-xs text-muted-foreground">{stat.label}</span>
                <span className={cn("text-lg font-bold tabular-nums", stat.tone)}>{stat.value}</span>
              </div>
            ))}
          </div>

          <section className="space-y-2 rounded-2xl border border-border bg-card p-4 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("reports.average")}</span>
              <span className="font-semibold">
                {report.deliveries.averageMinutes === null ? "—" : t("reports.minutes", { value: report.deliveries.averageMinutes })}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("reports.route_distance")}</span>
              <span className="font-semibold">{formatDistance(report.routeDistanceMeters) ?? "—"}</span>
            </div>
          </section>

          <section className="space-y-2 rounded-2xl border border-border bg-card p-4">
            <p className="text-sm font-semibold">{t("reports.collected")}</p>
            <p className="text-2xl font-bold tabular-nums">{money(report.collected.total)}</p>
            <div className="grid grid-cols-3 gap-2 text-xs">
              {(["cash", "card", "bank"] as const).map((method) => (
                <div key={method} className="rounded-xl bg-muted/50 px-2 py-1.5">
                  <p className="text-muted-foreground">{t(`method.${method}`)}</p>
                  <p className="font-semibold tabular-nums">{money(report.collected[method])}</p>
                </div>
              ))}
            </div>
            {num(report.deliveries.mismatch) > 0 && (
              <div className="flex justify-between text-sm text-amber-700 dark:text-amber-400">
                <span>{t("dash.mismatch")}</span>
                <span className="font-semibold tabular-nums">{money(report.deliveries.mismatch)}</span>
              </div>
            )}
          </section>

          <section className="space-y-2 rounded-2xl border border-border bg-card p-4">
            <p className="text-sm font-semibold">{t("reports.failure_reasons")}</p>
            {report.failureReasons.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("reports.none")}</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {report.failureReasons.map((item) => (
                  <li key={item.reason} className="flex justify-between">
                    <span>{t(`failure.${item.reason}`)}</span>
                    <span className="font-semibold tabular-nums">{item.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
