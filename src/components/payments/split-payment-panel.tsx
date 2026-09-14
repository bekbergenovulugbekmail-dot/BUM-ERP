/**
 * Aralash to'lov paneli: usul bo'yicha qismlar — naqd, karta terminali (UZCARD, HUMO ...), bank. Jami, to'langan va qoldiq
 * ko'rinib turadi; ortiqcha to'lov va takror qism yakunlashni to'xtatadi. Terminal to'lovi avtomatik tasdiqlanmaydi —
 * kassir (dostavshik) terminal chekiga qarab summani kiritadi. Aniq hisob-kitob va tekshiruv — serverda (universal taqsimot).
 */
import { Plus, X } from "lucide-react";
import { TERMINAL_NETWORK_LABELS, type TerminalNetwork } from "@bum/shared";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { cn } from "@/lib/utils.ts";

export type PaymentTerminalOption = { id: string; name: string; network: TerminalNetwork; branchId?: string | null };
export type SplitMethod = "cash" | "card" | "bank";
export type SplitRow = { key: string; method: SplitMethod; terminalId: string | null; amount: string };
export type SplitPart = { method: SplitMethod; amount: string; terminalId?: string };

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
  duplicate: "Bir xil usul (terminal) ikki marta kiritilgan — birlashtiring",
  cash: "Naqd",
  card: "Karta",
  bank: "Bank",
};

const MONEY_RE = /^\d{1,13}(\.\d{1,2})?$/;
const normalize = (value: string) => value.replace(/\s/g, "").replace(",", ".");

/** Qism summasi tiyinda; noto'g'ri kiritilgan — 0. */
export function rowMinor(row: SplitRow): bigint {
  const value = normalize(row.amount);
  if (!MONEY_RE.test(value)) return 0n;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
}

export const splitPaidMinor = (rows: SplitRow[]) => rows.reduce((sum, row) => sum + rowMinor(row), 0n);

const minorText = (minor: bigint) => `${minor / 100n}.${String(minor % 100n).padStart(2, "0")}`;

export function newSplitRow(method: SplitMethod = "cash", terminalId: string | null = null, amount = ""): SplitRow {
  return { key: crypto.randomUUID(), method, terminalId, amount };
}

/** Takrorlangan qism (bir xil usul va terminal) — server rad etadi, oldindan ko'rsatiladi. */
export function hasDuplicateParts(rows: SplitRow[]) {
  const keys = rows.filter((row) => rowMinor(row) > 0n).map((row) => `${row.method}|${row.terminalId ?? ""}`);
  return new Set(keys).size !== keys.length;
}

/** API tanasi uchun qismlar (nol summalilarsiz). */
export function splitParts(rows: SplitRow[]): SplitPart[] {
  return rows
    .filter((row) => rowMinor(row) > 0n)
    .map((row) => ({ method: row.method, amount: minorText(rowMinor(row)), ...(row.terminalId ? { terminalId: row.terminalId } : {}) }));
}

type Choice = { method: SplitMethod; terminalId: string | null; label: string; title: string };

function choicesFor(terminals: PaymentTerminalOption[], methods: readonly SplitMethod[], labels: SplitPanelLabels): Choice[] {
  const networkCount = new Map<string, number>();
  for (const terminal of terminals) networkCount.set(terminal.network, (networkCount.get(terminal.network) ?? 0) + 1);
  const list: Choice[] = [];
  if (methods.includes("cash")) list.push({ method: "cash", terminalId: null, label: labels.cash, title: labels.cash });
  if (methods.includes("card")) {
    if (terminals.length === 0) list.push({ method: "card", terminalId: null, label: labels.card, title: labels.card });
    for (const terminal of terminals) {
      const network = TERMINAL_NETWORK_LABELS[terminal.network] ?? terminal.name;
      list.push({
        method: "card",
        terminalId: terminal.id,
        label: (networkCount.get(terminal.network) ?? 0) > 1 ? `${network} · ${terminal.name}` : network,
        title: terminal.name,
      });
    }
  }
  if (methods.includes("bank")) list.push({ method: "bank", terminalId: null, label: labels.bank, title: labels.bank });
  return list;
}

export function SplitPaymentPanel({
  dueMinor,
  rows,
  onChange,
  terminals,
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
  format: (minor: bigint) => string;
  methods?: readonly SplitMethod[];
  maxParts?: number;
  /** Kam to'lov qoldig'i nomi (masalan, "Qarzga"). */
  shortfallLabel?: string;
  labels?: Partial<SplitPanelLabels>;
  idPrefix?: string;
}) {
  const labels = { ...DEFAULT_LABELS, ...labelOverrides };
  const choices = choicesFor(terminals, methods, labels);
  const paid = splitPaidMinor(rows);
  const remaining = dueMinor - paid;
  const duplicate = hasDuplicateParts(rows);

  const update = (key: string, patch: Partial<SplitRow>) => onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const remove = (key: string) => onChange(rows.filter((row) => row.key !== key));
  const add = () => {
    // Keyingi qism — hali ishlatilmagan birinchi usul, qoldiq summasi bilan
    const used = new Set(rows.map((row) => `${row.method}|${row.terminalId ?? ""}`));
    const next = choices.find((choice) => !used.has(`${choice.method}|${choice.terminalId ?? ""}`)) ?? choices[0];
    if (!next) return;
    onChange([...rows, newSplitRow(next.method, next.terminalId, remaining > 0n ? minorText(remaining) : "")]);
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
                const active = row.method === choice.method && row.terminalId === choice.terminalId;
                return (
                  <button
                    key={`${choice.method}|${choice.terminalId ?? ""}`}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    title={choice.title}
                    onClick={() => update(row.key, { method: choice.method, terminalId: choice.terminalId })}
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
