/**
 * Termal chek (58 / 80 mm) — HTML satr. Sozlamalardagi jonli ko'rinish (iframe) va chop etish bir manbadan,
 * shuning uchun ko'rilgan narsa aynan chiqadi. Brauzer chop etish oynasi orqali istalgan termal printerga.
 */
import { DEFAULT_RECEIPT_TEMPLATE, type ReceiptTemplate } from "@bum/shared";

export type ReceiptDocument = {
  company: { name: string; address?: string | null; phone?: string | null; taxId?: string | null };
  number: string;
  /** Tayyor formatlangan sana. */
  date: string;
  cashierName?: string | null;
  items: { name: string; sku?: string | null; quantity: number; unitPrice: number; lineTotal: number }[];
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
  /** Qabul qilingan to'lovlar: "Naqd" (qaytim bilan), "Balansdan" va h.k. */
  payments: { label: string; amount: number }[];
  change: number;
  changeToBalance: number;
  debt: number;
  customer?: { name: string; phone?: string | null; totalDebt: number; balance: number } | null;
  cashback?: { earned: number; balance: number } | null;
  currencyLabel?: string;
};

const FONT_PX: Record<ReceiptTemplate["fontSize"], number> = { sm: 11, md: 12.5, lg: 14 };

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);

const money = (n: number) => new Intl.NumberFormat("uz-UZ", { maximumFractionDigits: 2 }).format(n);
const quantity = (n: number) => new Intl.NumberFormat("uz-UZ", { maximumFractionDigits: 3 }).format(n);

function row(label: string, value: string, className = "") {
  return `<div class="row ${className}"><span>${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></div>`;
}

function receiptCss(t: ReceiptTemplate) {
  const width = t.paperWidth;
  const side = width === 58 ? 2 : 3;
  return `
@page { size: ${width}mm auto; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: "Courier New", Courier, ui-monospace, monospace; color: #000;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.receipt { width: ${width}mm; padding: 3mm ${side}mm 6mm; font-size: ${FONT_PX[t.fontSize]}px; line-height: 1.35; }
.logo { display: block; width: ${t.logoWidth}%; height: auto; margin: 0 auto 2mm; }
.center { text-align: center; }
.name { font-size: 1.3em; font-weight: 700; }
.bold { font-weight: 700; }
.muted { color: #444; }
.pre { white-space: pre-line; }
.sep { border-top: 1px dashed #000; margin: 2mm 0; }
.row { display: flex; justify-content: space-between; gap: 2mm; }
.row > span:first-child { min-width: 0; overflow-wrap: anywhere; }
.row > span:last-child { text-align: right; white-space: nowrap; }
.total { font-size: 1.2em; font-weight: 700; margin: 1mm 0; }
.item { margin-bottom: 1mm; }
.item-name { overflow-wrap: anywhere; }
@media screen {
  body { background: transparent; padding: 12px 0; }
  .receipt { margin: 0 auto; background: #fff; box-shadow: 0 1px 6px rgba(0, 0, 0, .18); }
}`;
}

