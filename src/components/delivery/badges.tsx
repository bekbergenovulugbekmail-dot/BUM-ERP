import { useTranslation } from "react-i18next";
import { CloudUpload } from "lucide-react";
import type { DeliveryPriority, DeliveryStatus } from "@bum/shared";
import { cn } from "@/lib/utils.ts";
import { PRIORITY_TONE, STATUS_TONE } from "@/lib/delivery/format.ts";
import type { RealtimeStatus } from "@/lib/delivery/realtime.ts";

const PILL = "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold";

export function StatusBadge({ status, className }: { status: DeliveryStatus; className?: string }) {
  const { t } = useTranslation("delivery");
  return <span className={cn(PILL, STATUS_TONE[status], className)}>{t(`status.${status}`)}</span>;
}

/** Oddiy ustuvorlik ko'rsatilmaydi — faqat past, yuqori va shoshilinch. */
export function PriorityBadge({ priority }: { priority: DeliveryPriority }) {
  const { t } = useTranslation("delivery");
  if (priority === "normal") return null;
  return <span className={cn(PILL, PRIORITY_TONE[priority])}>{t(`priority.${priority}`)}</span>;
}

export function LateBadge() {
  const { t } = useTranslation("delivery");
  return <span className={cn(PILL, "bg-red-600 uppercase tracking-wide text-white")}>{t("tasks.late")}</span>;
}

/** Tovar yetkazuvchida qolgan: omborga qabul qilinmaguncha sotuv yakunlangan bo'lib turadi. */
export function ReturnPendingBadge() {
  const { t } = useTranslation("delivery");
  return (
    <span className={cn(PILL, "bg-amber-500/15 text-amber-700 dark:text-amber-400")} title={t("sv.badge.return_pending")}>
      {t("sv.filter.return_pending")}
    </span>
  );
}

/** Amal qurilmada navbatda — server hali tasdiqlamagan. */
export function QueuedBadge() {
  const { t } = useTranslation("delivery");
  return (
    <span className={cn(PILL, "bg-sky-500/15 text-sky-700 dark:text-sky-400")}>
      <CloudUpload className="h-3 w-3" /> {t("queue.badge")}
    </span>
  );
}

/** Real-time ulanish holati: jonli (yashil), ulanmoqda, davriy yangilanish (sariq). `compact` — faqat nuqta. */
export function RealtimeBadge({ status, compact = false }: { status: RealtimeStatus; compact?: boolean }) {
  const { t } = useTranslation("delivery");
  const dot = cn(
    "h-2 w-2 shrink-0 rounded-full",
    status === "live" ? "bg-emerald-500" : status === "connecting" ? "animate-pulse bg-muted-foreground" : "bg-amber-500",
  );
  if (compact) {
    return (
      <span role="img" aria-label={t(`sv.realtime.${status}`)} title={t(`sv.realtime.${status}_hint`)} className="flex h-10 w-6 items-center justify-center">
        <span className={dot} />
      </span>
    );
  }
  return (
    <span
      title={t(`sv.realtime.${status}_hint`)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        status === "live"
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : status === "connecting"
            ? "bg-muted text-muted-foreground"
            : "bg-amber-500/10 text-amber-700 dark:text-amber-400",
      )}
    >
      <span className={dot} />
      {t(`sv.realtime.${status}`)}
    </span>
  );
}
