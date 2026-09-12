import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import type { PosCustomer } from "../../shared/kassa-api.js";
import { fmtMoney, num } from "../format.ts";
import { call, errorText } from "../kassa.ts";

/** Mijoz tanlash (ism, telefon, kod bo'yicha) yoki kassada yangi mijoz (offline ham). */
export default function CustomerDialog({
  open,
  baseCurrency,
  onClose,
  onSelect,
}: {
  open: boolean;
  baseCurrency: string;
  onClose: () => void;
  onSelect: (customer: PosCustomer) => void;
}) {
  const [query, setQuery] = useState("");
  const [list, setList] = useState<PosCustomer[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      call("pos:customers", { query }).then(setList, (err: unknown) => setError(errorText(err)));
    }, 150);
    return () => clearTimeout(timer);
  }, [open, query]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const customer = await call("pos:customer-create", { name, phone: phone.trim() || null });
      setCreating(false);
      setName("");
      setPhone("");
      onSelect(customer);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{creating ? "Yangi mijoz" : "Mijoz tanlash"}</DialogTitle>
          <DialogDescription>{creating ? "Internet bo'lmasa ham qo'shiladi — sinxronda serverga yoziladi." : "Ism, telefon yoki kod bo'yicha qidiring."}</DialogDescription>
        </DialogHeader>

        {creating ? (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="new-customer-name">Ism</Label>
              <Input id="new-customer-name" autoFocus value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-customer-phone">Telefon</Label>
              <Input id="new-customer-phone" inputMode="tel" value={phone} maxLength={20} placeholder="+998 90 123 45 67" onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
                Orqaga
              </Button>
              <Button type="submit" disabled={busy || name.trim() === ""}>
                Qo'shish
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input id="customer-search" autoFocus placeholder="Qidirish…" value={query} onChange={(e) => setQuery(e.target.value)} />
              <Button variant="secondary" onClick={() => setCreating(true)}>
                + Yangi
              </Button>
            </div>
            <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {list.map((customer) => (
                <li key={customer.id}>
                  <button type="button" className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted" onClick={() => onSelect(customer)}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {customer.name}
                        {customer.pending && <span className="ml-2 text-xs text-amber-600">sinxron kutilmoqda</span>}
                      </span>
                      <span className="text-xs text-muted-foreground">{[customer.phone, customer.code].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className="text-right text-xs tabular-nums">
                      {num(customer.totalDebt) > 0 && <span className="block text-amber-600">qarz {fmtMoney(customer.totalDebt, baseCurrency)}</span>}
                      {num(customer.balance) > 0 && <span className="block text-emerald-600">balans {fmtMoney(customer.balance, baseCurrency)}</span>}
                    </span>
                  </button>
                </li>
              ))}
              {list.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">Mijoz topilmadi</li>}
            </ul>
          </div>
        )}
        {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
