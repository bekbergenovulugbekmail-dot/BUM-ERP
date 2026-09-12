import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import type { AppStatus, LocalStockDocument, StockDocumentKind, StockFilter, StockList } from "../../shared/kassa-api.js";
import type { RemoteWarehouseStock } from "../../shared/sync-types.js";
import { STOCK_DOCUMENT_LABELS, SYNC_STATE_TEXT, fmtMoney, fmtQty, fmtTime } from "../format.ts";
import { call, errorText } from "../kassa.ts";
import StockDocumentForm from "../stock/stock-document-form.tsx";

type Tab = "stock" | "writeoff" | "transfer" | "documents";

const FILTERS: { key: StockFilter; label: string; count: keyof StockList["summary"] }[] = [
  { key: "all", label: "Hammasi", count: "products" },
  { key: "positive", label: "Bor", count: "positive" },
  { key: "low", label: "Kam qolgan", count: "low" },
  { key: "zero", label: "Tugagan", count: "zero" },
  { key: "negative", label: "Manfiy", count: "negative" },
];

/** Ombor: qurilma omboridagi qoldiqlar, hisobdan chiqarish, boshqa omborga ko'chirish va hujjatlar — offline ham. */
export default function WarehouseScreen({
  status,
  onStatus,
  onExit,
  onMovements,
}: {
  status: AppStatus;
  onStatus: (status: AppStatus) => void;
  onExit: () => void;
  onMovements: (product: { id: string; name: string }) => void;
}) {
  const [tab, setTab] = useState<Tab>("stock");
  const [version, setVersion] = useState(0);
  const permissions = status.cashier?.permissions ?? [];
  const base = status.company?.currency ?? "UZS";
  const lastSyncAt = status.sync.lastSyncAt;

  const tabs: { key: Tab; label: string; allowed: boolean }[] = [
    { key: "stock", label: "Qoldiqlar", allowed: true },
    { key: "writeoff", label: "Hisobdan chiqarish", allowed: permissions.includes("warehouse.manage") },
    { key: "transfer", label: "Ko'chirish", allowed: permissions.includes("warehouse.transfer") },
    { key: "documents", label: "Hujjatlar", allowed: true },
  ];

  const header = (
    <header className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-2">
      <Button size="sm" variant="secondary" onClick={onExit}>
        ← Bosh sahifa
      </Button>
      <h1 className="font-semibold">Ombor</h1>
      <span className="text-sm text-muted-foreground">
        {status.device?.code} · {status.device?.warehouseName}
      </span>
      <nav className="ml-auto flex flex-wrap gap-1">
        {tabs.map((item) => (
          <Button
            key={item.key}
            size="sm"
            variant={tab === item.key ? "default" : "secondary"}
            disabled={!item.allowed}
            title={item.allowed ? undefined : "Ruxsat yo'q"}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </Button>
        ))}
      </nav>
    </header>
  );

  if (!permissions.includes("warehouse.view")) {
    return (
      <main className="flex h-full flex-col bg-muted/40">
        {header}
        <p className="m-6 rounded-lg bg-amber-500/10 px-4 py-3 text-amber-700">Ombor bo'limi uchun ruxsat kerak: warehouse.view — rahbar kassir sifatida kirsin.</p>
      </main>
    );
  }

  const done = () => {
    setVersion((value) => value + 1);
    call("app:status").then(onStatus, () => undefined);
  };

  return (
    <main className="grid h-full grid-rows-[auto_1fr] bg-muted/40">
      {header}
      {tab === "stock" && <StockTab baseCurrency={base} refreshKey={`${lastSyncAt}:${version}`} onMovements={onMovements} />}
      {tab === "writeoff" && <StockDocumentForm kind="writeoff" baseCurrency={base} onDone={done} />}
      {tab === "transfer" && <StockDocumentForm kind="transfer" baseCurrency={base} onDone={done} />}
      {tab === "documents" && <DocumentsTab baseCurrency={base} refreshKey={`${lastSyncAt}:${version}`} />}
    </main>
  );
}

