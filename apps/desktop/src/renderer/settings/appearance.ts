/** Tashqi ko'rinish: yorug'/qorong'i/tizim mavzusi (web'dagi `.dark` tokenlari) va shrift o'lchami. */
import type { DevicePrefs } from "../../shared/kassa-api.js";

let media: MediaQueryList | null = null;
let listener: (() => void) | null = null;

export function applyAppearance(prefs: Pick<DevicePrefs, "theme" | "fontScale">) {
  const root = document.documentElement;
  if (media && listener) media.removeEventListener("change", listener);
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const update = () => root.classList.toggle("dark", prefs.theme === "dark" || (prefs.theme === "system" && query.matches));
  media = query;
  listener = update;
  query.addEventListener("change", update);
  update();
  root.style.fontSize = prefs.fontScale === "large" ? "112.5%" : "";
}
