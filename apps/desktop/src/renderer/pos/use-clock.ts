import { useEffect, useState } from "react";

/** Joriy vaqt (yuqori panel soati) — daqiqa aniqligida ko'rsatish uchun davriy yangilanadi. */
export function useClock(intervalMs = 15_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
