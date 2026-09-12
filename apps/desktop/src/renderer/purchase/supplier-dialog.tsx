import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import type { PosSupplier } from "../../shared/kassa-api.js";
import { fmtMoney, num } from "../format.ts";
import { call, errorText } from "../kassa.ts";

/** Ta'minotchi tanlash (nom, telefon, kod) yoki yangi ta'minotchi — internet bo'lmasa ham. */
export default function SupplierDialog({
  open,
  baseCurrency,
  onClose,
  onSelect,
}: {
  open: boolean;
  baseCurrency: string;
  onClose: () => void;
  onSelect: (supplier: PosSupplier) => void;
}) {
  const [query, setQuery] = useState("");
  const [list, setList] = useState<PosSupplier[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      call("purchase:suppliers", { query }).then(setList, (err: unknown) => setError(errorText(err)));
    }, 150);
    return () => clearTimeout(timer);
  }, [open, query]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const supplier = await call("purchase:supplier-create", { name, phone: phone.trim() || null });
      setCreating(false);
      setName("");
      setPhone("");
      onSelect(supplier);
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
          <DialogTitle>{creating ? "Yangi ta'minotchi" : "Ta'minotchi tanlash"}</DialogTitle>
          <DialogDescription>{creating ? "Sinxronda serverga yoziladi (kod avtomatik)." : "Nom, telefon yoki kod bo'yicha qidiring."}</DialogDescription>
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
              <Label htmlFor="new-supplier-name">Nomi</Label>
              <Input id="new-supplier-name" autoFocus maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-supplier-phone">Telefon</Label>
              <Input id="new-supplier-phone" inputMode="tel" maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} />
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
              <Input id="supplier-search" autoFocus placeholder="Qidirish…" value={query} onChange={(e) => setQuery(e.target.value)} />
              <Button variant="secondary" onClick={() => setCreating(true)}>
                + Yangi
              </Button>
            </div>
            <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {list.map((supplier) => (
                <li key={supplier.id}>
                  <button type="button" className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted" onClick={() => onSelect(supplier)}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {supplier.name}
                        {supplier.pending && <span className="ml-2 text-xs text-amber-600">sinxron kutilmoqda</span>}
                      </span>
                      <span className="text-xs text-muted-foreground">{[supplier.phone, supplier.code].filter(Boolean).join(" · ")}</span>
                    </span>
                    {num(supplier.totalDebt) !== 0 && (
                      <span className={`text-right text-xs tabular-nums ${num(supplier.totalDebt) > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                        {num(supplier.totalDebt) > 0 ? "qarzimiz" : "avans"} {fmtMoney(Math.abs(num(supplier.totalDebt)), baseCurrency)}
                      </span>
                    )}
                  </button>
                </li>
              ))}
              {list.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">Ta'minotchi topilmadi</li>}
            </ul>
          </div>
        )}
        {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
