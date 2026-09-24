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
import type { AgentMe, AgentStore, AgentToday, Debtor, DebtorStatus } from "../_lib/types.ts";

/**
 * Birinchi filtr — BUGUNGI marshrut. Ilgari sahifa doim `scope=all` so'rardi, ya'ni "Hammasi"
 * agentning butun haftadagi do'konlarini bir ro'yxatda ko'rsatardi; agent esa buni bugungi
 * marshrut deb o'qir va "payshanba marshruti bilan birga jumaniki ham chiqyapti" deb
 * hisoblardi. Endi bugungi marshrut sukut bo'yicha, "Hammasi" esa ataylab tanlanadi.
 */
const FILTERS = ["today", "all", "debtors", "overdue"] as const;
type Filter = (typeof FILTERS)[number];

const STATUS_TONE: Record<DebtorStatus, string> = {
  overdue: "text-destructive",
  today: "text-amber-600 dark:text-amber-400",
  soon: "text-amber-600 dark:text-amber-400",
  later: "text-emerald-600 dark:text-emerald-400",
  unscheduled: "text-muted-foreground",
};

const matches = (store: AgentStore, needle: string) =>
  !needle || [store.name, store.address, store.phone].some((value) => value?.toLowerCase().includes(needle));

/**
 * Mijozlar: bugungi marshrut (sukut), agentga ochiq barcha mijozlar, qarzdorlar va kechikkanlar.
 * Profil — tarix, tahrirlash, joylashuv va vitrina rasmi.
 */
export default function AgentCustomersPage() {
  const { t } = useTranslation("agent");
  const { lng = "uz" } = useParams<{ lng: string }>();
  const { company } = useOutletContext<AgentMe>();
  const position = useAgentLocation();
  const [params, setParams] = useSearchParams();
  const filter: Filter = FILTERS.find((value) => value === params.get("filter")) ?? "today";
  const [search, setSearch] = useState("");
  const [debounced] = useDebounce(search.trim(), 300);
  const needle = debounced.toLowerCase();

  // Bugungi marshrut "Sotuv" sahifasi bilan bir xil so'rov — qayta yuklanmaydi, keshdan keladi.
  // Ro'yxat bitta marshrut do'konlari bo'lgani uchun qidiruv shu yerda, qo'shimcha so'rovsiz.
  const today = useApiQuery<AgentToday>(
    filter === "today" && position.status !== "locating" ? "/api/sales-agent/today" : null,
    originParams(position),
  ).data;

  const stores = useApiQuery<{ stores: AgentStore[] }>(
    filter === "all" && position.status !== "locating" ? "/api/sales-agent/stores" : null,
    { scope: "all", search: debounced || undefined, ...originParams(position) },
    { placeholderData: (previous) => previous },
  ).data?.stores;

  const debtors = useApiQuery<{ debtors: Debtor[] }>(
    filter === "today" || filter === "all" ? null : "/api/sales-agent/debtors",
    { filter: filter === "overdue" ? "overdue" : "all" },
  ).data?.debtors;

  let list: (AgentStore | Debtor)[] | undefined;
  if (filter === "today") list = today?.stores.filter((store) => matches(store, needle));
  else if (filter === "all") list = stores;
  else list = debtors?.filter((debtor) => matches(debtor, needle));

  const dueText = (debtor: Debtor) => {
    if (debtor.daysOverdue === null) return t("debtors.unscheduled");
    if (debtor.daysOverdue > 0) return t("debtors.days_overdue", { count: debtor.daysOverdue });
    if (debtor.daysOverdue === 0) return t("debtors.due_today");
    return t("debtors.due_in", { count: -debtor.daysOverdue });
  };

  /** "Payshanba · Дехкон бозор" — qaysi kun va qaysi marshrut ekani ro'yxat tepasida yozib turadi. */
  const todayLine = () => {
    if (!today) return null;
    const weekday = t(`weekday.${new Date(`${today.date}T00:00:00Z`).getUTCDay()}`);
    const routes = today.routes.map((route) => route.name).join(", ");
    return routes ? `${weekday} · ${routes}` : weekday;
  };

  return (
    <div className="p-4 space-y-4">
      <LocationBanner location={position} />
      <div className="grid grid-cols-2 gap-2">
        {FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setParams(key === "today" ? {} : { filter: key }, { replace: true })}
            className={cn(
              "h-11 rounded-xl border text-xs font-semibold transition-colors cursor-pointer",
              filter === key ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground",
            )}
          >
            {t(`customers.filter.${key}`)}
          </button>
        ))}
      </div>

      {filter === "today" && todayLine() && (
        <p className="text-xs text-muted-foreground">
          {t("customers.today_line", { value: todayLine() })}
        </p>
      )}

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
        <div className="space-y-3">
          <EmptyState
            icon={Users}
            title={t("nav.customers")}
            message={filter === "today" ? t("customers.today_empty") : filter === "all" ? t("stores.empty") : t("debtors.empty")}
          />
          {/* Bugungi marshrutda topilmasa — do'kon boshqa kunniki bo'lishi mumkin, shuning uchun yo'l ko'rsatiladi */}
          {filter === "today" && needle && (
            <button
              type="button"
              onClick={() => setParams({ filter: "all" }, { replace: true })}
              className="w-full h-11 rounded-xl border border-primary bg-primary/10 text-sm font-semibold text-primary cursor-pointer"
            >
              {t("customers.search_in_all")}
            </button>
          )}
        </div>
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
