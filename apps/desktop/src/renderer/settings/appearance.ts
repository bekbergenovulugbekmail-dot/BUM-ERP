/**
 * Ko'rinishni qo'llash: `data-theme` (+ qorong'i mavzularda `.dark`), `data-density`, ildiz shrift o'lchami, maxsus mavzu
 * tokenlari (inline CSS o'zgaruvchilari). "Windows System" — tizim yorug'/qorong'i rejimini kuzatadi. Faqat CSS — React
 * holati, savat, sotuv va sinxronga tegmaydi (ilova qayta yuklanmaydi).
 */
import type { DevicePrefs } from "../../shared/kassa-api.js";
import { FONT_SCALE_PERCENT, concreteTheme, customThemeTokens, isDarkTheme } from "../../shared/themes.js";

type AppearancePrefs = Pick<DevicePrefs, "theme" | "fontScale" | "density" | "customTheme">;

let media: MediaQueryList | null = null;
let listener: (() => void) | null = null;
let customKeys: string[] = [];

export function applyAppearance(prefs: AppearancePrefs, root: HTMLElement = document.documentElement) {
  if (media && listener) media.removeEventListener("change", listener);
  const query = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const update = () => {
    const theme = concreteTheme(prefs.theme, query?.matches ?? false, prefs.customTheme);
    const custom = theme === "custom" ? prefs.customTheme : null;
    root.dataset.theme = theme;
    for (const key of customKeys) root.style.removeProperty(key);
    customKeys = [];
    if (custom) {
      for (const [key, value] of Object.entries(customThemeTokens(custom))) {
        root.style.setProperty(key, value);
        customKeys.push(key);
      }
    }
    root.classList.toggle("dark", isDarkTheme(theme, custom));
    // Yuqori kontrast — shrift kamida "Katta"
    const scale = theme === "high-contrast" && prefs.fontScale === "normal" ? "large" : prefs.fontScale;
    root.style.fontSize = FONT_SCALE_PERCENT[scale];
  };
  media = query;
  listener = query ? update : null;
  query?.addEventListener("change", update);
  root.dataset.density = prefs.density;
  update();
}
