import { Package, PackagePlus, PackageMinus, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import { errorMessage } from "@/lib/api.ts";
import { useApiQuery } from "@/lib/query.ts";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty.tsx";
import { formatQty, toNumber } from "@/pages/products/_lib/types.ts";
import type { StockRow } from "../_lib/types.ts";

type Props = {
  warehouseId: string;
  search: string;
  lowStockOnly: boolean;
  canReceive: boolean;
  canManage: boolean;
  onReceive: () => void;
  onIssue: () => void;
  onAdjust: () => void;
};

export default function StockTable({ warehouseId, search, lowStockOnly, canReceive, canManage, onReceive, onIssue, onAdjust }: Props) {
  const query = useApiQuery<{ stock: StockRow[] }>("/api/inventory/stock", {
    warehouseId,
    search: search || undefined,
    lowStockOnly: lowStockOnly || undefined,
  });
  const stockLevels = query.data?.stock;

  if (query.isError) {
    return (
      <div className="h-40 flex items-center justify-center text-sm text-destructive">
        {errorMessage(query.error)}
      </div>
    );
  }

  if (stockLevels === undefined) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (stockLevels.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon"><Package /></EmptyMedia>
          <EmptyTitle>{lowStockOnly || search ? "Natija topilmadi" : "Zaxira mavjud emas"}</EmptyTitle>
          <EmptyDescription>
            {lowStockOnly || search
              ? "Qidiruv yoki filtrni o'zgartiring"
              : "Mahsulot qabul qilib, ombor to'ldiring"}
          </EmptyDescription>
        </EmptyHeader>
        {!lowStockOnly && !search && canReceive && (
          <div className="flex gap-2 justify-center mt-2">
            <Button size="sm" onClick={onReceive}>
              <PackagePlus className="h-4 w-4 mr-1" /> Qabul qilish
            </Button>
          </div>
        )}
      </Empty>
    );
  }

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Mahsulot</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs whitespace-nowrap">Jami</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs whitespace-nowrap">Band</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs whitespace-nowrap">Mavjud</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs whitespace-nowrap">O'rtacha narx</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs whitespace-nowrap">Qiymat</th>
              <th className="text-center px-4 py-3 font-medium text-muted-foreground text-xs">Holat</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {stockLevels.map((row) => {
              const quantity = toNumber(row.quantity);
              const available = toNumber(row.availableQty);
              const avgCost = toNumber(row.avgCostPrice);
              const value = quantity * avgCost;
              const statusLabel = quantity === 0
                ? { text: "Tugagan", cls: "bg-destructive/10 text-destructive" }
                : row.isLow
                ? { text: "Kam", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400" }
                : row.isOverstock
                ? { text: "Ortiqcha", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" }
                : { text: "Yaxshi", cls: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400" };

              return (
                <tr key={row.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {/* API'da yo'q: zaxira ro'yxatida mahsulot rasmi — belgi ko'rsatiladi */}
                      <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Package className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium truncate max-w-[200px]">{row.productName}</p>
                        <p className="text-xs text-muted-foreground font-mono">{row.productSku}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-medium whitespace-nowrap">
                    {formatQty(row.quantity)} <span className="text-xs text-muted-foreground">{row.unitName}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-muted-foreground whitespace-nowrap">
                    {formatQty(row.reservedQty)} <span className="text-xs">{row.unitName}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold whitespace-nowrap">
                    <span className={cn(
                      available <= 0 ? "text-destructive" :
                      row.isLow ? "text-amber-600" : "text-foreground"
                    )}>
                      {formatQty(row.availableQty)}
                    </span>
                    <span className="text-xs text-muted-foreground ml-1">{row.unitName}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground whitespace-nowrap text-xs">
                    {new Intl.NumberFormat("uz-UZ").format(Math.round(avgCost))} so'm
                  </td>
                  <td className="px-4 py-3 text-right font-medium whitespace-nowrap text-xs">
                    {new Intl.NumberFormat("uz-UZ", { notation: "compact" }).format(value)} so'm
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={cn("text-[11px] px-2 py-0.5 rounded-full font-medium", statusLabel.cls)}>
                      {statusLabel.text}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      {canReceive && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onReceive} title="Qabul">
                          <PackagePlus className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {canManage && (
                        <>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onIssue} title="Chiqarish">
                            <PackageMinus className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onAdjust} title="Tuzatish">
                            <SlidersHorizontal className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
