import { useTranslation } from "react-i18next";
import { MapPin, MapPinOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/lib/utils.ts";
import type { CurrentPosition } from "../_lib/use-current-position.ts";

/** Lokatsiya holati: faol (aniqlik bilan), aniqlanmoqda yoki o'chiq (yoqish tugmasi bilan). */
export default function LocationBanner({ position, onRequest }: { position: CurrentPosition; onRequest: () => void }) {
  const { t } = useTranslation("agent");

  if (position.status === "ready") {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
        <MapPin className="h-4 w-4" />
        <span>{t("location.active")}</span>
        {position.accuracy !== null && (
          <span className="ml-auto text-xs font-normal">{t("location.accuracy", { value: Math.round(position.accuracy) })}</span>
        )}
      </div>
    );
  }

  if (position.status === "locating") {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {t("location.locating")}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl px-3 py-3 space-y-2",
        position.status === "denied" ? "bg-destructive/10 text-destructive" : "bg-amber-500/10 text-amber-700 dark:text-amber-400",
      )}
    >
      <div className="flex items-start gap-2 text-sm font-medium">
        <MapPinOff className="h-4 w-4 mt-0.5 shrink-0" />
        <span>{position.status === "denied" ? t("location.denied") : t("location.unavailable")}</span>
      </div>
      <Button size="sm" variant="secondary" className="h-10 w-full" onClick={onRequest}>
        {t("location.enable")}
      </Button>
    </div>
  );
}
