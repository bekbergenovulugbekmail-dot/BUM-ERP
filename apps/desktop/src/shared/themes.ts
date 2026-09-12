/**
 * Kassa mavzulari (packages/shared `pos-appearance` bilan bir xil ro'yxat). Mavzu faqat ranglar — hisob, qoldiq,
 * to'lov va sinxronga ta'sir qilmaydi. CSS: `renderer/index.css` dagi `[data-theme]` bloklari.
 */
export const POS_THEMES = ["light", "dark", "blue", "green", "purple", "orange", "high-contrast", "classic", "system"] as const;
export type PosTheme = (typeof POS_THEMES)[number];

export const THEME_LABELS: Record<PosTheme, string> = {
  light: "Yorug'",
  dark: "Qorong'i",
  blue: "Ko'k",
  green: "Yashil",
  purple: "Binafsha",
  orange: "To'q sariq",
  "high-contrast": "Yuqori kontrast",
  classic: "Klassik POS",
  system: "Windows bo'yicha",
};

export const isPosTheme = (value: unknown): value is PosTheme => typeof value === "string" && (POS_THEMES as readonly string[]).includes(value);

/** Qorong'i fonli mavzular — `dark:` variantlari ham yoqiladi. */
export const isDarkTheme = (theme: string) => theme === "dark" || theme === "high-contrast";
