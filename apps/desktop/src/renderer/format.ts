/** Ekranda ko'rsatish formatlari (hisob uchun emas — hisob `shared/money` da). */
import { currencySymbol } from "@bum/shared";

const moneyFormat = new Intl.NumberFormat("uz-UZ", { maximumFractionDigits: 2 });
const qtyFormat = new Intl.NumberFormat("uz-UZ", { maximumFractionDigits: 3 });

export const num = (value: string | number | null | undefined) => {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const fmtMoney = (value: string | number | null | undefined, currency = "UZS") => `${moneyFormat.format(num(value))} ${currencySymbol(currency)}`;

export const fmtQty = (value: string | number | null | undefined) => qtyFormat.format(num(value));

export const fmtTime = (iso: string) => new Date(iso).toLocaleString("uz-UZ", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Kiritilayotgan o'nlik son: vergul → nuqta, faqat raqam va bitta nuqta, kasr xonalar chegarasi. */
export function decimalInput(text: string, scale = 2): string {
  const cleaned = text.replace(",", ".").replace(/[^\d.]/g, "");
  const [int = "", ...rest] = cleaned.split(".");
  return rest.length > 0 ? `${int}.${rest.join("").slice(0, scale)}` : int;
}

/** "3.0000" → "3", "0.5000" → "0.5". */
export const trimDecimal = (text: string) => (text.includes(".") ? text.replace(/\.?0+$/, "") : text);

export const OP_LABELS: Record<string, string> = {
  "sale.complete": "Chek",
  "sale.return": "Qaytarish",
  "customer.create": "Yangi mijoz",
  "shift.open": "Smena ochildi",
  "shift.close": "Smena yopildi",
};

export const PAYMENT_LABELS: Record<string, string> = { cash: "Naqd", card: "Karta", bank: "Bank", transfer: "O'tkazma", balance: "Mijoz balansiga" };
