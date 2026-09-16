import { useState } from "react";
import { motion } from "motion/react";
import {
  ShoppingCart, Plus, TrendingUp,
  Truck, CreditCard, Users, FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { cn } from "@/lib/utils.ts";
import { useApiQuery } from "@/lib/query.ts";
import { usePermissions } from "@/hooks/use-company.ts";
import CsvToolbar from "@/components/csv/csv-toolbar.tsx";
import OrdersTable from "./_components/orders-table.tsx";
import SuppliersTable from "./_components/suppliers-table.tsx";
import CreateOrderDialog from "./_components/create-order-dialog.tsx";
import OrderDetailDrawer from "./_components/order-detail-drawer.tsx";
import { num, todayLocal, type PurchaseOrderRow, type PurchaseOrderStatus, type Supplier } from "./_lib/types.ts";

const STATUS_TABS = [
  { value: "all", label: "Barchasi" },
  { value: "draft", label: "Qoralama" },
  { value: "confirmed", label: "Tasdiqlangan" },
  { value: "partial", label: "Qisman" },
  { value: "received", label: "Qabul qilindi" },
  { value: "paid", label: "To'langan" },
];

export default function PurchasePage() {
  const { can } = usePermissions();
  const [mainTab, setMainTab] = useState("orders");
  const [statusFilter, setStatusFilter] = useState<PurchaseOrderStatus | "all">("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  // Bitta so'rov — statistika va holat filtri shu ro'yxatdan (API chegarasi: 200 ta eng yangi buyurtma)
  const allOrders = useApiQuery<{ orders: PurchaseOrderRow[]; nextCursor: string | null }>(
    "/api/purchase/orders",
    { limit: 200 },
  ).data?.orders;
  const orders = statusFilter === "all"
    ? allOrders
    : allOrders?.filter((o) => o.status === statusFilter);

  const suppliers = useApiQuery<{ suppliers: Supplier[] }>("/api/purchase/suppliers").data?.suppliers;
  const totalDebt = suppliers?.reduce((s, sup) => s + num(sup.totalDebt), 0) ?? 0;
  const pendingOrders = allOrders?.filter((o) => ["confirmed", "partial"].includes(o.status)).length ?? 0;
  const draftOrders = allOrders?.filter((o) => o.status === "draft").length ?? 0;
  const monthStart = `${todayLocal().slice(0, 7)}-01`;
  const monthTotal = allOrders
    ?.filter((o) => o.orderDate >= monthStart && o.status !== "cancelled")
    .reduce((s, o) => s + num(o.totalAmount), 0) ?? 0;

  const STATS = [
    { label: "Bu oy xarid", value: formatMoney(monthTotal), icon: <TrendingUp className="h-5 w-5" />, color: "text-green-600" },
    { label: "Kutilayotgan", value: pendingOrders, icon: <Truck className="h-5 w-5" />, color: "text-blue-600" },
    { label: "Qoralamalar", value: draftOrders, icon: <FileText className="h-5 w-5" />, color: "text-muted-foreground" },
    { label: "Yetkazuvchi qarzi", value: formatMoney(totalDebt), icon: <CreditCard className="h-5 w-5" />, color: totalDebt > 0 ? "text-amber-600" : "text-muted-foreground", alert: totalDebt > 0 },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <ShoppingCart className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Xarid moduli</h1>
            <p className="text-xs text-muted-foreground">Yetkazuvchilar, buyurtmalar va to'lovlar</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Eksport ekrandagi holat filtri bo'yicha; import hujjatni qoralama holatida ochadi */}
          <CsvToolbar
            exportUrl="/api/purchase/orders/export"
            exportParams={statusFilter === "all" ? undefined : { status: statusFilter }}
            filename="xaridlar"
            importUrl="/api/purchase/orders/import"
            invalidate={["/api/purchase/orders"]}
            canImport={can("purchase.create")}
            columns={[
              { key: "number", aliases: ["Hujjat raqami", "number"] },
              { key: "orderDate", aliases: ["Sana", "orderDate"] },
              { key: "supplier", aliases: ["Ta'minotchi", "Ta'minotchi kodi", "supplier"] },
              { key: "warehouse", aliases: ["Ombor", "warehouse"] },
              { key: "product", aliases: ["SKU", "Mahsulot", "product"] },
              { key: "quantity", aliases: ["Miqdor", "quantity"] },
              { key: "unit", aliases: ["Birlik", "unit"] },
              { key: "price", aliases: ["Narx", "price"] },
              { key: "discountPercent", aliases: ["Chegirma %", "discountPercent"] },
              { key: "taxRate", aliases: ["Soliq %", "taxRate"] },
              { key: "expectedDate", aliases: ["Kutilgan sana", "expectedDate"] },
              { key: "notes", aliases: ["Izoh", "notes"] },
            ]}
          />
          {can("purchase.create") && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1.5" /> Xarid buyurtmasi
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 px-6 py-4 shrink-0">
        {STATS.map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
            <Card className={cn(s.alert && "border-amber-400/60 dark:border-amber-500/40")}>
              <CardContent className="flex items-center gap-3 py-3 px-4">
                <div className={cn("shrink-0", s.color)}>{s.icon}</div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground truncate">{s.label}</p>
                  {allOrders === undefined ? (
                    <Skeleton className="h-5 w-16 mt-0.5" />
                  ) : (
                    <p className={cn("text-lg font-bold leading-tight", s.color)}>{s.value}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Main tabs */}
      <div className="flex-1 min-h-0 px-6 pb-6">
        <Tabs value={mainTab} onValueChange={setMainTab} className="h-full flex flex-col">
          <TabsList className="mb-4">
            <TabsTrigger value="orders">
              <ShoppingCart className="h-4 w-4 mr-1.5" /> Buyurtmalar
            </TabsTrigger>
            <TabsTrigger value="suppliers">
              <Users className="h-4 w-4 mr-1.5" /> Yetkazuvchilar
            </TabsTrigger>
          </TabsList>

          <TabsContent value="orders" className="flex-1 min-h-0 mt-0 flex flex-col gap-3">
            {/* Status sub-tabs */}
            <div className="flex gap-1 flex-wrap">
              {STATUS_TABS.map((tab) => (
                <button
                  key={tab.value}
                  onClick={() => setStatusFilter(tab.value as PurchaseOrderStatus | "all")}
                  className={cn(
                    "px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer",
                    statusFilter === tab.value
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="flex-1 min-h-0">
              <OrdersTable
                orders={orders}
                onSelect={(id) => setSelectedOrderId(id)}
              />
            </div>
          </TabsContent>

          <TabsContent value="suppliers" className="flex-1 min-h-0 mt-0">
            <SuppliersTable suppliers={suppliers} />
          </TabsContent>
        </Tabs>
      </div>

      {createOpen && (
        <CreateOrderDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => { setCreateOpen(false); setSelectedOrderId(id); }}
        />
      )}

      {selectedOrderId && (
        <OrderDetailDrawer
          orderId={selectedOrderId}
          onClose={() => setSelectedOrderId(null)}
        />
      )}
    </div>
  );
}

function formatMoney(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + " mln";
  if (n >= 1_000) return (n / 1_000).toFixed(0) + " ming";
  return n.toFixed(0);
}
