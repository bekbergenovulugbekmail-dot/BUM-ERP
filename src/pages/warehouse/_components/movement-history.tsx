import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  PackagePlus, PackageMinus, ArrowLeftRight, SlidersHorizontal,
  Trash2, RotateCcw, ClipboardList,
} from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import { api, errorMessage, type ApiError } from "@/lib/api.ts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty.tsx";
import { formatQty, toNumber } from "@/pages/products/_lib/types.ts";
import type { MovementsResponse } from "../_lib/types.ts";

type Props = {
  warehouseId: string;
};

const PAGE_SIZE = 100;

const MOVE_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  receive:      { label: "Qabul",         icon: <PackagePlus className="h-3.5 w-3.5" />,    color: "text-green-600" },
  issue:        { label: "Chiqarish",     icon: <PackageMinus className="h-3.5 w-3.5" />,   color: "text-amber-600" },
  transfer_out: { label: "Transfer (-)",  icon: <ArrowLeftRight className="h-3.5 w-3.5" />, color: "text-blue-600" },
  transfer_in:  { label: "Transfer (+)",  icon: <ArrowLeftRight className="h-3.5 w-3.5" />, color: "text-blue-600" },
  adjust:       { label: "Tuzatish",      icon: <SlidersHorizontal className="h-3.5 w-3.5" />, color: "text-purple-600" },
  writeoff:     { label: "Hisobdan ch.",  icon: <Trash2 className="h-3.5 w-3.5" />,         color: "text-destructive" },
  return_in:    { label: "Qaytish (+)",   icon: <RotateCcw className="h-3.5 w-3.5" />,      color: "text-teal-600" },
  return_out:   { label: "Qaytish (-)",   icon: <RotateCcw className="h-3.5 w-3.5" />,      color: "text-orange-600" },
  count:        { label: "Inventar.",     icon: <ClipboardList className="h-3.5 w-3.5" />,  color: "text-indigo-600" },
};

export default function MovementHistory({ warehouseId }: Props) {
  const [typeFilter, setTypeFilter] = useState("all");
  const filters = { warehouseId, type: typeFilter !== "all" ? typeFilter : undefined };

  // Kursorli sahifalash (vaqt bo'yicha teskari tartib); kalit prefiksi mutatsiyalardan keyin yangilanadi
  const query = useInfiniteQuery<MovementsResponse, ApiError>({
    queryKey: ["/api/inventory/stock/movements", { ...filters, pageSize: PAGE_SIZE, paged: true }],
    queryFn: ({ pageParam, signal }) =>
      api.get<MovementsResponse>(
        "/api/inventory/stock/movements",
        { ...filters, limit: PAGE_SIZE, cursor: pageParam as string | undefined },
        signal,
      ),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const movements = query.data?.pages.flatMap((page) => page.movements);

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center gap-3">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-9 w-52">
            <SelectValue placeholder="Barcha turlar" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Barcha turlar</SelectItem>
            <SelectItem value="receive">Qabul</SelectItem>
            <SelectItem value="issue">Chiqarish</SelectItem>
            <SelectItem value="transfer_out">Transfer (-)</SelectItem>
            <SelectItem value="transfer_in">Transfer (+)</SelectItem>
            <SelectItem value="adjust">Tuzatish</SelectItem>
            <SelectItem value="writeoff">Hisobdan chiqarish</SelectItem>
            <SelectItem value="return_in">Qaytish (+)</SelectItem>
            <SelectItem value="return_out">Qaytish (-)</SelectItem>
            <SelectItem value="count">Inventarizatsiya</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          {movements ? `${movements.length} ta yozuv` : "..."}
        </span>
      </div>

      {query.isError ? (
        <p className="text-sm text-destructive">{errorMessage(query.error)}</p>
      ) : movements === undefined ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : movements.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><ClipboardList /></EmptyMedia>
            <EmptyTitle>Harakatlar mavjud emas</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Sana</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Tur</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Mahsulot</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Miqdor</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Narx</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Izoh</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {movements.map((m) => {
                  const meta = MOVE_META[m.type] ?? { label: m.type, icon: null, color: "text-foreground" };
                  const isPositive = toNumber(m.quantity) > 0;
                  return (
                    <tr key={m.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                        {format(new Date(m.occurredAt), "dd.MM.yyyy HH:mm")}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className={cn("flex items-center gap-1.5 text-xs font-medium", meta.color)}>
                          {meta.icon}
                          {meta.label}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-xs truncate max-w-[180px]">{m.productName}</p>
                        <p className="text-[11px] text-muted-foreground font-mono">{m.productSku}</p>
                      </td>
                      <td className={cn("px-4 py-2.5 text-right font-mono font-bold text-sm whitespace-nowrap", isPositive ? "text-green-600" : "text-destructive")}>
                        {isPositive ? "+" : ""}{formatQty(m.quantity)} {m.unitName}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-muted-foreground whitespace-nowrap">
                        {new Intl.NumberFormat("uz-UZ").format(toNumber(m.costPrice))} so'm
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground truncate max-w-[150px]">
                        {m.notes ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {query.hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                size="sm"
                disabled={query.isFetchingNextPage}
                onClick={() => { void query.fetchNextPage(); }}
              >
                {query.isFetchingNextPage ? "Yuklanmoqda..." : "Ko'proq yuklash"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
