/**
 * Chop etish sozlamalari — API (saqlash) va frontend (chek HTML, sozlamalar sahifasi) uchun umumiy tur
 * va standart qiymatlar. Zod sxemasi API'da: bu paket runtime'da type stripping bilan, bog'liqliksiz yuklanadi.
 */

/** Chek logotipi data URL ko'rinishida (~220 KB rasm); frontend yuklashda kichraytiradi. */
export const RECEIPT_LOGO_MAX_LENGTH = 300_000;

export type ReceiptPaperWidth = 58 | 80;
export type ReceiptFontSize = "sm" | "md" | "lg";

export type ReceiptTemplate = {
  paperWidth: ReceiptPaperWidth;
  fontSize: ReceiptFontSize;
  showLogo: boolean;
  /** `data:image/png|jpeg|webp;base64,…` */
  logo: string | null;
  /** Logo kengligi — qog'oz kengligiga nisbatan, %. */
  logoWidth: number;
  showCompanyName: boolean;
  showAddress: boolean;
  showPhone: boolean;
  showTaxId: boolean;
  /** Kompaniya ma'lumotlari ostidagi matn: shior, filial, ish vaqti. */
  headerText: string;
  showCashier: boolean;
  showSku: boolean;
  showTax: boolean;
  showCustomer: boolean;
  showCustomerDebt: boolean;
  showCustomerBalance: boolean;
  showCashback: boolean;
  footerText: string;
  /** Sotuv yakunlanishi bilan chek avtomatik chop etiladi. */
  autoPrint: boolean;
};

export const DEFAULT_RECEIPT_TEMPLATE: ReceiptTemplate = {
  paperWidth: 80,
  fontSize: "md",
  showLogo: false,
  logo: null,
  logoWidth: 60,
  showCompanyName: true,
  showAddress: true,
  showPhone: true,
  showTaxId: false,
  headerText: "",
  showCashier: true,
  showSku: false,
  showTax: true,
  showCustomer: true,
  showCustomerDebt: true,
  showCustomerBalance: true,
  showCashback: true,
  footerText: "Xaridingiz uchun rahmat!",
  autoPrint: false,
};
