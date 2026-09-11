import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Store, MapPin, Navigation, ChevronRight } from "lucide-react";
import { formatMoney } from "@/hooks/use-currencies.ts";
import { cn } from "@/lib/utils.ts";
import { formatDistance, num, type AgentStore } from "../_lib/types.ts";

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
        <p className="font-semibold truncate">{store.name}</p>
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
