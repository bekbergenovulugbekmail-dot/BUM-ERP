import { useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Search, Store } from "lucide-react";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useApiQuery } from "@/lib/query.ts";
import { useDebounce } from "@/hooks/use-debounce.ts";
import EmptyState from "../_components/empty-state.tsx";
import LocationBanner from "../_components/location-banner.tsx";
import StoreCard from "../_components/store-card.tsx";
import { originParams, useAgentLocation } from "../_lib/agent-location.ts";
import type { AgentMe, AgentStore } from "../_lib/types.ts";

/** Agentga ochiq barcha do'konlar: qidiruv (nom, telefon, manzil), joy aniq bo'lsa — yaqinidan. */
export default function AgentStoresPage() {
  const { t } = useTranslation("agent");
  const { lng = "uz" } = useParams<{ lng: string }>();
  const { company } = useOutletContext<AgentMe>();
  const position = useAgentLocation();
  const [search, setSearch] = useState("");
  const [debounced] = useDebounce(search.trim(), 300);

  const stores = useApiQuery<{ stores: AgentStore[] }>(
    position.status === "locating" ? null : "/api/sales-agent/stores",
    { scope: "all", search: debounced || undefined, ...originParams(position) },
    { placeholderData: (previous) => previous },
  ).data?.stores;

  return (
    <div className="p-4 space-y-4">
      <LocationBanner location={position} />
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
        <Input
          className="h-12 pl-10 text-base"
          placeholder={t("stores.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {!stores ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
      ) : stores.length === 0 ? (
        <EmptyState icon={Store} title={t("nav.stores")} message={t("stores.empty")} />
      ) : (
        <div className="space-y-2">
          {stores.map((store) => (
            <StoreCard key={store.id} store={store} currency={company.currency} to={`/${lng}/sales-agent/stores/${store.id}`} />
          ))}
        </div>
      )}
    </div>
  );
}
