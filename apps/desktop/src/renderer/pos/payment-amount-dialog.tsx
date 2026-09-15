/**
 * To'lov summasi oynasi: kassir usul tugmasini bosadi (Naqd, UZCARD, HUMO, bank hisobi) — shu oyna ochiladi.
 * "Saqlash" (Enter) qismni ro'yxatga qo'shadi (bir nechta qism — aralash to'lov), "Yakunlash" (Ctrl+Enter) chekni yopadi.
 * Raqamli klaviatura sensorli ekran uchun; naqdda qaytim darhol ko'rinadi.
 */
import { useEffect, useRef, useState } from "react";
import { Delete } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { fromMinor, toMinor } from "../../shared/money.js";
import { decimalInput, fmtMoney, trimDecimal } from "../format.ts";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0"] as const;
const VALUE = /^\d{1,14}(\.\d{1,2})?$/;

export default function PaymentAmountDialog({
  title,
  isCash,
  suggested,
  remaining,
  max,
  currency,
  busy,
  onSave,
  onFinish,
  onClose,
}: {
  title: string;
  isCash: boolean;
  /** Taklif qilinadigan summa (qolgan qism; karta/bankda chegarada). */
  suggested: bigint;
  /** To'lanmagan qoldiq (qaytim shundan hisoblanadi). */
  remaining: bigint;
  /** Karta/bank uchun eng ko'pi; naqd — null. */
  max: bigint | null;
  currency: string;
  busy?: boolean;
  onSave: (amount: string) => void;
  onFinish: (amount: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(() => (suggested > 0n ? trimDecimal(fromMinor(suggested)) : ""));
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const valid = VALUE.test(text.trim());
  const amount = valid ? toMinor(text.trim()) : 0n;
  const tooMuch = max !== null && amount > max;
  const change = isCash && amount > remaining ? amount - remaining : 0n;
  const disabled = !valid || amount <= 0n || tooMuch || !!busy;

  const submit = (finish: boolean) => {
    if (disabled) return;
    const value = trimDecimal(fromMinor(amount));
    if (finish) onFinish(value);
    else onSave(value);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-center">{title}</DialogTitle>
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
            id="pay-amount"
            ref={inputRef}
            autoFocus
            inputMode="decimal"
            aria-label={`${title} summasi`}
            className="h-(--pos-tap-size) text-right text-2xl font-extrabold tabular-nums"
            value={text}
            onChange={(event) => setText(decimalInput(event.target.value))}
          />
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Qoldiq: {fmtMoney(fromMinor(remaining), currency)}</span>
            {isCash ? (
              <span className={change > 0n ? "font-semibold text-pos-success" : "text-muted-foreground"}>Qaytim: {fmtMoney(fromMinor(change), currency)}</span>
            ) : (
              max !== null && <span className={tooMuch ? "font-semibold text-pos-danger" : "text-muted-foreground"}>Ko'pi bilan: {fmtMoney(fromMinor(max), currency)}</span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {KEYS.map((key) => (
              <Button
                key={key}
                type="button"
                variant="secondary"
                className="h-(--pos-tap-size) text-lg font-bold"
                onClick={() => setText((current) => decimalInput(key === "." && current.includes(".") ? current : `${current}${key}`))}
              >
                {key}
              </Button>
            ))}
            <Button type="button" variant="secondary" className="h-(--pos-tap-size)" aria-label="O'chirish" onClick={() => setText((current) => current.slice(0, -1))}>
              <Delete className="size-5" />
            </Button>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-2">
            <Button type="submit" variant="secondary" className="h-(--pos-tap-size) font-bold" disabled={disabled}>
              Saqlash
            </Button>
            <Button
              type="button"
              className="h-(--pos-tap-size) bg-pos-action font-extrabold text-pos-action-foreground hover:bg-pos-action-hover"
              disabled={disabled}
              onClick={() => submit(true)}
            >
              Yakunlash
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
