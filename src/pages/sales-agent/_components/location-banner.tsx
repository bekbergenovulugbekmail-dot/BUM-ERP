import { useTranslation } from "react-i18next";
import { MapPin, MapPinOff, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/lib/utils.ts";
import type { AgentLocation } from "../_lib/use-location-tracking.ts";

const REJECTION_REASONS = new Set(["low_accuracy", "stale", "invalid"]);

/** Lokatsiya holati: faol (aniqlik bilan), aniqlanmoqda, server rad etgan (sabab bilan) yoki o'chiq (yoqish tugmasi). */
export default function LocationBanner({ location }: { location: AgentLocation }) {
  const { t } = useTranslation("agent");

  if (location.status === "active") {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
        <MapPin className="h-4 w-4" />
        <span>{t("location.active")}</span>
        {location.accuracy !== null && (
          <span className="ml-auto text-xs font-normal">{t("location.accuracy", { value: Math.round(location.accuracy) })}</span>
        )}
      </div>
    );
  }

  if (location.status === "locating") {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {t("location.locating")}
      </div>
    );
  }

  if (location.status === "rejected") {
    return (
      <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-700 dark:text-amber-400">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          {location.reason && REJECTION_REASONS.has(location.reason)
            ? t(`location.rejected.${location.reason}`)
            : (location.message ?? t("location.unavailable"))}
        </span>
        {location.accuracy !== null && (
          <span className="ml-auto text-xs font-normal whitespace-nowrap">
            {t("location.accuracy", { value: Math.round(location.accuracy) })}
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl px-3 py-3 space-y-2",
        location.status === "denied" ? "bg-destructive/10 text-destructive" : "bg-amber-500/10 text-amber-700 dark:text-amber-400",
      )}
    >
      <div className="flex items-start gap-2 text-sm font-medium">
        <MapPinOff className="h-4 w-4 mt-0.5 shrink-0" />
        <span>{location.status === "denied" ? t("location.denied") : t("location.unavailable")}</span>
      </div>
      <Button size="sm" variant="secondary" className="h-10 w-full" onClick={location.request}>
        {t("location.enable")}
      </Button>
    </div>
  );
}
