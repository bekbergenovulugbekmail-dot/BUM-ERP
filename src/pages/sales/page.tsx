import { useState } from "react";
import { motion } from "motion/react";
import {
  ShoppingBag, TrendingUp, Clock, Plus, Search,
  Users, ChevronRight, DollarSign,
} from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import PageTabs from "@/components/page-tabs.tsx";
import { useApiQuery } from "@/lib/query.ts";
import { useDebounce } from "@/hooks/use-debounce.ts";
import { usePermissions } from "@/hooks/use-company.ts";
import OrderDetailDrawer from "./_components/order-detail-drawer.tsx";
import CreateOrderDialog from "./_components/create-order-dialog.tsx";
import CustomersSection from "./_components/customers-section.tsx";
import { num, type SalesOrderRow, type SalesOrderStatus, type SalesStats } from "./_lib/types.ts";

const PAGE_SIZE = 30;
/** API chegarasi (`limit` ≤ 200). */
const MAX_LIMIT = 200;

/** "Yakunlangan" filtri serverda eski `shipped`/`delivered` yozuvlarni ham qamrab oladi. */
const STATUS_TABS = [
  { label: "Barchasi", value: "all" },
  { label: "Qoralama", value: "draft" },
  { label: "Tasdiqlangan", value: "confirmed" },
  { label: "Yakunlangan", value: "completed" },
  { label: "Qaytarilgan", value: "returned" },
  { label: "Bekor", value: "cancelled" },
] as const;

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  confirmed: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
  completed: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
  shipped: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
  delivered: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
  returned: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  cancelled: "bg-destructive/10 text-destructive",
};
/** Sotuv holati — yetkazish holati emas. Eski `shipped`/`delivered` ham yakunlangan sotuvni bildirgan. */
const STATUS_LABELS: Record<string, string> = {
  draft: "Qoralama", confirmed: "Tasdiqlangan", completed: "Yakunlangan",
  shipped: "Yakunlangan", delivered: "Yakunlangan", returned: "Qaytarilgan", cancelled: "Bekor",
};
/** To'lov holati alohida ustun — sotuv holati bilan aralashtirilmaydi. */
const PAYMENT_LABELS: Record<string, string> = { paid: "To'langan", partial: "Qisman", unpaid: "To'lanmagan" };
const PAYMENT_COLORS: Record<string, string> = {
  paid: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
  partial: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  unpaid: "bg-muted text-muted-foreground",
};
/** Yetkazma holati — sotuvdan mustaqil ustun; yetkazma yo'q bo'lsa "—". */
const DELIVERY_LABELS: Record<string, string> = {
  ready: "Tayyor", assigned: "Biriktirilgan", accepted: "Qabul qilingan",
  out_for_delivery: "Yo'lda", arrived: "Mijozda", delivering: "Topshirilmoqda",
  delivered: "Yetkazildi", partially_delivered: "Qisman yetkazildi",
  failed: "Yetkazilmadi", returned: "Qaytarildi", cancelled: "Bekor qilingan",
};
const DELIVERY_COLORS: Record<string, string> = {
  delivered: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
  partially_delivered: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  failed: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  returned: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  cancelled: "bg-destructive/10 text-destructive",
};

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

