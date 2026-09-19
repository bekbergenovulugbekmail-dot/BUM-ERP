/**
 * TANNARX — mahsulot qanchaga tushgani va marja.
 *
 * Ruxsat `products.view_cost`: tugma ko'rinmasa ham server 403 qaytaradi, ya'ni himoya
 * brauzerda emas. Raqamlar mavjud manbalardan: kartochkadagi kirim narxi, ombordagi AVCO
 * va qabul qilingan xarid hujjatlari (`GET /api/catalog/products/costs`).
 */
import { useState } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import { errorMessage } from "@/lib/api.ts";
import { useApiQuery } from "@/lib/query.ts";
import { useDebounce } from "@/hooks/use-debounce.ts";
import { formatMoney, useCurrencies } from "@/hooks/use-currencies.ts";

type CostRow = {
  id: string;
  name: string;
  sku: string;
  unitName: string;
  currentCost: string;
  avgCost: string | null;
  lastPurchasePrice: string | null;
  lastPurchaseDate: string | null;
  salesPrice: string;
  marginPercent: string | null;
};

type HistoryRow = {
  orderId: string;
  number: string;
  date: string;
  supplierName: string;
  unitName: string;
  quantity: string;
  unitPrice: string;
  currency: string;
  basePrice: string | null;
};

const dash = "—";

export default function CostsSection() {
  const currencies = useCurrencies();
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [openId, setOpenId] = useState<string | null>(null);

  const query = useApiQuery<{ products: CostRow[] }>("/api/catalog/products/costs", {
    search: debouncedSearch.trim() || undefined,
    limit: 200,
  });

  const money = (value: string | null) => (value === null ? dash : formatMoney(value, currencies.base));

  return (
    <div className="flex-1 overflow-auto p-6" data-testid="product-costs">
      <div className="relative mb-4 max-w-xs">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Nomi yoki SKU..."
          className="h-8 pl-8 text-sm"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {query.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </div>
      ) : query.isError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive" role="alert">
          {errorMessage(query.error)}
        </div>
      ) : query.data.products.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Mahsulot topilmadi</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Mahsulot</th>
                <th className="px-3 py-2 text-left font-medium">Birlik</th>
                <th className="px-3 py-2 text-right font-medium">Joriy tannarx</th>
                <th className="px-3 py-2 text-right font-medium">O'rtacha tannarx</th>
                <th className="px-3 py-2 text-right font-medium">Oxirgi xarid narxi</th>
                <th className="px-3 py-2 text-left font-medium">Oxirgi xarid sanasi</th>
                <th className="px-3 py-2 text-right font-medium">Sotuv narxi</th>
                <th className="px-3 py-2 text-right font-medium">Marja</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {query.data.products.map((row) => {
                const margin = row.marginPercent === null ? null : Number(row.marginPercent);
                const open = openId === row.id;
                return [
                  <tr key={row.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="flex items-center gap-1.5 text-left"
                        onClick={() => setOpenId(open ? null : row.id)}
                        aria-expanded={open}
                      >
                        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                        <span>
                          <span className="block">{row.name}</span>
                          <span className="block font-mono text-[11px] text-muted-foreground">{row.sku}</span>
                        </span>
                      </button>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{row.unitName}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(row.currentCost)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(row.avgCost)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(row.lastPurchasePrice)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{row.lastPurchaseDate ?? dash}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(row.salesPrice)}</td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right font-medium tabular-nums",
                        margin !== null && margin < 0 && "text-destructive",
                      )}
                    >
                      {margin === null ? dash : `${row.marginPercent}%`}
                    </td>
                  </tr>,
                  open ? (
                    <tr key={`${row.id}-history`} className="bg-muted/20">
                      <td colSpan={8} className="px-3 py-3">
                        <CostHistory productId={row.id} />
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Tannarx tarixi: tovar kelgan xarid hujjatlari. */
function CostHistory({ productId }: { productId: string }) {
  const query = useApiQuery<{ history: HistoryRow[] }>(`/api/catalog/products/${productId}/cost-history`, { limit: 20 });

  if (query.isPending) return <Skeleton className="h-16 w-full rounded-lg" />;
  if (query.isError) {
    return (
      <p className="text-xs text-destructive" role="alert">
        {errorMessage(query.error)}
      </p>
    );
  }
  if (query.data.history.length === 0) {
    return <p className="text-xs text-muted-foreground">Bu mahsulot hali xarid qilinmagan</p>;
  }

  return (
    <table className="w-full text-xs">
      <thead className="text-muted-foreground">
        <tr>
          <th className="py-1 text-left font-medium">Hujjat</th>
          <th className="py-1 text-left font-medium">Sana</th>
          <th className="py-1 text-left font-medium">Ta'minotchi</th>
          <th className="py-1 text-right font-medium">Miqdor</th>
          <th className="py-1 text-right font-medium">Hujjatdagi narx</th>
          <th className="py-1 text-right font-medium">Asosiy birlikda</th>
        </tr>
      </thead>
      <tbody>
        {query.data.history.map((row) => (
          <tr key={`${row.orderId}-${row.date}-${row.unitPrice}`}>
            <td className="py-1 font-mono">{row.number}</td>
            <td className="py-1">{row.date}</td>
            <td className="py-1">{row.supplierName}</td>
            <td className="py-1 text-right tabular-nums">
              {row.quantity} {row.unitName}
            </td>
            <td className="py-1 text-right tabular-nums">{formatMoney(row.unitPrice, row.currency)}</td>
            <td className="py-1 text-right tabular-nums">{row.basePrice === null ? dash : row.basePrice}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
