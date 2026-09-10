import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { toast } from "sonner";
import { motion } from "motion/react";
import {
  Plus, Search, Filter, Download, Upload, MoreHorizontal,
  Package, Edit, Trash2, Eye, Tag, BarChart2, AlertTriangle,
  ChevronDown, CheckCircle, XCircle, Grid3X3, List,
  ScanBarcode, Boxes,
} from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select.tsx";
import { cn } from "@/lib/utils.ts";
import { useDebounce } from "@/hooks/use-debounce.ts";
import ProductFormDialog from "./_components/product-form-dialog.tsx";
import ProductDetailDrawer from "./_components/product-detail-drawer.tsx";
import BarcodeLabelPrint from "@/components/barcode-label-print.tsx";
import BarcodeScanner from "@/components/barcode-scanner.tsx";
import type { Id } from "@/convex/_generated/dataModel.d.ts";

type ViewMode = "table" | "grid";

export default function ProductsPage() {
  const { t } = useTranslation("common");
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<Id<"products"> | null>(null);
  const [detailId, setDetailId] = useState<Id<"products"> | null>(null);
  const [labelProduct, setLabelProduct] = useState<{ _id: string; name: string; sku: string; barcode?: string; salesPrice: number } | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);

  const categories = useQuery(api.products.categories.list, {});
  const seedUnits = useMutation(api.products.units.seedDefaultUnits);
  const removeProduct = useMutation(api.products.products.remove);

  // Seed units once on first authenticated mount
  const unitSeededRef = useRef(false);
  useEffect(() => {
    if (unitSeededRef.current) return;
    unitSeededRef.current = true;
    void seedUnits({}).catch(() => {/* already seeded */});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { results, status, loadMore } = usePaginatedQuery(
    api.products.products.list,
    {
      search: debouncedSearch || undefined,
      categoryId: (categoryFilter !== "all" ? categoryFilter : undefined) as Id<"categories"> | undefined,
      isActive: statusFilter === "active" ? true : statusFilter === "inactive" ? false : undefined,
    },
    { initialNumItems: 20 }
  );

  const handleDelete = async (id: Id<"products">) => {
    try {
      await removeProduct({ id });
      toast.success(t("msg.delete_success"));
    } catch {
      toast.error(t("msg.error"));
    }
  };

  const formatPrice = (n: number) =>
    new Intl.NumberFormat("uz-UZ").format(n) + " so'm";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border px-6 py-4 bg-card">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              {t("nav.products")}
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Mahsulotlar katalogi, narxlar va partiyalar
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setScannerOpen(true)}>
              <ScanBarcode className="h-4 w-4 mr-1" /> Skaner
            </Button>
            <Button size="sm" variant="secondary">
              <Upload className="h-4 w-4 mr-1" /> Import
            </Button>
            <Button size="sm" variant="secondary">
              <Download className="h-4 w-4 mr-1" /> Export
            </Button>
            <Button size="sm" onClick={() => { setEditId(null); setFormOpen(true); }}>
              <Plus className="h-4 w-4 mr-1" /> Mahsulot qo'shish
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mt-4 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Nomi, SKU, barcode..."
              className="pl-8 h-8 text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="h-8 w-40 text-sm">
              <SelectValue placeholder="Kategoriya" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Barcha kategoriya</SelectItem>
              {categories?.map((c) => (
                <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-32 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Faol</SelectItem>
              <SelectItem value="inactive">Nofaol</SelectItem>
              <SelectItem value="all">Hammasi</SelectItem>
            </SelectContent>
          </Select>

          <div className="ml-auto flex items-center gap-1 border rounded-md p-0.5">
            <button
              onClick={() => setViewMode("table")}
              className={cn("p-1.5 rounded cursor-pointer transition-colors", viewMode === "table" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              <List className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setViewMode("grid")}
              className={cn("p-1.5 rounded cursor-pointer transition-colors", viewMode === "grid" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              <Grid3X3 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {status === "LoadingFirstPage" ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
              <Package className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="font-semibold">Mahsulot topilmadi</h3>
            <p className="text-sm text-muted-foreground mt-1 mb-4">
              Filtrni o'zgartiring yoki yangi mahsulot qo'shing
            </p>
            <Button size="sm" onClick={() => { setEditId(null); setFormOpen(true); }}>
              <Plus className="h-4 w-4 mr-1" /> Mahsulot qo'shish
            </Button>
          </div>
        ) : viewMode === "table" ? (
          <ProductTable
            products={results}
            onView={(id) => setDetailId(id)}
            onEdit={(id) => { setEditId(id); setFormOpen(true); }}
            onDelete={handleDelete}
            onLabel={(p) => setLabelProduct(p)}
            formatPrice={formatPrice}
          />
        ) : (
          <ProductGrid
            products={results}
            onView={(id) => setDetailId(id)}
            onEdit={(id) => { setEditId(id); setFormOpen(true); }}
            onDelete={handleDelete}
            onLabel={(p) => setLabelProduct(p)}
            formatPrice={formatPrice}
          />
        )}

        {status === "CanLoadMore" && (
          <div className="flex justify-center mt-6">
            <Button variant="secondary" size="sm" onClick={() => loadMore(20)}>
              Ko'proq yuklash
            </Button>
          </div>
        )}
      </div>

      {/* Form Dialog */}
      <ProductFormDialog
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditId(null); }}
        editId={editId}
      />

      {/* Detail Drawer */}
      {detailId && (
        <ProductDetailDrawer
          productId={detailId}
          onClose={() => setDetailId(null)}
          onEdit={(id) => { setDetailId(null); setEditId(id); setFormOpen(true); }}
        />
      )}

      {/* Barcode Label Print */}
      {labelProduct && (
        <BarcodeLabelPrint
          product={labelProduct}
          onClose={() => setLabelProduct(null)}
        />
      )}

      {/* Barcode Scanner — scan to search/filter */}
      {scannerOpen && (
        <BarcodeScanner
          title="Mahsulot skanerlash"
          hint="Barkod yoki QR kodni skanerlang — mahsulot qidiriladi"
          onScan={(code) => {
            setSearch(code);
            setScannerOpen(false);
          }}
          onClose={() => setScannerOpen(false)}
        />
      )}
    </div>
  );
}

type Product = {
  _id: Id<"products">;
  name: string;
  sku: string;
  barcode?: string;
  salesPrice: number;
  purchasePrice: number;
  minStock: number;
  isActive: boolean;
  trackBatch: boolean;
  trackExpiry: boolean;
  imageUrl?: string;
  categoryName?: string;
  brandName?: string;
  baseUnitName?: string;
  costingMethod: string;
};

type LabelProduct = { _id: string; name: string; sku: string; barcode?: string; salesPrice: number };

type ProductActionsProps = {
  product: Product;
  onView: (id: Id<"products">) => void;
  onEdit: (id: Id<"products">) => void;
  onDelete: (id: Id<"products">) => void;
  onLabel: (p: LabelProduct) => void;
};

function ProductActions({ product, onView, onEdit, onDelete, onLabel }: ProductActionsProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onView(product._id)} className="cursor-pointer">
          <Eye className="mr-2 h-4 w-4" /> Ko'rish
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onEdit(product._id)} className="cursor-pointer">
          <Edit className="mr-2 h-4 w-4" /> Tahrirlash
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onLabel(product)} className="cursor-pointer">
          <Tag className="mr-2 h-4 w-4" /> Yorliq chop etish
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => onDelete(product._id)}
          className="cursor-pointer text-destructive focus:text-destructive"
        >
          <Trash2 className="mr-2 h-4 w-4" /> O'chirish
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProductTable({ products, onView, onEdit, onDelete, onLabel, formatPrice }: {
  products: Product[];
  onView: (id: Id<"products">) => void;
  onEdit: (id: Id<"products">) => void;
  onDelete: (id: Id<"products">) => void;
  onLabel: (p: LabelProduct) => void;
  formatPrice: (n: number) => string;
}) {
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 border-b border-border">
          <tr>
            <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Mahsulot</th>
            <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs hidden md:table-cell">SKU / Barcode</th>
            <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs hidden lg:table-cell">Kategoriya</th>
            <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs">Xarid narxi</th>
            <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs">Sotuv narxi</th>
            <th className="text-center px-4 py-3 font-medium text-muted-foreground text-xs hidden lg:table-cell">Min. zaxira</th>
            <th className="text-center px-4 py-3 font-medium text-muted-foreground text-xs">Holat</th>
            <th className="px-4 py-3 w-10" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {products.map((p, i) => (
            <motion.tr
              key={p._id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.02 }}
              className="hover:bg-muted/30 cursor-pointer"
              onClick={() => onView(p._id)}
            >
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt={p.name} className="h-9 w-9 rounded-md object-cover border border-border shrink-0" />
                  ) : (
                    <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                      <Package className="h-4 w-4 text-primary" />
                    </div>
                  )}
                  <div>
                    <p className="font-medium text-sm leading-tight">{p.name}</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      {p.brandName && <span className="text-[11px] text-muted-foreground">{p.brandName}</span>}
                      {p.trackBatch && <Badge variant="secondary" className="text-[10px] py-0 h-4 px-1">Partiya</Badge>}
                      {p.trackExpiry && <Badge variant="secondary" className="text-[10px] py-0 h-4 px-1">Muddat</Badge>}
                    </div>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3 hidden md:table-cell">
                <p className="text-xs font-mono">{p.sku}</p>
                {p.barcode && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <ScanBarcode className="h-3 w-3 text-muted-foreground" />
                    <span className="text-[11px] text-muted-foreground font-mono">{p.barcode}</span>
                  </div>
                )}
              </td>
              <td className="px-4 py-3 hidden lg:table-cell">
                {p.categoryName ? (
                  <Badge variant="secondary" className="text-xs">{p.categoryName}</Badge>
                ) : (
                  <span className="text-muted-foreground text-xs">—</span>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                <span className="text-xs font-medium">{formatPrice(p.purchasePrice)}</span>
              </td>
              <td className="px-4 py-3 text-right">
                <span className="text-sm font-bold text-primary">{formatPrice(p.salesPrice)}</span>
              </td>
              <td className="px-4 py-3 text-center hidden lg:table-cell">
                <span className="text-xs">{p.minStock} {p.baseUnitName}</span>
              </td>
              <td className="px-4 py-3 text-center">
                {p.isActive ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-green-600 bg-green-50 dark:bg-green-900/30 px-2 py-0.5 rounded-full font-medium">
                    <CheckCircle className="h-3 w-3" /> Faol
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full font-medium">
                    <XCircle className="h-3 w-3" /> Nofaol
                  </span>
                )}
              </td>
              <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                <ProductActions product={p} onView={onView} onEdit={onEdit} onDelete={onDelete} onLabel={onLabel} />
              </td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProductGrid({ products, onView, onEdit, onDelete, onLabel, formatPrice }: {
  products: Product[];
  onView: (id: Id<"products">) => void;
  onEdit: (id: Id<"products">) => void;
  onDelete: (id: Id<"products">) => void;
  onLabel: (p: LabelProduct) => void;
  formatPrice: (n: number) => string;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-4">
      {products.map((p, i) => (
        <motion.div
          key={p._id}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: i * 0.03 }}
        >
          <Card
            className="hover:shadow-md transition-shadow cursor-pointer pt-0 overflow-hidden"
            onClick={() => onView(p._id)}
          >
            <div className="bg-muted/50 flex items-center justify-center h-32">
              {p.imageUrl ? (
                <img src={p.imageUrl} alt={p.name} className="h-full w-full object-cover" />
              ) : (
                <Package className="h-10 w-10 text-muted-foreground/40" />
              )}
            </div>
            <CardContent className="p-3">
              <p className="font-medium text-xs leading-tight line-clamp-2 mb-1">{p.name}</p>
              {p.categoryName && (
                <p className="text-[10px] text-muted-foreground mb-2">{p.categoryName}</p>
              )}
              <p className="text-sm font-bold text-primary">{formatPrice(p.salesPrice)}</p>
              <div className="flex items-center justify-between mt-2" onClick={(e) => e.stopPropagation()}>
                <span className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                  p.isActive ? "text-green-600 bg-green-50 dark:bg-green-900/30" : "text-muted-foreground bg-muted"
                )}>
                  {p.isActive ? "Faol" : "Nofaol"}
                </span>
                <ProductActions product={p} onView={onView} onEdit={onEdit} onDelete={onDelete} onLabel={onLabel} />
              </div>
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}
