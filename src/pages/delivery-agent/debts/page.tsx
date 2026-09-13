import { Link, Navigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertTriangle, HandCoins, Phone, Wallet } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { formatTime } from "@/lib/delivery/format.ts";
import { useLiveInterval } from "@/lib/delivery/realtime.ts";
import { num, type AgentDebts } from "@/lib/delivery/types.ts";
import { useApiQuery } from "@/lib/query.ts";
import { useDeliveryAgent } from "../_lib/context.ts";

/**
 * Qarz va to'lovlar (`delivery.view_debt`): bugun yig'ilgan pul, to'lov farqi qolgan yetkazmalar va qarzdor mijozlar —
 * faqat agentning o'z yetkazmalaridagi mijozlar. Nasiya berish yoki qarzni tasdiqlash agentda yo'q.
 */
export default function DeliveryDebtsPage() {
  const { t, i18n } = useTranslation("delivery");
  const { lng = "uz" } = useParams<{ lng: string }>();
  const { can, money } = useDeliveryAgent();
  const allowed = can("delivery.view_debt");
  const interval = useLiveInterval(120_000);
  const data = useApiQuery<AgentDebts>(allowed ? "/api/delivery/agent/debts" : null, undefined, { refetchInterval: interval }).data;

  if (!allowed) return <Navigate to={`/${lng}/delivery-agent/dashboard`} replace />;

  const collectedToday = data?.collections.reduce((sum, item) => sum + num(item.amount), 0) ?? 0;

  return (
    <div className="space-y-4 p-4">
      <h1 className="text-xl font-bold">{t("debts.title")}</h1>
      {!data ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          <section className="space-y-2 rounded-2xl border border-border bg-card p-4">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <HandCoins className="h-4 w-4" /> {t("debts.collections")}
            </p>
            <p className="text-2xl font-bold tabular-nums">{money(collectedToday)}</p>
            {data.collections.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("debts.empty_collections")}</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {data.collections.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-2 py-2">
                    <Link to={`/${lng}/delivery-agent/tasks/${item.taskId}`} className="min-w-0">
                      <p className="truncate font-medium">{item.customerName}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatTime(item.collectedAt, i18n.language)} · {item.number} · {t(`method.${item.method}`)}
                      </p>
                    </Link>
                    <span className="shrink-0 font-semibold tabular-nums">{money(item.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-2 rounded-2xl border border-border bg-card p-4">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle className="h-4 w-4 text-amber-600" /> {t("debts.shortfalls")}
            </p>
            {data.shortfalls.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("debts.empty_shortfalls")}</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {data.shortfalls.map((task) => (
                  <li key={task.id}>
                    <Link to={`/${lng}/delivery-agent/tasks/${task.id}`} className="flex items-center justify-between gap-2 py-2">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{task.customerName}</span>
                        <span className="text-xs text-muted-foreground">
                          {task.number} · {t(`payment_status.${task.paymentStatus}`)}
                          {task.paymentReview !== "none" ? ` · ${t(`review.${task.paymentReview}`)}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 font-semibold text-amber-700 tabular-nums dark:text-amber-400">{money(task.mismatchAmount)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-2 rounded-2xl border border-border bg-card p-4">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Wallet className="h-4 w-4" /> {t("debts.debtors")}
            </p>
            {data.debtors.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("debts.empty_debtors")}</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {data.debtors.map((debtor) => (
                  <li key={debtor.id} className="flex items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{debtor.name}</p>
                      {debtor.address && <p className="truncate text-xs text-muted-foreground">{debtor.address}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="font-semibold tabular-nums">{money(debtor.totalDebt)}</span>
                      {debtor.phone && (
                        <a href={`tel:${debtor.phone}`} aria-label={t("task.call")} className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
                          <Phone className="h-4 w-4" />
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
