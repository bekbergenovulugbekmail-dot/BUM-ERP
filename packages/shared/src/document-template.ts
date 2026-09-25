/**
 * Hujjat shabloni — server va brauzer uchun YAGONA ta'rif.
 *
 * Shablon PREZENTATSIYA qatlami: u "qaysi qiymat qayerda va qanday ko'rinsin" deydi, xolos.
 * Qiymatning o'zi hujjat ma'lumotidan keladi, shuning uchun shablonni tahrirlab summani
 * o'zgartirib bo'lmaydi.
 *
 * XAVFSIZLIK: bu yerdagi ro'yxatlar OQ RO'YXAT. Server saqlashdan oldin shablonni shu
 * ro'yxatlar bo'yicha qayta quradi — noma'lum kalit, HTML, JS yoki ixtiyoriy URL saqlanmaydi.
 */

/** Qaysi hujjat turi uchun shablon. */
export const DOCUMENT_TYPES = ["delivery_waybill", "sales_invoice", "purchase_order", "payslip"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  delivery_waybill: "Yetkazma nakladnoyi",
  sales_invoice: "Sotuv hisob-fakturasi",
  purchase_order: "Xarid buyurtmasi",
  payslip: "Maosh varaqasi",
};

/** Sahifadagi uchta mintaqa: sarlavha har sahifada, footer — sozlamaga qarab. */
export const SECTIONS = ["header", "body", "footer"] as const;
export type SectionKey = (typeof SECTIONS)[number];

/**
 * Element turlari. Har biri `pdf-utils` dagi mavjud chizish funksiyasiga tushadi —
 * yangi chizish dvigateli qurilmaydi.
 */
export const ELEMENT_TYPES = [
  "text", //        erkin matn (yorliq): "Qabul qildi:"
  "field", //       bitta dinamik qiymat: {{customer.name}}
  "image", //       kompaniya logotipi yoki yuklangan rasm
  "line", //        ajratuvchi chiziq
  "spacer", //      bo'sh joy
  "itemsTable", //  mahsulot/yetkazma jadvali (ustunlari tanlanadi)
  "totals", //      jami bloki (qaysi qatorlar ko'rinishi tanlanadi)
  "payments", //    to'lov usullari bo'yicha taqsimot
  "signatures", //  imzo joylari
  "rect", //        to'rtburchak ramka (ajratish, imzo qutisi)
  "qr", //          hujjat raqami yoki buyurtma raqami (ixtiyoriy URL emas)
  "barcode", //     shtrix-kod (Code128) — o'sha manbalardan
  "pageNumber", //  "1 / 3"
] as const;
export type ElementType = (typeof ELEMENT_TYPES)[number];

export const ALIGNMENTS = ["left", "center", "right"] as const;
export type Alignment = (typeof ALIGNMENTS)[number];

export const VALIGNMENTS = ["top", "middle", "bottom"] as const;
export type VAlignment = (typeof VALIGNMENTS)[number];

/** Chiziq ko'rinishi — jadval va ramkalar uchun. */
export const BORDER_STYLES = ["solid", "dashed", "dotted", "double"] as const;
export type BorderStyle = (typeof BORDER_STYLES)[number];

/**
 * Jadval chiziqlari va kataklari. HAR CHIZIQ ALOHIDA boshqariladi: foydalanuvchi
 * tashqi ramkani qoldirib ichki chiziqlarni o'chirishi (yoki aksincha) mumkin.
 *
 * `undefined` = standart ko'rinish (hozirgi nakladnoydagidek) — eski shablonlar
 * shu sababli o'zgarmaydi.
 */
export type TableStyle = {
  borderStyle?: BorderStyle;
  /** mm: 0 = chiziq yo'q. */
  borderWidth?: number;
  /** `#rrggbb`. */
  borderColor?: string;
  /** Tashqi ramka (to'rt tomon birdan). */
  outer?: boolean;
  top?: boolean;
  bottom?: boolean;
  left?: boolean;
  right?: boolean;
  /** Qatorlar orasidagi gorizontal chiziqlar. */
  horizontal?: boolean;
  /** Ustunlar orasidagi vertikal chiziqlar. */
  vertical?: boolean;
  /** Sarlavha ostidagi chiziq. */
  headerBorder?: boolean;
  /** Katak ichidagi bo'shliq, mm. */
  paddingX?: number;
  paddingY?: number;
  /** Qatorning eng kam balandligi, mm. */
  rowHeight?: number;
  /** Jadval matni, pt. */
  fontSize?: number;
  /** Sarlavha foni va matni, `#rrggbb`. */
  headerFill?: string;
  headerText?: string;
  /** Qatorlarni navbat bilan bo'yash. */
  zebra?: boolean;
  /** Katak ichida matn vertikal qayerda turadi. */
  valign?: VAlignment;
};

