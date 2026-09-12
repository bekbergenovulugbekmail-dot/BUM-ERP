import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import type { HeldReceipt } from "../../shared/kassa-api.js";
import { fmtMoney, fmtTime } from "../format.ts";
import { call, errorText } from "../kassa.ts";

/** Kechiktirilgan cheklar (F5 — kechiktirish, F6 — ro'yxat): ochish savatga qaytaradi. */
export default function HeldDialog({
  open,
  baseCurrency,
  cartEmpty,
  onClose,
  onTake,
}: {
  open: boolean;
  baseCurrency: string;
  cartEmpty: boolean;
  onClose: () => void;
  onTake: (held: HeldReceipt) => void;
}) {
  const [list, setList] = useState<HeldReceipt[]>([]);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    call("pos:held").then(setList, (err: unknown) => setError(errorText(err)));
  }, [open, version]);

  const take = async (id: string) => {
    setError(null);
    try {
      onTake(await call("pos:held-take", { id }));
    } catch (err) {
      setError(errorText(err));
    }
  };

  const remove = async (id: string) => {
    setError(null);
    try {
      await call("pos:held-delete", { id });
      setVersion((value) => value + 1);
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Kechiktirilgan cheklar</DialogTitle>
          <DialogDescription>{cartEmpty ? "Chekni ochib, sotuvni davom ettiring." : "Avval joriy savatni yakunlang yoki kechiktiring (F5)."}</DialogDescription>
        </DialogHeader>
        <ul className="max-h-96 divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {list.map((held) => (
            <li key={held.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{held.label}</p>
                <p className="text-xs text-muted-foreground">
                  {fmtTime(held.createdAt)} · {held.cart.lines.length} qator
                </p>
              </div>
              <span className="tabular-nums">{fmtMoney(held.total, baseCurrency)}</span>
              <Button size="sm" disabled={!cartEmpty} onClick={() => void take(held.id)}>
                Ochish
              </Button>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void remove(held.id)}>
                O'chirish
              </Button>
            </li>
          ))}
          {list.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted-foreground">Kechiktirilgan chek yo'q</li>}
        </ul>
        {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
