import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import type { AppStatus, KassaChannels } from "../../shared/kassa-api.js";
import { call, errorText } from "../kassa.ts";

type Cashier = KassaChannels["cashier:list"]["output"][number];

/** Kassir: ro'yxatdan tanlab PIN (offline) yoki birinchi marta telefon + parol bilan kirib PIN o'rnatish (onlayn). */
export default function CashierScreen({ status, onDone }: { status: AppStatus; onDone: (status: AppStatus) => void }) {
  const [cashiers, setCashiers] = useState<Cashier[] | null>(null);
  const [selected, setSelected] = useState<Cashier | null>(null);
  const [pin, setPin] = useState("");
  const [firstLogin, setFirstLogin] = useState(false);
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    call("cashier:list")
      .then((list) => {
        if (!cancelled) setCashiers(list);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, [status.counts.cashiers]);

  const run = async (action: () => Promise<AppStatus>) => {
    setBusy(true);
    setError(null);
    try {
      onDone(await action());
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const withPin = (cashiers ?? []).filter((cashier) => cashier.hasPin);
  const showFirstLogin = firstLogin || (cashiers !== null && withPin.length === 0);

  return (
    <main className="flex min-h-full items-center justify-center bg-muted/40 p-6">
      <section className="w-full max-w-lg space-y-5 rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold">{status.company?.name}</h1>
          <p className="text-sm text-muted-foreground">
            {status.device?.name} ({status.device?.code}) · {status.device?.warehouseName}
          </p>
        </div>

        {!showFirstLogin ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {withPin.map((cashier) => (
                <button
                  key={cashier.userId}
                  type="button"
                  onClick={() => {
                    setSelected(cashier);
                    setPin("");
                  }}
                  className={`rounded-xl border px-3 py-3 text-left text-sm transition-colors ${selected?.userId === cashier.userId ? "border-primary bg-primary/5" : "border-border hover:bg-muted"}`}
                >
                  <span className="block font-medium">{cashier.name ?? cashier.phone}</span>
                  <span className="text-xs text-muted-foreground">{cashier.role}</span>
                </button>
              ))}
            </div>
            {selected && (
              <form
                className="space-y-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(() => call("cashier:unlock", { userId: selected.userId, pin }));
                }}
              >
                <Label htmlFor="cashier-pin">PIN — {selected.name ?? selected.phone}</Label>
                <Input id="cashier-pin" type="password" inputMode="numeric" autoFocus maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
                <Button type="submit" className="h-11 w-full" disabled={busy || pin.length < 4}>
                  Kirish
                </Button>
              </form>
            )}
            <button type="button" className="text-sm text-primary underline-offset-4 hover:underline" onClick={() => setFirstLogin(true)}>
              Yangi kassir — birinchi marta kirish
            </button>
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (newPin !== confirmPin) {
                setError("PIN'lar mos emas");
                return;
              }
              void run(() => call("cashier:first-login", { phone, password, pin: newPin }));
            }}
          >
            <p className="text-sm text-muted-foreground">Birinchi kirish internet bilan. Keyin shu kassada PIN bilan offline kirasiz.</p>
            <div className="space-y-1">
              <Label htmlFor="first-phone">Telefon</Label>
              <Input id="first-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="first-password">Parol</Label>
              <Input id="first-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="first-pin">Yangi PIN (4–8 raqam)</Label>
                <Input id="first-pin" type="password" inputMode="numeric" maxLength={8} value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="first-pin-confirm">PIN takror</Label>
                <Input id="first-pin-confirm" type="password" inputMode="numeric" maxLength={8} value={confirmPin} onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="secondary" className="h-11" disabled={withPin.length === 0} onClick={() => setFirstLogin(false)}>
                Orqaga
              </Button>
              <Button type="submit" className="h-11" disabled={busy || !phone || !password || newPin.length < 4}>
                {busy ? "Tekshirilmoqda…" : "Kirish"}
              </Button>
            </div>
          </form>
        )}

        {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      </section>
    </main>
  );
}
