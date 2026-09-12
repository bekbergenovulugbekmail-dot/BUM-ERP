/**
 * Desktop kassa mavzulari va kompaniya qulfi. Mavzu faqat ko'rinish — hisob, qoldiq, to'lov, sinxronga ta'sir qilmaydi.
 * Har kassir o'z mavzusini tanlaydi; kompaniya qulflasa (`pos.appearance`) — hamma kassada shu mavzu.
 */
export const POS_THEMES = ["light", "dark", "blue", "green", "purple", "orange", "high-contrast", "classic", "system"] as const;
export type PosTheme = (typeof POS_THEMES)[number];

export const POS_THEME_LABELS: Record<PosTheme, string> = {
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

export const POS_APPEARANCE_KEY = "pos.appearance";

export type PosAppearance = { locked: boolean; theme: PosTheme };

export const DEFAULT_POS_APPEARANCE: PosAppearance = { locked: false, theme: "light" };

export const isPosTheme = (value: unknown): value is PosTheme => typeof value === "string" && (POS_THEMES as readonly string[]).includes(value);

export function parsePosAppearance(raw: string | null | undefined): PosAppearance {
  if (!raw) return DEFAULT_POS_APPEARANCE;
  try {
    const data = JSON.parse(raw) as { locked?: unknown; theme?: unknown };
    return { locked: data.locked === true, theme: isPosTheme(data.theme) ? data.theme : DEFAULT_POS_APPEARANCE.theme };
  } catch {
    return DEFAULT_POS_APPEARANCE;
  }
}
