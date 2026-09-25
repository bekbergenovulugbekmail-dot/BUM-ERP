/**
 * Kassa hujjati: kirim, chiqim, o'tkazma, to'lov usulini ayirboshlash/tuzatish, valyuta ayirboshlash.
 *
 * Qoldiq hech qachon qo'lda yozilmaydi — server hujjatni kassa harakati va jurnal bilan birga yozadi. Sabab majburiy.
 * Valyuta ayirboshlashda kelishilgan kurs ko'rsatiladi; hisob kursi va kurs farqi serverda snapshot bo'lib saqlanadi.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { KIND_LABELS, localToday, money, type CashCategory, type CashDocumentKind, type CashRegister, type TransferTarget } from "../_lib/types.ts";

const DESCRIPTIONS: Record<CashDocumentKind, string> = {
  income: "Kategoriya bo'yicha kirim (mijoz va ta'minotchi puli — to'lov bo'limida).",
  expense: "Kategoriya bo'yicha chiqim (hisob-faktura bo'yicha xarajat — Xarajatlar bo'limida, tasdiq bilan).",
  transfer: "Kassadan kassaga: bir amalda, ikkala kassada ham yoziladi.",
  method_exchange: "Naqd ↔ karta/bank (bir valyuta). Kelgan summa farq qilsa — farq alohida yoziladi.",
  method_correction: "To'lov noto'g'ri usulda kiritilgan: pul to'g'ri hisobga o'tadi, asl yozuv o'zgarmaydi.",
  currency_exchange: "Valyuta sotish/olish: kurs va kurs farqi saqlanadi.",
};

export default function CashDocumentDialog({
  kind,
  register,
  registers,
  onClose,
}: {
  kind: CashDocumentKind;
  /** Joriy kassa: kirimda — qabul qiluvchi, qolganlarida — beruvchi. */
  register: CashRegister;
  registers: CashRegister[];
  onClose: () => void;
}) {
  const targets = useApiQuery<{ targets: TransferTarget[] }>("/api/finance/cash/targets").data?.targets ?? [];
  const categories = useApiQuery<{ categories: CashCategory[] }>(kind === "income" || kind === "expense" ? "/api/finance/cash-categories" : null).data?.categories ?? [];
  const [counterpartId, setCounterpartId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [toAmount, setToAmount] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [counterpartyName, setCounterpartyName] = useState("");
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState(localToday);
  const [error, setError] = useState<string | null>(null);
  const requestId = useMemo(() => crypto.randomUUID(), []);

  const needsCounterpart = kind !== "income" && kind !== "expense";
  // O'tkazma va tuzatish — istalgan kassaga (nom bilan), ayirboshlash — o'z kassalari orasida
  const options: TransferTarget[] = (kind === "method_exchange" || kind === "currency_exchange" ? registers : targets)
    .filter((row) => row.id !== register.id)
    .filter((row) => (kind === "currency_exchange" ? row.currency !== register.currency : row.currency === register.currency));
  const counterpart = options.find((row) => row.id === counterpartId) ?? null;
  const directionCategories = categories.filter((row) => row.isActive && row.direction === (kind === "income" ? "in" : "out"));

  const value = Number(amount.replace(/\s/g, "").replace(",", "."));
  const toValue = Number(toAmount.replace(/\s/g, "").replace(",", "."));
  const showToAmount = kind === "currency_exchange" || kind === "method_exchange";
  const rate = kind === "currency_exchange" && value > 0 && toValue > 0 ? toValue / value : null;

  const save = useApiMutation((body: object) => api.post("/api/finance/cash-documents", body), {
    invalidate: ["/api/finance/cash", "/api/finance/cash-documents", "/api/finance/cash-accounts", "/api/finance/dashboard"],
  });

  const submit = async () => {
    setError(null);
    if (!(value > 0)) return setError("Summani kiriting");
    if (needsCounterpart && !counterpart) return setError("Kassani tanlang");
    if (kind === "currency_exchange" && !(toValue > 0)) return setError("Olingan summani kiriting");
    if ((kind === "income" || kind === "expense") && !categoryId) return setError("Kategoriyani tanlang");
    if (reason.trim().length < 3) return setError("Sababni yozing");
    const from = kind === "income" ? null : register.id;
    const to = kind === "income" ? register.id : kind === "expense" ? null : counterpart!.id;
    try {
      await save.mutateAsync({
        kind,
        docDate: date,
        fromCashAccountId: from,
        toCashAccountId: to,
        amount: value.toFixed(2),
        toAmount: showToAmount && toValue > 0 ? toValue.toFixed(2) : null,
        categoryId: categoryId ?? null,
        counterpartyType: counterpartyName.trim() ? "person" : null,
        counterpartyName: counterpartyName.trim() || null,
        reason: reason.trim(),
        reference: reference.trim() || null,
        requestId,
      });
      toast.success(`${KIND_LABELS[kind]} yozildi`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg" data-testid={`cash-document-${kind}`}>
        <DialogHeader>
          <DialogTitle>{KIND_LABELS[kind]} — {register.name}</DialogTitle>
          <DialogDescription>{DESCRIPTIONS[kind]}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {needsCounterpart && (
            <div className="sm:col-span-2">
              <Label>{kind === "currency_exchange" ? "Qaysi valyuta kassasiga" : "Qaysi kassaga"}</Label>
              <Select value={counterpartId ?? undefined} onValueChange={setCounterpartId}>
                <SelectTrigger data-testid="cash-document-counterpart"><SelectValue placeholder="Tanlang" /></SelectTrigger>
                <SelectContent>
                  {options.map((row) => (
                    <SelectItem key={row.id} value={row.id}>{row.name} · {row.currency}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {options.length === 0 && <p className="mt-1 text-xs text-muted-foreground">Mos kassa yo'q</p>}
            </div>
          )}
          {(kind === "income" || kind === "expense") && (
            <div className="sm:col-span-2">
              <Label>Kategoriya</Label>
              <Select value={categoryId ?? undefined} onValueChange={setCategoryId}>
                <SelectTrigger data-testid="cash-document-category"><SelectValue placeholder="Tanlang" /></SelectTrigger>
                <SelectContent>
                  {directionCategories.map((row) => (
                    <SelectItem key={row.id} value={row.id}>{row.name} · {row.counterAccountCode}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label htmlFor="cash-doc-amount">{showToAmount ? `Berildi (${register.currency})` : `Summa (${register.currency})`}</Label>
            <Input id="cash-doc-amount" data-testid="cash-document-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </div>
          {showToAmount ? (
            <div>
              <Label htmlFor="cash-doc-to-amount">Olindi ({counterpart?.currency ?? "—"})</Label>
              <Input id="cash-doc-to-amount" data-testid="cash-document-to-amount" inputMode="decimal" value={toAmount} placeholder={kind === "method_exchange" ? "teng bo'lsa bo'sh" : ""} onChange={(event) => setToAmount(event.target.value)} />
            </div>
          ) : (
            <div>
              <Label htmlFor="cash-doc-date">Sana</Label>
              <Input id="cash-doc-date" type="date" max={localToday()} value={date} onChange={(event) => setDate(event.target.value)} />
            </div>
          )}
          {rate !== null && (
            <p className="sm:col-span-2 text-xs text-muted-foreground" data-testid="cash-document-rate">
              Kelishilgan kurs: 1 {register.currency} = {money(rate.toFixed(4))} {counterpart?.currency}
            </p>
          )}
          {(kind === "income" || kind === "expense") && (
            <div className="sm:col-span-2">
              <Label htmlFor="cash-doc-counterparty">Kontragent (kimdan / kimga)</Label>
              <Input id="cash-doc-counterparty" value={counterpartyName} onChange={(event) => setCounterpartyName(event.target.value)} maxLength={200} />
            </div>
          )}
          <div className="sm:col-span-2">
            <Label htmlFor="cash-doc-reason">Sabab (majburiy)</Label>
            <Textarea id="cash-doc-reason" data-testid="cash-document-reason" rows={2} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="cash-doc-reference">Hujjat raqami / izoh (ixtiyoriy)</Label>
            <Input id="cash-doc-reference" value={reference} onChange={(event) => setReference(event.target.value)} maxLength={100} />
          </div>
        </div>
        {error && <p className="text-sm text-destructive" data-testid="cash-document-error">{error}</p>}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Bekor</Button>
          <Button data-testid="cash-document-submit" disabled={save.isPending} onClick={() => void submit()}>Yozish</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