function StockTab({ baseCurrency, refreshKey, onMovements }: { baseCurrency: string; refreshKey: string; onMovements: (product: { id: string; name: string }) => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StockFilter>("all");
  const [list, setList] = useState<StockList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elsewhere, setElsewhere] = useState<{ id: string; name: string; rows: RemoteWarehouseStock[] | null; error: string | null } | null>(null);

  useEffect(() => {
    const timer = setTimeout(
      () => {
        call("stock:list", { query, filter, limit: 500 }).then(
          (value) => {
            setList(value);
            setError(null);
          },
          (err: unknown) => setError(errorText(err)),
        );
      },
      query ? 150 : 0,
    );
    return () => clearTimeout(timer);
  }, [query, filter, refreshKey]);

  const showElsewhere = (id: string, name: string) => {
    setElsewhere({ id, name, rows: null, error: null });
    call("stock:elsewhere", { productId: id }).then(
      (rows) => setElsewhere((current) => (current?.id === id ? { ...current, rows } : current)),
      (err: unknown) => setElsewhere((current) => (current?.id === id ? { ...current, error: errorText(err) } : current)),
    );
  };

  return (
    <div className="grid min-h-0 grid-rows-[auto_1fr] gap-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input id="stock-search" autoFocus className="h-10 w-80" placeholder="Mahsulot, SKU yoki shtrix-kod" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((item) => (
            <Button key={item.key} size="sm" variant={filter === item.key ? "default" : "secondary"} onClick={() => setFilter(item.key)}>
              {item.label}
              {list && <span className="ml-1.5 tabular-nums opacity-70">{list.summary[item.count]}</span>}
            </Button>
          ))}
        </div>
        {list?.summary.totalValue != null && (
          <p className="ml-auto text-sm">
            Ombor qiymati (tannarxda): <span className="font-semibold tabular-nums">{fmtMoney(list.summary.totalValue, baseCurrency)}</span>
          </p>
        )}
      </div>

      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_auto] gap-3">
        <div className="min-h-0 overflow-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/80 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Mahsulot</th>
                <th className="px-3 py-2 text-right">Qoldiq</th>
                <th className="px-3 py-2 text-right">Min.</th>
                {list?.summary.totalValue != null && <th className="px-3 py-2 text-right">O'rtacha tannarx</th>}
                {list?.summary.totalValue != null && <th className="px-3 py-2 text-right">Qiymat</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {list?.rows.map((row) => {
                const negative = row.quantity.startsWith("-");
                return (
                  <tr key={row.productId} className="border-t border-border">
                    <td className="px-3 py-1.5">
                      <p className="font-medium leading-tight">{row.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.sku}
                        {row.barcode ? ` · ${row.barcode}` : ""}
                      </p>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      <span className={`font-semibold ${negative ? "text-destructive" : row.isLow ? "text-amber-600" : ""}`}>
                        {fmtQty(row.quantity)} {row.unitName}
                      </span>
                      {row.pending !== "0.0000" && (
                        <span className="block text-xs text-amber-600" title="Serverga hali yetib bormagan hujjatlar ta'siri">
                          navbatda {row.pending.startsWith("-") ? "" : "+"}
                          {fmtQty(row.pending)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{row.minStock === "0.0000" ? "—" : fmtQty(row.minStock)}</td>
                    {row.avgCost !== null && <td className="px-3 py-1.5 text-right tabular-nums">{fmtMoney(row.avgCost, baseCurrency)}</td>}
                    {row.value !== null && <td className="px-3 py-1.5 text-right tabular-nums">{fmtMoney(row.value, baseCurrency)}</td>}
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">
                      <Button size="sm" variant="ghost" onClick={() => onMovements({ id: row.productId, name: row.name })}>
                        Harakati
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => showElsewhere(row.productId, row.name)}>
                        Boshqa omborlarda
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {list && list.rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-12 text-center text-muted-foreground">
                    Mahsulot topilmadi
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {list?.truncated && <p className="border-t border-border px-3 py-2 text-center text-xs text-muted-foreground">Ro'yxat qisqartirildi — qidiruvni aniqlashtiring</p>}
          {error && <p className="m-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        </div>

        {elsewhere && (
          <aside className="w-72 space-y-2 self-start rounded-xl border border-border bg-card p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs text-muted-foreground">Boshqa omborlarda</p>
                <p className="font-medium">{elsewhere.name}</p>
              </div>
              <button type="button" aria-label="Yopish" className="text-muted-foreground hover:text-foreground" onClick={() => setElsewhere(null)}>
                ✕
              </button>
            </div>
            {elsewhere.error && <p className="text-destructive">{elsewhere.error}</p>}
            {!elsewhere.rows && !elsewhere.error && <p className="text-muted-foreground">Yuklanmoqda…</p>}
            <ul className="divide-y divide-border">
              {elsewhere.rows?.map((row) => (
                <li key={row.warehouseId} className="flex justify-between gap-2 py-1.5">
                  <span className="min-w-0 truncate">{row.warehouseName}</span>
                  <span className={`tabular-nums ${row.quantity.startsWith("-") ? "text-destructive" : ""}`}>{fmtQty(row.quantity)}</span>
                </li>
              ))}
              {elsewhere.rows?.length === 0 && <li className="py-1.5 text-muted-foreground">Hech qaysi omborda yo'q</li>}
            </ul>
          </aside>
        )}
      </div>
    </div>
  );
}

function DocumentsTab({ baseCurrency, refreshKey }: { baseCurrency: string; refreshKey: string }) {
  const [kind, setKind] = useState<StockDocumentKind | "all">("all");
  const [docs, setDocs] = useState<LocalStockDocument[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call("stock:documents", { ...(kind === "all" ? {} : { kind }), limit: 300 }).then(setDocs, (err: unknown) => setError(errorText(err)));
  }, [kind, refreshKey]);

  return (
    <div className="grid min-h-0 grid-rows-[auto_1fr] gap-3 p-3">
      <div className="flex gap-1">
        {(["all", "writeoff", "transfer", "count"] as const).map((key) => (
          <Button key={key} size="sm" variant={kind === key ? "default" : "secondary"} onClick={() => setKind(key)}>
            {key === "all" ? "Hammasi" : STOCK_DOCUMENT_LABELS[key]}
          </Button>
        ))}
      </div>
      <ul className="min-h-0 divide-y divide-border overflow-y-auto rounded-xl border border-border bg-card text-sm">
        {docs.map((doc) => (
          <li key={doc.id}>
            <button type="button" className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/60" onClick={() => setOpen(open === doc.id ? null : doc.id)}>
              <span className="w-32 font-medium">{doc.number}</span>
              <span className="w-36 text-muted-foreground">{STOCK_DOCUMENT_LABELS[doc.kind]}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {fmtTime(doc.createdAt)} · {doc.cashierName}
                {doc.toWarehouse ? ` · → ${doc.toWarehouse.name}` : ""}
                {doc.notes ? ` · ${doc.notes}` : ""}
              </span>
              <span className="text-muted-foreground">{doc.lines.length} qator</span>
              {doc.value !== null && <span className="w-32 text-right tabular-nums">{fmtMoney(doc.value, baseCurrency)}</span>}
              <span className={`w-28 text-right text-xs ${SYNC_STATE_TEXT[doc.sync.state]?.tone ?? ""}`}>{SYNC_STATE_TEXT[doc.sync.state]?.text}</span>
            </button>
            {open === doc.id && (
              <div className="space-y-1 bg-muted/30 px-3 py-2">
                {doc.sync.error && <p className="text-xs text-destructive">{doc.sync.error}</p>}
                {doc.sync.conflicts.length > 0 && <p className="text-xs text-amber-700">Serverdagi nomuvofiqlik: {doc.sync.conflicts.join(", ")}</p>}
                <table className="w-full text-xs">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="py-1">Mahsulot</th>
                      {doc.kind === "count" && <th className="py-1 text-right">Kutilgan</th>}
                      <th className="py-1 text-right">{doc.kind === "count" ? "Sanalgan" : "Miqdor"}</th>
                      {doc.kind === "count" && <th className="py-1 text-right">Farq</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {doc.lines.map((line) => (
                      <tr key={line.productId} className="border-t border-border/60">
                        <td className="py-1">
                          {line.name} <span className="text-muted-foreground">{line.sku}</span>
                        </td>
                        {doc.kind === "count" && <td className="py-1 text-right tabular-nums">{fmtQty(line.expected)}</td>}
                        <td className="py-1 text-right tabular-nums">
                          {fmtQty(line.quantity)} {line.unitName}
                        </td>
                        {doc.kind === "count" && (
                          <td className={`py-1 text-right tabular-nums ${line.difference?.startsWith("-") ? "text-destructive" : line.difference === "0.0000" ? "" : "text-emerald-600"}`}>
                            {fmtQty(line.difference)}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </li>
        ))}
        {docs.length === 0 && <li className="px-3 py-12 text-center text-muted-foreground">Hujjat yo'q</li>}
      </ul>
      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}
