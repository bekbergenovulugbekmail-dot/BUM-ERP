/**
 * Ta'minotchiga qaytarish (`POST /api/purchase/orders/:id/returns`, ruxsat `purchase.return`).
 * Faqat qabul qilingan va hali qaytarilmagan miqdor qaytariladi (server ham tekshiradi). Qaytarish — ombordan chiqim,
 * ta'minotchi qarzi kamayadi; ta'minotchi pul qaytarsa (naqd yoki karta) — kassa/bankka kirim. So'rov kaliti dialog
 * ochilganda bir marta yaratiladi: ikki marta bosish ikkinchi qaytarish yozmaydi.
 */
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation } from "@/lib/query.ts";
import { num, type PurchaseOrderItem } from "../_lib/types.ts";

type Props = {
  orderId: string;
  orderNumber: string;
  items: PurchaseOrderItem[];
  onClose: () => void;
};

const qtyText = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, ""));

export default function PurchaseReturnDialog({ orderId, orderNumber, items, onClose }: Props) {
  const requestId = useRef(crypto.randomUUID());
  const returnable = items
    .map((item) => ({ item, left: num(item.receivedQty) - num(item.returnedQty ?? "0") }))
    .filter((row) => row.left > 0);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [refundMethod, setRefundMethod] = useState<"cash" | "card">("cash");
  const submit = useApiMutation((body: object) => api.post(`/api/purchase/orders/${orderId}/returns`, body), {
    invalidate: ["/api/purchase", "/api/inventory", "/api/finance"],
  });

  const lines = returnable
    .map(({ item, left }) => ({ item, left, qty: Number((quantities[item.id] ?? "").replace(",", ".")) }))
    .filter((line) => line.qty > 0);
  const over = lines.find((line) => line.qty > line.left);
  // AUD-015: qaytgan pul qaytarilayotgan tovar valyutasida (server ham tekshiradi); turli valyuta — pulni alohida kiriting
  const lineCurrencies = [...new Set(lines.map((line) => line.item.currency ?? null))];
  const refundCurrency = lineCurrencies.length === 1 ? lineCurrencies[0] : null;
  const mixedCurrencies = lineCurrencies.length > 1;
  const refund = Number(refundAmount.replace(/\s/g, "").replace(",", ".") || "0");

  const handleSave = async () => {
    if (lines.length === 0) return toast.error("Qaytariladigan miqdorni kiriting");
    if (over) return toast.error(`${over.item.productName}: ko'pi bilan ${qtyText(over.left)}`);
    if (reason.trim().length < 3) return toast.error("Qaytarish sababini yozing");
    if (Number.isNaN(refund) || refund < 0) return toast.error("Qaytgan pul summasi noto'g'ri");
    if (refund > 0 && mixedCurrencies) return toast.error("Turli valyutadagi tovarlar uchun qaytgan pulni har valyuta bo'yicha alohida qaytarishda kiriting");
    try {
      await submit.mutateAsync({
        items: lines.map((line) => ({ orderItemId: line.item.id, quantity: String(line.qty) })),
        reason: reason.trim(),
        ...(refund > 0 ? { refund: { amount: String(refund), method: refundMethod } } : {}),
        requestId: requestId.current,
      });
      toast.success("Ta'minotchiga qaytarildi");
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Ta'minotchiga qaytarish — {orderNumber}</DialogTitle>
          <DialogDescription>Tovar ombordan chiqadi, ta'minotchi qarzi qaytarilgan qiymatga kamayadi.</DialogDescription>
        </DialogHeader>
        {returnable.length === 0 ? (
          <p className="text-sm text-muted-foreground">Qaytariladigan tovar yo'q (hammasi qaytarilgan yoki qabul qilinmagan).</p>
        ) : (
          <div className="space-y-3" data-testid="purchase-return-form">
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {returnable.map(({ item, left }) => (
                <div key={item.id} className="flex items-center gap-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{item.productName}</p>
                    <p className="text-[11px] text-muted-foreground">
                      Qaytarsa bo'ladi: {qtyText(left)} {item.unitName}
                    </p>
                  </div>
                  <Input
                    className="h-8 w-24"
                    inputMode="decimal"
                    placeholder="0"
                    aria-label={`${item.productName} qaytariladigan miqdor`}
                    value={quantities[item.id] ?? ""}
                    onChange={(e) => setQuantities((current) => ({ ...current, [item.id]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
            <div>
              <Label htmlFor="purchase-return-reason">Sabab *</Label>
              <Input id="purchase-return-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Masalan: muddati o'tgan" />
            </div>
            <div className="grid grid-cols-[1fr_auto] items-end gap-2">
              <div>
                <Label htmlFor="purchase-return-refund">
                  Ta'minotchi qaytargan pul{refundCurrency ? ` (${refundCurrency})` : ""} (ixtiyoriy)
                </Label>
                <Input id="purchase-return-refund" inputMode="decimal" placeholder="0" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} />
              </div>
              <select
                aria-label="Qaytgan pul usuli"
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={refundMethod}
                onChange={(e) => setRefundMethod(e.target.value as "cash" | "card")}
              >
                <option value="cash">Naqd</option>
                <option value="card">Karta</option>
              </select>
            </div>
            <p className="text-[11px] text-muted-foreground">Pul qaytarilmasa — summa ta'minotchi qarzidan ayriladi.</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Bekor</Button>
          {returnable.length > 0 && (
            <Button onClick={() => void handleSave()} disabled={submit.isPending} data-testid="purchase-return-save">
              {submit.isPending ? "..." : "Qaytarish"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
