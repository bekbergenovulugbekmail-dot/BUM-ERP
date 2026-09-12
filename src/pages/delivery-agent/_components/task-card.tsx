import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Clock, MapPin } from "lucide-react";
import type { DeliveryStatus } from "@bum/shared";
import { LateBadge, PriorityBadge, QueuedBadge, StatusBadge } from "@/components/delivery/badges.tsx";
import { formatDistance, timeWindow } from "@/lib/delivery/format.ts";
import type { DeliveryTaskRow } from "@/lib/delivery/types.ts";

type Props = {
  task: DeliveryTaskRow;
  money: (value: string | number) => string;
  /** Navbatdagi amallar bilan ko'rinadigan holat. */
  status?: DeliveryStatus;
  queued?: boolean;
  distanceMeters?: number | null;
};

/** Yetkazma kartasi: mijoz, buyurtma №, summa, sana va vaqt oynasi, to'lov turi, masofa, ustuvorlik, holat. */
export default function TaskCard({ task, money, status, queued, distanceMeters }: Props) {
  const { t } = useTranslation("delivery");
  const { lng = "uz" } = useParams<{ lng: string }>();
  const distance = formatDistance(distanceMeters);
  const slot = timeWindow(task.windowStart, task.windowEnd);
  return (
    <Link
      to={`/${lng}/delivery-agent/tasks/${task.id}`}
      className="block space-y-3 rounded-2xl border border-border bg-card p-4 transition-colors active:bg-accent"
    >
      <div className="flex items-start gap-3">
        {task.routeOrder !== null && (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-base font-bold tabular-nums text-primary">
            {task.routeOrder}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">{task.customerName}</p>
          {task.customerAddress && (
            <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
              <MapPin className="h-3 w-3 shrink-0" /> <span className="truncate">{task.customerAddress}</span>
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusBadge status={status ?? task.status} />
          {queued && <QueuedBadge />}
        </div>
      </div>

      {(task.overdue || task.priority !== "normal") && (
        <div className="flex flex-wrap gap-1.5">
          {task.overdue && <LateBadge />}
          <PriorityBadge priority={task.priority} />
        </div>
      )}

      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0 text-xs text-muted-foreground">
          <p>
            {t("task.order")} <span className="font-medium text-foreground">{task.orderNumber}</span>
          </p>
          <p className="flex items-center gap-1">
            <Clock className="h-3 w-3" /> {task.scheduledDate}
            {slot ? ` · ${slot}` : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold tabular-nums">{money(task.expectedAmount)}</p>
          <p className="text-xs text-muted-foreground">
            {t(`payment_type.${task.paymentType}`)}
            {distance ? ` · ${distance}` : ""}
          </p>
        </div>
      </div>
    </Link>
  );
}
