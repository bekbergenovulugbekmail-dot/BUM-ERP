/**
 * Balansni to'g'rilash oynasi (mijoz balansi/qarzi/keshbegi, ta'minotchi qarzi, kassa qoldig'i).
 *
 * Joriy qiymatlar oldindan to'ldiriladi — foydalanuvchi to'g'ri qiymatni yozadi, faqat o'zgargan maydonlar
 * yuboriladi. Sabab majburiy: server uni jurnal yozuvi va audit qatoriga yozadi. Farqning o'zi buxgalteriyada
 * "Boshqa daromadlar" yoki "Boshqa xarajatlar" bo'lib yopiladi.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { Skeleton } from "@/components/ui/skeleton.tsx";

export type BalanceField = {
  /** So'rov tanasidagi kalit (masalan `balance`, `totalDebt`, `cashback`). */
  key: string;
  label: string;
  /** Joriy qiymat — "12500.00" ko'rinishidagi satr. */
  current: string;
  hint?: string;
};

/** Balans harakati — `GET .../balance` qaytaradigan qator. */
type BalanceTx = {
  id: string;
  type: "deposit" | "change" | "sale_payment" | "refund" | "adjustment";
  amount: string;
  balanceAfter: string;
  notes: string | null;
  orderNumber: string | null;
  createdAt: string;
};

const TX_LABELS: Record<BalanceTx["type"], string> = {
  deposit: "To'ldirish",
  change: "Chek qaytimi",
  sale_payment: "Savdoga to'lov",
  refund: "Qaytarish",
  adjustment: "Qo'lda to'g'rilash",
};

const moneyText = (value: string | number) => new Intl.NumberFormat("uz-UZ").format(Number(value));

/**
 * Balans TARIXI — nima uchun shunday raqam chiqqani shu yerda ko'rinadi.
 * Tuzatishdan oldin tarixni ko'rish kerak, shuning uchun u aynan shu oynada.
 */
function BalanceHistory({ url }: { url: string }) {
  const query = useApiQuery<{ transactions: BalanceTx[] }>(url, { limit: 20 });
  const rows = query.data?.transactions;

  if (query.isError) return <p className="text-xs text-destructive">{errorMessage(query.error)}</p>;
  if (rows === undefined) {
    return (
      <div className="space-y-1.5">
        {Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-7 w-full" />)}
      </div>
    );
  }
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">Harakat yo'q</p>;

  return (
    <div className="max-h-56 overflow-auto rounded-lg border border-border divide-y divide-border">
      {rows.map((row) => {
        const amount = Number(row.amount);
        return (
          <div key={row.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
            <div className="min-w-0">
              <p className="font-medium">
                {TX_LABELS[row.type]}
                {row.orderNumber ? ` · ${row.orderNumber}` : ""}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {new Date(row.createdAt).toLocaleString("uz-UZ")}
                {row.notes ? ` · ${row.notes}` : ""}
              </p>
            </div>
            <div className="shrink-0 text-right tabular-nums">
              <p className={amount < 0 ? "font-semibold text-destructive" : "font-semibold text-emerald-600"}>
                {amount > 0 ? "+" : ""}{moneyText(amount)}
              </p>
              <p className="text-[11px] text-muted-foreground">Qoldiq: {moneyText(row.balanceAfter)}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// JS `\s` bo'linmas probelni (NBSP) ham qamrab oladi — "12 500,50" kabi kiritish ham o'qiladi
const numeric = (value: string) => Number(value.trim().replace(/\s/g, "").replace(",", ".") || "0");

export default function SetBalanceDialog({
  title,
  description,
  fields,
  endpoint,
  historyUrl,
  invalidate,
  onClose,
}: {
  title: string;
  description?: string;
  fields: BalanceField[];
  /** To'liq yo'l, masalan `/api/sales/customers/<id>/balance-adjust`. */
  endpoint: string;
  /** Balans harakatlari tarixi (`GET`) — berilsa oynada ko'rsatiladi. */
  historyUrl?: string;
  invalidate: string[];
  onClose: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((field) => [field.key, String(Number(field.current))])),
  );
  const [reason, setReason] = useState("");
  const save = useApiMutation((body: Record<string, string>) => api.post(endpoint, body), { invalidate });

  // Faqat o'zgargan maydonlar yuboriladi — tegilmagan balans qayta yozilmasin
  const changed = fields.filter((field) => numeric(values[field.key] ?? "") !== Number(field.current));
  const invalid = fields.some((field) => {
    const raw = (values[field.key] ?? "").trim();
    return raw === "" || Number.isNaN(numeric(raw)) || numeric(raw) < 0;
  });

  const handleSave = async () => {
    if (invalid) { toast.error("Qiymat manfiy bo'lmagan son bo'lishi kerak"); return; }
    if (changed.length === 0) { toast.error("O'zgargan qiymat yo'q"); return; }
    if (reason.trim().length < 3) { toast.error("To'g'rilash sababini yozing"); return; }
    try {
      await save.mutateAsync({
        ...Object.fromEntries(changed.map((field) => [field.key, String(numeric(values[field.key] ?? ""))])),
        reason: reason.trim(),
      });
      toast.success("Balans to'g'rilandi");
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
          {fields.map((field) => (
            <div key={field.key}>
              <Label htmlFor={`set-balance-${field.key}`}>{field.label}</Label>
              <Input
                id={`set-balance-${field.key}`}
                inputMode="decimal"
                value={values[field.key] ?? ""}
                onChange={(e) => setValues((current) => ({ ...current, [field.key]: e.target.value }))}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Hozir: {new Intl.NumberFormat("uz-UZ").format(Number(field.current))}
                {field.hint ? ` · ${field.hint}` : ""}
              </p>
            </div>
          ))}
          <div>
            <Label htmlFor="set-balance-reason">Sabab *</Label>
            <Input
              id="set-balance-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Masalan: inventarizatsiya farqi"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">Sabab jurnal yozuvi va audit tarixida saqlanadi</p>
          </div>
          {historyUrl && (
            <div>
              <p className="mb-1 text-xs font-medium">Balans tarixi</p>
              <BalanceHistory url={historyUrl} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Bekor</Button>
          <Button onClick={handleSave} disabled={save.isPending || changed.length === 0}>
            {save.isPending ? "..." : "To'g'rilash"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
