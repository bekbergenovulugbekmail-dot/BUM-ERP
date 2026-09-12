import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import type { AppStatus } from "../../shared/kassa-api.js";
import { call, errorText } from "../kassa.ts";

/**
 * Harakatsizlikdan keyingi blok (Sozlamalar → Xavfsizlik): ekran ustida, ochiq chek va oynalar saqlanadi. Shu kassir
 * PIN'i bilan ochiladi yoki boshqa kassirga almashiladi.
 */
export default function LockOverlay({ status, onUnlocked, onSwitched }: { status: AppStatus; onUnlocked: (status: AppStatus) => void; onSwitched: (status: AppStatus) => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cashier = status.cashier!;

  const unlock = async () => {
    setBusy(true);
    setError(null);
    try {
      onUnlocked(await call("cashier:unlock", { userId: cashier.userId, pin }));
    } catch (err) {
      setError(errorText(err));
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur" role="dialog" aria-modal="true" aria-label="Kassa bloklangan">
      <form
        className="w-80 space-y-3 rounded-2xl border border-border bg-card p-6 text-center shadow-xl"
        onSubmit={(event) => {
          event.preventDefault();
          void unlock();
        }}
      >
        <p className="text-lg font-semibold">Kassa bloklangan</p>
        <p className="text-sm text-muted-foreground">{cashier.name ?? cashier.phone} — davom etish uchun PIN kiriting</p>
        <Input
          id="lock-pin"
          autoFocus
          type="password"
          inputMode="numeric"
          maxLength={8}
          className="h-12 text-center text-2xl tracking-[0.5em]"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="h-11 w-full" disabled={busy || pin.length < 4}>
          Ochish
        </Button>
        <Button type="button" variant="ghost" className="w-full" onClick={() => void call("cashier:logout").then(onSwitched)}>
          Boshqa kassir
        </Button>
      </form>
    </div>
  );
}
