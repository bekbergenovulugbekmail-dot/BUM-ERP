/** Ekran qulfi uchun PIN o'rnatish (`POST /api/auth/pin`) — serverda faqat xeshi saqlanadi. */
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { PIN_REGEX } from "@/lib/session-lock.ts";

export default function SetPinDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const save = async () => {
    if (!PIN_REGEX.test(pin)) return setError("PIN 4-8 ta raqamdan iborat bo'lishi kerak");
    if (pin !== confirmPin) return setError("PIN'lar mos kelmadi");
    setPending(true);
    setError(null);
    try {
      await api.post("/api/auth/pin", { pin });
      setPin("");
      setConfirmPin("");
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  const digits = (value: string) => value.replace(/\D/g, "").slice(0, 8);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>PIN o'rnatish</DialogTitle>
          <DialogDescription>
            Ekran bloklanganda faqat shu PIN bilan ochiladi. PIN parol o'rnini bosmaydi: tizimdan chiqqach yoki yangi qurilmada parol kerak.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="set-pin">PIN (4-8 raqam)</Label>
            <Input id="set-pin" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => { setPin(digits(e.target.value)); setError(null); }} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="set-pin-confirm">PIN'ni takrorlang</Label>
            <Input id="set-pin-confirm" type="password" inputMode="numeric" autoComplete="off" value={confirmPin} onChange={(e) => { setConfirmPin(digits(e.target.value)); setError(null); }} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Bekor</Button>
          <Button onClick={() => { void save(); }} disabled={pending || pin.length < 4}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Saqlash va bloklash"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
