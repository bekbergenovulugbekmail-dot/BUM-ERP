import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BadgePercent, CalendarDays } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useApiQuery } from "@/lib/query.ts";
import { cn } from "@/lib/utils.ts";
import EmptyState from "../_components/empty-state.tsx";
import { promotionRule, type Promotion } from "../_lib/types.ts";

type Filter = "active" | "upcoming" | "ending_soon";
const FILTERS: Filter[] = ["active", "ending_soon", "upcoming"];

/** Aksiyalar va chegirmalar: faol, tugayotgan (3 kun ichida) va yaqinlashayotgan. Hisoblash buyurtmada, serverda. */
export default function AgentPromotionsPage() {
  const { t } = useTranslation("agent");
  const [filter, setFilter] = useState<Filter>("active");
  const promotions = useApiQuery<{ promotions: Promotion[] }>("/api/sales-agent/promotions", { filter }, {
    placeholderData: (previous) => previous,
  }).data?.promotions;

  return (
    <div className="space-y-4 p-4">
      <div className="grid grid-cols-3 gap-2">
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={cn(
              "h-11 rounded-xl border text-sm font-medium",
              filter === value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card",
            )}
          >
            {t(`promo.filter.${value}`)}
          </button>
        ))}
      </div>

      {!promotions ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
      ) : promotions.length === 0 ? (
        <EmptyState icon={BadgePercent} title={t("nav.promotions")} message={t("promo.empty")} />
      ) : (
        <div className="space-y-2">
          {promotions.map((promotion) => (
            <div key={promotion.id} className="space-y-1.5 rounded-2xl border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <span className="rounded bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-destructive-foreground">{t("promo.badge")}</span>
                <p className="min-w-0 truncate font-semibold">{promotion.name}</p>
              </div>
              <p className="text-sm font-medium">{promotion.productName}</p>
              <p className="text-base font-bold text-destructive">{promotionRule(promotion, t)}</p>
              {promotion.description && <p className="text-xs text-muted-foreground">{promotion.description}</p>}
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5" /> {t("promo.period", { from: promotion.startsAt, to: promotion.endsAt })}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
