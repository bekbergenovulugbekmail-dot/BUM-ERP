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
  "cash.movement": "Kassa harakati",
  "customer.payment": "Mijoz to'lovi",
  "supplier.create": "Yangi ta'minotchi",
  "purchase.complete": "Xarid",
  "purchase.return": "Ta'minotchiga qaytarish",
  "supplier.payment": "Ta'minotchiga to'lov",
  "stock.writeoff": "Hisobdan chiqarish",
  "stock.transfer": "Ko'chirish",
  "stock.count": "Inventarizatsiya",
  "customer.update": "Mijoz tahriri",
  "supplier.update": "Ta'minotchi tahriri",
  "product.prices": "Narx o'zgarishi",
};

export const PARTY_TYPE_LABELS: Record<string, string> = { individual: "Jismoniy shaxs", legal: "Yuridik shaxs" };

/** Lokal hujjatning serverga yetib borish holati. */
export const SYNC_STATE_TEXT: Record<string, { text: string; tone: string }> = {
  pending: { text: "navbatda", tone: "text-amber-600" },
  rejected: { text: "rad etildi", tone: "text-destructive" },
  applied: { text: "serverda", tone: "text-emerald-600" },
  discarded: { text: "bekor qilingan", tone: "text-muted-foreground" },
};

export const STOCK_DOCUMENT_LABELS: Record<string, string> = { writeoff: "Hisobdan chiqarish", transfer: "Ko'chirish", count: "Inventarizatsiya" };

/** Serverdagi zaxira harakati turlari. */
export const MOVEMENT_LABELS: Record<string, string> = {
  receive: "Kirim",
  issue: "Chiqim (sotuv)",
  transfer_out: "Ko'chirildi",
  transfer_in: "Ko'chirib keltirildi",
  adjust: "Tuzatish",
  writeoff: "Hisobdan chiqarildi",
  return_in: "Qaytib keldi",
  return_out: "Qaytarildi",
  count: "Inventarizatsiya",
};

export const CASH_KIND_LABELS: Record<string, string> = {
  collection: "Inkassatsiya",
  change_fund: "Almashtirish puli",
  expense: "Kassadan xarajat",
  other_in: "Boshqa kirim",
  other_out: "Boshqa chiqim",
};

export const PAYMENT_LABELS: Record<string, string> = { cash: "Naqd", card: "Karta", bank: "Bank", transfer: "O'tkazma", balance: "Mijoz balansiga" };
