import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import type { LocalCashMovement } from "../../shared/kassa-api.js";
import type { CashMovementKind } from "../../shared/sync-types.js";
import { CASH_KIND_LABELS, decimalInput } from "../format.ts";
import { call, errorText } from "../kassa.ts";

const KINDS: Record<"in" | "out", CashMovementKind[]> = {
  in: ["change_fund", "other_in"],
  out: ["collection", "expense", "other_out"],
};

const HINTS: Record<CashMovementKind, string> = {
  collection: "Naqdni kassadan seyf yoki bankka olish",
  change_fund: "Maydalash uchun kassaga pul qo'yish",
  expense: "Kassadan to'langan xarajat — xarajatlar ro'yxatiga tushadi",
  other_in: "Boshqa sabab bilan kassaga kirim",
  other_out: "Boshqa sabab bilan kassadan chiqim",
};

/** Kassaga kirim yoki chiqim (inkassatsiya, xarajat) — internet bo'lmasa ham yoziladi. */
export default function CashMovementDialog({
  direction,
  canExpense,
  onClose,
  onDone,
}: {
  direction: "in" | "out" | null;
  canExpense: boolean;
  onClose: () => void;
  onDone: (movement: LocalCashMovement) => void;
}) {
  const kinds = direction ? KINDS[direction].filter((kind) => kind !== "expense" || canExpense) : [];
  const [kind, setKind] = useState<CashMovementKind | null>(null);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = kind && kinds.includes(kind) ? kind : (kinds[0] ?? null);

  const close = () => {
    setKind(null);
    setAmount("");
    setCategory("");
    setNotes("");
    setError(null);
    onClose();
  };

  const submit = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const movement = await call("cash:movement", { kind: selected, amount, category: selected === "expense" ? category : null, notes });
      onDone(movement);
      close();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={direction !== null} onOpenChange={(value) => !value && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{direction === "in" ? "Kassaga kirim" : "Kassadan chiqim"}</DialogTitle>
          <DialogDescription>{selected ? HINTS[selected] : ""}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-wrap gap-1">
            {kinds.map((item) => (
              <Button key={item} type="button" size="sm" variant={selected === item ? "default" : "secondary"} onClick={() => setKind(item)}>
                {CASH_KIND_LABELS[item]}
              </Button>
            ))}
          </div>
          <div className="space-y-1">
            <Label htmlFor="movement-amount">Summa</Label>
            <Input id="movement-amount" autoFocus inputMode="decimal" className="h-11 text-right text-lg" value={amount} onChange={(e) => setAmount(decimalInput(e.target.value))} />
          </div>
          {selected === "expense" && (
            <div className="space-y-1">
              <Label htmlFor="movement-category">Kategoriya</Label>
              <Input id="movement-category" placeholder="kassa, transport, kommunal…" maxLength={64} value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="movement-notes">Izoh</Label>
            <Input id="movement-notes" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <Button type="submit" className="h-11 w-full" disabled={busy || !selected || amount === "" || Number(amount) <= 0}>
            Yozish
          </Button>
        </form>
        {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
