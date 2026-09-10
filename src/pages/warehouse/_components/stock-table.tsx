import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { AlertTriangle, TrendingDown, Package, PackagePlus, PackageMinus, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty.tsx";
import type { Id } from "@/convex/_generated/dataModel.d.ts";

type Props = {
  warehouseId: Id<"warehouses">;
  search: string;
  lowStockOnly: boolean;
  onReceive: () => void;
  onIssue: () => void;
  onAdjust: () => void;
};

const MOVE_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  receive: { label: "Qabul", color: "text-green-600" },
  issue: { label: "Chiqarish", color: "text-amber-600" },
  transfer_out: { label: "Chiqim transfer", color: "text-blue-600" },
  transfer_in: { label: "Kirish transfer", color: "text-blue-600" },
  adjust: { label: "Tuzatish", color: "text-purple-600" },
  writeoff: { label: "Hisobdan chiqarish", color: "text-destructive" },
  return_in: { label: "Qaytish (kirish)", color: "text-teal-600" },
  return_out: { label: "Qaytish (chiqish)", color: "text-orange-600" },
  count: { label: "Inventarizatsiya", color: "text-indigo-600" },
};

export default function StockTable({ warehouseId, search, lowStockOnly, onReceive, onIssue, onAdjust }: Props) {
  const stockLevels = useQuery(api.warehouse.stock.getWarehouseStock, {
    warehouseId,
    searchQuery: search || undefined,
    lowStockOnly: lowStockOnly || undefined,
  });

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
        {!lowStockOnly && !search && (
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
              const value = row.quantity * row.avgCostPrice;
              const statusLabel = row.quantity === 0
                ? { text: "Tugagan", cls: "bg-destructive/10 text-destructive" }
                : row.isLow
                ? { text: "Kam", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400" }
                : row.isOverstock
                ? { text: "Ortiqcha", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" }
                : { text: "Yaxshi", cls: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400" };

              return (
                <tr key={row._id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {row.productImage ? (
                        <img src={row.productImage} alt="" className="h-8 w-8 rounded-lg object-cover border border-border shrink-0" />
                      ) : (
                        <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <Package className="h-4 w-4 text-primary" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="font-medium truncate max-w-[200px]">{row.productName}</p>
                        <p className="text-xs text-muted-foreground font-mono">{row.productSku}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-medium whitespace-nowrap">
                    {row.quantity} <span className="text-xs text-muted-foreground">{row.unitName}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-muted-foreground whitespace-nowrap">
                    {row.reservedQty} <span className="text-xs">{row.unitName}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold whitespace-nowrap">
                    <span className={cn(
                      row.availableQty === 0 ? "text-destructive" :
                      row.isLow ? "text-amber-600" : "text-foreground"
                    )}>
                      {row.availableQty}
                    </span>
                    <span className="text-xs text-muted-foreground ml-1">{row.unitName}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground whitespace-nowrap text-xs">
                    {new Intl.NumberFormat("uz-UZ").format(Math.round(row.avgCostPrice))} so'm
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
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onReceive} title="Qabul">
                        <PackagePlus className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onIssue} title="Chiqarish">
                        <PackageMinus className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onAdjust} title="Tuzatish">
                        <SlidersHorizontal className="h-3.5 w-3.5" />
                      </Button>
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
