import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { AlertTriangle, History, Radio, RefreshCw, X } from "lucide-react";
import { AGENT_ONLINE_MINUTES } from "@bum/shared";
import MapView from "@/components/map-view.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { usePermissions } from "@/hooks/use-company.ts";
import type { LatLng, MapMarker } from "@/lib/maps/index.ts";
import { useApiQuery } from "@/lib/query.ts";
import { cn } from "@/lib/utils.ts";
import { todayLocal } from "@/pages/sales/_lib/types.ts";
import type { AgentDetail, AgentLocationHistory, LiveLocations, LocationEvent, StoreVisitStatus, SupervisedAgent } from "../_lib/types.ts";

const STORE_TONES: Record<StoreVisitStatus, string> = {
  waiting: "bg-muted text-muted-foreground",
  in_progress: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  ordered: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  visited_no_order: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
};
const STORE_MARKER_TONES: Record<StoreVisitStatus, MapMarker["tone"]> = {
  waiting: "offline",
  in_progress: "primary",
  ordered: "online",
  visited_no_order: "warning",
};

const LIVE_REFRESH_MS = 15_000;
const AGENTS_REFRESH_MS = 60_000;

const pointOf = (latitude: string | null, longitude: string | null): LatLng | null =>
  latitude !== null && longitude !== null ? { latitude: Number(latitude), longitude: Number(longitude) } : null;

/** Jonli yangilanishni agentlar ro'yxatiga qo'shadi: yangiroq joy va onlayn holati (server vaqti bo'yicha). */
function withLive(agents: SupervisedAgent[], live: LiveLocations | undefined): SupervisedAgent[] {
  if (!live) return agents;
  const onlineSince = new Date(live.serverTime).getTime() - AGENT_ONLINE_MINUTES * 60_000;
  const byRep = new Map(live.locations.map((location) => [location.salesRepId, location]));
  return agents.map((agent) => {
    const fresh = byRep.get(agent.id);
    if (!fresh || (agent.receivedAt && agent.receivedAt >= fresh.receivedAt)) return agent;
    return {
      ...agent,
      latitude: fresh.latitude,
      longitude: fresh.longitude,
      accuracy: fresh.accuracy,
      recordedAt: fresh.recordedAt,
      receivedAt: fresh.receivedAt,
      suspicious: fresh.suspicious,
      online: new Date(fresh.receivedAt).getTime() >= onlineSince,
    };
  });
}

function eventDetails(event: LocationEvent, t: TFunction<"distribution">): string | null {
  const details = event.details ?? {};
  if (typeof details.meters === "number" && typeof details.speedKmh === "number") {
    return t("monitoring.speed", { meters: details.meters, speed: details.speedKmh });
  }
  if (typeof details.message === "string" && details.message) return details.message;
  if (event.accuracy !== null) return t("monitoring.accuracy", { value: Math.round(Number(event.accuracy)) });
  return null;
}

/**
 * Monitoring: agentlar holati va oxirgi joyi xaritada (jonli), tanlangan agentning kunlik yo'li va lokatsiya hodisalari.
 * Har bir qism o'z ruxsati bilan: ko'rish / jonli / tarix (audit) / hodisalar (nazorat).
 */