export default function SalesPage() {
  const { can } = usePermissions();
  const [tab, setTab] = useState("orders");
  const [statusFilter, setStatusFilter] = useState<SalesStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search.trim(), 300);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);

  const stats = useApiQuery<SalesStats>("/api/sales/orders/stats").data;
  // Qidiruv serverda (raqam yoki mijoz nomi)
  const ordersData = useApiQuery<{ orders: SalesOrderRow[]; nextCursor: string | null }>(
    "/api/sales/orders",
    {
      status: statusFilter !== "all" ? statusFilter : undefined,
      isPos: false,
      limit: visibleLimit,
      search: debouncedSearch || undefined,
    },
    { placeholderData: (previous) => previous },
  ).data;
  const orders = ordersData?.orders;

  // Reset pagination when filter changes
  const handleStatusFilter = (val: SalesStatus | "all") => {
    setStatusFilter(val);
    setVisibleLimit(PAGE_SIZE);
  };

  const canLoadMore = Boolean(ordersData?.nextCursor) && visibleLimit < MAX_LIMIT;

  const statCards = [
    { label: "Bu oy sotuv", value: fmt(num(stats?.totalThisMonth)) + " so'm", icon: TrendingUp, color: "text-emerald-500" },
    { label: "Kutilayotgan to'lov", value: fmt(num(stats?.totalDebt)) + " so'm", icon: Clock, color: "text-amber-500" },
    { label: "Bu oy buyurtmalar", value: String(stats?.countThisMonth ?? 0), icon: ShoppingBag, color: "text-blue-500" },
    { label: "Bugun", value: String(stats?.todayCount ?? 0), icon: DollarSign, color: "text-purple-500" },
  ];

  const canCreate = can("sales.create");

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
            <ShoppingBag className="h-5 w-5 text-emerald-500" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Sotuv moduli</h1>
            <p className="text-sm text-muted-foreground">Buyurtmalar, mijozlar va to'lovlar</p>
          </div>
        </div>
        {canCreate && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" /> Sotuv buyurtmasi
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card, i) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="bg-card border border-border rounded-2xl p-4"
          >
            <div className="flex items-center gap-2 mb-2">
              <card.icon className={cn("h-4 w-4", card.color)} />
              <span className="text-xs text-muted-foreground">{card.label}</span>
            </div>
            {stats ? (
              <p className="text-xl font-bold">{card.value}</p>
            ) : (
              <Skeleton className="h-7 w-32" />
            )}
          </motion.div>
        ))}
      </div>

      <PageTabs
        tabs={[
          { key: "orders", label: "Buyurtmalar", icon: ShoppingBag },
          { key: "customers", label: "Mijozlar", icon: Users },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "customers" ? (
        <CustomersSection />
      ) : (
        <>
          {/* Status chips */}
          <div className="flex flex-wrap gap-2">
            {STATUS_TABS.map((s) => (
              <button
                key={s.value}
                onClick={() => handleStatusFilter(s.value as SalesStatus | "all")}
                className={cn(
                  "px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer",
                  statusFilter === s.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent"
                )}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Buyurtma raqami yoki mijoz..." value={search}
              onChange={(e) => { setSearch(e.target.value); setVisibleLimit(PAGE_SIZE); }} />
          </div>

          {/* Orders table */}
          {!orders ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          ) : orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <ShoppingBag className="h-12 w-12 text-muted-foreground/30 mb-3" />
              <p className="text-muted-foreground">Buyurtmalar yo'q</p>
              {canCreate && (
                <Button className="mt-4" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4 mr-1" /> Yangi buyurtma
                </Button>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 border-b border-border">
                    <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Raqam</th>
                    <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Mijoz</th>
                    <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Sana</th>
                    <th className="text-right px-4 py-3 text-xs text-muted-foreground font-medium">Jami</th>
                    <th className="text-right px-4 py-3 text-xs text-muted-foreground font-medium">To'langan</th>
                    <th className="text-center px-4 py-3 text-xs text-muted-foreground font-medium">Sotuv</th>
                    <th className="text-center px-4 py-3 text-xs text-muted-foreground font-medium">To'lov</th>
                    <th className="text-center px-4 py-3 text-xs text-muted-foreground font-medium">Yetkazma</th>
                    <th className="w-8 px-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {orders.map((order) => {
                    const total = num(order.totalAmount);
                    const paid = num(order.paidAmount);
                    return (
                      <tr
                        key={order.id}
                        onClick={() => setSelectedOrderId(order.id)}
                        className="hover:bg-muted/30 cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-3 font-mono text-xs font-semibold">{order.number}</td>
                        <td className="px-4 py-3">
                          <p className="font-medium">{order.customerName ?? "Anonim mijoz"}</p>
                          <p className="text-xs text-muted-foreground">{order.warehouseName}</p>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{order.orderDate}</td>
                        <td className="px-4 py-3 text-right font-semibold">
                          {fmt(total)} so'm
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className={cn(
                            "text-sm",
                            paid >= total ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
                          )}>
                            {fmt(paid)} so'm
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium", STATUS_COLORS[order.status] ?? "")}>
                            {STATUS_LABELS[order.status] ?? order.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {order.status === "draft" || order.status === "cancelled" ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium", PAYMENT_COLORS[order.paymentStatus] ?? "")}>
                              {PAYMENT_LABELS[order.paymentStatus] ?? order.paymentStatus}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {order.deliveryStatus ? (
                            <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium", DELIVERY_COLORS[order.deliveryStatus] ?? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400")}>
                              {DELIVERY_LABELS[order.deliveryStatus] ?? order.deliveryStatus}
                            </span>
                          ) : (
                            <span className="text-muted-foreground" title="Yetkazma yaratilmagan">—</span>
                          )}
                        </td>
                        <td className="px-2 py-3">
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Load more */}
          {canLoadMore && orders && orders.length > 0 && (
            <div className="flex justify-center pt-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setVisibleLimit((prev) => Math.min(MAX_LIMIT, prev + PAGE_SIZE))}
              >
                Ko'proq yuklash
              </Button>
            </div>
          )}
        </>
      )}

      {createOpen && (
        <CreateOrderDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => {
            setCreateOpen(false);
            setSelectedOrderId(id);
          }}
        />
      )}

      {selectedOrderId && (
        <OrderDetailDrawer orderId={selectedOrderId} onClose={() => setSelectedOrderId(null)} />
      )}
    </div>
  );
}

type SalesStatus = SalesOrderStatus;
