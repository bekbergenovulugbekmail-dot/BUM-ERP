import { useTranslation } from "react-i18next";
import { CloudUpload } from "lucide-react";
import type { DeliveryPriority, DeliveryStatus } from "@bum/shared";
import { cn } from "@/lib/utils.ts";
import { PRIORITY_TONE, STATUS_TONE } from "@/lib/delivery/format.ts";

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

/** Amal qurilmada navbatda — server hali tasdiqlamagan. */
export function QueuedBadge() {
  const { t } = useTranslation("delivery");
  return (
    <span className={cn(PILL, "bg-sky-500/15 text-sky-700 dark:text-sky-400")}>
      <CloudUpload className="h-3 w-3" /> {t("queue.badge")}
    </span>
  );
}