/** Rasm va to'rtburchak uchun ramka. */
export type BoxStyle = {
  borderStyle?: BorderStyle;
  /** mm */
  borderWidth?: number;
  borderColor?: string;
  /** Burchak radiusi, mm. */
  radius?: number;
  /** Ichini bo'yash, `#rrggbb`. */
  fill?: string;
};

/** QR xatolikka chidamliligi — qancha yuqori bo'lsa shuncha zichroq, lekin ishonchliroq. */
export const QR_LEVELS = ["L", "M", "Q", "H"] as const;
export type QrLevel = (typeof QR_LEVELS)[number];

/** Rasm katagiga qanday joylashadi. */
export const IMAGE_FITS = ["contain", "fill"] as const;
export type ImageFit = (typeof IMAGE_FITS)[number];

/** Matn uslubi — faqat shu kalitlar saqlanadi. */
export type TextStyle = {
  /** Punktda; hujjat o'lchovlari mm, shrift esa pt (jsPDF shunday ishlaydi). */
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  align?: Alignment;
  /** `#rrggbb`; boshqa format qabul qilinmaydi (`rgb()`, `url()` — yo'q). */
  color?: string;
};

/**
 * Shart bo'yicha ko'rsatish. Faqat TUZILMALI shart — ifoda matni emas, shuning uchun
 * `eval` yoki SQL ishlatilmaydi.
 */
export const CONDITION_OPERATORS = ["gt", "gte", "lt", "lte", "eq", "ne", "empty", "notEmpty"] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export type VisibilityCondition = {
  /** Bog'lanish yo'li — maydonlar katalogidan (`document.debt`). */
  field: string;
  operator: ConditionOperator;
  /** `empty`/`notEmpty` da ishlatilmaydi. Faqat son yoki matn. */
  value?: string | number;
};

export type DocumentElement = {
  id: string;
  type: ElementType;
  /** Erkin matn yoki maydon yorlig'i ("Mijoz:"). Qiymat EMAS. */
  label?: string;
  /** `field` uchun: maydonlar katalogidagi yo'l (`customer.name`). */
  field?: string;
  /** `itemsTable` uchun: ustunlar (katalogdan), nomi, kengligi va tekislashi. */
  columns?: { key: string; label?: string; width?: number; align?: Alignment }[];
  /** `itemsTable` uchun: chiziqlar va katak sozlamalari. */
  table?: TableStyle;
  /** `image` va `rect` uchun: ramka, radius, fon. */
  box?: BoxStyle;
  /** `image` uchun: katakka sig'dirish (nisbatni saqlab) yoki cho'zish. */
  fit?: ImageFit;
  /** `qr` uchun: xatolikka chidamlilik va chekka (modul soni). */
  qrLevel?: QrLevel;
  qrMargin?: number;
  /** `totals` va `payments` uchun: qaysi qatorlar ko'rinadi. */
  rows?: string[];
  /**
   * `image` uchun rasm — `data:image/...;base64,...` ko'rinishida, shablon ichida.
   *
   * Nega fayl kaliti emas: production'da fayl saqlash (S3) sozlanmagan, chek logotipi ham
   * shu yo'l bilan ishlaydi. Data URL tashqi tarmoqqa chiqmaydi va skript bajarmaydi —
   * server uni qat'iy tekshiradi (faqat png/jpeg/webp, hajm chegarasi bilan).
   */
  imageData?: string;
  /** `qr` va `barcode` uchun: nimani kodlash — faqat ro'yxatdan. */
  qrSource?: "documentNumber" | "orderNumber" | "customerPhone";
  /** mm; berilmasa element butun kenglikni egallaydi. */
  width?: number;
  height?: number;
  /**
   * ERKIN JOYLASHUV (`page.layout === "free"`): elementning sahifadagi joyi, mm.
   * Nuqta — sahifaning YUQORI CHAP burchagi (chekkalardan emas), ya'ni dizayner va PDF bitta
   * koordinata tizimida ishlaydi va zoom/ekran o'lchami joyni o'zgartirmaydi.
   */
  x?: number;
  y?: number;
  /** Qatlam: kattasi ustida chiziladi. */
  zIndex?: number;
  /** Rasm uchun: burchakdan tortilganda nisbat saqlanadimi (standart — ha). */
  lockRatio?: boolean;
  style?: TextStyle;
  /** Shart bajarilmasa element chizilmaydi. */
  visibleWhen?: VisibilityCondition;
};

