import { useCallback, useEffect, useState } from "react";
import type { AppStatus } from "../shared/kassa-api.js";
import { call, errorText } from "./kassa.ts";
import CashierScreen from "./screens/cashier-screen.tsx";
import CountScreen from "./screens/count-screen.tsx";
import HistoryScreen from "./screens/history-screen.tsx";
import HomeScreen from "./screens/home-screen.tsx";
import KassaScreen from "./screens/kassa-screen.tsx";
import LabelsScreen from "./screens/labels-screen.tsx";
import MovementsScreen from "./screens/movements-screen.tsx";
import PosScreen from "./screens/pos-screen.tsx";
import PurchaseScreen from "./screens/purchase-screen.tsx";
import SetupScreen from "./screens/setup-screen.tsx";
import WarehouseScreen from "./screens/warehouse-screen.tsx";

export type View = "home" | "pos" | "history" | "kassa" | "purchase" | "warehouse" | "movements" | "count" | "labels";

/** Oqim: qurilma ro'yxatdan o'tmagan → sozlash; kassir kirmagan → PIN; aks holda — bosh ekran yoki bo'lim. */
export default function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("home");
  const [movementProduct, setMovementProduct] = useState<{ id: string; name: string } | null>(null);

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
  const home = () => setView("home");
  if (view === "pos") return <PosScreen status={status} onStatus={setStatus} onExit={home} onNavigate={setView} />;
  if (view === "history") return <HistoryScreen status={status} onExit={home} />;
  if (view === "kassa") return <KassaScreen status={status} onStatus={setStatus} onExit={home} />;
  if (view === "purchase") return <PurchaseScreen status={status} onStatus={setStatus} onExit={home} />;
  if (view === "warehouse") {
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
  }
  if (view === "movements") return <MovementsScreen key={movementProduct?.id ?? "all"} status={status} initialProduct={movementProduct} onExit={home} />;
  if (view === "count") return <CountScreen status={status} onStatus={setStatus} onExit={home} />;
  if (view === "labels") return <LabelsScreen status={status} onExit={home} />;
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
