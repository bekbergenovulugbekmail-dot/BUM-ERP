/**
 * Desktop kassa ko'rinishi: 12 ta tayyor mavzu, kompaniya standart mavzusi va qulfi, kompaniya maxsus mavzusi (kontrast
 * tekshiruvidan o'tgan). Mavzu faqat ko'rinish — hisob, qoldiq, to'lov, sinxronga ta'sir qilmaydi.
 *
 * Kassada mavzu ustuvorligi: kompaniya qulfi → kassir tanlovi → kompaniya standarti → Windows tizimi
 * (desktop `shared/themes.ts` `resolvePosTheme` — shu fayl bilan bir xil ro'yxat va qoidalar).
 */
export const POS_THEMES = ["midnight", "snow", "ocean", "emerald", "royal", "sunset", "graphite", "glass", "neon", "classic", "high-contrast", "system"] as const;
export type PosTheme = (typeof POS_THEMES)[number];

/** Kompaniya maxsus mavzusi (web'da yaratiladi). */
export const CUSTOM_POS_THEME = "custom";
export type PosThemeChoice = PosTheme | typeof CUSTOM_POS_THEME;

export const POS_THEME_LABELS: Record<PosThemeChoice, string> = {
  midnight: "Midnight POS",
  snow: "Snow POS",
  ocean: "Ocean Blue",
  emerald: "Emerald",
  royal: "Royal Purple",
  sunset: "Sunset Orange",
  graphite: "Graphite",
  glass: "Glass POS",
  neon: "Neon Night",
  classic: "Classic Supermarket",
  "high-contrast": "High Contrast",
  system: "Windows System",
  custom: "Kompaniya mavzusi",
};

export const POS_THEME_ICONS: Record<PosThemeChoice, string> = {
  midnight: "🌑",
  snow: "❄️",
  ocean: "🌊",
  emerald: "💚",
  royal: "💜",
  sunset: "🟠",
  // 🩶 va 🪟 Windows 10 shriftida yo'q (kvadrat chiqadi) — o'rniga Windows 10 da ko'rinadigan belgilar
  graphite: "🌫️",
  glass: "✨",
  neon: "⚡",
  classic: "🛒",
  "high-contrast": "👁️",
  system: "💻",
  custom: "🎨",
};

/** Oldingi versiyadagi (K4) mavzu nomlari — saqlangan sozlamalar yo'qolmasin. */
export const LEGACY_POS_THEMES: Readonly<Record<string, PosTheme>> = {
  light: "snow",
  dark: "midnight",
  blue: "ocean",
  green: "emerald",
  purple: "royal",
  orange: "sunset",
};

export function normalizePosTheme(value: unknown, allowCustom = true): PosThemeChoice | null {
  if (typeof value !== "string") return null;
  if ((POS_THEMES as readonly string[]).includes(value)) return value as PosTheme;
  if (value === CUSTOM_POS_THEME) return allowCustom ? CUSTOM_POS_THEME : null;
  return LEGACY_POS_THEMES[value] ?? null;
}

export const isPosTheme = (value: unknown): value is PosTheme => typeof value === "string" && (POS_THEMES as readonly string[]).includes(value);

export const POS_DENSITIES = ["compact", "comfortable", "touch"] as const;
export type PosDensity = (typeof POS_DENSITIES)[number];
export const POS_DENSITY_LABELS: Record<PosDensity, string> = { compact: "Ixcham", comfortable: "Qulay", touch: "Sensorli ekran" };

export const POS_FONT_SCALES = ["normal", "large", "xlarge"] as const;
export type PosFontScale = (typeof POS_FONT_SCALES)[number];
export const POS_FONT_SCALE_LABELS: Record<PosFontScale, string> = { normal: "Oddiy", large: "Katta", xlarge: "Juda katta" };

export const POS_SHADOWS = ["none", "soft", "strong"] as const;
export type PosShadow = (typeof POS_SHADOWS)[number];

export const CUSTOM_THEME_COLOR_FIELDS = ["primary", "secondary", "background", "surface", "card", "button", "sidebar", "accent"] as const;
export type CustomThemeColorField = (typeof CUSTOM_THEME_COLOR_FIELDS)[number];

