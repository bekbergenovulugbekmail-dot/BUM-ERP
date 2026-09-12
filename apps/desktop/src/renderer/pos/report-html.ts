/** X / Z smena hisoboti — termal chek (58/80 mm), dialogsiz printerga. */
import { currencySymbol } from "@bum/shared";
import type { DevicePrefs, PosContext, ShiftReport } from "../../shared/kassa-api.js";
import { PAYMENT_LABELS, num } from "../format.ts";
import { call } from "../kassa.ts";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
const money = (value: string | number) => new Intl.NumberFormat("uz-UZ", { maximumFractionDigits: 2 }).format(num(value));
const time = (iso: string) => new Date(iso).toLocaleString("uz-UZ");

export function buildShiftReportHtml(report: ShiftReport, options: { companyName: string; baseCurrency: string; paperWidth: 58 | 80; printedAt: string }): string {
  const symbol = currencySymbol(options.baseCurrency);
  const row = (label: string, value: string, className = "") =>
    `<div class="row ${className}"><span>${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></div>`;
  const sum = (value: string | number) => `${money(value)} ${symbol}`;
  const sep = `<div class="sep"></div>`;
  const title = report.shift.closedAt ? "Z-HISOBOT" : "X-HISOBOT";
  const parts: string[] = [
    `<div class="center name">${escapeHtml(options.companyName)}</div>`,
    `<div class="center bold">${title}</div>`,
  ];
  if (report.device) parts.push(`<div class="center">${escapeHtml(`${report.device.code} · ${report.device.name} · ${report.device.warehouseName}`)}</div>`);
  parts.push(sep, row("Kassir", report.shift.cashierName ?? "—"), row("Ochilgan", time(report.shift.openedAt)));
  if (report.shift.closedAt) parts.push(row("Yopilgan", time(report.shift.closedAt)));
  parts.push(sep, row("Cheklar", String(report.receipts)), row("Savdo", sum(report.salesTotal), "bold"));
  if (num(report.discount) > 0) parts.push(row("Chegirma", sum(report.discount)));
  if (num(report.tax) > 0) parts.push(row("shu jumladan QQS", sum(report.tax)));
  for (const method of report.byMethod) {
    parts.push(row(`  ${method.label}`, method.key.startsWith("fx:") ? `${money(method.amount)} ${method.key.slice(3)}` : sum(method.amount)));
  }
  if (report.returns.count > 0) {
    parts.push(sep, row(`Qaytarishlar (${report.returns.count})`, sum(report.returns.total), "bold"));
    if (num(report.returns.cash) > 0) parts.push(row(`  ${PAYMENT_LABELS.cash}`, sum(report.returns.cash)));
    if (num(report.returns.card) > 0) parts.push(row(`  ${PAYMENT_LABELS.card}`, sum(report.returns.card)));
    if (num(report.returns.balance) > 0) parts.push(row(`  ${PAYMENT_LABELS.balance}`, sum(report.returns.balance)));
  }
  const payments = report.customerPayments;
  if (payments.count > 0) {
    parts.push(sep, row(`Mijoz to'lovlari (${payments.count})`, "", "bold"));
    if (num(payments.debtCash) > 0) parts.push(row("  Qarz — naqd", sum(payments.debtCash)));
    if (num(payments.debtCard) > 0) parts.push(row("  Qarz — karta", sum(payments.debtCard)));
    if (num(payments.depositCash) > 0) parts.push(row("  Balans — naqd", sum(payments.depositCash)));
    if (num(payments.depositCard) > 0) parts.push(row("  Balans — karta", sum(payments.depositCard)));
  }
  if (report.cashMovements.length > 0) {
    parts.push(sep);
    for (const movement of report.cashMovements) parts.push(row(`${movement.label} (${movement.count})`, sum(movement.amount)));
  }
  const suppliers = report.suppliers;
  if (suppliers.payments > 0 || suppliers.refunds > 0) {
    parts.push(sep);
    if (num(suppliers.paidCash) > 0) parts.push(row("Ta'minotchiga — naqd", sum(suppliers.paidCash)));
    if (num(suppliers.paidCard) > 0) parts.push(row("Ta'minotchiga — karta", sum(suppliers.paidCard)));
    if (num(suppliers.refundCash) > 0) parts.push(row("Ta'minotchidan qaytdi — naqd", sum(suppliers.refundCash)));
    if (num(suppliers.refundCard) > 0) parts.push(row("Ta'minotchidan qaytdi — karta", sum(suppliers.refundCard)));
  }
  parts.push(sep, row("Boshlang'ich naqd", sum(report.shift.openingCash)), row("Kassada bo'lishi kerak", sum(report.expectedCash), "total"));
  if (report.shift.closingCash !== null) {
    parts.push(row("Sanalgan naqd", sum(report.shift.closingCash)), row("Farq", sum(report.difference ?? "0"), "bold"));
  }
  if (report.cashiers.length > 1) {
    parts.push(sep);
    for (const cashier of report.cashiers) parts.push(row(`${cashier.name} (${cashier.receipts})`, sum(cashier.total)));
  }
  if (report.unsynced > 0) parts.push(sep, `<div class="center">Serverga yuborilmagan: ${report.unsynced}</div>`);
  parts.push(sep, `<div class="center muted">${escapeHtml(options.printedAt)}</div>`);

  const width = options.paperWidth;
  const css = `
@page { size: ${width}mm auto; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: "Courier New", Courier, ui-monospace, monospace; color: #000; }
.receipt { width: ${width}mm; padding: 3mm ${width === 58 ? 2 : 3}mm 6mm; font-size: 12px; line-height: 1.35; }
.center { text-align: center; }
.name { font-size: 1.25em; font-weight: 700; }
.bold { font-weight: 700; }
.muted { color: #444; }
.total { font-size: 1.15em; font-weight: 700; }
.sep { border-top: 1px dashed #000; margin: 2mm 0; }
.row { display: flex; justify-content: space-between; gap: 2mm; white-space: pre; }
.row > span:last-child { text-align: right; }`;
  return `<!doctype html><html><head><meta charset="utf-8" /><title>${title}</title><style>${css}</style></head><body><div class="receipt">${parts.join("")}</div></body></html>`;
}

export async function printShiftReport(report: ShiftReport, context: PosContext | null, prefs: DevicePrefs, fallbackCurrency: string): Promise<void> {
  const html = buildShiftReportHtml(report, {
    companyName: context?.company?.name ?? "BUM ERP",
    baseCurrency: context?.baseCurrency ?? fallbackCurrency,
    paperWidth: prefs.paperWidth,
    printedAt: new Date().toLocaleString("uz-UZ"),
  });
  await call("device:print", { html });
}