export type DocumentSection = {
  key: SectionKey;
  elements: DocumentElement[];
};

/**
 * Joylashuv rejimi.
 *  - `flow` — elementlar yuqoridan pastga ketma-ket (eski shablonlar shunday qoladi);
 *  - `free` — har element o'z `x/y/width/height` joyida (vizual dizayner).
 */
export const LAYOUT_MODES = ["flow", "free"] as const;
export type LayoutMode = (typeof LAYOUT_MODES)[number];

export type PageSettings = {
  /** Hozircha A4; kelajakda A5/A3 qo'shiladi. */
  size: "a4";
  /** Berilmasa — `flow` (eski shablonlar o'zgarmaydi). */
  layout?: LayoutMode;
  orientation: "portrait" | "landscape";
  /** mm */
  margins: { top: number; right: number; bottom: number; left: number };
  /** Footer har sahifada chiqadimi yoki faqat oxirgisida. */
  footerOnEveryPage: boolean;
  /** Imzo bloki faqat oxirgi sahifada (odatda shunday). */
  signaturesOnLastPage: boolean;
};

export type DocumentTemplateSchema = {
  /** Sxema versiyasi — kelajakdagi migratsiya uchun. */
  schemaVersion: 1;
  page: PageSettings;
  sections: DocumentSection[];
};

export const DEFAULT_PAGE: PageSettings = {
  size: "a4",
  orientation: "portrait",
  margins: { top: 14, right: 14, bottom: 14, left: 14 },
  footerOnEveryPage: true,
  signaturesOnLastPage: true,
};

/** Uslub chegaralari — nomutanosib qiymat hujjatni buzmasin. */
export const STYLE_LIMITS = {
  fontSizeMin: 5,
  fontSizeMax: 48,
  widthMax: 420,
  heightMax: 420,
} as const;

/** Sahifa o'lchami, mm (kitob holatida). */
export const PAGE_SIZES_MM = { a4: { width: 210, height: 297 } } as const;

/** Sahifaning mm dagi eni va bo'yi — yo'nalishga qarab. */
export function pageSizeMm(page: Pick<PageSettings, "size" | "orientation">): { width: number; height: number } {
  const base = PAGE_SIZES_MM[page.size] ?? PAGE_SIZES_MM.a4;
  return page.orientation === "landscape" ? { width: base.height, height: base.width } : { ...base };
}

/** Erkin joylashuvdami. */
export const isFreeLayout = (schema: { page: Pick<PageSettings, "layout"> }) => schema.page.layout === "free";

/** `#rrggbb` (katta-kichik harf farqsiz). Boshqa hech narsa qabul qilinmaydi. */
export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const MAX_ELEMENTS_PER_SECTION = 60;
export const MAX_TABLE_COLUMNS = 12;

/** Shablondagi rasm hajmi (data URL uzunligi) — chek logotipi bilan bir xil chegara. */
export const MAX_IMAGE_DATA_LENGTH = 300_000;

/** Ruxsat etilgan rasm boshlanishi. Boshqa hech narsa (`svg`, `data:text/html`) qabul qilinmaydi. */
export const IMAGE_DATA_PREFIX = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

/** QR ichiga nima yoziladi — faqat shu manbalardan (ixtiyoriy URL emas). */
export const QR_SOURCES = ["documentNumber", "orderNumber", "customerPhone"] as const;
export type QrSource = (typeof QR_SOURCES)[number];