export const CUSTOM_THEME_COLOR_LABELS: Record<CustomThemeColorField, string> = {
  primary: "Asosiy rang",
  secondary: "Ikkinchi darajali",
  background: "Fon",
  surface: "Panel (savat, yuqori panel)",
  card: "Karta",
  button: "To'lov tugmasi",
  sidebar: "Yon panel",
  accent: "Urg'u (tanlangan)",
};

export type PosCustomTheme = {
  name: string;
  /** Yorug' yoki qorong'i asos: semantik ranglar (muvaffaqiyat, ogohlantirish, xato, aksiya) shu asosdan olinadi. */
  base: "light" | "dark";
  radius: number;
  shadow: PosShadow;
  density: PosDensity;
  fontScale: PosFontScale;
} & Record<CustomThemeColorField, string>;

/** To'lov paneli (mijoz, to'lov usullari, jami, yakunlash) ekranning qaysi tomonida. */
export const POS_PANEL_SIDES = ["right", "left"] as const;
export type PosPanelSide = (typeof POS_PANEL_SIDES)[number];
export const POS_PANEL_SIDE_LABELS: Record<PosPanelSide, string> = { right: "O'ng tomonda", left: "Chap tomonda" };

/**
 * Kassa ekrani tuzilishi (boshqa kassalardagi keng tarqalgan variantlar):
 *   classic — mahsulot kartalari katta maydonda, savat va to'lov yon panelda (supermarket sensorli kassa)
 *   table   — savat jadval ko'rinishida katta maydonda, mahsulot qidiruv/skaner bilan qo'shiladi (Bito, iiko uslubi)
 *   compact — kichik kartalar ro'yxati va kengroq to'lov paneli (kichik ekran, noutbuk)
 */
export const POS_LAYOUTS = ["classic", "table", "compact"] as const;
export type PosLayout = (typeof POS_LAYOUTS)[number];
export const POS_LAYOUT_LABELS: Record<PosLayout, string> = {
  classic: "Klassik — mahsulot kartalari va yon savat",
  table: "Jadval — savat jadvali, qidiruv va skaner bilan",
  compact: "Ixcham — kichik ro'yxat, keng to'lov paneli",
};

export type PosAppearance = {
  /** true — hamma kassada `theme`, kassir o'zgartira olmaydi; false — kassir tanlamagan bo'lsa `theme` (kompaniya standarti). */
  locked: boolean;
  theme: PosThemeChoice;
  custom: PosCustomTheme | null;
  /** Biznes egasi tanlaydi — web va desktop kassada bir xil. */
  paymentPanelSide: PosPanelSide;
  layout: PosLayout;
};

export const POS_APPEARANCE_KEY = "pos.appearance";

export const DEFAULT_POS_APPEARANCE: PosAppearance = { locked: false, theme: "system", custom: null, paymentPanelSide: "right", layout: "classic" };

// ─── Kontrast (WCAG 2.x) ─────────────────────────────────────────────────────

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
export const DARK_TEXT = "#111827";
export const LIGHT_TEXT = "#ffffff";

export const isHexColor = (value: unknown): value is string => typeof value === "string" && HEX_COLOR.test(value);

/** Nisbiy yorqinlik (sRGB). */
export function relativeLuminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** Rang ustidagi matn: qora yoki oq — qaysi biri kontrastliroq. */
export function readableTextColor(background: string): string {
  return contrastRatio(background, DARK_TEXT) >= contrastRatio(background, LIGHT_TEXT) ? DARK_TEXT : LIGHT_TEXT;
}

