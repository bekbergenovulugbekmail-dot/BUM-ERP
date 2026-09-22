import { useState } from "react";
import { PackageSearch, RefreshCw, TruckElectric } from "lucide-react";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { toast } from "sonner";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { api, errorMessage } from "@/lib/api.ts";
import { usePermissions } from "@/hooks/use-company.ts";
import { toNumber } from "@/pages/products/_lib/types.ts";

/**
 * Backorder — mijozga va'da qilingan, lekin omborda hali band qilinmagan tovar.
 * Ro'yxat serverda `sales_order_items` dan hisoblanadi (alohida jadval yo'q).
 */
type BackorderRow = {
  orderItemId: string;
  orderId: string;
  orderNumber: string;
  orderDate: string;
  customerId: string | null;
  customerName: string | null;
  productId: string;
  productName: string;
  sku: string;
  warehouseId: string;
  warehouseName: string;
  ordered: string;
  reserved: string;
  remaining: string;
  status: "open" | "partially_allocated";
  /** Yo'ldagi tasdiqlangan xarid qoldig'i; 0 bo'lsa kutilayotgan tovar yo'q. */
  inbound: string;
};

const STATUS_LABELS: Record<BackorderRow["status"], string> = {
  open: "Band qilinmagan",
  partially_allocated: "Qisman band",
};
const STATUS_COLORS: Record<BackorderRow["status"], string> = {
  open: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  partially_allocated: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
};

const qty = (value: string) => new Intl.NumberFormat("uz-UZ", { maximumFractionDigits: 3 }).format(toNumber(value));

export default function BackordersSection({ warehouseId }: { warehouseId: string }) {
  const { can } = usePermissions();
  const [status, setStatus] = useState<"all" | BackorderRow["status"]>("all");

  const query = useApiQuery<{ items: BackorderRow[]; totals: { lines: number; remaining: string } }>("/api/inventory/backorders", {
    warehouseId,
    status: status === "all" ? undefined : status,
    limit: 500,
  });
  const rows = query.data?.items;

  /** Tovar kelganda taqsimot avtomatik bo'ladi; bu — qo'lda qayta urinish (qoldiq tuzatilgandan keyin). */
  const allocate = useApiMutation(
    () => api.post<{ allocations: unknown[] }>("/api/inventory/backorders/allocate", { warehouseId }),
    { invalidate: ["/api/inventory/backorders", "/api/inventory/stock"] },
  );

  const runAllocate = () =>
    allocate.mutate(undefined, {
      onSuccess: (result) =>
        toast.success(result.allocations.length > 0 ? `${result.allocations.length} qator band qilindi` : "Taqsimlanadigan qator yo'q"),
      onError: (error) => toast.error(errorMessage(error)),
    });

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
            <SelectTrigger className="h-9 w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Barchasi</SelectItem>
              <SelectItem value="open">Band qilinmagan</SelectItem>
              <SelectItem value="partially_allocated">Qisman band</SelectItem>
            </SelectContent>
          </Select>
          {query.data && (
            <p className="text-sm text-muted-foreground">
              {query.data.totals.lines} qator · jami {qty(query.data.totals.remaining)} birlik kutilmoqda
            </p>
          )}
        </div>
        {can("warehouse.receive") && (
          <Button size="sm" variant="secondary" onClick={runAllocate} disabled={allocate.isPending || !rows?.length}>
            <RefreshCw className={allocate.isPending ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            Qayta taqsimlash
          </Button>
        )}
      </div>

      {!rows ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-14 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <PackageSearch className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">Kutilayotgan buyurtma yo'q</p>
            <p className="text-sm text-muted-foreground">Tasdiqlangan buyurtmalarning hammasi omborda band qilingan.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/60 backdrop-blur">
              <tr className="text-left">
                <th className="px-3 py-2.5 font-medium text-muted-foreground">Buyurtma</th>
                <th className="px-3 py-2.5 font-medium text-muted-foreground">Mijoz</th>
                <th className="px-3 py-2.5 font-medium text-muted-foreground">Mahsulot</th>
                <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">Buyurtma</th>
                <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">Band</th>
                <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">Kutilmoqda</th>
                <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">Yo'lda</th>
                <th className="px-3 py-2.5 font-medium text-muted-foreground">Holat</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.orderItemId} className="border-t">
                  <td className="px-3 py-2.5">
                    <p className="font-medium">{row.orderNumber}</p>
                    <p className="text-xs text-muted-foreground">{row.orderDate}</p>
                  </td>
                  <td className="px-3 py-2.5">{row.customerName ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    <p>{row.productName}</p>
                    <p className="text-xs text-muted-foreground">{row.sku}</p>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{qty(row.ordered)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{qty(row.reserved)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{qty(row.remaining)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {toNumber(row.inbound) > 0 ? (
                      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                        <TruckElectric className="h-3.5 w-3.5" />
                        {qty(row.inbound)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge variant="secondary" className={STATUS_COLORS[row.status]}>
                      {STATUS_LABELS[row.status]}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
