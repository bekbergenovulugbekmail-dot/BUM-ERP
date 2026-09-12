import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import type { AppStatus, PosCustomer, PosSupplier, PriceRow } from "../../shared/kassa-api.js";
import type { PartyType } from "../../shared/sync-types.js";
import { PARTY_TYPE_LABELS, fmtMoney, fmtQty, num, trimDecimal } from "../format.ts";
import { call, errorText } from "../kassa.ts";
import PartyDialog from "../references/party-dialog.tsx";
import PriceDialog from "../references/price-dialog.tsx";

type Tab = "customers" | "suppliers" | "prices";
type TypeFilter = PartyType | "all";

/** Ma'lumotlar: mijozlar va ta'minotchilar (jismoniy/yuridik shaxslar, rekvizitlar), narxlar — offline tahrir. */
export default function ReferencesScreen({ status, onExit }: { status: AppStatus; onExit: () => void }) {
  const permissions = status.cashier?.permissions ?? [];
  const canSuppliers = permissions.includes("purchase.view") || permissions.includes("purchase.create");
  const canPrices = permissions.includes("products.view");
  const [tab, setTab] = useState<Tab>("customers");
  const base = status.company?.currency ?? "UZS";

  const tabs: { key: Tab; label: string; allowed: boolean }[] = [
    { key: "customers", label: "Mijozlar", allowed: true },
    { key: "suppliers", label: "Ta'minotchilar", allowed: canSuppliers },
    { key: "prices", label: "Narxlar", allowed: canPrices },
  ];

  return (
    <main className="grid h-full grid-rows-[auto_1fr] bg-muted/40">
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-2">
        <Button size="sm" variant="secondary" onClick={onExit}>
          ← Bosh sahifa
        </Button>
        <h1 className="font-semibold">Ma'lumotlar</h1>
        <nav className="ml-auto flex gap-1">
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
      {tab === "customers" && <PartiesTab kind="customer" baseCurrency={base} canCreate canEdit={permissions.includes("crm.manage")} refreshKey={status.sync.lastSyncAt} />}
      {tab === "suppliers" && (
        <PartiesTab
          kind="supplier"
          baseCurrency={base}
          canCreate={permissions.includes("purchase.create")}
          canEdit={permissions.includes("purchase.edit")}
          refreshKey={status.sync.lastSyncAt}
        />
      )}
      {tab === "prices" && <PricesTab baseCurrency={base} canEdit={permissions.includes("products.edit")} refreshKey={status.sync.lastSyncAt} />}
    </main>
  );
}

