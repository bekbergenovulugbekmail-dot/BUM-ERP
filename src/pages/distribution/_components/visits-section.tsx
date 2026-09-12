import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Camera, ClipboardCheck, Clock, ShoppingCart, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiQuery } from "@/lib/query.ts";
import { cn } from "@/lib/utils.ts";
import { todayLocal } from "@/pages/sales/_lib/types.ts";
import type { NoOrderReason, SalesRep, SupervisorVisit, VisitsSummary } from "../_lib/types.ts";

/**
 * Tashriflar (`sales_agent.supervise`): kun va agent bo'yicha do'konga tashriflar, davomiyligi, natijasi,
 * buyurtmasiz sabablar tahlili va tashrif rasmlari (imzolangan qisqa muddatli havola orqali).
 */
export default function VisitsSection() {
  const { t, i18n } = useTranslation("distribution");
  const [date, setDate] = useState(todayLocal);
  const [repId, setRepId] = useState("all");
  const [photo, setPhoto] = useState<{ url: string; title: string } | null>(null);

  const reps = useApiQuery<{ salesReps: SalesRep[] }>("/api/distribution/sales-reps").data?.salesReps;
  const data = useApiQuery<{ visits: SupervisorVisit[]; summary: VisitsSummary }>(
    "/api/sales-agent/supervisor/visits",
    { date, salesRepId: repId === "all" ? undefined : repId },
    { refetchInterval: 60_000 },
  ).data;

  const time = useMemo(() => new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit" }), [i18n.language]);
  const reasons = Object.entries(data?.summary.reasons ?? {}).sort((a, b) => b[1] - a[1]) as [NoOrderReason, number][];
  const maxReason = reasons[0]?.[1] ?? 0;

  const openPhoto = async (visit: SupervisorVisit, photoId: string, kind: string) => {
    try {
      const { url } = await api.get<{ url: string }>(`/api/sales-agent/supervisor/visits/${visit.id}/photos/${photoId}/url`);
      setPhoto({ url, title: `${visit.customerName} · ${t(`visits.photo_kind.${kind}`)}` });
    } catch (err) {
      toast.error(errorMessage(err, t("visits.photo_failed")));
    }
  };

  const cards = [
    { label: t("visits.total"), value: data?.summary.total, icon: ClipboardCheck, tone: "text-indigo-500 bg-indigo-500/10" },
    { label: t("visits.in_progress"), value: data?.summary.inProgress, icon: Clock, tone: "text-blue-500 bg-blue-500/10" },
    { label: t("visits.ordered"), value: data?.summary.ordered, icon: ShoppingCart, tone: "text-emerald-500 bg-emerald-500/10" },
    { label: t("visits.no_order"), value: data?.summary.noOrder, icon: XCircle, tone: "text-amber-500 bg-amber-500/10" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" className="h-9 w-40" max={todayLocal()} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <Select value={repId} onValueChange={setRepId}>
          <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("visits.all_agents")}</SelectItem>
            {reps?.map((rep) => <SelectItem key={rep.id} value={rep.id}>{rep.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map((card) => (
          <div key={card.label} className="bg-card border border-border rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center", card.tone)}>
                <card.icon className="h-4 w-4" />
              </div>
              <p className="text-xs text-muted-foreground">{card.label}</p>
            </div>
            <p className="text-2xl font-bold">{card.value ?? "—"}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
          <p className="text-sm font-semibold">{t("visits.reasons")}</p>
          {reasons.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("visits.no_reasons")}</p>
          ) : (
            reasons.map(([reason, count]) => (
              <div key={reason} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span>{t(`visits.reason.${reason}`)}</span>
                  <span className="font-semibold">{count}</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-amber-500" style={{ width: `${maxReason ? (count / maxReason) * 100 : 0}%` }} />
                </div>
              </div>
            ))
          )}
        </div>

        <div className="lg:col-span-2 bg-card border border-border rounded-2xl overflow-hidden">
          {!data ? (
            <div className="p-3 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
          ) : data.visits.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">{t("visits.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="text-left font-medium px-3 py-2">{t("visits.col.agent")}</th>
                    <th className="text-left font-medium px-3 py-2">{t("visits.col.store")}</th>
                    <th className="text-left font-medium px-3 py-2">{t("visits.col.time")}</th>
                    <th className="text-left font-medium px-3 py-2">{t("visits.col.duration")}</th>
                    <th className="text-left font-medium px-3 py-2">{t("visits.col.result")}</th>
                    <th className="text-right font-medium px-3 py-2">{t("visits.col.distance")}</th>
                    <th className="text-left font-medium px-3 py-2">{t("visits.col.photos")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.visits.map((visit) => (
                    <tr key={visit.id} className="align-top">
                      <td className="px-3 py-2 whitespace-nowrap">{visit.salesRepName}</td>
                      <td className="px-3 py-2 min-w-40">{visit.customerName}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                        {time.format(new Date(visit.startedAt))}
                        {visit.completedAt && `–${time.format(new Date(visit.completedAt))}`}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {visit.durationSeconds !== null
                          ? t("visits.minutes", { count: Math.max(1, Math.round(visit.durationSeconds / 60)) })
                          : <span className="text-blue-600">{t("visits.running")}</span>}
                      </td>
                      <td className="px-3 py-2 min-w-40">
                        {visit.result === "ordered" ? (
                          <span className="text-emerald-600 font-medium">{t("visits.result.ordered")}</span>
                        ) : visit.result === "no_order" ? (
                          <div>
                            <span className="text-amber-600 font-medium">
                              {visit.noOrderReason ? t(`visits.reason.${visit.noOrderReason}`) : t("visits.result.no_order")}
                            </span>
                            {visit.noOrderComment && <p className="text-xs text-muted-foreground">{visit.noOrderComment}</p>}
                          </div>
                        ) : (
                          "—"
                        )}
                        {visit.notes && <p className="text-xs text-muted-foreground">{visit.notes}</p>}
                        <div className="flex flex-wrap gap-1 mt-1 empty:hidden">
                          {visit.invalidatedAt && (
                            <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
                              {t("visits.flag.invalid")}
                            </span>
                          )}
                          {visit.outsideCount > 0 && (
                            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                              {t("visits.flag.outside", { count: visit.outsideCount })}
                            </span>
                          )}
                          {visit.pausedSeconds >= 60 && (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                              {t("visits.flag.paused", { count: Math.round(visit.pausedSeconds / 60) })}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap text-muted-foreground">
                        {visit.startDistanceMeters !== null ? `${visit.startDistanceMeters} m` : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {visit.photos.map((item) => (
                            <Button
                              key={item.id}
                              size="sm"
                              variant="secondary"
                              className="h-7 px-2 text-xs"
                              title={t(`visits.photo_kind.${item.kind}`)}
                              onClick={() => void openPhoto(visit, item.id, item.kind)}
                            >
                              <Camera className="h-3.5 w-3.5" />
                            </Button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <Dialog open={photo !== null} onOpenChange={(open) => !open && setPhoto(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{photo?.title}</DialogTitle>
          </DialogHeader>
          {photo && <img src={photo.url} alt={photo.title} className="w-full max-h-[75vh] object-contain rounded-xl bg-muted" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
