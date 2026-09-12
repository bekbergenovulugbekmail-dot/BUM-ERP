import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import type { AppStatus, DevicePrefs, LocalReturn, LocalSale, PosContext } from "../../shared/kassa-api.js";
import type { RemoteSale } from "../../shared/sync-types.js";
import { PAYMENT_LABELS, fmtMoney, fmtQty, fmtTime, num } from "../format.ts";
import { call, errorText } from "../kassa.ts";
import { printSale } from "../pos/receipt.ts";
import ReturnDialog from "../pos/return-dialog.tsx";

type Tab = "sales" | "returns" | "server";
type Preset = "today" | "yesterday" | "week" | "month";

const PRESETS: { key: Preset; label: string }[] = [
  { key: "today", label: "Bugun" },
  { key: "yesterday", label: "Kecha" },
  { key: "week", label: "7 kun" },
  { key: "month", label: "30 kun" },
];

const STATE_LABEL: Record<string, { text: string; tone: string }> = {
  pending: { text: "navbatda", tone: "text-pos-warning" },
  rejected: { text: "rad etildi", tone: "text-destructive" },
  applied: { text: "serverda", tone: "text-pos-success" },
  discarded: { text: "bekor qilingan", tone: "text-muted-foreground line-through" },
};

const STATUS_LABEL: Record<string, string> = { shipped: "qarz bor", delivered: "to'langan", returned: "qaytarilgan", confirmed: "tasdiqlangan" };

/** Mahalliy kun chegaralari (sotuv tarixi kassa vaqti bo'yicha). */
function presetRange(preset: Preset) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  if (preset === "yesterday") {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
  } else if (preset === "week") start.setDate(start.getDate() - 6);
  else if (preset === "month") start.setDate(start.getDate() - 29);
  const date = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  const lastDay = new Date(end);
  lastDay.setDate(lastDay.getDate() - 1);
  return { from: start.toISOString(), to: end.toISOString(), fromDate: date(start), toDate: date(lastDay) };
}

