import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { AppStatus, DevicePrefs } from "../shared/kassa-api.js";
import { call, errorText } from "./kassa.ts";
import AnalyticsScreen from "./screens/analytics-screen.tsx";
import CashierScreen from "./screens/cashier-screen.tsx";
import CountScreen from "./screens/count-screen.tsx";
import HistoryScreen from "./screens/history-screen.tsx";
import HomeScreen from "./screens/home-screen.tsx";
import KassaScreen from "./screens/kassa-screen.tsx";
import LabelsScreen from "./screens/labels-screen.tsx";
import MovementsScreen from "./screens/movements-screen.tsx";
import PosScreen from "./screens/pos-screen.tsx";
import PurchaseScreen from "./screens/purchase-screen.tsx";
import ReferencesScreen from "./screens/references-screen.tsx";
import SettingsScreen from "./screens/settings-screen.tsx";
import SetupScreen from "./screens/setup-screen.tsx";
import WarehouseScreen from "./screens/warehouse-screen.tsx";
import { applyAppearance } from "./settings/appearance.ts";
import LockOverlay from "./settings/lock-overlay.tsx";
import { applyScript } from "./settings/transliterate.ts";

export type View = "home" | "pos" | "history" | "kassa" | "purchase" | "warehouse" | "movements" | "count" | "labels" | "references" | "analytics" | "settings";

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "wheel"] as const;

/** Oqim: qurilma ro'yxatdan o'tmagan → sozlash; kassir kirmagan → PIN; aks holda — bosh ekran yoki bo'lim. */
export default function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("home");
  const [movementProduct, setMovementProduct] = useState<{ id: string; name: string } | null>(null);
  const [prefs, setPrefs] = useState<DevicePrefs | null>(null);
  const [locked, setLocked] = useState(false);

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

  // Qurilma sozlamalari: mavzu, shrift, til (kirill), avtomatik blok
  const registered = status?.registered ?? false;
  const cashierId = status?.cashier?.userId ?? null;
  useEffect(() => {
    if (!registered) return;
    call("device:prefs").then(setPrefs, () => undefined);
  }, [registered, cashierId]);

  useEffect(() => {
    if (!prefs) return;
    applyAppearance(prefs);
    applyScript(prefs.language);
  }, [prefs]);

  const autoLockMinutes = prefs?.autoLockMinutes ?? 0;
  useEffect(() => {
    if (!cashierId || autoLockMinutes <= 0 || locked) return;
    const delay = autoLockMinutes * 60_000;
    const holder = { timer: setTimeout(() => setLocked(true), delay) };
    const reset = () => {
      clearTimeout(holder.timer);
      holder.timer = setTimeout(() => setLocked(true), delay);
    };
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, reset, { passive: true });
    return () => {
      clearTimeout(holder.timer);
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, reset);
    };
  }, [cashierId, autoLockMinutes, locked]);

  if (error) return <p className="p-8 text-destructive">{error}</p>;
  if (!status) return <p className="p-8 text-muted-foreground">Yuklanmoqda…</p>;
  if (!status.registered) return <SetupScreen onDone={setStatus} />;
  const afterLogin = (next: AppStatus) => {
    setLocked(false);
    setStatus(next);
  };
  if (!status.cashier) return <CashierScreen status={status} onDone={afterLogin} />;

  const home = () => setView("home");
  const renderView = (): ReactNode => {
    switch (view) {
      case "pos":
        return <PosScreen status={status} onStatus={setStatus} onExit={home} onNavigate={setView} />;
      case "history":
        return <HistoryScreen status={status} onExit={home} />;
      case "kassa":
        return <KassaScreen status={status} onStatus={setStatus} onExit={home} />;
      case "purchase":
        return <PurchaseScreen status={status} onStatus={setStatus} onExit={home} />;
      case "warehouse":
        return (
          <WarehouseScreen
            status={status}
            onStatus={setStatus}
            onExit={home}
            onMovements={(product) => {
              setMovementProduct(product);
              setView("movements");
            }}
          />
        );
      case "movements":
        return <MovementsScreen key={movementProduct?.id ?? "all"} status={status} initialProduct={movementProduct} onExit={home} />;
      case "count":
        return <CountScreen status={status} onStatus={setStatus} onExit={home} />;
      case "labels":
        return <LabelsScreen status={status} onExit={home} />;
      case "references":
        return <ReferencesScreen status={status} onExit={home} />;
      case "analytics":
        return <AnalyticsScreen status={status} onExit={home} />;
      case "settings":
        return <SettingsScreen status={status} prefs={prefs} onPrefs={setPrefs} onStatus={setStatus} onExit={home} />;
      default:
        return (
          <HomeScreen
            status={status}
            onChange={setStatus}
            onOpen={(next) => {
              setMovementProduct(null);
              setView(next);
            }}
          />
        );
    }
  };

  return (
    <>
      {renderView()}
      {locked && <LockOverlay status={status} onUnlocked={afterLogin} onSwitched={afterLogin} />}
    </>
  );
}