export default function MonitoringSection() {
  const { t, i18n } = useTranslation("distribution");
  const { can } = usePermissions();
  const canLive = can("sales_agent.location.live");
  const canHistory = can("sales_agent.location.history");
  const canEvents = can("sales_agent.supervise");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [date, setDate] = useState(todayLocal);

  const agentsQuery = useApiQuery<{ agents: SupervisedAgent[] }>("/api/sales-agent/supervisor/agents", undefined, {
    refetchInterval: AGENTS_REFRESH_MS,
  });
  const live = useApiQuery<LiveLocations>(canLive ? "/api/sales-agent/supervisor/live" : null, undefined, {
    refetchInterval: LIVE_REFRESH_MS,
  }).data;
  // Tarixni har ochish audit qilinadi — fokusda qayta so'ralmaydi
  const history = useApiQuery<AgentLocationHistory>(
    canHistory && selectedId ? `/api/sales-agent/supervisor/agents/${selectedId}/history` : null,
    { date },
    { refetchOnWindowFocus: false, staleTime: 5 * 60_000 },
  ).data;
  const events = useApiQuery<{ events: LocationEvent[] }>(
    canEvents ? "/api/sales-agent/supervisor/events" : null,
    { date, salesRepId: selectedId ?? undefined },
    { refetchInterval: AGENTS_REFRESH_MS },
  ).data?.events;

  const detailData = useApiQuery<AgentDetail>(selectedId ? `/api/sales-agent/supervisor/agents/${selectedId}` : null, undefined, {
    refetchInterval: AGENTS_REFRESH_MS,
  }).data;
  const detail = detailData && detailData.agent.id === selectedId ? detailData : null;

  const agents = useMemo(() => withLive(agentsQuery.data?.agents ?? [], live), [agentsQuery.data, live]);
  const onlineCount = agents.filter((agent) => agent.online).length;
  const selected = agents.find((agent) => agent.id === selectedId) ?? null;
  const showHistory = Boolean(selected && history && history.agent.id === selected.id);

  const formatTime = useMemo(() => {
    const format = new Intl.DateTimeFormat(i18n.language, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    return (iso: string) => format.format(new Date(iso));
  }, [i18n.language]);

  const polyline = useMemo<LatLng[]>(
    () => (showHistory && history ? history.points.map((point) => ({ latitude: Number(point.latitude), longitude: Number(point.longitude) })) : []),
    [showHistory, history],
  );

  const markers = useMemo<MapMarker[]>(() => {
    // Tanlangan agentning bugungi do'konlari — tashrif holati rangida
    const storeMarkers: MapMarker[] = (detail?.stores ?? []).flatMap((store) => {
      const point = pointOf(store.latitude, store.longitude);
      return point
        ? [{ id: `store-${store.id}`, ...point, label: store.name, description: t(`monitoring.store_status.${store.visitStatus}`), tone: STORE_MARKER_TONES[store.visitStatus] }]
        : [];
    });
    if (showHistory && history) {
      const first = history.points[0];
      const last = history.points.at(-1);
      const result: MapMarker[] = [...storeMarkers];
      if (first && last && first !== last) {
        result.push({ id: "start", latitude: Number(first.latitude), longitude: Number(first.longitude), label: t("monitoring.start"), description: formatTime(first.recordedAt), tone: "primary" });
      }
      if (last) {
        result.push({ id: "end", latitude: Number(last.latitude), longitude: Number(last.longitude), label: history.agent.name, description: `${t("monitoring.end")}: ${formatTime(last.recordedAt)}`, tone: "online" });
      }
      for (const event of history.events) {
        const point = pointOf(event.latitude, event.longitude);
        if (point) result.push({ id: event.id, ...point, label: t(`events.type.${event.type}`), description: formatTime(event.occurredAt), tone: "danger" });
      }
      return result;
    }
    const agentMarkers = agents
      .filter((agent) => !selectedId || agent.id === selectedId)
      .flatMap((agent) => {
        const point = pointOf(agent.latitude, agent.longitude);
        if (!point) return [];
        return [{
          id: agent.id,
          ...point,
          label: agent.name,
          description: agent.recordedAt ? t("monitoring.last_seen", { time: formatTime(agent.recordedAt) }) : undefined,
          tone: agent.suspicious ? "warning" : agent.online ? "online" : "offline",
        } satisfies MapMarker];
      });
    return [...storeMarkers, ...agentMarkers];
  }, [showHistory, history, agents, selectedId, detail, formatTime, t]);

  const money = useMemo(() => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 }), [i18n.language]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="bg-card border border-border rounded-2xl overflow-hidden flex flex-col lg:max-h-[720px]">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">{t("monitoring.agents")}</p>
            <p className="text-xs text-muted-foreground">{t("monitoring.online_count", { online: onlineCount, total: agents.length })}</p>
          </div>
          {canLive && (
            <span className="flex items-center gap-1 text-[11px] text-emerald-600" title={t("monitoring.live_note")}>
              <Radio className="h-3.5 w-3.5 animate-pulse" /> Live
            </span>
          )}
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title={t("monitoring.refresh")} onClick={() => void agentsQuery.refetch()}>
            <RefreshCw className={cn("h-4 w-4", agentsQuery.isFetching && "animate-spin")} />
          </Button>
        </div>
        {!agentsQuery.data ? (
          <div className="p-3 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
        ) : agents.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">{t("monitoring.empty")}</p>
        ) : (
          <div className="divide-y divide-border overflow-y-auto">
            {agents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                disabled={!canHistory}
                onClick={() => setSelectedId((current) => (current === agent.id ? null : agent.id))}
                className={cn(
                  "w-full text-left px-4 py-3 space-y-1 transition-colors enabled:cursor-pointer enabled:hover:bg-muted/50",
                  selectedId === agent.id && "bg-primary/5",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", agent.online ? "bg-emerald-500" : "bg-muted-foreground/40")} />
                  <span className="text-sm font-medium truncate flex-1">{agent.name}</span>
                  <span className={cn("text-[11px]", agent.online ? "text-emerald-600" : "text-muted-foreground")}>
                    {agent.online ? t("monitoring.online") : t("monitoring.offline")}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {agent.todayRoutes.length > 0 ? agent.todayRoutes.map((route) => route.name).join(", ") : t("monitoring.no_route")}
                </p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span>{agent.recordedAt ? t("monitoring.last_seen", { time: formatTime(agent.recordedAt) }) : t("monitoring.never")}</span>
                  {agent.accuracy !== null && <span>{t("monitoring.accuracy", { value: Math.round(Number(agent.accuracy)) })}</span>}
                  {agent.suspicious && (
                    <span className="flex items-center gap-1 text-amber-600">
                      <AlertTriangle className="h-3 w-3" /> {t("monitoring.suspicious")}
                    </span>
                  )}
                  {!agent.hasLogin && <span className="text-amber-600">{t("monitoring.no_login")}</span>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="lg:col-span-2 space-y-4">
        {canHistory && (
          <div className="bg-card border border-border rounded-2xl p-3 flex flex-wrap items-center gap-3">
            <History className="h-4 w-4 text-muted-foreground" />
            <div className="flex-1 min-w-40">
              <p className="text-sm font-semibold">
                {selected ? `${t("monitoring.history")}: ${selected.name}` : t("monitoring.history")}
              </p>
              <p className="text-xs text-muted-foreground">
                {!selected
                  ? t("monitoring.history_hint")
                  : !history
                    ? "..."
                    : history.points.length === 0
                      ? t("monitoring.no_points")
                      : t("monitoring.points", { count: history.points.length })}
                {selected && history?.truncated && ` · ${t("monitoring.truncated")}`}
              </p>
            </div>
            <Input type="date" className="h-9 w-40" max={todayLocal()} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            {selected && (
              <Button size="sm" variant="secondary" onClick={() => setSelectedId(null)}>
                <X className="h-4 w-4 mr-1" /> {t("monitoring.clear")}
              </Button>
            )}
            {selected && <p className="basis-full text-[11px] text-muted-foreground">{t("monitoring.history_audit")}</p>}
          </div>
        )}

        {detail && (
          <div className="space-y-2 rounded-2xl border border-border bg-card p-3 text-sm">
            <div className="grid grid-cols-3 gap-2">
              <div>
                <p className="text-xs text-muted-foreground">{t("monitoring.detail.sales")}</p>
                <p className="font-semibold">{money.format(Number(detail.today.salesAmount))} {detail.currency}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("monitoring.detail.orders")}</p>
                <p className="font-semibold">{detail.today.orderCount}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  {t("monitoring.detail.visits", { done: detail.today.visitsCompleted, total: detail.stores.length })}
                </p>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${detail.stores.length ? (detail.today.visitsCompleted / detail.stores.length) * 100 : 0}%` }}
                  />
                </div>
              </div>
            </div>
            {detail.currentVisit && (
              <p className="text-xs text-blue-600">{t("monitoring.detail.current", { store: detail.currentVisit.customerName })}</p>
            )}
            {detail.stores.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{t("monitoring.detail.stores")}</p>
                <div className="flex flex-wrap gap-1">
                  {detail.stores.map((store) => (
                    <span
                      key={store.id}
                      title={t(`monitoring.store_status.${store.visitStatus}`)}
                      className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", STORE_TONES[store.visitStatus])}
                    >
                      {store.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <MapView markers={markers} polyline={polyline} className="h-[420px] lg:h-[520px]" />

        {canEvents && (
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border text-sm font-semibold">
              {t("monitoring.events")}
              {selected && <span className="font-normal text-muted-foreground"> · {selected.name}</span>}
            </div>
            {!events ? (
              <div className="p-3"><Skeleton className="h-12 rounded-xl" /></div>
            ) : events.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">{t("monitoring.no_events")}</p>
            ) : (
              <div className="divide-y divide-border max-h-80 overflow-y-auto">
                {events.map((event) => {
                  const severe = event.type === "jump" || event.type === "mock" || event.type === "geofence_block" || event.type === "permission_denied";
                  const details = eventDetails(event, t);
                  return (
                    <div key={event.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                      <AlertTriangle className={cn("h-4 w-4 shrink-0", severe ? "text-destructive" : "text-amber-500")} />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">
                          {t(`events.type.${event.type}`)}
                          {event.salesRepName && <span className="font-normal text-muted-foreground"> · {event.salesRepName}</span>}
                        </p>
                        {details && <p className="text-xs text-muted-foreground truncate">{details}</p>}
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">{formatTime(event.occurredAt)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
