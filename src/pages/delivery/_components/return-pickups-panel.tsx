/**
 * Dostavchi mijozdan qaytarib olgan tovar — omborda qabul qilinishi kutilmoqda.
 *
 * Qabul qilinganda savdo qaytarish hujjati yoziladi: zaxira omborga qaytadi, mijoz qarzi kamayadi yoki
 * puli tanlangan usulda qaytariladi. Rad etilganda hech qanday pul yoki zaxira harakati bo'lmaydi.
 * Siyosatda "darhol" rejimi yoqilgan bo'lsa bu ro'yxat bo'sh turadi — dostavchining o'zi yakunlaydi.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { usePermissions } from "@/hooks/use-company.ts";
import { api, errorMessage } from "@/lib/api.ts";
import { useLiveInterval } from "@/lib/delivery/realtime.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";

type Money = (value: string | number) => string;

export type ReturnPickup = {
  id: string;
  number: string;
  status: "pending" | "accepted" | "rejected";
  orderNumber: string;
  customerName: string;
  agentName: string | null;
  reason: string | null;
  refundMethod: string;
  amount: string;
  createdAt: string;
  items: { orderItemId: string; productName: string; unitName: string; quantity: string; unitPrice: string }[];
};

const REFUND_METHODS = ["balance", "cash", "card", "bank"] as const;

export default function ReturnPickupsPanel({ money }: { money: Money }) {
  const { t } = useTranslation("delivery");
  const { can } = usePermissions();
  const interval = useLiveInterval(60_000);
  const query = useApiQuery<{ pickups: ReturnPickup[] }>(
    can("delivery.return") ? "/api/delivery/returns/pickups" : null,
    { status: "pending", limit: 200 },
    { refetchInterval: interval },
  );
  const [open, setOpen] = useState<ReturnPickup | null>(null);

  if (!can("delivery.return")) return null;
  const pickups = query.data?.pickups;

  return (
    <section className="space-y-2 rounded-2xl border border-border bg-card p-4" data-testid="return-pickups">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <PackageCheck className="h-4 w-4 text-emerald-600" /> {t("sv.pickups.title")}
        {pickups && <span className="ml-auto text-xs font-normal text-muted-foreground tabular-nums">{pickups.length}</span>}
      </p>
      {!pickups ? (
        <Skeleton className="h-24 rounded-xl" />
      ) : pickups.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">{t("sv.pickups.empty")}</p>
      ) : (
        <ul className="max-h-[480px] divide-y divide-border overflow-y-auto">
          {pickups.map((pickup) => (
            <li key={pickup.id}>
              <button type="button" className="flex w-full items-center gap-3 py-2 text-left text-sm hover:bg-accent/40" onClick={() => setOpen(pickup)}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {pickup.number} · {pickup.customerName}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {pickup.orderNumber} · {pickup.agentName ?? "—"} · {t("sv.pickups.lines", { count: pickup.items.length })}
                  </p>
                </div>
                <span className="shrink-0 font-semibold tabular-nums">{money(pickup.amount)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && <DecisionDialog pickup={open} money={money} onClose={() => setOpen(null)} />}
    </section>
  );
}

function DecisionDialog({ pickup, money, onClose }: { pickup: ReturnPickup; money: Money; onClose: () => void }) {
  const { t } = useTranslation("delivery");
  const [refundMethod, setRefundMethod] = useState(pickup.refundMethod);
  const [note, setNote] = useState("");
  const accept = useApiMutation(
    () => api.post(`/api/delivery/returns/pickups/${pickup.id}/accept`, { refundMethod, note: note.trim() || undefined }),
    { invalidate: ["/api/delivery", "/api/inventory", "/api/sales"] },
  );
  const reject = useApiMutation(() => api.post(`/api/delivery/returns/pickups/${pickup.id}/reject`, { note: note.trim() }), {
    invalidate: ["/api/delivery"],
  });
  const busy = accept.isPending || reject.isPending;

  const run = async (action: "accept" | "reject") => {
    try {
      if (action === "reject" && note.trim().length < 3) {
        toast.error(t("sv.pickups.note_required"));
        return;
      }
      await (action === "accept" ? accept : reject).mutateAsync();
      toast.success(action === "accept" ? t("sv.pickups.accepted") : t("sv.pickups.rejected"));
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open onOpenChange={(value) => !value && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {pickup.number} · {pickup.customerName}
          </DialogTitle>
          <DialogDescription>
            {t("sv.pickups.from_order", { number: pickup.orderNumber })}
            {pickup.reason ? ` · ${pickup.reason}` : ""}
          </DialogDescription>
        </DialogHeader>

        <ul className="divide-y divide-border rounded-xl border border-border">
          {pickup.items.map((item) => (
            <li key={item.orderItemId} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 truncate">{item.productName}</span>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {Number(item.quantity)} {item.unitName} × {money(item.unitPrice)}
              </span>
            </li>
          ))}
        </ul>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="pickup-refund">{t("sv.pickups.refund_method")}</Label>
            <Select value={refundMethod} onValueChange={setRefundMethod}>
              <SelectTrigger id="pickup-refund">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REFUND_METHODS.map((method) => (
                  <SelectItem key={method} value={method}>
                    {t(`method.${method}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="pickup-note">{t("sv.pickups.note")}</Label>
            <Textarea id="pickup-note" rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => void run("reject")}>
            {t("sv.pickups.reject")}
          </Button>
          <Button disabled={busy} data-testid="pickup-accept" onClick={() => void run("accept")}>
            {t("sv.pickups.accept")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
