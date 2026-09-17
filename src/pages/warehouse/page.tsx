import { useState, useEffect } from "react";
import { motion } from "motion/react";
import {
  Warehouse, PackagePlus, PackageMinus, ArrowLeftRight,
  ClipboardList, TrendingUp, TrendingDown, AlertTriangle,
  BarChart3, Search, SlidersHorizontal, History, ScanLine,
  Boxes,
} from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import { useApiQuery } from "@/lib/query.ts";
import { usePermissions } from "@/hooks/use-company.ts";
import { useDebounce } from "@/hooks/use-debounce.ts";
import WarehouseSelector from "./_components/warehouse-selector.tsx";
import StockTable from "./_components/stock-table.tsx";
import MovementDialog from "./_components/movement-dialog.tsx";
import TransferDialog from "./_components/transfer-dialog.tsx";
import MovementHistory from "./_components/movement-history.tsx";
import InventoryCountSection from "./_components/inventory-count-section.tsx";
import CatalogSection from "./_components/catalog-section.tsx";
import BarcodeScanner from "@/components/barcode-scanner.tsx";
import { toNumber } from "@/pages/products/_lib/types.ts";
import type { WarehouseItem, WarehouseStats } from "./_lib/types.ts";

export default function WarehousePage() {
  const { can } = usePermissions();
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [activeTab, setActiveTab] = useState("stock");
  const [movementDialog, setMovementDialog] = useState<{
    open: boolean;
    type: "receive" | "issue" | "adjust" | "writeoff";
  }>({ open: false, type: "receive" });
  const [transferOpen, setTransferOpen] = useState(false);
  const [warehouseScannerOpen, setWarehouseScannerOpen] = useState(false);

  // Asosiy ombor kompaniya yaratilganda serverda ochiladi (seedDefault kerak emas);
  // ro'yxat a'zoning ruxsat etilgan omborlari bilan cheklangan
  const warehousesQuery = useApiQuery<{ warehouses: WarehouseItem[] }>("/api/inventory/warehouses");
  const warehouses = warehousesQuery.data?.warehouses;

  // Asosiy omborni tanlash (kompaniya almashsa yoki ombor ro'yxatdan chiqsa — qayta); render paytida moslash
  if (warehouses && !(selectedWarehouseId && warehouses.some((w) => w.id === selectedWarehouseId))) {
    const fallback = (warehouses.find((w) => w.isDefault) ?? warehouses[0])?.id ?? null;
    if (fallback !== selectedWarehouseId) setSelectedWarehouseId(fallback);
  }

  const statsQuery = useApiQuery<WarehouseStats>(
    selectedWarehouseId ? "/api/inventory/stock/stats" : null,
    { warehouseId: selectedWarehouseId },
  );
  const stats = statsQuery.data;
  const statsLoading = Boolean(selectedWarehouseId) && statsQuery.isPending;

  const canReceive = can("warehouse.receive");
  const canManage = can("warehouse.manage");
  const canTransfer = can("warehouse.transfer");

  const formatMoney = (n: number) =>
    new Intl.NumberFormat("uz-UZ", { notation: "compact" }).format(n) + " so'm";

  const STAT_CARDS = [
    {
      label: "Jami mahsulot turi",
      value: stats?.totalItems ?? 0,
      icon: <BarChart3 className="h-5 w-5" />,
      color: "text-primary",
    },
    {
      label: "Ombor qiymati",
      value: stats ? formatMoney(toNumber(stats.totalValue)) : "—",
      icon: <TrendingUp className="h-5 w-5" />,
      color: "text-green-600",
    },
    {
      label: "Kam zaxira",
      value: stats?.lowStockCount ?? 0,
      icon: <AlertTriangle className="h-5 w-5" />,
      color: "text-amber-600",
      alert: (stats?.lowStockCount ?? 0) > 0,
    },
    {
      label: "Tugagan mahsulot",
      value: stats?.zeroStockCount ?? 0,
      icon: <TrendingDown className="h-5 w-5" />,
      color: "text-destructive",
      alert: (stats?.zeroStockCount ?? 0) > 0,
    },
  ];

  return (
    <div className="flex flex-col h-full gap-0">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <Warehouse className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Ombor boshqaruvi</h1>
            <p className="text-xs text-muted-foreground">Zaxira, harakatlar va inventarizatsiya</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canTransfer && (warehouses?.length ?? 0) > 1 && (
            <Button variant="secondary" size="sm" disabled={!selectedWarehouseId} onClick={() => setTransferOpen(true)}>
              <ArrowLeftRight className="h-4 w-4 mr-1.5" /> Ko'chirish
            </Button>
          )}
          {canManage && (
            <Button variant="secondary" size="sm" disabled={!selectedWarehouseId} onClick={() => setMovementDialog({ open: true, type: "issue" })}>
              <PackageMinus className="h-4 w-4 mr-1.5" /> Chiqarish
            </Button>
          )}
          {canReceive && (
            <Button size="sm" disabled={!selectedWarehouseId} onClick={() => setMovementDialog({ open: true, type: "receive" })}>
              <PackagePlus className="h-4 w-4 mr-1.5" /> Qabul qilish
            </Button>
          )}
        </div>
      </div>

      {/* Warehouse selector */}
      <div className="px-6 py-3 border-b border-border shrink-0 bg-muted/30">
        {!warehouses ? (
          warehousesQuery.isError ? (
            <p className="text-sm text-destructive">Omborlarni yuklab bo'lmadi</p>
          ) : (
            <Skeleton className="h-9 w-64" />
          )
        ) : (
          <WarehouseSelector
            warehouses={warehouses}
            selectedId={selectedWarehouseId}
            onChange={setSelectedWarehouseId}
          />
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 px-6 py-4 shrink-0">
        {STAT_CARDS.map((card, i) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07 }}
          >
            <Card className={cn("border", card.alert && "border-amber-400/60 dark:border-amber-500/40")}>
              <CardContent className="flex items-center gap-3 py-3 px-4">
                <div className={cn("shrink-0", card.color)}>{card.icon}</div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground truncate">{card.label}</p>
                  {statsLoading ? (
                    <Skeleton className="h-5 w-16 mt-0.5" />
                  ) : (
                    <p className={cn("text-lg font-bold", card.color)}>{card.value}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Main tabs */}
      <div className="flex-1 min-h-0 px-6 pb-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
          <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
            <TabsList>
              <TabsTrigger value="stock">
                <BarChart3 className="h-4 w-4 mr-1.5" /> Zaxira
              </TabsTrigger>
              <TabsTrigger value="movements">
                <History className="h-4 w-4 mr-1.5" /> Harakatlar
              </TabsTrigger>
              <TabsTrigger value="count">
                <ClipboardList className="h-4 w-4 mr-1.5" /> Inventarizatsiya
              </TabsTrigger>
              <TabsTrigger value="catalog">
                <Boxes className="h-4 w-4 mr-1.5" /> Katalog
              </TabsTrigger>
            </TabsList>

            {activeTab === "stock" && (
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Mahsulot qidirish..."
                    className="pl-9 h-9 w-56"
                  />
                </div>
                <Button
                  variant="secondary"
                  size="icon"
                  className="h-9 w-9"
                  title="Barkod skanerlash"
                  onClick={() => setWarehouseScannerOpen(true)}
                >
                  <ScanLine className="h-4 w-4" />
                </Button>
                <Button
                  variant={lowStockOnly ? "default" : "secondary"}
                  size="sm"
                  onClick={() => setLowStockOnly((p) => !p)}
                >
                  <AlertTriangle className="h-4 w-4 mr-1.5" />
                  Kam zaxira
                  {(stats?.lowStockCount ?? 0) > 0 && (
                    <Badge className="ml-1.5 h-4 px-1 text-[10px]">{stats?.lowStockCount}</Badge>
                  )}
                </Button>
                {canManage && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!selectedWarehouseId}
                    onClick={() => setMovementDialog({ open: true, type: "adjust" })}
                  >
                    <SlidersHorizontal className="h-4 w-4 mr-1.5" /> Tuzatish
                  </Button>
                )}
              </div>
            )}
          </div>

          <TabsContent value="stock" className="flex-1 min-h-0 mt-0">
            {selectedWarehouseId ? (
              <StockTable
                warehouseId={selectedWarehouseId}
                search={debouncedSearch.trim()}
                lowStockOnly={lowStockOnly}
                canReceive={canReceive}
                canManage={canManage}
                onReceive={() => setMovementDialog({ open: true, type: "receive" })}
                onIssue={() => setMovementDialog({ open: true, type: "issue" })}
                onAdjust={() => setMovementDialog({ open: true, type: "adjust" })}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                Ombor tanlang
              </div>
            )}
          </TabsContent>

          <TabsContent value="movements" className="flex-1 min-h-0 mt-0">
            {selectedWarehouseId && (
              <MovementHistory warehouseId={selectedWarehouseId} />
            )}
          </TabsContent>

          <TabsContent value="count" className="flex-1 min-h-0 mt-0">
            {selectedWarehouseId && (
              <InventoryCountSection warehouseId={selectedWarehouseId} />
            )}
          </TabsContent>

          {/* Mahsulot, xom ashyo va yarim tayyor — bitta katalogda (ombor uchun ular bir xil) */}
          <TabsContent value="catalog" className="flex-1 min-h-0 mt-0">
            <CatalogSection />
          </TabsContent>
        </Tabs>
      </div>

      {/* Dialogs */}
      {movementDialog.open && selectedWarehouseId && (
        <MovementDialog
          type={movementDialog.type}
          warehouseId={selectedWarehouseId}
          onClose={() => setMovementDialog((p) => ({ ...p, open: false }))}
        />
      )}

      {transferOpen && selectedWarehouseId && (
        <TransferDialog
          fromWarehouseId={selectedWarehouseId}
          warehouses={warehouses ?? []}
          onClose={() => setTransferOpen(false)}
        />
      )}

      {warehouseScannerOpen && (
        <BarcodeScanner
          title="Ombor — Mahsulot skanerlash"
          hint="Barkod yoki QR kodni skanerlang — mahsulot qidiriladi"
          onScan={(code) => {
            setSearch(code);
            setWarehouseScannerOpen(false);
          }}
          onClose={() => setWarehouseScannerOpen(false)}
        />
      )}
    </div>
  );
}
