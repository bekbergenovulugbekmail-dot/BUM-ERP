/**
 * To'lov summasi oynasi (usul tugmasi bosilganda): raqamli klaviatura, qolgan summa taklifi, naqdda qaytim.
 * "Saqlash" (Enter) — qism ro'yxatga qo'shiladi; "Yakunlash" (Ctrl+Enter) — qism qo'shilib chek yakunlanadi.
 */
import { useEffect, useRef, useState } from "react";
import { Delete } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { cn } from "@/lib/utils.ts";
import { parseMinor, type PayOption } from "../_lib/payment-parts.ts";

type Props = {
  option: PayOption;
  /** Taklif qilinadigan summa (qolgan qism, karta uchun chegarada). */
  suggested: bigint;
  /** Hali to'lanmagan qism (qaytimni hisoblash uchun). */
  remaining: bigint;
  /** Karta/bank uchun eng ko'pi; naqd — null. */
  max: bigint | null;
  format: (minor: bigint) => string;
  busy?: boolean;
  onSave: (amount: bigint) => void;
  onFinish: (amount: bigint) => void;
  onClose: () => void;
};

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0"] as const;
const textOf = (minor: bigint) => (minor % 100n === 0n ? String(minor / 100n) : `${minor / 100n}.${String(minor % 100n).padStart(2, "0")}`);

export default function PaymentAmountDialog({ option, suggested, remaining, max, format, busy, onSave, onFinish, onClose }: Props) {
  const [text, setText] = useState(() => (suggested > 0n ? textOf(suggested) : ""));
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const amount = parseMinor(text);
  const invalid = amount === null || amount <= 0n;
  const tooMuch = amount !== null && max !== null && amount > max;
  const change = option.method === "cash" && amount !== null && amount > remaining ? amount - remaining : 0n;
  const disabled = invalid || tooMuch || busy;

  const press = (key: (typeof KEYS)[number]) => setText((current) => (key === "." && current.includes(".") ? current : `${current}${key}`));
  const submit = (finish: boolean) => {
    if (disabled || amount === null) return;
    if (finish) onFinish(amount);
    else onSave(amount);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-center">{option.label}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              submit(true);
            }
          }}
        >
          <Input
            id="pos-payment-amount"
            ref={inputRef}
            inputMode="decimal"
            autoComplete="off"
            aria-label={`${option.label} summasi`}
            className="h-12 text-right text-2xl font-bold tabular-nums"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Qoldiq: {format(remaining)}</span>
            {option.method === "cash" ? (
              <span className={cn("font-semibold", change > 0n ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>Qaytim: {format(change)}</span>
            ) : (
              max !== null && <span className={cn(tooMuch ? "font-semibold text-destructive" : "text-muted-foreground")}>Ko'pi bilan: {format(max)}</span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {KEYS.map((key) => (
              <Button key={key} type="button" variant="secondary" className="h-12 text-lg font-semibold" onClick={() => press(key)}>
                {key}
              </Button>
            ))}
            <Button type="button" variant="secondary" className="h-12" aria-label="O'chirish" onClick={() => setText((current) => current.slice(0, -1))}>
              <Delete className="h-5 w-5" />
            </Button>
          </div>
          <DialogFooter className="grid grid-cols-[auto_1fr] gap-2 sm:grid-cols-[auto_1fr]">
            <Button type="submit" variant="outline" disabled={disabled}>
              Saqlash
            </Button>
            <Button type="button" disabled={disabled} onClick={() => submit(true)}>
              Yakunlash <span className="ml-2 text-xs opacity-80">Ctrl+Enter</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