export function buildReceiptHtml(doc: ReceiptDocument, template: ReceiptTemplate = DEFAULT_RECEIPT_TEMPLATE): string {
  const t = template;
  const currency = doc.currencyLabel ?? "so'm";
  const sum = (n: number) => `${money(n)} ${currency}`;
  const parts: string[] = [];

  if (t.showLogo && t.logo) parts.push(`<img class="logo" src="${escapeHtml(t.logo)}" alt="" />`);

  const head: string[] = [];
  if (t.showCompanyName) head.push(`<div class="name">${escapeHtml(doc.company.name)}</div>`);
  if (t.showAddress && doc.company.address) head.push(`<div>${escapeHtml(doc.company.address)}</div>`);
  if (t.showPhone && doc.company.phone) head.push(`<div>Tel: ${escapeHtml(doc.company.phone)}</div>`);
  if (t.showTaxId && doc.company.taxId) head.push(`<div>STIR: ${escapeHtml(doc.company.taxId)}</div>`);
  if (t.headerText.trim()) head.push(`<div class="pre">${escapeHtml(t.headerText.trim())}</div>`);
  if (head.length > 0) parts.push(`<div class="center">${head.join("")}</div>`);

  parts.push(`<div class="sep"></div>`);
  parts.push(`<div class="center bold">CHEK № ${escapeHtml(doc.number)}</div>`);
  parts.push(`<div class="center">${escapeHtml(doc.date)}</div>`);
  if (t.showCashier && doc.cashierName) parts.push(row("Kassir", doc.cashierName));
  parts.push(`<div class="sep"></div>`);

  for (const item of doc.items) {
    const name = t.showSku && item.sku ? `${item.name} (${item.sku})` : item.name;
    parts.push(
      `<div class="item"><div class="item-name">${escapeHtml(name)}</div>` +
        `${row(`${quantity(item.quantity)} × ${money(item.unitPrice)}`, money(item.lineTotal))}</div>`,
    );
  }
  parts.push(`<div class="sep"></div>`);

  if (doc.discountAmount > 0) parts.push(row("Chegirma", `−${sum(doc.discountAmount)}`));
  parts.push(row("JAMI", sum(doc.totalAmount), "total"));
  if (t.showTax && doc.taxAmount > 0) parts.push(row("shu jumladan QQS", sum(doc.taxAmount), "muted"));
  for (const payment of doc.payments) {
    if (payment.amount > 0) parts.push(row(payment.label, sum(payment.amount)));
  }
  if (doc.change > 0) parts.push(row("Qaytim", sum(doc.change), "bold"));
  if (doc.changeToBalance > 0) parts.push(row("Qaytim balansga", `+${sum(doc.changeToBalance)}`, "bold"));
  if (doc.debt > 0) parts.push(row("Qarzga yozildi", sum(doc.debt), "bold"));

  const customer = doc.customer;
  if (customer && t.showCustomer) {
    const lines = [row("Mijoz", customer.name)];
    if (customer.phone) lines.push(row("Telefon", customer.phone));
    if (t.showCustomerDebt) lines.push(row("Umumiy qarz", sum(Math.max(0, customer.totalDebt))));
    if (t.showCustomerBalance) lines.push(row("Balans", sum(customer.balance)));
    parts.push(`<div class="sep"></div>${lines.join("")}`);
  }

  const cashback = doc.cashback;
  if (cashback && t.showCashback && (cashback.earned > 0 || cashback.balance > 0)) {
    parts.push(
      `<div class="sep"></div>${row("Keshbek (shu chek)", `+${sum(cashback.earned)}`)}${row("Keshbek balansi", sum(cashback.balance))}`,
    );
  }

  if (t.footerText.trim()) {
    parts.push(`<div class="sep"></div><div class="center pre">${escapeHtml(t.footerText.trim())}</div>`);
  }

  return (
    `<!doctype html><html><head><meta charset="utf-8" /><title>Chek ${escapeHtml(doc.number)}</title>` +
    `<style>${receiptCss(t)}</style></head><body><div class="receipt">${parts.join("")}</div></body></html>`
  );
}

/** HTML'ni yashirin iframe'da brauzer chop etish oynasi orqali chiqaradi (rasmlar yuklangach). */
export function printHtml(html: string): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0";
  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) return;
    const cleanup = () => frame.remove();
    win.onafterprint = () => setTimeout(cleanup, 0);
    // Ba'zi brauzerlarda afterprint kelmaydi
    setTimeout(cleanup, 60_000);
    win.focus();
    win.print();
  };
  frame.srcdoc = html;
  document.body.appendChild(frame);
}

/** Sozlamalar sahifasidagi ko'rinish uchun namuna chek. */
export function sampleReceipt(company: ReceiptDocument["company"], cashierName?: string | null): ReceiptDocument {
  return {
    company,
    number: "SO-2026-0042",
    date: new Date().toLocaleString("uz-UZ"),
    cashierName: cashierName ?? "Kassir",
    items: [
      { name: "Coca-Cola 1.5 l", sku: "1001", quantity: 2, unitPrice: 14_000, lineTotal: 28_000 },
      { name: "Non (patir)", sku: "1002", quantity: 3, unitPrice: 5_000, lineTotal: 15_000 },
      { name: "Shokolad Alpen Gold 90 g", sku: "1003", quantity: 1, unitPrice: 17_000, lineTotal: 17_000 },
    ],
    taxAmount: 6_428.57,
    discountAmount: 0,
    totalAmount: 60_000,
    payments: [
      { label: "Balansdan", amount: 10_000 },
      { label: "Naqd", amount: 52_000 },
    ],
    change: 0,
    changeToBalance: 2_000,
    debt: 0,
    customer: { name: "Valiyev Ali", phone: "+998 90 123 45 67", totalDebt: 150_000, balance: 2_000 },
    cashback: { earned: 1_200, balance: 8_700 },
  };
}
