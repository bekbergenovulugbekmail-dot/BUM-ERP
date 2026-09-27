/**
 * POS kassalar paneli (rahbar, `sales.approve`) — `GET /api/sales/pos/kassa-board`: har kassa (pul qutisi) qaysi omborda,
 * hozir qancha pul bor (kassa balansi = kutilgan naqd) va ochiq smenasi (kassir, cheklar, tushum usul bo'yicha).
 */
import { Monitor } from "lucide-react";
import { Badge } from "@/components/ui/badge.tsx";
import { useApiQuery } from "@/lib/query.ts";
import { money } from "../_lib/types.ts";

type BoardKassa = {
  id: string;
  name: string;
  code: string | null;
  warehouseName: string;
  isActive: boolean;
  balance: string;
  openShift: {
    id: string;
    cashierName: string | null;
    deviceId: string | null;
    openedAt: string;
    receiptCount: number;
    totalSales: string;
    totalCash: string;
    totalCard: string;
    totalBank: string;
    totalReturns: string;
  } | null;
};

export default function PosKassaBoard() {
  const kassas = useApiQuery<{ kassas: BoardKassa[] }>("/api/sales/pos/kassa-board", undefined, { refetchInterval: 30_000 }).data?.kassas;
  if (!kassas || kassas.length === 0) return null;
  const open = kassas.filter((kassa) => kassa.openShift).length;
  return (
    <section className="mb-4 space-y-2" data-testid="pos-kassa-board">
      <div className="flex items-center gap-2">
        <Monitor className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">POS kassalar</h2>
        <span className="text-xs text-muted-foreground">{open} / {kassas.length} ochiq</span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {kassas.map((kassa) => (
          <div key={kassa.id} className="rounded-xl border border-border bg-card p-3 text-sm" data-testid={`board-kassa-${kassa.code ?? kassa.id}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold">{kassa.code ? `${kassa.code} · ${kassa.name}` : kassa.name}</p>
                <p className="truncate text-xs text-muted-foreground">{kassa.warehouseName}</p>
              </div>
              {kassa.openShift ? <Badge className="bg-emerald-600">Ochiq</Badge> : <Badge variant="secondary">Yopiq</Badge>}
            </div>
            <p className="mt-2 text-lg font-bold tabular-nums">{money(kassa.balance)}</p>
            <p className="text-[11px] text-muted-foreground">Kassadagi naqd (balans)</p>
            {kassa.openShift && (
              <div className="mt-2 space-y-0.5 border-t border-border/60 pt-2 text-xs">
                <p>
                  Kassir: <span className="font-medium">{kassa.openShift.cashierName ?? "—"}</span>
                  {kassa.openShift.deviceId && <span className="text-muted-foreground"> · desktop</span>}
                </p>
                <p className="text-muted-foreground">
                  {new Date(kassa.openShift.openedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })} dan · {kassa.openShift.receiptCount} chek
                </p>
                <p>Sotuv: <span className="tabular-nums">{money(kassa.openShift.totalSales)}</span></p>
                <p className="text-muted-foreground tabular-nums">
                  Naqd {money(kassa.openShift.totalCash)} · Karta {money(kassa.openShift.totalCard)} · Bank {money(kassa.openShift.totalBank)}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
