/**
 * MIJOZNING BANK ORQALI TO'LOVI — xodim bank ko'chirmasidan kiritadi.
 *
 * Avval taqsimot KO'RSATILADI (server hisoblaydi): qancha qarzga, qancha avansga (2300). Foydalanuvchi aynan shu
 * taqsimotni tasdiqlaydi — shu orada qarz o'zgargan bo'lsa server 409 qaytaradi va taqsimot yangilanadi. Balans qo'lda
 * o'zgartirilmaydi: server bitta hujjatda to'lov (DR bank / CR debitorlar) va avans (DR bank / CR 2300) yozadi.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Landmark } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { useDebounce } from "@/hooks/use-debounce.ts";

type BankAccount = { id: string; name: string; bankName: string | null; isDefault: boolean };
type Preview = { toDebt: string; toAdvance: string; debtBefore: string; debtAfter: string; advanceBefore: string; advanceAfter: string };

const fmt = (value: string | number) => new Intl.NumberFormat("uz-UZ", { maximumFractionDigits: 2 }).format(Number(value));
const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

export default function BankReceiptDialog({ customer, onClose }: { customer: { id: string; name: string }; onClose: () => void }) {
  const accounts = useApiQuery<{ accounts: BankAccount[] }>("/api/sales/bank-receipts/accounts").data?.accounts;
  const [accountId, setAccountId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(localToday);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Bitta dialog — bitta so'rov kaliti: ikki marta bosish yoki tarmoq qayta urinishi ikkinchi tushum yaratmaydi
  const requestId = useMemo(() => crypto.randomUUID(), []);

  const selected = accountId ?? accounts?.[0]?.id ?? null;
  const value = Number(amount.replace(/\s/g, "").replace(",", "."));
  const valid = Number.isFinite(value) && value > 0;
  const [debounced] = useDebounce(valid ? value.toFixed(2) : "", 300);
  const preview = useApiQuery<Preview>(debounced ? "/api/sales/bank-receipts/preview" : null, { customerId: customer.id, amount: debounced });
  const split = preview.data && debounced === (valid ? value.toFixed(2) : "") ? preview.data : null;

  const save = useApiMutation((body: object) => api.post("/api/sales/bank-receipts", body), {
    invalidate: ["/api/sales/customers", `/api/sales/customers/${customer.id}`, "/api/sales/bank-receipts", "/api/finance/cash-accounts"],
  });

  const submit = async () => {
    setError(null);
    if (!selected) return setError("Bank hisobini tanlang");
    if (!valid || !split) return setError("Summani kiriting");
    try {
      await save.mutateAsync({
        customerId: customer.id,
        cashAccountId: selected,
        amount: value.toFixed(2),
        paymentDate: date,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
        expectedAdvance: split.toAdvance,
        requestId,
      });
      toast.success(
        Number(split.toAdvance) > 0
          ? `Qabul qilindi: qarzga ${fmt(split.toDebt)}, avansga ${fmt(split.toAdvance)} so'm`
          : `Qabul qilindi: qarz ${fmt(split.toDebt)} so'mga kamaydi`,
      );
      onClose();
    } catch (err) {
      await preview.refetch();
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg" data-testid="bank-receipt-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Landmark className="h-4 w-4" /> {customer.name} — bank orqali to'lov</DialogTitle>
          <DialogDescription>
            Pul bank hisobiga tushadi: avval mijoz qarzi yopiladi, ortgani mijozning avansiga (hamyoniga) yoziladi.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Bank hisobi</Label>
              {accounts && accounts.length === 0 ? (
                <p className="text-sm text-destructive">Faol bank hisobi yo'q — Moliya bo'limida oching</p>
              ) : (
                <Select value={selected ?? undefined} onValueChange={setAccountId}>
                  <SelectTrigger data-testid="bank-receipt-account"><SelectValue placeholder="Tanlang" /></SelectTrigger>
                  <SelectContent>
                    {accounts?.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.name}{account.bankName ? ` · ${account.bankName}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div>
              <Label htmlFor="bank-receipt-amount">Summa</Label>
              <Input id="bank-receipt-amount" data-testid="bank-receipt-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" />
            </div>
            <div>
              <Label htmlFor="bank-receipt-date">Sana</Label>
              <Input id="bank-receipt-date" type="date" max={localToday()} value={date} onChange={(event) => setDate(event.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="bank-receipt-reference">To'lov topshirig'i / bank hujjati raqami</Label>
              <Input id="bank-receipt-reference" data-testid="bank-receipt-reference" value={reference} onChange={(event) => setReference(event.target.value)} maxLength={100} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="bank-receipt-notes">Izoh</Label>
              <Textarea id="bank-receipt-notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} />
            </div>
          </div>

          {split && (
            <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3 text-sm" data-testid="bank-receipt-split">
              <div className="flex items-center justify-between">
                <span>Qarzga</span>
                <b className="tabular-nums" data-testid="bank-receipt-to-debt">{fmt(split.toDebt)}</b>
              </div>
              <div className="flex items-center justify-between">
                <span>Avansga (mijoz hamyoni)</span>
                <b className="tabular-nums" data-testid="bank-receipt-to-advance">{fmt(split.toAdvance)}</b>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Qarz</span>
                <span className="inline-flex items-center gap-1 tabular-nums">{fmt(split.debtBefore)} <ArrowRight className="h-3 w-3" /> {fmt(split.debtAfter)}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Avans</span>
                <span className="inline-flex items-center gap-1 tabular-nums">{fmt(split.advanceBefore)} <ArrowRight className="h-3 w-3" /> {fmt(split.advanceAfter)}</span>
              </div>
            </div>
          )}
          {error && <p className="text-sm text-destructive" data-testid="bank-receipt-error">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Bekor</Button>
          <Button data-testid="bank-receipt-confirm" disabled={!split || !selected || save.isPending} onClick={() => void submit()}>
            {split ? `${fmt(value)} so'mni qabul qilish` : "Qabul qilish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
