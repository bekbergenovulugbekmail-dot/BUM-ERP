import { useEffect, useState } from "react";

/** Windows qorong'i rejimi (Electron `nativeTheme` → `prefers-color-scheme`), o'zgarsa yangilanadi. */
export function usePrefersDark(): boolean {
  const [dark, setDark] = useState(() => (typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)").matches : false));
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setDark(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return dark;
}
