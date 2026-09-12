import { useOutletContext, useParams, useSearchParams } from "react-router-dom";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, Users } from "lucide-react";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useApiQuery } from "@/lib/query.ts";
import { useDebounce } from "@/hooks/use-debounce.ts";
import { cn } from "@/lib/utils.ts";
import EmptyState from "../_components/empty-state.tsx";
import LocationBanner from "../_components/location-banner.tsx";
import StoreCard from "../_components/store-card.tsx";
import { originParams, useAgentLocation } from "../_lib/agent-location.ts";
import type { AgentMe, AgentStore, Debtor, DebtorStatus } from "../_lib/types.ts";

const FILTERS = ["all", "debtors", "overdue"] as const;
type Filter = (typeof FILTERS)[number];

const STATUS_TONE: Record<DebtorStatus, string> = {
  overdue: "text-destructive",
  today: "text-amber-600 dark:text-amber-400",
  soon: "text-amber-600 dark:text-amber-400",
  later: "text-emerald-600 dark:text-emerald-400",
  unscheduled: "text-muted-foreground",
};

/**
 * Mijozlar: agentga ochiq barcha mijozlar (qidiruv, joy aniq bo'lsa — yaqinidan) va qarzdorlar (muddat bo'yicha rangli).
 * Profil — tarix, tahrirlash, joylashuv va vitrina rasmi.
 */
export default function AgentCustomersPage() {
  const { t } = useTranslation("agent");
  const { lng = "uz" } = useParams<{ lng: string }>();
  const { company } = useOutletContext<AgentMe>();
  const position = useAgentLocation();
  const [params, setParams] = useSearchParams();
  const filter: Filter = FILTERS.find((value) => value === params.get("filter")) ?? "all";
  const [search, setSearch] = useState("");
  const [debounced] = useDebounce(search.trim(), 300);

  const stores = useApiQuery<{ stores: AgentStore[] }>(
    filter === "all" && position.status !== "locating" ? "/api/sales-agent/stores" : null,
    { scope: "all", search: debounced || undefined, ...originParams(position) },
    { placeholderData: (previous) => previous },
  ).data?.stores;
  const debtors = useApiQuery<{ debtors: Debtor[] }>(filter === "all" ? null : "/api/sales-agent/debtors", {
    filter: filter === "overdue" ? "overdue" : "all",
  }).data?.debtors;

  const needle = debounced.toLowerCase();
  const list: (AgentStore | Debtor)[] | undefined =
    filter === "all"
      ? stores
      : debtors?.filter((debtor) => !needle || [debtor.name, debtor.address, debtor.phone].some((value) => value?.toLowerCase().includes(needle)));

  const dueText = (debtor: Debtor) => {
    if (debtor.daysOverdue === null) return t("debtors.unscheduled");
    if (debtor.daysOverdue > 0) return t("debtors.days_overdue", { count: debtor.daysOverdue });
    if (debtor.daysOverdue === 0) return t("debtors.due_today");
    return t("debtors.due_in", { count: -debtor.daysOverdue });
  };

  return (
    <div className="p-4 space-y-4">
      <LocationBanner location={position} />
      <div className="grid grid-cols-3 gap-2">
        {FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setParams(key === "all" ? {} : { filter: key }, { replace: true })}
            className={cn(
              "h-11 rounded-xl border text-xs font-semibold transition-colors cursor-pointer",
              filter === key ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground",
            )}
          >
            {t(`customers.filter.${key}`)}
          </button>
        ))}
      </div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
        <Input
          id="customers-search"
          className="h-12 pl-10 text-base"
          placeholder={t("stores.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {!list ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon={Users} title={t("nav.customers")} message={filter === "all" ? t("stores.empty") : t("debtors.empty")} />
      ) : (
        <div className="space-y-2">
          {list.map((store) => (
            <StoreCard
              key={store.id}
              store={store}
              currency={company.currency}
              to={`/${lng}/sales-agent/stores/${store.id}`}
              footer={
                "status" in store ? <p className={cn("text-xs font-semibold", STATUS_TONE[store.status])}>{dueText(store)}</p> : undefined
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
