/**
 * Tashqi ko'rinish: mavzu (`data-theme` + qorong'i mavzularda `.dark`) va shrift o'lchami. "Windows bo'yicha" — tizim
 * yorug'/qorong'i rejimini kuzatadi. Faqat CSS tokenlari — hisob va mantiqqa ta'sir qilmaydi.
 */
import type { DevicePrefs } from "../../shared/kassa-api.js";
import { isDarkTheme } from "../../shared/themes.js";

let media: MediaQueryList | null = null;
let listener: (() => void) | null = null;

export function applyAppearance(prefs: Pick<DevicePrefs, "theme" | "fontScale">) {
  const root = document.documentElement;
  if (media && listener) media.removeEventListener("change", listener);
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const update = () => {
    const resolved = prefs.theme === "system" ? (query.matches ? "dark" : "light") : prefs.theme;
    root.dataset.theme = resolved;
    root.classList.toggle("dark", isDarkTheme(resolved));
  };
  media = query;
  listener = update;
  query.addEventListener("change", update);
  update();
  root.style.fontSize = prefs.fontScale === "large" ? "112.5%" : "";
}