function PartiesTab({
  kind,
  baseCurrency,
  canCreate,
  canEdit,
  refreshKey,
}: {
  kind: "customer" | "supplier";
  baseCurrency: string;
  canCreate: boolean;
  canEdit: boolean;
  refreshKey: unknown;
}) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<TypeFilter>("all");
  const [rows, setRows] = useState<(PosCustomer | PosSupplier)[]>([]);
  const [dialog, setDialog] = useState<{ party: PosCustomer | PosSupplier | null } | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(
      () => {
        const input = { query, ...(type === "all" ? {} : { partyType: type }), limit: 1000 };
        (kind === "customer" ? call("ref:customers", input) : call("ref:suppliers", input)).then(
          (list) => {
            setRows(list);
            setError(null);
          },
          (err: unknown) => setError(errorText(err)),
        );
      },
      query ? 150 : 0,
    );
    return () => clearTimeout(timer);
  }, [kind, query, type, refreshKey, version]);

  return (
    <div className="grid min-h-0 grid-rows-[auto_1fr] gap-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input id={`${kind}-search`} autoFocus className="h-10 w-80" placeholder="Nomi, telefon, kod yoki STIR" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="flex gap-1">
          {(["all", "individual", "legal"] as const).map((key) => (
            <Button key={key} size="sm" variant={type === key ? "default" : "secondary"} onClick={() => setType(key)}>
              {key === "all" ? "Hammasi" : PARTY_TYPE_LABELS[key]}
            </Button>
          ))}
        </div>
        <span className="text-sm text-muted-foreground">{rows.length} ta</span>
        {canCreate && (
          <Button className="ml-auto" onClick={() => setDialog({ party: null })}>
            + {kind === "customer" ? "Yangi mijoz" : "Yangi ta'minotchi"}
          </Button>
        )}
      </div>

      <div className="min-h-0 overflow-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Nomi</th>
              <th className="px-3 py-2">Turi</th>
              <th className="px-3 py-2">Telefon</th>
              <th className="px-3 py-2">STIR / rekvizit</th>
              <th className="px-3 py-2 text-right">{kind === "customer" ? "Qarz / balans" : "Qarzimiz"}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const customer = kind === "customer" ? (row as PosCustomer) : null;
              return (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-3 py-1.5">
                    <p className="font-medium leading-tight">
                      {row.name}
                      {row.pending && <span className="ml-2 text-xs text-pos-warning">sinxron kutilmoqda</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">{[row.code, "contactName" in row ? row.contactName : row.contactPerson, row.address].filter(Boolean).join(" · ")}</p>
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">{PARTY_TYPE_LABELS[row.partyType]}</td>
                  <td className="px-3 py-1.5">{row.phone ?? "—"}</td>
                  <td className="px-3 py-1.5 text-xs">
                    {row.taxId ? <span className="block">STIR {row.taxId}</span> : <span className="text-muted-foreground">—</span>}
                    {row.bankAccount && (
                      <span className="block text-muted-foreground">
                        h/r {row.bankAccount}
                        {row.bankMfo ? ` · MFO ${row.bankMfo}` : ""}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {customer ? (
                      <>
                        {num(customer.totalDebt) > 0 && <span className="block text-pos-warning">qarz {fmtMoney(customer.totalDebt, baseCurrency)}</span>}
                        {num(customer.balance) > 0 && <span className="block text-pos-success">balans {fmtMoney(customer.balance, baseCurrency)}</span>}
                        {num(customer.cashbackBalance) > 0 && <span className="block text-pos-promotion">keshbek {fmtMoney(customer.cashbackBalance, baseCurrency)}</span>}
                        {num(customer.totalDebt) <= 0 && num(customer.balance) <= 0 && num(customer.cashbackBalance) <= 0 && <span className="text-muted-foreground">—</span>}
                      </>
                    ) : num(row.totalDebt) !== 0 ? (
                      <span className={num(row.totalDebt) > 0 ? "text-pos-warning" : "text-pos-success"}>
                        {num(row.totalDebt) > 0 ? "" : "avans "}
                        {fmtMoney(Math.abs(num(row.totalDebt)), baseCurrency)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {canEdit && (
                      <Button size="sm" variant="ghost" onClick={() => setDialog({ party: row })}>
                        Tahrirlash
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-12 text-center text-muted-foreground">
                  Topilmadi
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {error && <p className="m-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      </div>

      {dialog && (
        <PartyDialog
          key={dialog.party?.id ?? "new"}
          kind={kind}
          party={dialog.party}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            setVersion((value) => value + 1);
          }}
        />
      )}
    </div>
  );
}

function PricesTab({ baseCurrency, canEdit, refreshKey }: { baseCurrency: string; canEdit: boolean; refreshKey: unknown }) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [editing, setEditing] = useState<PriceRow | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(
      () => {
        call("ref:prices", { query, limit: 500 }).then(
          (list) => {
            setRows(list);
            setError(null);
          },
          (err: unknown) => setError(errorText(err)),
        );
      },
      query ? 150 : 0,
    );
    return () => clearTimeout(timer);
  }, [query, refreshKey, version]);

  const showPurchase = rows.some((row) => row.purchasePrice !== null);
  const price = (value: string | null, currency: string | null) => (value == null ? <span className="text-muted-foreground">—</span> : fmtMoney(trimDecimal(value), currency ?? baseCurrency));

  return (
    <div className="grid min-h-0 grid-rows-[auto_1fr] gap-3 p-3">
      <div className="flex items-center gap-2">
        <Input id="prices-search" autoFocus className="h-10 w-80" placeholder="Mahsulot, SKU yoki shtrix-kod" value={query} onChange={(e) => setQuery(e.target.value)} />
        <span className="text-sm text-muted-foreground">{rows.length} ta</span>
      </div>
      <div className="min-h-0 overflow-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Mahsulot</th>
              <th className="px-3 py-2 text-right">Qoldiq</th>
              <th className="px-3 py-2 text-right">Sotuv</th>
              <th className="px-3 py-2 text-right">Chakana</th>
              <th className="px-3 py-2 text-right">Ulgurji</th>
              <th className="px-3 py-2 text-right">Aksiya</th>
              {showPurchase && <th className="px-3 py-2 text-right">Xarid</th>}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.productId} className="border-t border-border">
                <td className="px-3 py-1.5">
                  <p className="font-medium leading-tight">
                    {row.name}
                    {row.pending && <span className="ml-2 text-xs text-pos-warning">narx navbatda</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {row.sku}
                    {row.barcode ? ` · ${row.barcode}` : ""}
                  </p>
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                  {fmtQty(row.stock)} {row.unitName}
                </td>
                <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{price(row.salesPrice, row.salesCurrency)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{price(row.retailPrice, row.salesCurrency)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{price(row.wholesalePrice, row.salesCurrency)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {price(row.promoPrice, row.salesCurrency)}
                  {row.promoPrice && row.promoPriceEnd && <span className="block text-xs text-muted-foreground">{row.promoPriceEnd} gacha</span>}
                </td>
                {showPurchase && <td className="px-3 py-1.5 text-right tabular-nums">{price(row.purchasePrice, row.purchaseCurrency)}</td>}
                <td className="px-2 py-1.5 text-right">
                  {canEdit && (
                    <Button size="sm" variant="ghost" onClick={() => setEditing(row)}>
                      Narx
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-12 text-center text-muted-foreground">
                  Mahsulot topilmadi
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {error && <p className="m-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      </div>
      {editing && (
        <PriceDialog
          key={editing.productId}
          row={editing}
          baseCurrency={baseCurrency}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setVersion((value) => value + 1);
          }}
        />
      )}
    </div>
  );
}
