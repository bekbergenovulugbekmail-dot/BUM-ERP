import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { History, Loader2, ShieldAlert } from "lucide-react";
import { DEFAULT_DELIVERY_POLICY, type DeliveryPolicy } from "@bum/shared";
import MapView from "@/components/map-view.tsx";
import { StatusBadge } from "@/components/delivery/badges.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { deliveryErrorMessage } from "@/lib/delivery/errors.ts";
import { coordsOf, formatDateTime, formatTime } from "@/lib/delivery/format.ts";
import type { AgentTrack, LiveAgent } from "@/lib/delivery/types.ts";
import type { LatLng, MapCircle, MapMarker } from "@/lib/maps/index.ts";
import { useApiQuery } from "@/lib/query.ts";
import { cn } from "@/lib/utils.ts";
import { todayLocal } from "@/pages/sales/_lib/types.ts";

/**
 * Xarita (sxematik, tashqi xarita API'siz): faol yetkazuvchilarning oxirgi joyi (faqat ish sessiyasida), aniqligi,
 * oxirgi yangilanish, joriy yetkazma va mijoz geofence doirasi; tanlangan agentning kunlik izi — har ko'rish auditga yoziladi.
 */
export default function MapSection({ onOpenTask }: { onOpenTask: (taskId: string) => void }) {
  const { t, i18n } = useTranslation("delivery");
  const live = useApiQuery<{ agents: LiveAgent[]; serverTime: string }>("/api/delivery/agents/live", undefined, { refetchInterval: 30_000 });
  const policy = useApiQuery<{ policy: DeliveryPolicy }>("/api/delivery/policy").data?.policy ?? DEFAULT_DELIVERY_POLICY;
  const agents = useMemo(() => live.data?.agents ?? [], [live.data]);
  const [agentId, setAgentId] = useState("");
  const [date, setDate] = useState(todayLocal);
  const [request, setRequest] = useState<{ agentId: string; date: string } | null>(null);
  const track = useApiQuery<AgentTrack>(request ? `/api/delivery/agents/${request.agentId}/track` : null, request ? { date: request.date } : undefined, {
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const liveMap = useMemo(() => {
    const markers: MapMarker[] = [];
    const circles: MapCircle[] = [];
    for (const agent of agents) {
      const point = coordsOf(agent.latitude, agent.longitude);
      if (point && agent.onDuty) {
        markers.push({
          id: `agent-${agent.id}`,
          ...point,
          label: agent.name ?? agent.code,
          description: [
            agent.online ? t("sv.map.online") : t("sv.map.offline"),
            formatTime(agent.recordedAt, i18n.language),
            agent.accuracy ? `±${Math.round(Number(agent.accuracy))} m` : null,
            agent.currentTask?.number ?? null,
          ]
            .filter(Boolean)
            .join(" · "),
          tone: agent.suspicious ? "warning" : agent.online ? "online" : "offline",
        });
      }
      const customer = agent.currentTask ? coordsOf(agent.currentTask.customerLatitude, agent.currentTask.customerLongitude) : null;
      if (agent.currentTask && customer) {
        markers.push({
          id: `task-${agent.currentTask.id}`,
          ...customer,
          label: agent.currentTask.customerName,
          description: `${agent.currentTask.number} · ${t(`status.${agent.currentTask.status}`)}`,
          tone: "primary",
        });
        circles.push({ id: `fence-${agent.currentTask.id}`, ...customer, radiusMeters: policy.geofenceRadiusMeters });
      }
    }
    return { markers, circles };
  }, [agents, policy.geofenceRadiusMeters, t, i18n.language]);

  const trackMap = useMemo(() => {
    const data = track.data;
    if (!data) return null;
    const polyline: LatLng[] = data.points
      .filter((point) => !point.suspicious)
      .map((point) => ({ latitude: Number(point.latitude), longitude: Number(point.longitude) }));
    const markers: MapMarker[] = [];
    data.events.forEach((event, index) => {
      const point = coordsOf(event.latitude, event.longitude);
      if (!point) return;
      markers.push({
        id: `event-${index}`,
        ...point,
        label: `${event.number} · ${t(`event.${event.action}`, { defaultValue: event.action })}`,
        description: formatDateTime(event.occurredAt, i18n.language),
        tone: event.action === "GEOFENCE_BLOCK" ? "danger" : event.action === "FAILED" ? "warning" : event.action.includes("DELIVERED") ? "online" : "primary",
      });
    });
    return { polyline, markers, suspicious: data.points.length - polyline.length };
  }, [track.data, t, i18n.language]);

  const onDuty = agents.filter((agent) => agent.onDuty);

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-xl bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /> {t("sv.map.privacy")}
      </p>

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        {live.isError ? (
          <p className="rounded-2xl border border-border bg-card p-4 text-sm text-destructive">{deliveryErrorMessage(live.error, t)}</p>
        ) : !live.data ? (
          <Skeleton className="aspect-[5/3] rounded-2xl" />
        ) : (
          <MapView markers={liveMap.markers} circles={liveMap.circles} className="aspect-[5/3] w-full" />
        )}

        <div className="space-y-2">
          <p className="text-sm font-semibold">{t("sv.map.agents", { onDuty: onDuty.length, total: agents.length })}</p>
          <ul className="max-h-[520px] space-y-2 overflow-y-auto">
            {agents.map((agent) => (
              <li key={agent.id} className="space-y-1 rounded-xl border border-border bg-card p-3 text-sm">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "h-2.5 w-2.5 shrink-0 rounded-full",
                      !agent.onDuty ? "bg-muted-foreground/40" : agent.suspicious ? "bg-amber-500" : agent.online ? "bg-emerald-500" : "bg-slate-400",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">{agent.name ?? agent.code}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {agent.today.done}/{agent.today.total}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {!agent.onDuty
                    ? t("sv.map.off_duty")
                    : [
                        agent.online ? t("sv.map.online") : t("sv.map.offline"),
                        agent.recordedAt ? t("sv.map.last_update", { time: formatTime(agent.recordedAt, i18n.language) }) : t("sv.map.no_location"),
                        agent.accuracy ? `±${Math.round(Number(agent.accuracy))} m` : null,
                        agent.suspicious ? t("sv.map.suspicious") : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                </p>
                {agent.currentTask && (
                  <button type="button" className="flex w-full items-center gap-2 text-left text-xs hover:underline" onClick={() => onOpenTask(agent.currentTask!.id)}>
                    <StatusBadge status={agent.currentTask.status} />
                    <span className="truncate">
                      {agent.currentTask.number} · {agent.currentTask.customerName}
                    </span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <History className="h-4 w-4" /> {t("sv.map.track")}
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 space-y-1">
            <Label>{t("sv.table.agent")}</Label>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger>
                <SelectValue placeholder={t("assign.choose")} />
              </SelectTrigger>
              <SelectContent>
                {agents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name ?? agent.phone} · {agent.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="track-date">{t("sv.table.date")}</Label>
            <Input id="track-date" type="date" className="w-44" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </div>
          <Button disabled={!agentId || track.isFetching} onClick={() => setRequest({ agentId, date })}>
            {track.isFetching && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("sv.map.show_track")}
          </Button>
          <p className="text-[11px] text-muted-foreground">{t("sv.map.track_audit")}</p>
        </div>
        {track.isError && <p className="text-sm text-destructive">{deliveryErrorMessage(track.error, t)}</p>}
        {trackMap && track.data && (
          <>
            <p className="text-xs text-muted-foreground">
              {t("sv.map.points", { count: track.data.points.length })}
              {trackMap.suspicious > 0 ? ` · ${t("sv.map.suspicious_points", { count: trackMap.suspicious })}` : ""}
              {" · "}
              {track.data.sessions
                .map((session) => `${formatTime(session.startedAt, i18n.language)}–${session.endedAt ? formatTime(session.endedAt, i18n.language) : "…"}`)
                .join(", ") || t("sv.map.no_sessions")}
            </p>
            <MapView markers={trackMap.markers} polyline={trackMap.polyline} className="aspect-[5/3] w-full" />
          </>
        )}
      </div>
    </div>
  );
}
