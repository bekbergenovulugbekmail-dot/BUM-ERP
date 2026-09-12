import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { cn } from "@/lib/utils.ts";
import { todayLocal } from "@/pages/sales/_lib/types.ts";
import type { SupervisorOrder } from "../_lib/types.ts";

type ApprovalFilter = "all" | "pending" | "approved" | "rejected";
const APPROVAL_FILTERS: ApprovalFilter[] = ["pending", "all", "approved", "rejected"];

const APPROVAL_TONES: Record<NonNullable<SupervisorOrder["approvalStatus"]>, string> = {
  pending: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  approved: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  rejected: "bg-destructive/10 text-destructive",
};

/**
 * Agent buyurtmalari (`sales_agent.supervise`): kun bo'yicha yuborilganlar va kredit limitidan oshib tasdiq kutayotganlar —
 * tasdiqlash (qoldiq qayta tekshiriladi) yoki sabab bilan rad etish.
 */
export default function OrdersSection() {
  const { t, i18n } = useTranslation("distribution");
  const [date, setDate] = useState(todayLocal);
  const [approval, setApproval] = useState<ApprovalFilter>("pending");
  const [rejecting, setRejecting] = useState<SupervisorOrder | null>(null);
  const [reason, setReason] = useState("");

  // Tasdiq kutayotganlar — kunidan qat'i nazar
  const orders = useApiQuery<{ orders: SupervisorOrder[] }>(
    "/api/sales-agent/supervisor/orders",
    { approval: approval === "all" ? undefined : approval, date: approval === "pending" ? undefined : date },
    { refetchInterval: 60_000 },
  ).data?.orders;
  const approve = useApiMutation((orderId: string) => api.post(`/api/sales-agent/supervisor/orders/${orderId}/approve`), {
    invalidate: ["/api/sales-agent/supervisor"],
  });
  const reject = useApiMutation(
    (body: { orderId: string; reason: string }) => api.post(`/api/sales-agent/supervisor/orders/${body.orderId}/reject`, { reason: body.reason }),
    { invalidate: ["/api/sales-agent/supervisor"] },
  );

  const amount = useMemo(() => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }), [i18n.language]);

  const handleApprove = async (order: SupervisorOrder) => {
    try {
      await approve.mutateAsync(order.id);
      toast.success(t("orders.approved"));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const handleReject = async () => {
    if (!rejecting) return;
    if (reason.trim().length < 3) {
      toast.error(t("orders.reason_short"));
      return;
    }
    try {
      await reject.mutateAsync({ orderId: rejecting.id, reason: reason.trim() });
      toast.success(t("orders.rejected"));
      setRejecting(null);
      setReason("");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={approval} onValueChange={(value) => setApproval(value as ApprovalFilter)}>
          <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            {APPROVAL_FILTERS.map((value) => (
              <SelectItem key={value} value={value}>
                {value === "all" ? t("orders.approval_all") : t(`orders.approval.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {approval !== "pending" && (
          <Input type="date" className="h-9 w-40" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        )}
      </div>

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        {!orders ? (
          <div className="p-3 space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
        ) : orders.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">{t("orders.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-3 py-2">{t("orders.col.number")}</th>
                  <th className="text-left font-medium px-3 py-2">{t("orders.col.agent")}</th>
                  <th className="text-left font-medium px-3 py-2">{t("orders.col.store")}</th>
                  <th className="text-right font-medium px-3 py-2">{t("orders.col.total")}</th>
                  <th className="text-left font-medium px-3 py-2">{t("orders.col.payment")}</th>
                  <th className="text-left font-medium px-3 py-2">{t("orders.col.delivery")}</th>
                  <th className="text-left font-medium px-3 py-2">{t("orders.col.status")}</th>
                  <th className="text-right font-medium px-3 py-2">{t("orders.col.distance")}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {orders.map((order) => (
                  <tr key={order.id} className="align-top">
                    <td className="px-3 py-2 whitespace-nowrap font-medium">{order.number}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{order.salesRepName}</td>
                    <td className="px-3 py-2 min-w-36">{order.customerName}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap font-semibold">
                      {amount.format(Number(order.totalAmount))} {order.currency}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {t(`orders.payment.${order.paymentType}`)}
                      {order.paymentDueDate && <p className="text-xs text-muted-foreground">{order.paymentDueDate}</p>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{order.deliveryDate ?? "—"}</td>
                    <td className="px-3 py-2 min-w-32">
                      <span>{t(`orders.status.${order.status}`)}</span>
                      {order.approvalStatus && (
                        <span className={cn("ml-1 rounded-full px-2 py-0.5 text-[11px] font-medium", APPROVAL_TONES[order.approvalStatus])}>
                          {t(`orders.approval.${order.approvalStatus}`)}
                        </span>
                      )}
                      {order.rejectionReason && <p className="text-xs text-muted-foreground">{order.rejectionReason}</p>}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap text-muted-foreground">
                      {order.submitDistanceMeters !== null ? `${order.submitDistanceMeters} m` : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {order.approvalStatus === "pending" && order.status === "draft" && (
                        <div className="flex gap-1 justify-end">
                          <Button size="sm" className="h-8" disabled={approve.isPending} onClick={() => void handleApprove(order)}>
                            <Check className="h-4 w-4 mr-1" /> {t("orders.approve")}
                          </Button>
                          <Button size="sm" variant="secondary" className="h-8" onClick={() => setRejecting(order)}>
                            <X className="h-4 w-4 mr-1" /> {t("orders.reject")}
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={rejecting !== null} onOpenChange={(open) => !open && setRejecting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("orders.reject_title")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="reject-reason">
              {t("orders.reject_reason")} · {rejecting?.number}
            </Label>
            <Textarea id="reject-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="secondary" onClick={() => setRejecting(null)}>{t("orders.cancel")}</Button>
            <Button variant="destructive" disabled={reject.isPending} onClick={() => void handleReject()}>
              {t("orders.reject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
