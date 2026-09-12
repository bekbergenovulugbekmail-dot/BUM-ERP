import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import type { AppStatus, MovementPage, MovementRow } from "../../shared/kassa-api.js";
import type { RemoteWarehouseStock } from "../../shared/sync-types.js";
import { MOVEMENT_LABELS, OP_LABELS, fmtQty, fmtTime } from "../format.ts";
import { call, errorText } from "../kassa.ts";
import ProductPicker from "../stock/product-picker.tsx";

/**
 * Mahsulot harakati: qurilma omboridagi kirim-chiqimlar serverdan (barcha kassalar va web), qurilmadagi yuborilmagan
 * hujjatlar "navbatda" bo'lib yuqorida. Mahsulot tanlansa — faqat uning harakati va boshqa omborlardagi qoldig'i.
 */
export default function MovementsScreen({
  status,
  initialProduct,
  onExit,
}: {
  status: AppStatus;
  initialProduct: { id: string; name: string } | null;
  onExit: () => void;
}) {
  const [product, setProduct] = useState(initialProduct);
  const [type, setType] = useState("");
  const [page, setPage] = useState<MovementPage | null>(null);
  const [rows, setRows] = useState<MovementRow[]>([]);
  const [elsewhere, setElsewhere] = useState<RemoteWarehouseStock[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const lastSyncAt = status.sync.lastSyncAt;
  const allowed = status.cashier?.permissions.includes("warehouse.view") ?? false;

  useEffect(() => {
    if (!allowed) return;
    call("stock:movements", { ...(product ? { productId: product.id } : {}), ...(type ? { type } : {}) }).then(
      (value) => {
        setPage(value);
        setRows(value.rows);
        setError(null);
      },
      (err: unknown) => setError(errorText(err)),
    );
  }, [product, type, lastSyncAt, allowed]);

  useEffect(() => {
    if (!product || !allowed) return;
    call("stock:elsewhere", { productId: product.id }).then(setElsewhere, () => setElsewhere(null));
  }, [product, lastSyncAt, allowed]);

  const more = async () => {
    if (!page?.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await call("stock:movements", { ...(product ? { productId: product.id } : {}), ...(type ? { type } : {}), cursor: page.nextCursor });
      setRows((current) => [...current, ...next.rows]);
      setPage(next);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoadingMore(false);
    }
  };

  const pick = (next: { id: string; name: string } | null) => {
    setProduct(next);
    setElsewhere(null);
  };

  return (
    <main className="grid h-full grid-rows-[auto_1fr] bg-muted/40">
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-2">
        <Button size="sm" variant="secondary" onClick={onExit}>
          ← Bosh sahifa
        </Button>
        <h1 className="font-semibold">Mahsulot harakati</h1>
        <span className="text-sm text-muted-foreground">
          {status.device?.code} · {status.device?.warehouseName}
        </span>
        <select id="movement-type" className="ml-auto h-9 rounded-md border border-input bg-background px-2 text-sm" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Barcha turlar</option>
          {Object.entries(MOVEMENT_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </header>

      {!allowed ? (
        <p className="m-6 rounded-lg bg-pos-warning/10 px-4 py-3 text-pos-warning">Mahsulot harakati uchun ruxsat kerak: warehouse.view.</p>
      ) : (
        <div className="grid min-h-0 grid-cols-[minmax(0,340px)_minmax(0,1fr)] gap-3 p-3">
          <div className="flex min-h-0 flex-col gap-2">
            {product ? (
              <div className="space-y-2 rounded-xl border border-primary/40 bg-primary/5 p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold">{product.name}</p>
                  <Button size="sm" variant="ghost" onClick={() => pick(null)}>
                    Barcha mahsulotlar
                  </Button>
                </div>
                {elsewhere && (
                  <ul className="divide-y divide-border/60 text-xs">
                    {elsewhere.map((row) => (
                      <li key={row.warehouseId} className="flex justify-between py-1">
                        <span className={row.warehouseId === status.device?.warehouseId ? "font-semibold" : ""}>{row.warehouseName}</span>
                        <span className="tabular-nums">{fmtQty(row.quantity)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="rounded-xl border border-border bg-card px-3 py-2 text-sm text-muted-foreground">Barcha mahsulotlar — bittasini tanlang yoki skanerlang</p>
            )}
            <ProductPicker className="flex-1" onPick={(picked) => pick({ id: picked.id, name: picked.name })} />
          </div>

          <section className="flex min-h-0 flex-col rounded-xl border border-border bg-card">
            {page?.offline && <p className="border-b border-border bg-pos-warning/10 px-3 py-2 text-sm text-pos-warning">Internet yo'q — faqat shu kassadagi yuborilmagan hujjatlar ko'rinmoqda</p>}
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/80 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Vaqt</th>
                    <th className="px-3 py-2">Turi</th>
                    {!product && <th className="px-3 py-2">Mahsulot</th>}
                    <th className="px-3 py-2 text-right">Miqdor</th>
                    <th className="px-3 py-2">Hujjat</th>
                    <th className="px-3 py-2">Kim</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className={`border-t border-border ${row.source === "pending" ? "bg-pos-warning/5" : ""}`}>
                      <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">{fmtTime(row.occurredAt)}</td>
                      <td className="px-3 py-1.5">
                        {row.source === "pending" ? (
                          <>
                            {OP_LABELS[row.type] ?? row.type} <span className="text-xs text-pos-warning">navbatda</span>
                          </>
                        ) : (
                          (MOVEMENT_LABELS[row.type] ?? row.type)
                        )}
                      </td>
                      {!product && <td className="px-3 py-1.5">{row.productName}</td>}
                      <td className={`px-3 py-1.5 text-right font-semibold tabular-nums ${row.quantity.startsWith("-") ? "text-destructive" : "text-pos-success"}`}>
                        {row.quantity.startsWith("-") ? "" : "+"}
                        {fmtQty(row.quantity)} {row.unitName}
                      </td>
                      <td className="px-3 py-1.5">
                        {row.documentNumber ?? "—"}
                        {row.notes && <span className="block max-w-64 truncate text-xs text-muted-foreground">{row.notes}</span>}
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground">{row.by ?? ""}</td>
                    </tr>
                  ))}
                  {page && rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-12 text-center text-muted-foreground">
                        Harakat yo'q
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {page?.nextCursor && (
              <div className="border-t border-border p-2 text-center">
                <Button size="sm" variant="secondary" disabled={loadingMore} onClick={() => void more()}>
                  Ko'proq
                </Button>
              </div>
            )}
            {error && <p className="m-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          </section>
        </div>
      )}
    </main>
  );
}
