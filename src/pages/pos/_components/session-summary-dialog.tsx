/**
 * Faol kassa smenasining tafsiloti: naqd, har terminal bo'yicha summa va tranzaksiyalar soni,
 * pul tushgan bank hisobi. Karta summalari naqd qoldig'iga qo'shilmaydi — ular alohida ko'rsatiladi.
 */
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { num, type PosShift } from "@/pages/sales/_lib/types.ts";

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

type Props = {
  shift: PosShift;
  onClose: () => void;
};

export default function SessionSummaryDialog({ shift, onClose }: Props) {
  const rows = (shift.payments ?? []).filter((row) => row.method !== "cash");
  const opened = new Date(shift.openedAt).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent data-testid="session-detail">
        <DialogHeader>
          <DialogTitle>Kassa smenasi</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          {shift.warehouseName} · Smena faol · {opened} dan · {shift.cashierName ?? "—"}
        </p>

        <div className="rounded-xl border border-border p-4 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Naqd</span>
            <span className="font-bold tabular-nums" data-testid="session-cash">{fmt(num(shift.totalCash))} so'm</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Boshlang'ich {fmt(num(shift.openingCash))} · kassada bo'lishi kerak {fmt(num(shift.expectedCash))} so'm
          </p>
        </div>

        {rows.length > 0 && (
          <div className="rounded-xl border border-border p-4 text-sm" data-testid="session-terminals">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Karta va terminallar (naqd hisobiga kirmaydi)
            </p>
            <ul className="space-y-2">
              {rows.map((row) => (
                <li key={`${row.method}:${row.terminalId ?? row.accountName ?? ""}`} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{row.terminalName ?? (row.method === "bank" ? "Bank o'tkazma" : "Karta")}</p>
                    {row.accountName && <p className="truncate text-xs text-muted-foreground">{row.accountName}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-semibold tabular-nums">{fmt(num(row.amount))} so'm</p>
                    <p className="text-xs text-muted-foreground">{row.count} ta tranzaksiya</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center justify-between rounded-xl bg-muted/40 px-4 py-3 text-sm">
          <span className="font-semibold">Jami savdo</span>
          <span className="font-bold tabular-nums" data-testid="session-total">{fmt(num(shift.totalSales))} so'm</span>
        </div>
        <p className="text-xs text-muted-foreground">Cheklar: {shift.receiptCount} ta · Qaytarishlar: {fmt(num(shift.totalReturns))} so'm</p>
      </DialogContent>
    </Dialog>
  );
}
