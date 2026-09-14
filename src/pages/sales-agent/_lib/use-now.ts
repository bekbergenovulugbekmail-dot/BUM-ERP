import { useEffect, useState } from "react";

/** Joriy vaqt (ms), har `intervalMs` da yangilanadi — taymerlar uchun (render ichida `Date.now()` chaqirilmaydi). */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // Ilova fonda (ekran o'chgan) — taymer qayta chizmaydi; qaytganda keyingi tikda yangilanadi
    const timer = setInterval(() => {
      if (typeof document === "undefined" || !document.hidden) setNow(Date.now());
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
