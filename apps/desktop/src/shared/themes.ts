/**
 * Kassa mavzulari — packages/shared `pos-appearance.ts` bilan bir xil ro'yxat va qoidalar (main jarayon workspace paketini
 * import qila olmaydi; moslik `test/themes.test.ts` da tekshiriladi). Mavzu faqat ko'rinish: hisob, qoldiq, to'lov va
 * sinxronga ta'sir qilmaydi. CSS tokenlari — `renderer/index.css`.
 *
 * Ustuvorlik: kompaniya qulfi → kassir tanlovi → kompaniya standarti → Windows tizimi.
 */
export const POS_THEMES = ["midnight", "snow", "ocean", "emerald", "royal", "sunset", "graphite", "glass", "neon", "classic", "high-contrast", "system"] as const;
export type PosTheme = (typeof POS_THEMES)[number];
export const CUSTOM_POS_THEME = "custom";
export type PosThemeChoice = PosTheme | typeof CUSTOM_POS_THEME;

export const THEME_LABELS: Record<PosThemeChoice, string> = {
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

export const THEME_ICONS: Record<PosThemeChoice, string> = {
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

/** Mavzu tavsifi (Sozlamalar → Tashqi ko'rinish). */
export const THEME_HINTS: Record<PosThemeChoice, string> = {
  midnight: "Yumshoq qorong'i — kechki smena uchun",
  snow: "Toza yorug', ko'zni qamashtirmaydi",
  ocean: "Ishonchli ko'k, professional",
  emerald: "Savdo va moliya uchun yashil",
  royal: "Zamonaviy binafsha",
  sunset: "Energiyali to'q sariq",
  graphite: "Neytral kulrang, kam vizual shovqin",
  glass: "Shisha paneller, o'qilishi saqlangan",
  neon: "Futuristik qorong'i, yorqin urg'u",
  classic: "Katta elementlar, animatsiyasiz — eng tez",
  "high-contrast": "Kuchli kontrast, katta shrift, aniq fokus",
  system: "Windows yorug'/qorong'i rejimiga ergashadi",
  custom: "Kompaniya ranglari",
};

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
export const DENSITY_LABELS: Record<PosDensity, string> = { compact: "Ixcham", comfortable: "Qulay", touch: "Sensorli ekran" };
export const isPosDensity = (value: unknown): value is PosDensity => typeof value === "string" && (POS_DENSITIES as readonly string[]).includes(value);

export const POS_FONT_SCALES = ["normal", "large", "xlarge"] as const;
export type PosFontScale = (typeof POS_FONT_SCALES)[number];
export const FONT_SCALE_LABELS: Record<PosFontScale, string> = { normal: "Oddiy", large: "Katta", xlarge: "Juda katta" };
export const isPosFontScale = (value: unknown): value is PosFontScale => typeof value === "string" && (POS_FONT_SCALES as readonly string[]).includes(value);
/** Ildiz shrift o'lchami (Tailwind rem — butun interfeys mutanosib kattalashadi). */
export const FONT_SCALE_PERCENT: Record<PosFontScale, string> = { normal: "", large: "112.5%", xlarge: "125%" };

export const POS_SHADOWS = ["none", "soft", "strong"] as const;
export type PosShadow = (typeof POS_SHADOWS)[number];

export const CUSTOM_THEME_COLOR_FIELDS = ["primary", "secondary", "background", "surface", "card", "button", "sidebar", "accent"] as const;
export type CustomThemeColorField = (typeof CUSTOM_THEME_COLOR_FIELDS)[number];

export type PosCustomTheme = {
  name: string;
  base: "light" | "dark";
  radius: number;
  shadow: PosShadow;
  density: PosDensity;
  fontScale: PosFontScale;
} & Record<CustomThemeColorField, string>;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
export const DARK_TEXT = "#111827";
export const LIGHT_TEXT = "#ffffff";

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

export function readableTextColor(background: string): string {
  return contrastRatio(background, DARK_TEXT) >= contrastRatio(background, LIGHT_TEXT) ? DARK_TEXT : LIGHT_TEXT;
}

/** Tuzilishi to'g'ri maxsus mavzu (kontrastni server tekshirgan). Noto'g'ri — null. */
export function parseCustomTheme(value: unknown): PosCustomTheme | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const name = typeof data.name === "string" ? data.name.trim().slice(0, 40) : "";
  if (!name || (data.base !== "light" && data.base !== "dark")) return null;
  if (!CUSTOM_THEME_COLOR_FIELDS.every((field) => typeof data[field] === "string" && HEX_COLOR.test(data[field]))) return null;
  const radius = Number(data.radius);
  if (!Number.isInteger(radius) || radius < 0 || radius > 24) return null;
  if (!(POS_SHADOWS as readonly unknown[]).includes(data.shadow) || !isPosDensity(data.density) || !isPosFontScale(data.fontScale)) return null;
  const colors = Object.fromEntries(CUSTOM_THEME_COLOR_FIELDS.map((field) => [field, String(data[field]).toLowerCase()])) as Record<CustomThemeColorField, string>;
  return { name, base: data.base, radius, shadow: data.shadow as PosShadow, density: data.density, fontScale: data.fontScale, ...colors };
}

const DARK_THEMES: ReadonlySet<string> = new Set(["midnight", "graphite", "neon", "high-contrast"]);

/** Qorong'i fonli mavzu — `dark:` variantlari ham yoqiladi. */
export function isDarkTheme(theme: string, custom?: PosCustomTheme | null): boolean {
  return theme === CUSTOM_POS_THEME ? custom?.base === "dark" : DARK_THEMES.has(theme);
}

export type ThemeSource = "company-lock" | "cashier" | "company-default" | "system";

export type CompanyAppearance = { locked: boolean; theme: unknown; custom: PosCustomTheme | null };

/** Ustuvorlik: kompaniya qulfi → kassir tanlovi → kompaniya standarti → Windows tizimi. */
export function resolvePosTheme(input: { company: CompanyAppearance | null; cashierTheme: unknown }): {
  theme: PosThemeChoice;
  source: ThemeSource;
  lock: PosThemeChoice | null;
} {
  const allowCustom = input.company?.custom != null;
  const companyTheme = input.company ? normalizePosTheme(input.company.theme, allowCustom) : null;
  if (input.company?.locked && companyTheme) return { theme: companyTheme, source: "company-lock", lock: companyTheme };
  const own = normalizePosTheme(input.cashierTheme, allowCustom);
  if (own) return { theme: own, source: "cashier", lock: null };
  if (companyTheme) return { theme: companyTheme, source: "company-default", lock: null };
  return { theme: "system", source: "system", lock: null };
}

/** "Windows System" — tizim rejimi bo'yicha Snow yoki Midnight; maxsus mavzu yo'q bo'lsa — Snow. */
export function concreteTheme(theme: PosThemeChoice, prefersDark: boolean, custom: PosCustomTheme | null): Exclude<PosThemeChoice, "system"> {
  if (theme === "system") return prefersDark ? "midnight" : "snow";
  if (theme === CUSTOM_POS_THEME && !custom) return "snow";
  return theme;
}

const SHADOWS: Record<PosShadow, [string, string]> = {
  none: ["none", "0 0 0 1px color-mix(in oklab, var(--primary) 45%, transparent)"],
  soft: ["0 1px 2px rgb(15 23 42 / 0.06), 0 2px 8px rgb(15 23 42 / 0.06)", "0 4px 10px rgb(15 23 42 / 0.1), 0 10px 24px rgb(15 23 42 / 0.1)"],
  strong: ["0 2px 4px rgb(15 23 42 / 0.12), 0 8px 20px rgb(15 23 42 / 0.14)", "0 6px 14px rgb(15 23 42 / 0.18), 0 16px 36px rgb(15 23 42 / 0.18)"],
};

/**
 * Maxsus mavzu CSS tokenlari: bir necha rangdan to'liq to'plam (matn rangi — kontrast bo'yicha qora/oq). Semantik ranglar
 * (muvaffaqiyat, ogohlantirish, xato, aksiya) CSS'da `base` bo'yicha — mavzu ularning ma'nosini buzmaydi.
 */
export function customThemeTokens(theme: PosCustomTheme): Record<string, string> {
  const text = readableTextColor;
  const mix = (a: string, b: string, percent: number) => `color-mix(in oklab, ${a} ${percent}%, ${b})`;
  const foreground = text(theme.background);
  const sidebarText = text(theme.sidebar);
  const [shadow, shadowHover] = SHADOWS[theme.shadow];
  return {
    "--radius": `${theme.radius / 16}rem`,
    "--background": theme.background,
    "--foreground": foreground,
    "--card": theme.card,
    "--card-foreground": text(theme.card),
    "--popover": theme.surface,
    "--popover-foreground": text(theme.surface),
    "--primary": theme.primary,
    "--primary-foreground": text(theme.primary),
    "--secondary": theme.secondary,
    "--secondary-foreground": text(theme.secondary),
    "--muted": mix(theme.secondary, theme.surface, 55),
    "--muted-foreground": mix(foreground, theme.background, 64),
    "--accent": theme.accent,
    "--accent-foreground": text(theme.accent),
    "--border": mix(foreground, theme.background, 16),
    "--input": mix(foreground, theme.background, 22),
    "--ring": theme.primary,
    "--sidebar": theme.sidebar,
    "--sidebar-foreground": sidebarText,
    "--sidebar-primary": theme.primary,
    "--sidebar-primary-foreground": text(theme.primary),
    "--sidebar-accent": mix(sidebarText, theme.sidebar, 14),
    "--sidebar-accent-foreground": sidebarText,
    "--sidebar-border": mix(sidebarText, theme.sidebar, 16),
    "--sidebar-ring": theme.primary,
    "--pos-surface": theme.surface,
    "--pos-topbar": theme.surface,
    "--pos-topbar-foreground": text(theme.surface),
    "--pos-cart": theme.surface,
    "--pos-total": mix(theme.primary, theme.surface, 10),
    "--pos-total-foreground": text(theme.surface),
    "--pos-category": theme.secondary,
    "--pos-category-foreground": text(theme.secondary),
    "--pos-category-active": theme.primary,
    "--pos-category-active-foreground": text(theme.primary),
    "--pos-action": theme.button,
    "--pos-action-foreground": text(theme.button),
    "--pos-action-hover": mix(theme.button, text(theme.button), 88),
    "--pos-selected": mix(theme.accent, theme.card, 70),
    "--pos-price": text(theme.card),
    "--pos-focus": theme.primary,
    "--pos-shadow": shadow,
    "--pos-shadow-hover": shadowHover,
  };
}
