/**
 * Avtomatik biriktirish (`delivery.assign`): sana va strategiya → server rejasi (hech narsa yozilmaydi) → ko'rib chiqish
 * (kimga, masofa, agent yuklamasi, biriktirilmay qolganlar sababi bilan) → "Qo'llash". Qo'llashda server har juftlikni
 * bazadan qayta tekshiradi; o'zgarib qolgani o'tkazib yuboriladi va natijada ko'rsatiladi.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
import { DELIVERY_AUTO_ASSIGN_STRATEGIES, type DeliveryAutoAssignSkipReason, type DeliveryAutoAssignStrategy, type DeliveryPolicy } from "@bum/shared";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { api } from "@/lib/api.ts";
import { deliveryErrorMessage } from "@/lib/delivery/errors.ts";
import { formatDistance } from "@/lib/delivery/format.ts";
import type { AutoAssignPlan, AutoAssignResult, AutoAssignSkip } from "@/lib/delivery/types.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { todayLocal } from "@/pages/sales/_lib/types.ts";

function SkipList({ skipped }: { skipped: AutoAssignSkip[] }) {
  const { t } = useTranslation("delivery");
  if (skipped.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-sm font-semibold">{t("auto.skipped", { count: skipped.length })}</p>
      <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-xl border border-border text-sm">
        {skipped.map((item) => (
          <li key={`${item.taskId}-${item.reason}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <span className="min-w-0">
              <span className="font-medium">{item.number ?? "—"}</span>
              {item.customerName ? <span className="text-muted-foreground"> · {item.customerName}</span> : null}
            </span>
            <span className="text-xs text-amber-700 dark:text-amber-400">
              {t(`auto.reason.${item.reason}`)}
              {item.counts
                ? ` (${(Object.entries(item.counts) as [DeliveryAutoAssignSkipReason, number][])
                    .map(([reason, count]) => `${t(`auto.reason.${reason}`)}: ${count}`)
                    .join(", ")})`
                : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function AutoAssignDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("delivery");
  const policy = useApiQuery<{ policy: DeliveryPolicy }>("/api/delivery/policy").data?.policy;
  const [date, setDate] = useState(todayLocal);
  const [strategy, setStrategy] = useState<DeliveryAutoAssignStrategy | null>(null);
  const [plan, setPlan] = useState<AutoAssignPlan | null>(null);
  const [result, setResult] = useState<AutoAssignResult | null>(null);
  const chosenStrategy = strategy ?? policy?.autoAssign.strategy ?? "balanced";

  const preview = useApiMutation((body: { date: string; strategy: DeliveryAutoAssignStrategy }) => api.post<{ plan: AutoAssignPlan }>("/api/delivery/auto-assign/preview", body), {
    invalidate: false,
  });
  const apply = useApiMutation((body: { date: string; strategy: DeliveryAutoAssignStrategy; assignments: { taskId: string; deliveryAgentId: string }[] }) =>
    api.post<{ result: AutoAssignResult }>("/api/delivery/auto-assign", body),
  { invalidate: ["/api/delivery"] });

  const runPreview = async () => {
    setResult(null);
    try {
      setPlan((await preview.mutateAsync({ date, strategy: chosenStrategy })).plan);
    } catch (error) {
      toast.error(deliveryErrorMessage(error, t));
    }
  };

  const runApply = async () => {
    if (!plan || plan.proposals.length === 0) return;
    try {
      const { result: applied } = await apply.mutateAsync({
        date: plan.date,
        strategy: plan.strategy,
        assignments: plan.proposals.map((item) => ({ taskId: item.taskId, deliveryAgentId: item.deliveryAgentId })),
      });
      setResult(applied);
      setPlan(null);
      toast.success(t("auto.applied", { count: applied.assigned.length }));
    } catch (error) {
      toast.error(deliveryErrorMessage(error, t));
    }
  };

  const disabled = policy !== undefined && !policy.autoAssign.enabled;
  const busy = preview.isPending || apply.isPending;

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("auto.title")}</DialogTitle>
          <DialogDescription>{t("auto.hint")}</DialogDescription>
        </DialogHeader>

        {disabled ? (
          <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">{t("error.auto_assign_disabled")}</p>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="auto-date">{t("sv.table.date")}</Label>
              <Input
                id="auto-date"
                type="date"
                className="w-44"
                min={todayLocal()}
                value={date}
                onChange={(e) => {
                  if (!e.target.value) return;
                  setDate(e.target.value);
                  setPlan(null);
                }}
              />
            </div>
            <div className="min-w-56 space-y-1">
              <Label>{t("auto.strategy")}</Label>
              <Select
                value={chosenStrategy}
                onValueChange={(value) => {
                  setStrategy(value as DeliveryAutoAssignStrategy);
                  setPlan(null);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DELIVERY_AUTO_ASSIGN_STRATEGIES.map((item) => (
                    <SelectItem key={item} value={item}>
                      {t(`auto.strategy_option.${item}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="secondary" disabled={busy || !policy} onClick={() => void runPreview()}>
              {preview.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              {t("auto.preview")}
            </Button>
          </div>
        )}

        {plan && (
          <div className="space-y-3">
            {plan.agents.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {plan.agents.map((agent) => (
                  <span key={agent.id} className="rounded-full bg-muted px-2 py-0.5 text-[11px]">
                    {agent.name ?? agent.code} · {t("auto.agent_open", { count: agent.openTasks })}
                    {agent.onDuty ? ` · ${t("sv.map.online")}` : ""}
                  </span>
                ))}
              </div>
            )}
            {plan.proposals.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">{t("auto.nothing")}</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2 font-medium">{t("sv.table.number")}</th>
                      <th className="px-2 py-2 font-medium">{t("sv.table.customer")}</th>
                      <th className="px-2 py-2 font-medium">{t("sv.table.agent")}</th>
                      <th className="px-2 py-2 text-right font-medium">{t("auto.distance")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("auto.load")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.proposals.map((item) => (
                      <tr key={item.taskId} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 font-medium">{item.number}</td>
                        <td className="max-w-[200px] truncate px-2 py-2">{item.customerName}</td>
                        <td className="px-2 py-2">
                          {item.agentName ?? item.agentCode} <span className="text-xs text-muted-foreground">{item.agentCode}</span>
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatDistance(item.distanceMeters) ?? "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {item.openTasksAfter}
                          {item.loadKgAfter !== null ? ` · ${item.loadKgAfter} kg` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <SkipList skipped={plan.skipped} />
          </div>
        )}

        {result && (
          <div className="space-y-2">
            <p className="rounded-xl bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
              {t("auto.applied", { count: result.assigned.length })}
            </p>
            <SkipList skipped={result.skipped} />
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button disabled={busy || !plan || plan.proposals.length === 0} onClick={() => void runApply()}>
            {apply.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("auto.apply", { count: plan?.proposals.length ?? 0 })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