/** Sotuv tarixi: shu kassa cheklari va qaytarishlari (offline), serverdagi barcha kassalar cheklari (internet bilan). */
export default function HistoryScreen({ status, onExit }: { status: AppStatus; onExit: () => void }) {
  const [tab, setTab] = useState<Tab>("sales");
  const [preset, setPreset] = useState<Preset>("today");
  const [query, setQuery] = useState("");
  const [sales, setSales] = useState<LocalSale[]>([]);
  const [returns, setReturns] = useState<LocalReturn[]>([]);
  const [server, setServer] = useState<{ sales: RemoteSale[]; nextCursor: string | null }>({ sales: [], nextCursor: null });
  const [selected, setSelected] = useState<LocalSale | null>(null);
  const [returnNumber, setReturnNumber] = useState<string | null>(null);
  const [context, setContext] = useState<PosContext | null>(null);
  const [prefs, setPrefs] = useState<DevicePrefs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const lastSyncAt = status.sync.lastSyncAt;

  useEffect(() => {
    Promise.all([call("pos:context"), call("device:prefs")]).then(
      ([loaded, devicePrefs]) => {
        setContext(loaded);
        setPrefs(devicePrefs);
      },
      (err: unknown) => setError(errorText(err)),
    );
  }, []);

  useEffect(() => {
    const range = presetRange(preset);
    const fail = (err: unknown) => setError(errorText(err));
    if (tab === "sales") call("history:sales", { from: range.from, to: range.to, limit: 5000 }).then(setSales, fail);
    else if (tab === "returns") call("history:returns", { from: range.from, to: range.to, limit: 5000 }).then(setReturns, fail);
    else {
      call("history:server", { from: range.fromDate, to: range.toDate }).then(
        (page) => {
          setError(null);
          setServer(page);
        },
        fail,
      );
    }
  }, [tab, preset, version, lastSyncAt]);

  const base = context?.baseCurrency ?? status.company?.currency ?? "UZS";
  const needle = query.trim().toLowerCase();
  const visibleSales = sales.filter((sale) => !needle || sale.number.toLowerCase().includes(needle) || (sale.customer?.name ?? "").toLowerCase().includes(needle));
  const counted = visibleSales.filter((sale) => sale.sync.state !== "discarded");
  const visibleReturns = returns.filter((row) => !needle || row.number.toLowerCase().includes(needle) || row.orderNumber.toLowerCase().includes(needle));

  const loadMore = async () => {
    if (!server.nextCursor) return;
    const range = presetRange(preset);
    try {
      const page = await call("history:server", { from: range.fromDate, to: range.toDate, cursor: server.nextCursor });
      setServer((current) => ({ sales: [...current.sales, ...page.sales], nextCursor: page.nextCursor }));
    } catch (err) {
      setError(errorText(err));
    }
  };

  const reprint = async (sale: LocalSale) => {
    if (!prefs) return;
    try {
      await printSale(sale, context, prefs);
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <main className="flex h-full flex-col bg-muted/40">
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-2">
        <Button size="sm" variant="secondary" onClick={onExit}>
          ← Bosh sahifa
        </Button>
        <h1 className="font-semibold">Sotuv tarixi</h1>
        <div className="flex gap-1">
          {(
            [
              ["sales", "Cheklar (shu kassa)"],
              ["returns", "Qaytarishlar"],
              ["server", "Barcha kassalar (server)"],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <Button key={key} size="sm" variant={tab === key ? "default" : "secondary"} onClick={() => setTab(key)}>
              {label}
            </Button>
          ))}
        </div>
        <div className="flex gap-1">
          {PRESETS.map((item) => (
            <Button key={item.key} size="sm" variant={preset === item.key ? "default" : "ghost"} onClick={() => setPreset(item.key)}>
              {item.label}
            </Button>
          ))}
        </div>
        {tab !== "server" && <Input id="history-search" className="ml-auto h-8 w-64" placeholder="Raqam yoki mijoz" value={query} onChange={(e) => setQuery(e.target.value)} />}
      </header>

      {error && <p className="mx-4 mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          {tab === "sales" && (
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Chek</th>
                  <th className="px-3 py-2">Vaqt</th>
                  <th className="px-3 py-2">Kassir</th>
                  <th className="px-3 py-2">Mijoz</th>
                  <th className="px-3 py-2">To'lov</th>
                  <th className="px-3 py-2 text-right">Summa</th>
                  <th className="px-3 py-2 text-right">Holat</th>
                </tr>
              </thead>
              <tbody>
                {visibleSales.map((sale) => (
                  <tr key={sale.id} className="cursor-pointer border-t border-border hover:bg-primary/5" onClick={() => setSelected(sale)}>
                    <td className="px-3 py-2 font-medium">{sale.number}</td>
                    <td className="px-3 py-2">{fmtTime(sale.createdAt)}</td>
                    <td className="px-3 py-2">{sale.cashierName}</td>
                    <td className="px-3 py-2">{sale.customer?.name ?? "—"}</td>
                    <td className="px-3 py-2">
                      {PAYMENT_LABELS[sale.paymentMethod]}
                      {num(sale.debt) > 0 && <span className="ml-1 text-pos-warning">+ qarz</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(sale.total, base)}</td>
                    <td className={`px-3 py-2 text-right text-xs ${STATE_LABEL[sale.sync.state]?.tone ?? ""}`}>{STATE_LABEL[sale.sync.state]?.text}</td>
                  </tr>
                ))}
                {visibleSales.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                      Chek yo'q
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot className="border-t border-border bg-muted/40 text-sm font-semibold">
                <tr>
                  <td className="px-3 py-2" colSpan={5}>
                    {counted.length} chek
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(counted.reduce((total, sale) => total + num(sale.total), 0), base)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}

          {tab === "returns" && (
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Qaytarish</th>
                  <th className="px-3 py-2">Chek</th>
                  <th className="px-3 py-2">Vaqt</th>
                  <th className="px-3 py-2">Mahsulotlar</th>
                  <th className="px-3 py-2">Pul</th>
                  <th className="px-3 py-2 text-right">Summa</th>
                  <th className="px-3 py-2 text-right">Holat</th>
                </tr>
              </thead>
              <tbody>
                {visibleReturns.map((row) => (
                  <tr key={row.id} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">{row.number}</td>
                    <td className="px-3 py-2">{row.orderNumber}</td>
                    <td className="px-3 py-2">{fmtTime(row.createdAt)}</td>
                    <td className="px-3 py-2">{row.lines.map((line) => `${line.name} × ${fmtQty(line.quantity)}`).join(", ")}</td>
                    <td className="px-3 py-2">
                      {PAYMENT_LABELS[row.refundMethod]} {fmtMoney(row.refundEstimate, base)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(row.total, base)}</td>
                    <td className={`px-3 py-2 text-right text-xs ${STATE_LABEL[row.sync.state]?.tone ?? ""}`}>{STATE_LABEL[row.sync.state]?.text}</td>
                  </tr>
                ))}
                {visibleReturns.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                      Qaytarish yo'q
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {tab === "server" && (
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Chek</th>
                  <th className="px-3 py-2">Vaqt</th>
                  <th className="px-3 py-2">Kassa</th>
                  <th className="px-3 py-2">Kassir</th>
                  <th className="px-3 py-2">Mijoz</th>
                  <th className="px-3 py-2 text-right">Summa</th>
                  <th className="px-3 py-2 text-right">Holat</th>
                </tr>
              </thead>
              <tbody>
                {server.sales.map((sale) => (
                  <tr key={sale.id} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">{sale.number}</td>
                    <td className="px-3 py-2">{fmtTime(sale.createdAt)}</td>
                    <td className="px-3 py-2">{sale.deviceCode ?? "web"}</td>
                    <td className="px-3 py-2">{sale.cashierName ?? "—"}</td>
                    <td className="px-3 py-2">{sale.customerName ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(sale.totalAmount, base)}</td>
                    <td className="px-3 py-2 text-right text-xs">{STATUS_LABEL[sale.status] ?? sale.status}</td>
                  </tr>
                ))}
                {server.sales.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                      Chek yo'q
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
        {tab === "server" && server.nextCursor && (
          <div className="mt-3 text-center">
            <Button variant="secondary" onClick={() => void loadMore()}>
              Yana yuklash
            </Button>
          </div>
        )}
      </div>

      <Dialog open={selected !== null} onOpenChange={(value) => !value && setSelected(null)}>
        <DialogContent className="sm:max-w-2xl">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>Chek {selected.number}</DialogTitle>
                <DialogDescription>
                  {fmtTime(selected.createdAt)} · {selected.cashierName} · {PAYMENT_LABELS[selected.paymentMethod]}
                  {selected.customer ? ` · ${selected.customer.name}` : ""}
                </DialogDescription>
              </DialogHeader>
              <table className="w-full text-sm">
                <tbody>
                  {selected.lines.map((line) => (
                    <tr key={line.id} className="border-b border-border">
                      <td className="py-1.5">{line.name}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {fmtQty(line.quantity)} {line.unitName} × {fmtMoney(line.unitPrice, base)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{line.currency ? fmtMoney(line.currencyTotal, line.currency) : fmtMoney(line.lineTotal, base)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between font-semibold">
                  <dt>Jami</dt>
                  <dd className="tabular-nums">{fmtMoney(selected.total, base)}</dd>
                </div>
                {num(selected.balanceUsed) > 0 && (
                  <div className="flex justify-between">
                    <dt>Balansdan</dt>
                    <dd className="tabular-nums">{fmtMoney(selected.balanceUsed, base)}</dd>
                  </div>
                )}
                {num(selected.cashbackUsed) > 0 && (
                  <div className="flex justify-between">
                    <dt>Keshbekdan</dt>
                    <dd className="tabular-nums">{fmtMoney(selected.cashbackUsed, base)}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt>To'landi / qaytim</dt>
                  <dd className="tabular-nums">
                    {fmtMoney(selected.tendered, base)} / {fmtMoney(selected.change, base)}
                  </dd>
                </div>
                {num(selected.debt) > 0 && (
                  <div className="flex justify-between text-pos-warning">
                    <dt>Qarzga</dt>
                    <dd className="tabular-nums">{fmtMoney(selected.debt, base)}</dd>
                  </div>
                )}
              </dl>
              <p className={`text-sm ${STATE_LABEL[selected.sync.state]?.tone ?? ""}`}>
                {STATE_LABEL[selected.sync.state]?.text}
                {selected.sync.error ? ` — ${selected.sync.error}` : ""}
                {selected.sync.conflicts.length > 0 ? ` · nomuvofiqlik: ${selected.sync.conflicts.join(", ")}` : ""}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" disabled={!prefs} onClick={() => void reprint(selected)}>
                  Qayta chop etish
                </Button>
                <Button
                  disabled={selected.sync.state === "rejected" || selected.sync.state === "discarded" || !status.shift}
                  onClick={() => {
                    setReturnNumber(selected.number);
                    setSelected(null);
                  }}
                >
                  Mahsulotni qaytarish
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ReturnDialog
        key={returnNumber ?? "none"}
        open={returnNumber !== null}
        initialNumber={returnNumber ?? ""}
        baseCurrency={base}
        canRefund={(context?.permissions ?? []).includes("sales.refund")}
        onClose={() => setReturnNumber(null)}
        onDone={() => setVersion((value) => value + 1)}
      />
    </main>
  );
}
