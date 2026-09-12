import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { deliveryErrorMessage } from "@/lib/delivery/errors.ts";
import { num, type DeliveryAgentRow, type SupervisorReport } from "@/lib/delivery/types.ts";
import { useApiQuery } from "@/lib/query.ts";
import { cn } from "@/lib/utils.ts";
import { REPORT_PRESETS, presetRange, type ReportPreset, type ReportRange } from "@/pages/sales-agent/_lib/report-range.ts";

const ALL = "all";

/** Davr hisoboti agentlar kesimida: yetkazmalar, kechikkan, o'rtacha vaqt, to'lov farqi, yig'ilgan pul, sabablar (93 kungacha). */
export default function ReportsSection({ money }: { money: (value: string | number) => string }) {
  const { t } = useTranslation("delivery");
  const [preset, setPreset] = useState<ReportPreset | null>("month");
  const [range, setRange] = useState<ReportRange>(() => presetRange("month"));
  const [agentId, setAgentId] = useState(ALL);
  const agents = useApiQuery<{ agents: DeliveryAgentRow[] }>("/api/delivery/agents").data?.agents;
  const query = useApiQuery<{ report: SupervisorReport }>("/api/delivery/reports", { ...range, agentId: agentId === ALL ? undefined : agentId });
  const report = query.data?.report;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-wrap gap-1">
          {REPORT_PRESETS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => {
                setPreset(item);
                setRange(presetRange(item));
              }}
              className={cn(
                "h-9 rounded-lg border px-3 text-sm",
                preset === item ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background",
              )}
            >
              {t(`reports.preset.${item}`)}
            </button>
          ))}
        </div>
        <div className="space-y-1">
          <Label htmlFor="sv-report-from">{t("reports.from")}</Label>
          <Input
            id="sv-report-from"
            type="date"
            className="w-40"
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
          <Label htmlFor="sv-report-to">{t("reports.to")}</Label>
          <Input
            id="sv-report-to"
            type="date"
            className="w-40"
            value={range.to}
            min={range.from}
            onChange={(e) => {
              if (!e.target.value) return;
              setPreset(null);
              setRange((current) => ({ ...current, to: e.target.value }));
            }}
          />
        </div>
        <div className="min-w-56 space-y-1">
          <Label>{t("sv.table.agent")}</Label>
          <Select value={agentId} onValueChange={setAgentId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("sv.filter.all_agents")}</SelectItem>
              {agents?.map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  {agent.name ?? agent.phone} · {agent.code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {query.isError ? (
        <p className="rounded-2xl border border-border bg-card p-4 text-sm text-destructive">{deliveryErrorMessage(query.error, t)}</p>
      ) : !report ? (
        <Skeleton className="h-72 rounded-2xl" />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-2 rounded-2xl border border-border bg-card p-4">
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
            </div>
            <div className="space-y-2 rounded-2xl border border-border bg-card p-4 lg:col-span-2">
              <p className="text-sm font-semibold">{t("reports.failure_reasons")}</p>
              {report.failureReasons.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("reports.none")}</p>
              ) : (
                <ul className="grid gap-1 text-sm sm:grid-cols-2">
                  {report.failureReasons.map((item) => (
                    <li key={item.reason} className="flex justify-between gap-2 rounded-lg bg-muted/40 px-2 py-1">
                      <span>{t(`failure.${item.reason}`)}</span>
                      <span className="font-semibold tabular-nums">{item.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="w-full min-w-[1000px] text-sm">
              <thead>
                <tr className="border-b border-border text-right text-xs text-muted-foreground">
                  <th className="px-4 py-2 text-left font-medium">{t("sv.table.agent")}</th>
                  <th className="px-2 py-2 font-medium">{t("reports.total")}</th>
                  <th className="px-2 py-2 font-medium">{t("status.delivered")}</th>
                  <th className="px-2 py-2 font-medium">{t("status.partially_delivered")}</th>
                  <th className="px-2 py-2 font-medium">{t("status.failed")}</th>
                  <th className="px-2 py-2 font-medium">{t("status.returned")}</th>
                  <th className="px-2 py-2 font-medium">{t("reports.open")}</th>
                  <th className="px-2 py-2 font-medium">{t("reports.late")}</th>
                  <th className="px-2 py-2 font-medium">{t("reports.average")}</th>
                  <th className="px-2 py-2 font-medium">{t("dash.mismatch")}</th>
                  <th className="px-4 py-2 font-medium">{t("reports.collected")}</th>
                </tr>
              </thead>
              <tbody>
                {report.agents.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-10 text-center text-muted-foreground">
                      {t("reports.empty")}
                    </td>
                  </tr>
                ) : (
                  report.agents.map((row) => (
                    <tr key={row.agent.id} className="border-b border-border text-right tabular-nums last:border-0">
                      <td className="px-4 py-2 text-left">
                        <p className="font-medium">{row.agent.name ?? row.agent.code}</p>
                        <p className="text-xs text-muted-foreground">
                          {row.agent.code}
                          {row.agent.territory ? ` · ${row.agent.territory}` : ""}
                        </p>
                      </td>
                      <td className="px-2 py-2">{row.total}</td>
                      <td className="px-2 py-2 text-emerald-600">{row.delivered}</td>
                      <td className="px-2 py-2">{row.partiallyDelivered}</td>
                      <td className={cn("px-2 py-2", row.failed > 0 && "text-destructive")}>{row.failed}</td>
                      <td className="px-2 py-2">{row.returned}</td>
                      <td className="px-2 py-2">{row.open}</td>
                      <td className={cn("px-2 py-2", row.late > 0 && "text-destructive")}>{row.late}</td>
                      <td className="px-2 py-2">{row.averageMinutes === null ? "—" : t("reports.minutes", { value: row.averageMinutes })}</td>
                      <td className={cn("px-2 py-2", num(row.mismatch) > 0 && "text-amber-600")}>{money(row.mismatch)}</td>
                      <td className="px-4 py-2 font-medium">{money(row.collected.total)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
