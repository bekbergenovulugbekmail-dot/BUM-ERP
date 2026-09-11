import { Link, useOutletContext, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Route as RouteIcon, CalendarDays, Store, Clock, ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useApiQuery } from "@/lib/query.ts";
import EmptyState from "../_components/empty-state.tsx";
import LocationBanner from "../_components/location-banner.tsx";
import StoreCard from "../_components/store-card.tsx";
import { originParams, useAgentLocation } from "../_lib/agent-location.ts";
import type { AgentMe, AgentToday, AgentVisit } from "../_lib/types.ts";

/** Sotuv: bugungi marshrut va do'konlar (marshrut tartibida). */
export default function AgentSalesPage() {
  const { t } = useTranslation("agent");
  const { lng = "uz" } = useParams<{ lng: string }>();
  const { company } = useOutletContext<AgentMe>();
  const position = useAgentLocation();
  // Joy aniqlanguncha kutiladi — masofa bir so'rovda keladi
  const today = useApiQuery<AgentToday>(
    position.status === "locating" ? null : "/api/sales-agent/today",
    originParams(position),
  ).data;
  const deliveryDate = today?.routes.find((route) => route.deliveryDate)?.deliveryDate;
  const openVisit = useApiQuery<{ visit: AgentVisit | null }>("/api/sales-agent/visits/current").data?.visit;

  return (
    <div className="p-4 space-y-4">
      <LocationBanner location={position} />
      {openVisit && (
        <Link
          to={`/${lng}/sales-agent/stores/${openVisit.customerId}`}
          className="flex items-center gap-3 rounded-2xl border-2 border-primary/40 bg-primary/5 p-4 active:bg-primary/10"
        >
          <Clock className="h-5 w-5 text-primary shrink-0" />
          <span className="flex-1 min-w-0 text-sm font-semibold truncate">{t("visit.open_banner", { store: openVisit.customerName })}</span>
          <span className="text-sm font-medium text-primary">{t("visit.continue")}</span>
          <ChevronRight className="h-4 w-4 text-primary" />
        </Link>
      )}

      {!today ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
      ) : today.routes.length === 0 ? (
        <EmptyState icon={RouteIcon} title={t("today.no_route.title")} message={t("today.no_route.message")} />
      ) : (
        <>
          <div className="rounded-2xl border border-border bg-card p-4 space-y-2">
            <p className="text-xs text-muted-foreground">{t("today.route")}</p>
            <p className="text-lg font-bold">{today.routes.map((route) => route.name).join(", ")}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Store className="h-4 w-4" /> {t("today.stores", { count: today.stores.length })}
              </span>
              {deliveryDate && (
                <span className="flex items-center gap-1.5">
                  <CalendarDays className="h-4 w-4" /> {t("today.delivery", { date: deliveryDate })}
                </span>
              )}
            </div>
          </div>
          <div className="space-y-2">
            {today.stores.map((store, i) => (
              <StoreCard
                key={store.id}
                store={store}
                index={i + 1}
                currency={company.currency}
                to={`/${lng}/sales-agent/stores/${store.id}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
