import { useCallback, useEffect, useState } from "react";
import type { AppStatus } from "../shared/kassa-api.js";
import { call, errorText } from "./kassa.ts";
import CashierScreen from "./screens/cashier-screen.tsx";
import HomeScreen from "./screens/home-screen.tsx";
import SetupScreen from "./screens/setup-screen.tsx";

/** Oqim: qurilma ro'yxatdan o'tmagan → sozlash; kassir kirmagan → PIN; aks holda — bosh ekran. */
export default function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    call("app:status").then(setStatus, (err: unknown) => setError(errorText(err)));
  }, []);

  useEffect(() => {
    refresh();
    return window.bumKassa.onSyncStatus((sync) => {
      setStatus((current) => (current ? { ...current, sync } : current));
      if (sync.state === "idle") refresh();
    });
  }, [refresh]);

  if (error) return <p className="p-8 text-destructive">{error}</p>;
  if (!status) return <p className="p-8 text-muted-foreground">Yuklanmoqda…</p>;
  if (!status.registered) return <SetupScreen onDone={setStatus} />;
  if (!status.cashier) return <CashierScreen status={status} onDone={setStatus} />;
  return <HomeScreen status={status} onChange={setStatus} />;
}
