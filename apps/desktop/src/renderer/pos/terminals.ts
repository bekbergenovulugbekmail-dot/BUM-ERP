/** Karta terminali yorliqlari: kassa ekrani, to'lov taqsimoti va chek uchun bir xil. */
import { TERMINAL_NETWORK_LABELS, type TerminalNetwork } from "@bum/shared";
import { PAYMENT_LABELS } from "../format.ts";

export type TerminalView = { id: string; name: string; network: string };

/** "UZCARD"; shu tizimdagi bir nechta terminal bo'lsa — "UZCARD · Kassa 2". */
export function terminalLabel(terminal: TerminalView, all: readonly TerminalView[] = []): string {
  const network = TERMINAL_NETWORK_LABELS[terminal.network as TerminalNetwork] ?? terminal.name;
  const sameNetwork = all.filter((item) => item.network === terminal.network).length > 1;
  return sameNetwork ? `${network} · ${terminal.name}` : network;
}

/** To'lov qismi nomi: terminal bilan — "Karta · UZCARD", aks holda usul nomi. */
export function paymentPartLabel(part: { method: string; terminal?: TerminalView | null }): string {
  return part.terminal ? `${PAYMENT_LABELS.card} · ${terminalLabel(part.terminal)}` : (PAYMENT_LABELS[part.method] ?? part.method);
}
