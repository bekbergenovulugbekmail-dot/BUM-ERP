/**
 * Mijozdan tovarni qaytarib olish (dostavchi).
 *
 * Mijozning oldingi xaridlari chek bo'yicha ko'rsatiladi: QACHON olgani va QANDAY narxda — dostavchi
 * kerakli qatorlarni belgilab, miqdorini kiritadi. Yuborilgandan keyin siyosatga qarab so'rov
 * supervayzer qabulini kutadi yoki darhol rasmiylashtiriladi (javobdagi holat shuni ko'rsatadi).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2, Minus, PackageCheck, Plus } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { cn } from "@/lib/utils.ts";
import { useDeliveryAgent } from "../_lib/context.ts";

type PurchaseLine = {
  orderItemId: string;
  productName: string;
  sku: string | null;
  unitName: string;
  quantity: string;
  unitPrice: string;
  returnableQty: string;
  pendingQty: string;
};

type PurchaseOrder = {
  id: string;
  number: string;
  orderDate: string;
  items: PurchaseLine[];
};

const QTY_RE = /^\d+([.,]\d{1,4})?$/;
const num = (value: string) => Number(value.replace(",", ".")) || 0;

export default function ReturnPickupDialog({
  customerId,
  customerName,
  taskId,
  onClose,
}: {
  customerId: string;
  customerName: string;
  taskId?: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation("delivery");
  const { money } = useDeliveryAgent();
  const query = useApiQuery<{ orders: PurchaseOrder[] }>(`/api/delivery/agent/customers/${customerId}/purchases`);
  const create = useApiMutation(
    (body: object) => api.post<{ pickup: { status: string; number: string } }>("/api/delivery/agent/returns", body),
    { invalidate: ["/api/delivery/agent"] },
  );

  /** Tanlangan qatorlar: orderItemId → miqdor (matn). */
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [orderId, setOrderId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const orders = query.data?.orders ?? [];
  const lineById = new Map(orders.flatMap((order) => order.items.map((item) => [item.orderItemId, { item, order }] as const)));

  const toggle = (line: PurchaseLine, order: PurchaseOrder) => {
    setPicked((current) => {
      if (current[line.orderItemId] !== undefined) {
        const { [line.orderItemId]: _removed, ...rest } = current;
        if (Object.keys(rest).length === 0) setOrderId(null);
        return rest;
      }
      // Bitta so'rov — bitta chek: boshqa chek tanlansa avvalgilari almashtiriladi
      if (orderId && orderId !== order.id) {
        setOrderId(order.id);
        return { [line.orderItemId]: line.returnableQty };
      }
      setOrderId(order.id);
      return { ...current, [line.orderItemId]: line.returnableQty };
    });
  };

  const setQty = (orderItemId: string, value: string) => setPicked((current) => ({ ...current, [orderItemId]: value }));
  const step = (orderItemId: string, max: number, delta: number) => {
    const current = num(picked[orderItemId] ?? "0");
    setQty(orderItemId, String(Math.min(max, Math.max(0, Math.round((current + delta) * 10_000) / 10_000))));
  };

  const entries = Object.entries(picked);
  const invalid = entries.some(([id, raw]) => {
    const line = lineById.get(id)?.item;
    return !line || !QTY_RE.test(raw.trim()) || num(raw) <= 0 || num(raw) > num(line.returnableQty);
  });
  const total = entries.reduce((sum, [id, raw]) => {
    const line = lineById.get(id)?.item;
    return line ? sum + num(raw) * num(line.unitPrice) : sum;
  }, 0);

  const submit = async () => {
    if (entries.length === 0 || !orderId) return;
    try {
      const result = await create.mutateAsync({
        customerId,
        orderId,
        items: entries.map(([orderItemId, quantity]) => ({ orderItemId, quantity: quantity.replace(",", ".") })),
        reason: reason.trim() || undefined,
        refundMethod: "balance",
        taskId: taskId ?? undefined,
      });
      toast.success(result.pickup.status === "accepted" ? t("return_pickup.done") : t("return_pickup.pending"));
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !create.isPending && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageCheck className="h-5 w-5 text-primary" /> {t("return_pickup.title")}
          </DialogTitle>
          <DialogDescription>{t("return_pickup.hint", { name: customerName })}</DialogDescription>
        </DialogHeader>

        {query.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
          </div>
        ) : orders.length === 0 ? (
          <p className="rounded-xl bg-muted/50 px-3 py-6 text-center text-sm text-muted-foreground">{t("return_pickup.empty")}</p>
        ) : (
          <div className="space-y-4">
            {orders.map((order) => (
              <div key={order.id} className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {order.number} · {order.orderDate}
                </p>
                <ul className="space-y-2">
                  {order.items.map((line) => {
                    const chosen = picked[line.orderItemId];
                    const max = num(line.returnableQty);
                    return (
                      <li
                        key={line.orderItemId}
                        className={cn("rounded-xl border p-3", chosen !== undefined ? "border-primary bg-primary/5" : "border-border")}
                      >
                        <button type="button" className="flex w-full items-start justify-between gap-2 text-left" onClick={() => toggle(line, order)}>
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{line.productName}</p>
                            {/* Firmadan qanday narxda olgani va qancha qaytarish mumkinligi */}
                            <p className="text-xs text-muted-foreground">
                              {money(line.unitPrice)} · {t("return_pickup.returnable", { qty: max, unit: line.unitName })}
                            </p>
                            {num(line.pendingQty) > 0 && (
                              <p className="text-[11px] text-amber-700 dark:text-amber-400">
                                {t("return_pickup.pending_qty", { qty: num(line.pendingQty) })}
                              </p>
                            )}
                          </div>
                          <span className="shrink-0 text-xs text-muted-foreground">{t("return_pickup.bought", { qty: num(line.quantity) })}</span>
                        </button>
                        {chosen !== undefined && (
                          <div className="mt-2 flex items-center gap-2">
                            <Button type="button" variant="secondary" size="icon" className="h-11 w-11" onClick={() => step(line.orderItemId, max, -1)}>
                              <Minus className="h-5 w-5" />
                            </Button>
                            <Input
                              aria-label={t("return_pickup.qty")}
                              inputMode="decimal"
                              className="h-11 text-center text-lg font-semibold tabular-nums"
                              value={chosen}
                              onChange={(event) => setQty(line.orderItemId, event.target.value)}
                            />
                            <Button type="button" variant="secondary" size="icon" className="h-11 w-11" onClick={() => step(line.orderItemId, max, 1)}>
                              <Plus className="h-5 w-5" />
                            </Button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}

            <div className="space-y-1">
              <Label htmlFor="return-reason">{t("return_pickup.reason")}</Label>
              <Textarea
                id="return-reason"
                rows={2}
                value={reason}
                placeholder={t("return_pickup.reason_placeholder")}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>

            {entries.length > 0 && (
              <div className="flex justify-between rounded-xl bg-muted/50 px-3 py-2 text-sm">
                <span className="text-muted-foreground">{t("return_pickup.total")}</span>
                <span className="font-semibold tabular-nums">{money(String(total))}</span>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="secondary" className="h-12" disabled={create.isPending} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button className="h-12" disabled={entries.length === 0 || invalid || create.isPending} onClick={() => void submit()}>
            {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("return_pickup.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
