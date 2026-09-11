import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Store, MapPin, Navigation, ChevronRight } from "lucide-react";
import { formatMoney } from "@/hooks/use-currencies.ts";
import { cn } from "@/lib/utils.ts";
import { formatDistance, num, type AgentStore, type StoreVisitStatus } from "../_lib/types.ts";

const VISIT_TONES: Record<Exclude<StoreVisitStatus, "waiting">, string> = {
  in_progress: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  ordered: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  visited_no_order: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
};

type Props = {
  store: AgentStore;
  to: string;
  currency: string;
  /** Marshrutdagi tartib raqami. */
  index?: number;
  /** Qo'shimcha qator (masalan, qarz muddati). */
  footer?: React.ReactNode;
};

/** Do'kon kartasi — katta bosiladigan maydon (bir qo'lda ishlatish). */
export default function StoreCard({ store, to, currency, index, footer }: Props) {
  const { t } = useTranslation("agent");
  const debt = num(store.totalDebt);
  const distance = formatDistance(store.distanceMeters, t);

  return (
    <Link to={to} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 active:bg-accent transition-colors">
      <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 text-primary font-bold">
        {index ?? <Store className="h-5 w-5" />}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2 min-w-0">
          <p className="font-semibold truncate">{store.name}</p>
          {store.visitStatus && store.visitStatus !== "waiting" && (
            <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", VISIT_TONES[store.visitStatus])}>
              {t(`visit.status.${store.visitStatus}`)}
            </span>
          )}
        </div>
        {store.address && (
          <p className="flex items-center gap-1 text-xs text-muted-foreground truncate">
            <MapPin className="h-3 w-3 shrink-0" /> {store.address}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className={cn("font-medium", debt > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
            {t("store.debt")}: {formatMoney(debt, currency)}
          </span>
          {distance && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Navigation className="h-3 w-3" /> {distance}
            </span>
          )}
        </div>
        {footer}
      </div>
      <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
    </Link>
  );
}
