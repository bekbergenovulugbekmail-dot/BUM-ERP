import { ShoppingCart, ChevronRight, Truck, CheckCircle, Clock, Ban } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty.tsx";
import type { Id } from "@/convex/_generated/dataModel.d.ts";

type Order = {
  _id: Id<"purchaseOrders">;
  number: string;
  supplierName: string;
  warehouseName: string;
  status: string;
  orderDate: string;
  totalAmount: number;
  paidAmount: number;
  balance: number;
  itemCount: number;
  currency: string;
};

type Props = {
  orders: Order[] | undefined;
  onSelect: (id: Id<"purchaseOrders">) => void;
};

const STATUS_META: Record<string, { label: string; icon: React.ReactNode; cls: string }> = {
  draft:     { label: "Qoralama",    icon: <Clock className="h-3 w-3" />,        cls: "bg-muted text-muted-foreground" },
  confirmed: { label: "Tasdiqlangan",icon: <CheckCircle className="h-3 w-3" />,  cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" },
  partial:   { label: "Qisman",      icon: <Truck className="h-3 w-3" />,        cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400" },
  received:  { label: "Qabul qilindi",icon: <Truck className="h-3 w-3" />,       cls: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400" },
  invoiced:  { label: "Hisob-faktura",icon: <ShoppingCart className="h-3 w-3" />,cls: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400" },
  paid:      { label: "To'langan",   icon: <CheckCircle className="h-3 w-3" />,  cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400" },
  cancelled: { label: "Bekor",       icon: <Ban className="h-3 w-3" />,          cls: "bg-destructive/10 text-destructive" },
};

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

export default function OrdersTable({ orders, onSelect }: Props) {
  if (orders === undefined) {
    return <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>;
  }

  if (orders.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon"><ShoppingCart /></EmptyMedia>
          <EmptyTitle>Buyurtmalar yo'q</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Raqam</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Yetkazuvchi</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Ombor</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Sana</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-muted-foreground">Holat</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Jami</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Qoldi</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {orders.map((o) => {
              const meta = STATUS_META[o.status] ?? STATUS_META.draft;
              return (
                <tr
                  key={o._id}
                  className="hover:bg-muted/30 transition-colors cursor-pointer"
                  onClick={() => onSelect(o._id)}
                >
                  <td className="px-4 py-3 font-mono font-medium text-sm">{o.number}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-sm">{o.supplierName}</p>
                    <p className="text-xs text-muted-foreground">{o.itemCount} ta mahsulot</p>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{o.warehouseName}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{o.orderDate}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={cn("inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium", meta.cls)}>
                      {meta.icon} {meta.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-sm whitespace-nowrap">
                    {fmt(o.totalAmount)} so'm
                  </td>
                  <td className={cn("px-4 py-3 text-right text-sm font-bold whitespace-nowrap", o.balance > 0 ? "text-amber-600" : "text-green-600")}>
                    {o.balance > 0 ? fmt(o.balance) + " so'm" : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
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
