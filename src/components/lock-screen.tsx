/**
 * 🔒 EKRAN BLOKLANGAN — sessiya saqlangan, ochish faqat PIN bilan. Chiqish tugmasi sessiyani tugatadi
 * (keyin faqat parol bilan kiriladi).
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Lock, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { PIN_REGEX, pinFailureText } from "@/lib/session-lock.ts";
import { useAuth, type Me } from "@/hooks/use-auth.ts";

type UnlockResult = { success: true } | { success: false; reason: string };

export default function LockScreen({ me }: { me: Me }) {
  const queryClient = useQueryClient();
  const { signout } = useAuth();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const unlock = async () => {
    if (!PIN_REGEX.test(pin)) {
      setError("PIN 4-8 ta raqamdan iborat");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await api.post<UnlockResult>("/api/auth/unlock", { pin });
      setPin("");
      if (result.success) await queryClient.invalidateQueries();
      else setError(pinFailureText(result.reason));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur p-4">
      <form
        className="w-full max-w-xs space-y-5 text-center"
        onSubmit={(event) => {
          event.preventDefault();
          void unlock();
        }}
      >
        <div className="mx-auto h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
          <Lock className="h-8 w-8 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-bold tracking-wide">🔒 EKRAN BLOKLANGAN</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {me.name ?? me.phone}
            {me.companyName ? ` · ${me.companyName}` : ""}
          </p>
        </div>
        <Input
          id="lock-screen-pin"
          autoFocus
          inputMode="numeric"
          type="password"
          autoComplete="off"
          maxLength={8}
          placeholder="PIN"
          aria-label="PIN"
          value={pin}
          onChange={(event) => {
            setPin(event.target.value.replace(/\D/g, ""));
            setError(null);
          }}
          className="text-center text-2xl tracking-[0.5em] h-12"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={pending || pin.length < 4}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Ochish"}
        </Button>
        <Button type="button" variant="ghost" className="w-full text-muted-foreground" onClick={() => signout()}>
          <LogOut className="h-4 w-4 mr-2" />
          Chiqish (keyin parol bilan kiriladi)
        </Button>
      </form>
    </div>
  );
}