export type ThemeContrastIssue = { field: CustomThemeColorField; ratio: number; min: number; message: string };

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Maxsus mavzu kontrasti: har rang ustidagi matn ≥ 4.5:1 (WCAG AA), asosiy rang fonga va to'lov tugmasi panelga
 * nisbatan ≥ 3:1 (interfeys elementi ko'rinishi, WCAG 1.4.11). Bo'sh ro'yxat — o'tdi.
 */
export function validateCustomTheme(theme: PosCustomTheme): ThemeContrastIssue[] {
  const issues: ThemeContrastIssue[] = [];
  for (const field of CUSTOM_THEME_COLOR_FIELDS) {
    const color = theme[field];
    const ratio = contrastRatio(color, readableTextColor(color));
    if (ratio < 4.5) {
      issues.push({ field, ratio: round(ratio), min: 4.5, message: `${CUSTOM_THEME_COLOR_LABELS[field]}: matn kontrasti ${round(ratio)}:1 (kamida 4.5:1)` });
    }
  }
  const visible = (field: CustomThemeColorField, against: CustomThemeColorField, label: string) => {
    const ratio = contrastRatio(theme[field], theme[against]);
    if (ratio < 3) issues.push({ field, ratio: round(ratio), min: 3, message: `${label}: ${round(ratio)}:1 (kamida 3:1)` });
  };
  visible("primary", "background", "Asosiy rang fondan ajralmaydi");
  visible("button", "surface", "To'lov tugmasi paneldan ajralmaydi");
  return issues;
}

/** Tuzilishi to'g'ri maxsus mavzu (kontrast alohida — `validateCustomTheme`). Noto'g'ri — null. */
export function parseCustomTheme(value: unknown): PosCustomTheme | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const name = typeof data.name === "string" ? data.name.trim().slice(0, 40) : "";
  if (!name || (data.base !== "light" && data.base !== "dark")) return null;
  if (!CUSTOM_THEME_COLOR_FIELDS.every((field) => isHexColor(data[field]))) return null;
  const radius = Number(data.radius);
  if (!Number.isInteger(radius) || radius < 0 || radius > 24) return null;
  if (!(POS_SHADOWS as readonly unknown[]).includes(data.shadow)) return null;
  if (!(POS_DENSITIES as readonly unknown[]).includes(data.density)) return null;
  if (!(POS_FONT_SCALES as readonly unknown[]).includes(data.fontScale)) return null;
  const colors = Object.fromEntries(CUSTOM_THEME_COLOR_FIELDS.map((field) => [field, String(data[field]).toLowerCase()])) as Record<CustomThemeColorField, string>;
  return { name, base: data.base, radius, shadow: data.shadow as PosShadow, density: data.density as PosDensity, fontScale: data.fontScale as PosFontScale, ...colors };
}

/** Saqlangan qiymat: eski nomlar yangisiga, kontrastdan o'tmagan maxsus mavzu va maxsus mavzusiz `custom` — tashlanadi. */
export function parsePosAppearance(raw: string | null | undefined): PosAppearance {
  if (!raw) return DEFAULT_POS_APPEARANCE;
  try {
    const data = JSON.parse(raw) as { locked?: unknown; theme?: unknown; custom?: unknown; paymentPanelSide?: unknown; layout?: unknown };
    const parsed = parseCustomTheme(data.custom);
    const custom = parsed && validateCustomTheme(parsed).length === 0 ? parsed : null;
    return {
      locked: data.locked === true,
      theme: normalizePosTheme(data.theme, custom !== null) ?? DEFAULT_POS_APPEARANCE.theme,
      custom,
      paymentPanelSide: (POS_PANEL_SIDES as readonly unknown[]).includes(data.paymentPanelSide) ? (data.paymentPanelSide as PosPanelSide) : DEFAULT_POS_APPEARANCE.paymentPanelSide,
      layout: (POS_LAYOUTS as readonly unknown[]).includes(data.layout) ? (data.layout as PosLayout) : DEFAULT_POS_APPEARANCE.layout,
    };
  } catch {
    return DEFAULT_POS_APPEARANCE;
  }
}

/** Web muharririda boshlang'ich maxsus mavzu (Ocean Blue'ga yaqin, kontrastdan o'tadi). */
export const DEFAULT_CUSTOM_THEME: PosCustomTheme = {
  name: "Kompaniya mavzusi",
  base: "light",
  primary: "#1d4ed8",
  secondary: "#e2e8f0",
  background: "#eef2f7",
  surface: "#ffffff",
  card: "#ffffff",
  button: "#15803d",
  sidebar: "#1e293b",
  accent: "#dbeafe",
  radius: 10,
  shadow: "soft",
  density: "comfortable",
  fontScale: "normal",
};
