import { Link, useOutletContext, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Phone, MapPin, User, Navigation, CalendarDays, Map, Store } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { ApiError } from "@/lib/api.ts";
import { useApiQuery } from "@/lib/query.ts";
import { formatMoney } from "@/hooks/use-currencies.ts";
import { cn } from "@/lib/utils.ts";
import EmptyState from "../_components/empty-state.tsx";
import LocationBanner from "../_components/location-banner.tsx";
import OrderEntry from "../_components/order-entry.tsx";
import VisitPanel from "../_components/visit-panel.tsx";
import { originParams, useAgentLocation } from "../_lib/agent-location.ts";
import { formatDistance, num, type AgentMe, type StoreProfile } from "../_lib/types.ts";

/** Do'kon profili: aloqa, qarz va kredit, buyurtmalar, tashrif kunlari, masofa. */
export default function AgentStorePage() {
  const { t } = useTranslation("agent");
  const { lng = "uz", customerId } = useParams<{ lng: string; customerId: string }>();
  const { company } = useOutletContext<AgentMe>();
  const position = useAgentLocation();
  const query = useApiQuery<{ store: StoreProfile }>(
    position.status === "locating" || !customerId ? null : `/api/sales-agent/stores/${customerId}`,
    originParams(position),
  );
  const store = query.data?.store;
  const money = (value: string | number) => formatMoney(num(value), company.currency);

  const back = (
    <Button asChild variant="ghost" className="h-11 -ml-2">
      <Link to={`/${lng}/sales-agent/stores`}>
        <ArrowLeft className="h-5 w-5 mr-1" /> {t("back")}
      </Link>
    </Button>
  );

  if (query.isError) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div className="p-4">
        {back}
        <EmptyState icon={Store} title={missing ? t("store.not_found") : t("error.title")} message="" />
      </div>
    );
  }

  if (!store) {
    return (
      <div className="p-4 space-y-3">
        {back}
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
      </div>
    );
  }

  const debt = num(store.totalDebt);
  const distance = formatDistance(store.distanceMeters, t);
  const mapUrl =
    store.latitude && store.longitude
      ? `https://yandex.uz/maps/?pt=${store.longitude},${store.latitude}&z=17&l=map`
      : null;

  return (
    <div className="p-4 space-y-4">
      {back}
      <div>
        <h1 className="text-xl font-bold">{store.name}</h1>
        <p className="text-xs text-muted-foreground">{store.code} · {store.routes.map((route) => route.name).join(", ")}</p>
      </div>

      <LocationBanner location={position} />
      <VisitPanel store={store} />
      <OrderEntry customerId={store.id} />

      <div className="rounded-2xl border border-border bg-card p-4 space-y-2.5 text-sm">
        {store.contactName && (
          <div className="flex items-center gap-3">
            <User className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">{t("store.contact")}</span>
            <span className="ml-auto font-medium">{store.contactName}</span>
          </div>
        )}
        {store.address && (
          <div className="flex items-center gap-3">
            <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="ml-auto text-right">{store.address}</span>
          </div>
        )}
        {distance && (
          <div className="flex items-center gap-3">
            <Navigation className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">{t("store.distance")}</span>
            <span className="ml-auto font-semibold">{distance}</span>
          </div>
        )}
        {store.visitDays.length > 0 && (
          <div className="flex items-center gap-3">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">{t("store.visit_days")}</span>
            <span className="ml-auto font-medium">{store.visitDays.map((day) => t(`days.${day}`)).join(", ")}</span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 pt-1">
          {store.phone && (
            <Button asChild variant="secondary" className="h-11">
              <a href={`tel:${store.phone}`}><Phone className="h-4 w-4 mr-2" /> {t("store.call")}</a>
            </Button>
          )}
          {mapUrl && (
            <Button asChild variant="secondary" className="h-11">
              <a href={mapUrl} target="_blank" rel="noreferrer"><Map className="h-4 w-4 mr-2" /> {t("store.open_map")}</a>
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className={cn("rounded-2xl border p-4", debt > 0 ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-card")}>
          <p className="text-xs text-muted-foreground">{t("store.debt")}</p>
          <p className={cn("text-lg font-bold mt-1", debt > 0 && "text-amber-600 dark:text-amber-400")}>{money(debt)}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">{t("store.available_credit")}</p>
          <p className={cn("text-lg font-bold mt-1", store.availableCredit !== null && num(store.availableCredit) < 0 && "text-destructive")}>
            {store.availableCredit === null ? t("store.no_limit") : money(store.availableCredit)}
          </p>
          {num(store.creditLimit) > 0 && (
            <p className="text-[11px] text-muted-foreground mt-0.5">{t("store.credit_limit")}: {money(store.creditLimit)}</p>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t("store.orders_90")}</span>
          <span className="font-semibold">
            {store.ordersLast90Days.count} · {money(store.ordersLast90Days.total)}
          </span>
        </div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("store.recent_orders")}</p>
        {store.recentOrders.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("store.never")}</p>
        ) : (
          <div className="divide-y divide-border">
            {store.recentOrders.map((order) => (
              <div key={order.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <p className="font-medium">{order.number}</p>
                  <p className="text-xs text-muted-foreground">{order.orderDate} · {t(`order.status.${order.status}`)}</p>
                </div>
                <span className="font-semibold">{money(order.totalAmount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {store.notes && <p className="text-sm text-muted-foreground px-1">{store.notes}</p>}
    </div>
  );
}
