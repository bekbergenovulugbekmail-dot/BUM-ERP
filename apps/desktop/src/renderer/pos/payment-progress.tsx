import { fromMinor } from "../../shared/money.js";
import type { SaleCalc } from "../../shared/sale-calc.js";
import type { PaymentMethod } from "../../shared/sync-types.js";
import { fmtMoney } from "../format.ts";
import { terminalLabel, type TerminalView } from "./terminals.ts";

const METHOD_TONE: Record<PaymentMethod, string> = { cash: "bg-pos-success", card: "bg-pos-info", bank: "bg-primary", transfer: "bg-primary" };
const METHOD_LABEL: Record<PaymentMethod, string> = { cash: "Naqd", card: "Karta", bank: "Bank", transfer: "O'tkazma" };

/**
 * Aralash to'lov taqsimoti: har qism ulushi chiziqda va "Naqd 300 000 + UZCARD 400 000 = 700 000" ko'rinishida
 * (hisob — `computeSale`); karta terminal bo'yicha alohida.
 */
export function PaymentProgress({
  calc,
  base,
  terminals = [],
  bankAccounts = [],
}: {
  calc: SaleCalc;
  base: string;
  terminals?: readonly TerminalView[];
  bankAccounts?: readonly { id: string; name: string }[];
}) {
  if (calc.due <= 0n) return null;
  const parts = calc.payments.filter((part) => part.paid > 0n);
  const width = (value: bigint) => `${Math.min(100, Number((value * 10000n) / calc.due) / 100)}%`;
  const done = calc.paid >= calc.due;
  const labelOf = (part: SaleCalc["payments"][number]) => {
    const terminal = part.terminalId ? terminals.find((item) => item.id === part.terminalId) : undefined;
    if (terminal) return terminalLabel(terminal, terminals);
    const account = part.cashAccountId ? bankAccounts.find((item) => item.id === part.cashAccountId) : undefined;
    return account ? account.name : METHOD_LABEL[part.method];
  };
  const keyOf = (part: SaleCalc["payments"][number]) => `${part.method}:${part.terminalId ?? ""}:${part.cashAccountId ?? ""}`;
  return (
    <div className="space-y-1.5">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="To'lov" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Number((calc.paid * 100n) / calc.due))}>
        {parts.map((part) => (
          <span key={keyOf(part)} className={`pos-motion h-full transition-[width] duration-200 ${METHOD_TONE[part.method]}`} style={{ width: width(part.paid) }} />
        ))}
      </div>
      {parts.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs tabular-nums text-muted-foreground">
          {parts.map((part, index) => (
            <span key={keyOf(part)} className="inline-flex items-center gap-1">
              {index > 0 && <span aria-hidden>+</span>}
              <span className={`size-2 rounded-full ${METHOD_TONE[part.method]}`} aria-hidden />
              {labelOf(part)} {fmtMoney(fromMinor(part.paid), base)}
            </span>
          ))}
          <span>= {fmtMoney(fromMinor(calc.paid), base)}</span>
          {done && <span className="font-semibold text-pos-success">✓ to'liq</span>}
        </p>
      )}
    </div>
  );
}
