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

// ─── Etiketkalar ─────────────────────────────────────────────────────────────

/** roll — termal etiketka printeri (har etiketka alohida sahifa); a4 — varaqqa ustunlab. */
export type LabelLayout = "roll" | "a4";
export type LabelCodeType = "barcode" | "qr" | "none";

export type LabelTemplate = {
  id: string;
  name: string;
  layout: LabelLayout;
  widthMm: number;
  heightMm: number;
  /** Faqat A4: ustunlar soni va etiketkalar orasidagi masofa. */
  columns: number;
  gapMm: number;
  /** Kod mahsulot shtrix-kodidan, u bo'lmasa SKU'dan olinadi. */
  codeType: LabelCodeType;
  showCompanyName: boolean;
  showName: boolean;
  showPrice: boolean;
  showSku: boolean;
  showCodeText: boolean;
  showBorder: boolean;
  fontSize: "sm" | "md" | "lg";
};

export type LabelSettings = { defaultTemplateId: string; templates: LabelTemplate[] };

export const LABEL_LIMITS = { minMm: 15, maxMm: 150, maxTemplates: 20, maxColumns: 10, maxGapMm: 20 };

/** Saqlangan shablonda yo'q maydonlar shu qiymatlar bilan to'ldiriladi. */
export const LABEL_TEMPLATE_DEFAULTS: Omit<LabelTemplate, "id" | "name"> = {
  layout: "roll",
  widthMm: 58,
  heightMm: 40,
  columns: 1,
  gapMm: 0,
  codeType: "barcode",
  showCompanyName: false,
  showName: true,
  showPrice: true,
  showSku: true,
  showCodeText: true,
  showBorder: false,
  fontSize: "md",
};

export const LABEL_PRESETS: LabelTemplate[] = [
  { ...LABEL_TEMPLATE_DEFAULTS, id: "preset-58x40", name: "58 × 40 mm" },
  { ...LABEL_TEMPLATE_DEFAULTS, id: "preset-40x30", name: "40 × 30 mm", widthMm: 40, heightMm: 30, showSku: false, fontSize: "sm" },
  {
    ...LABEL_TEMPLATE_DEFAULTS,
    id: "preset-30x20",
    name: "30 × 20 mm (narx)",
    widthMm: 30,
    heightMm: 20,
    showName: false,
    showSku: false,
    showCodeText: false,
    fontSize: "sm",
  },
  {
    ...LABEL_TEMPLATE_DEFAULTS,
    id: "preset-a4-70x37",
    name: "A4 varaq — 70 × 37 mm",
    layout: "a4",
    widthMm: 70,
    heightMm: 37,
    columns: 3,
    showSku: false,
    showBorder: true,
  },
];

export const DEFAULT_LABEL_SETTINGS: LabelSettings = { defaultTemplateId: "preset-58x40", templates: LABEL_PRESETS };
