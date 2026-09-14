/**
 * Aralash to'lov paneli: usul bo'yicha qismlar — naqd, karta terminali (UZCARD, HUMO ...), bank hisobi. Jami, to'langan va
 * qoldiq ko'rinib turadi; ortiqcha to'lov va takror qism yakunlashni to'xtatadi. Terminal to'lovi avtomatik tasdiqlanmaydi —
 * kassir (dostavshik) terminal chekiga qarab summani kiritadi. Qism hisob funksiyalari — `split-payment.ts`.
 */
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { cn } from "@/lib/utils.ts";
import {
  hasDuplicateParts,
  minorText,
  newSplitRow,
  partKey,
  rowMinor,
  splitPaidMinor,
  terminalOptionLabel,
  type PaymentBankAccountOption,
  type PaymentTerminalOption,
  type SplitMethod,
  type SplitRow,
} from "./split-payment.ts";

export type SplitPanelLabels = {
  total: string;
  paid: string;
  remaining: string;
  overpaid: string;
  add: string;
  fill: string;
  duplicate: string;
  cash: string;
  card: string;
  bank: string;
};

const DEFAULT_LABELS: SplitPanelLabels = {
  total: "Jami",
  paid: "To'langan",
  remaining: "Qoldiq",
  overpaid: "Ortiqcha to'lov",
  add: "To'lov qo'shish",
  fill: "+Qoldiq",
  duplicate: "Bir xil usul (terminal, hisob) ikki marta kiritilgan — birlashtiring",
  cash: "Naqd",
  card: "Karta",
  bank: "Bank",
};

type Choice = { method: SplitMethod; terminalId: string | null; cashAccountId: string | null; label: string; title: string };

function choicesFor(
  terminals: PaymentTerminalOption[],
  bankAccounts: PaymentBankAccountOption[],
  methods: readonly SplitMethod[],
  labels: SplitPanelLabels,
): Choice[] {
  const list: Choice[] = [];
  if (methods.includes("cash")) list.push({ method: "cash", terminalId: null, cashAccountId: null, label: labels.cash, title: labels.cash });
  if (methods.includes("card")) {
    if (terminals.length === 0) list.push({ method: "card", terminalId: null, cashAccountId: null, label: labels.card, title: labels.card });
    for (const terminal of terminals) {
      list.push({ method: "card", terminalId: terminal.id, cashAccountId: null, label: terminalOptionLabel(terminal, terminals), title: terminal.name });
    }
  }
  if (methods.includes("bank")) {
    if (bankAccounts.length === 0) list.push({ method: "bank", terminalId: null, cashAccountId: null, label: labels.bank, title: labels.bank });
    for (const account of bankAccounts) {
      list.push({ method: "bank", terminalId: null, cashAccountId: account.id, label: account.name, title: account.bankName ?? account.name });
    }
  }
  return list;
}

export function SplitPaymentPanel({
  dueMinor,
  rows,
  onChange,
  terminals,
  bankAccounts = [],
  format,
  methods = ["cash", "card", "bank"],
  maxParts = 8,
  shortfallLabel,
  labels: labelOverrides,
  idPrefix = "split",
}: {
  dueMinor: bigint;
  rows: SplitRow[];
  onChange: (rows: SplitRow[]) => void;
  terminals: PaymentTerminalOption[];
  bankAccounts?: PaymentBankAccountOption[];
  format: (minor: bigint) => string;
  methods?: readonly SplitMethod[];
  maxParts?: number;
  /** Kam to'lov qoldig'i nomi (masalan, "Qarzga"). */
  shortfallLabel?: string;
  labels?: Partial<SplitPanelLabels>;
  idPrefix?: string;
}) {
  const labels = { ...DEFAULT_LABELS, ...labelOverrides };
  const choices = choicesFor(terminals, bankAccounts, methods, labels);
  const paid = splitPaidMinor(rows);
  const remaining = dueMinor - paid;
  const duplicate = hasDuplicateParts(rows);

  const update = (key: string, patch: Partial<SplitRow>) => onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const remove = (key: string) => onChange(rows.filter((row) => row.key !== key));
  const add = () => {
    // Keyingi qism — hali ishlatilmagan birinchi usul, qoldiq summasi bilan
    const used = new Set(rows.map(partKey));
    const next = choices.find((choice) => !used.has(partKey(choice))) ?? choices[0];
    if (!next) return;
    onChange([...rows, newSplitRow(next.method, next.terminalId, remaining > 0n ? minorText(remaining) : "", next.cashAccountId)]);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{labels.total}</span>
        <span className="font-bold tabular-nums">{format(dueMinor)}</span>
      </div>

      <ul className="space-y-2">
        {rows.map((row, index) => (
          <li key={row.key} className="space-y-1.5 rounded-xl border border-border p-2">
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={`${index + 1}`}>
              {choices.map((choice) => {
                const active = partKey(row) === partKey(choice);
                return (
                  <button
                    key={partKey(choice)}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    title={choice.title}
                    onClick={() => update(row.key, { method: choice.method, terminalId: choice.terminalId, cashAccountId: choice.cashAccountId })}
                    className={cn(
                      "h-8 rounded-md border px-2.5 text-xs font-semibold transition-colors cursor-pointer",
                      active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-muted/30 text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {choice.label}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-1.5">
              <Input
                id={`${idPrefix}-amount-${index}`}
                inputMode="decimal"
                autoComplete="off"
                aria-label={`${labels.paid} ${index + 1}`}
                className="h-10 text-right text-base font-bold tabular-nums"
                placeholder="0"
                value={row.amount}
                onChange={(e) => update(row.key, { amount: e.target.value })}
              />
              {remaining > 0n && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-10 shrink-0 px-2 text-xs"
                  onClick={() => update(row.key, { amount: minorText(rowMinor(row) + remaining) })}
                >
                  {labels.fill}
                </Button>
              )}
              {rows.length > 1 && (
                <Button type="button" variant="ghost" size="icon" className="h-10 w-10 shrink-0" aria-label="×" onClick={() => remove(row.key)}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {rows.length < maxParts && (
        <Button type="button" variant="outline" size="sm" className="h-9 w-full" onClick={add}>
          <Plus className="mr-1.5 h-4 w-4" /> {labels.add}
        </Button>
      )}

      <div className="space-y-1 rounded-lg bg-muted/40 px-3 py-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">{labels.paid}</span>
          <span className="font-semibold tabular-nums">{format(paid)}</span>
        </div>
        {remaining >= 0n ? (
          <div className={cn("flex justify-between", remaining > 0n ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400")}>
            <span>{remaining > 0n ? (shortfallLabel ?? labels.remaining) : labels.remaining}</span>
            <span className="font-semibold tabular-nums">{format(remaining)}</span>
          </div>
        ) : (
          <div className="flex justify-between text-destructive">
            <span>{labels.overpaid}</span>
            <span className="font-semibold tabular-nums">{format(-remaining)}</span>
          </div>
        )}
      </div>
      {duplicate && <p className="text-xs text-destructive">{labels.duplicate}</p>}
    </div>
  );
}
