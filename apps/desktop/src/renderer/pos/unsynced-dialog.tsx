import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import type { AppStatus, UnsyncedOperation } from "../../shared/kassa-api.js";
import { OP_LABELS, fmtMoney, fmtTime } from "../format.ts";
import { call, errorText } from "../kassa.ts";

/**
 * Sinxron bo'lmagan cheklar: navbatdagilar (internet bo'lganda o'zi ketadi) va server rad etganlar — qayta yuborish
 * yoki (rahbar, `sales.approve`) bekor qilish.
 */
export default function UnsyncedDialog({
  open,
  baseCurrency,
  canDiscard,
  onClose,
  onStatus,
}: {
  open: boolean;
  baseCurrency: string;
  canDiscard: boolean;
  onClose: () => void;
  onStatus: (status: AppStatus) => void;
}) {
  const [ops, setOps] = useState<UnsyncedOperation[]>([]);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    call("sync:unsynced").then(setOps, (err: unknown) => setError(errorText(err)));
  }, [open, version]);

  const run = async (action: () => Promise<AppStatus>) => {
    setBusy(true);
    setError(null);
    try {
      onStatus(await action());
      setVersion((value) => value + 1);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Sinxron bo'lmagan cheklar</DialogTitle>
          <DialogDescription>Internet bo'lganda navbat avtomatik yuboriladi. Rad etilganini tuzatib qayta yuboring.</DialogDescription>
        </DialogHeader>
        <div className="flex justify-end">
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => call("sync:run"))}>
            Hozir sinxronlash
          </Button>
        </div>
        <ul className="max-h-96 divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {ops.map((op) => (
            <li key={op.opId} className="flex items-start gap-3 px-3 py-2 text-sm">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${op.status === "rejected" ? "bg-destructive" : "bg-amber-500"}`} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {OP_LABELS[op.type] ?? op.type} {op.number ?? op.label ?? ""}
                  {op.total && <span className="ml-2 tabular-nums text-muted-foreground">{fmtMoney(op.total, baseCurrency)}</span>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {fmtTime(op.createdAt)} · {op.status === "rejected" ? "rad etildi" : `navbatda${op.attempts > 0 ? `, urinish ${op.attempts}` : ""}`}
                </p>
                {op.error && <p className="text-xs text-destructive">{op.error.message}</p>}
              </div>
              {op.status === "rejected" && (
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => call("sync:retry", { opId: op.opId }))}>
                    Qayta yuborish
                  </Button>
                  {canDiscard && (
                    <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={() => void run(() => call("sync:discard", { opId: op.opId }))}>
                      Bekor qilish
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
          {ops.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted-foreground">Hammasi serverga yetib borgan</li>}
        </ul>
        {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
