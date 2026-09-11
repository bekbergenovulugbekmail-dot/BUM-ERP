import { useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Wallet } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useApiQuery } from "@/lib/query.ts";
import { cn } from "@/lib/utils.ts";
import EmptyState from "../_components/empty-state.tsx";
import StoreCard from "../_components/store-card.tsx";
import type { AgentMe, Debtor, DebtorStatus } from "../_lib/types.ts";

const FILTERS = ["all", "overdue", "today", "soon"] as const;
type Filter = (typeof FILTERS)[number];

const STATUS_TONE: Record<DebtorStatus, string> = {
  overdue: "text-destructive",
  today: "text-amber-600 dark:text-amber-400",
  soon: "text-amber-600 dark:text-amber-400",
  later: "text-emerald-600 dark:text-emerald-400",
  unscheduled: "text-muted-foreground",
};

/** Qarzdorlar: biriktirilgan do'konlar, eng eski to'lanmagan buyurtma muddati bo'yicha. */
export default function AgentDebtorsPage() {
  const { t } = useTranslation("agent");
  const { lng = "uz" } = useParams<{ lng: string }>();
  const { company } = useOutletContext<AgentMe>();
  const [filter, setFilter] = useState<Filter>("all");
  const debtors = useApiQuery<{ debtors: Debtor[] }>("/api/sales-agent/debtors", { filter }).data?.debtors;

  const dueText = (debtor: Debtor) => {
    if (debtor.daysOverdue === null) return t("debtors.unscheduled");
    if (debtor.daysOverdue > 0) return t("debtors.days_overdue", { count: debtor.daysOverdue });
    if (debtor.daysOverdue === 0) return t("debtors.due_today");
    return t("debtors.due_in", { count: -debtor.daysOverdue });
  };

  return (
    <div className="p-4 space-y-4">
      <div className="grid grid-cols-4 gap-2">
        {FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={cn(
              "h-11 rounded-xl border text-xs font-semibold transition-colors cursor-pointer",
              filter === key ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground",
            )}
          >
            {t(`debtors.filter.${key}`)}
          </button>
        ))}
      </div>

      {!debtors ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
      ) : debtors.length === 0 ? (
        <EmptyState icon={Wallet} title={t("nav.debtors")} message={t("debtors.empty")} />
      ) : (
        <div className="space-y-2">
          {debtors.map((debtor) => (
            <StoreCard
              key={debtor.id}
              store={debtor}
              currency={company.currency}
              to={`/${lng}/sales-agent/stores/${debtor.id}`}
              footer={<p className={cn("text-xs font-semibold", STATUS_TONE[debtor.status])}>{dueText(debtor)}</p>}
            />
          ))}
        </div>
      )}
    </div>
  );
}
