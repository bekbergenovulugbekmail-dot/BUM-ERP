import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useInfiniteQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import Papa from "papaparse";
import { motion } from "motion/react";
import {
  Plus, Search, Download, Upload, MoreHorizontal,
  Package, Edit, Trash2, Eye, Tag, CheckCircle, XCircle, Grid3X3, List,
  ScanBarcode,
} from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select.tsx";
import { cn } from "@/lib/utils.ts";
import { api, errorMessage, type ApiError } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { usePermissions } from "@/hooks/use-company.ts";
import { useDebounce } from "@/hooks/use-debounce.ts";
import ProductFormDialog from "./_components/product-form-dialog.tsx";
import ProductDetailDrawer from "./_components/product-detail-drawer.tsx";
import { ProductImage } from "./_lib/product-image.tsx";
import {
  formatQty,
  type Category, type ImportResult, type ProductListItem, type ProductListResponse,
} from "./_lib/types.ts";
import LabelPrintDialog from "@/components/label-print-dialog.tsx";
import { toLabelProduct, type LabelItem } from "@/lib/print/label-html.ts";
import { formatMoney, useCurrencies } from "@/hooks/use-currencies.ts";
import BarcodeScanner from "@/components/barcode-scanner.tsx";

type ViewMode = "table" | "grid";

const PAGE_SIZE = 20;
/** API bitta so'rovda ko'pi bilan 1000 qator qabul qiladi. */
const IMPORT_BATCH = 1000;

type ImportRow = {
  name?: string;
  sku?: string;
  barcode?: string;
  unit?: string;
  purchasePrice?: string;
  salesPrice?: string;
  minStock?: string;
  category?: string;
  brand?: string;
};

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function ProductsPage() {
  const { t } = useTranslation("common");
  const { can } = usePermissions();
  const currencies = useCurrencies();
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [labelItems, setLabelItems] = useState<LabelItem[] | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const categories = useApiQuery<{ categories: Category[] }>("/api/catalog/categories").data?.categories;
  const removeProduct = useApiMutation((id: string) => api.delete(`/api/catalog/products/${id}`));
  const importProducts = useApiMutation((rows: ImportRow[]) =>
    api.post<ImportResult>("/api/catalog/products/import", { rows }),
  );

  const filters = {
    search: debouncedSearch.trim() || undefined,
    categoryId: categoryFilter !== "all" ? categoryFilter : undefined,
    isActive: statusFilter === "active" ? true : statusFilter === "inactive" ? false : undefined,
  };

  // Kursorli sahifalash; kalit prefiksi `/api/catalog/products` — mutatsiyalardan keyin yangilanadi
  const productsQuery = useInfiniteQuery<ProductListResponse, ApiError>({
    queryKey: ["/api/catalog/products", { ...filters, pageSize: PAGE_SIZE, paged: true }],
    queryFn: ({ pageParam, signal }) =>
      api.get<ProductListResponse>(
        "/api/catalog/products",
        { ...filters, limit: PAGE_SIZE, cursor: pageParam as string | undefined },
        signal,
      ),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const results = productsQuery.data?.pages.flatMap((page) => page.products) ?? [];

  // ── CSV export: server joriy filtrga mos barcha mahsulotlarni beradi ──
  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await api.blob("/api/catalog/products/export", filters);
      downloadBlob(blob, `mahsulotlar-${new Date().toISOString().slice(0, 10)}.csv`);
      toast.success("Mahsulotlar eksport qilindi");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  // ── CSV import: fayl brauzerda o'qiladi, tekshiruv va yozish serverda ──
  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // bir xil faylni qayta tanlash mumkin bo'lsin
    if (!file) return;

    setImporting(true);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (parsed) => {
        void (async () => {
          const pick = (row: Record<string, string>, ...keys: string[]) => {
            for (const key of keys) {
              const value = row[key]?.toString().trim();
              if (value) return value;
            }
            return undefined;
          };
          const rows: ImportRow[] = parsed.data.map((row) => ({
            name: pick(row, "Nomi", "name"),
            sku: pick(row, "SKU", "sku"),
            barcode: pick(row, "Shtrix-kod", "barcode"),
            // Eksport `shortName` yozadi ("d"); to'liq nom ("Dona") ham qabul qilinadi
            unit: pick(row, "O'lchov birligi", "unit"),
            purchasePrice: pick(row, "Kirim narxi", "purchasePrice"),
            salesPrice: pick(row, "Sotuv narxi", "salesPrice"),
            minStock: pick(row, "Min. qoldiq", "minStock"),
            category: pick(row, "Kategoriya", "category"),
            brand: pick(row, "Brend", "brand"),
          }));

          if (rows.length === 0) {
            setImporting(false);
            toast.error("Faylda qator topilmadi");
            return;
          }

          let created = 0;
          const errors: string[] = [];
          try {
            for (let offset = 0; offset < rows.length; offset += IMPORT_BATCH) {
              const result = await importProducts.mutateAsync(rows.slice(offset, offset + IMPORT_BATCH));
              created += result.created;
              for (const error of result.errors) {
                // Faylda: sarlavha 1-qator, ma'lumot 2-qatordan
                const line = offset + error.row + 1;
                errors.push(`${line}-qator${error.sku ? ` (${error.sku})` : ""}: ${error.message}`);
              }
            }
          } catch (err) {
            errors.push(errorMessage(err));
          }

          setImporting(false);
          if (created > 0) toast.success(`${created} ta mahsulot import qilindi`);
          if (errors.length > 0) {
            toast.error(`${errors.length} ta qator o'tmadi`, {
              description: errors.slice(0, 3).join("; "),
              duration: 8000,
            });
          }
        })();
      },
      error: () => {
        setImporting(false);
        toast.error("CSV faylni o'qib bo'lmadi");
      },
    });
  };

  const handleDelete = async (id: string) => {
    try {
      await removeProduct.mutateAsync(id);
      toast.success(t("msg.delete_success"));
    } catch (err) {
      toast.error(errorMessage(err, t("msg.error")));
    }
  };

  const perms = {
    create: can("products.create"),
    edit: can("products.edit"),
    delete: can("products.delete"),
  };

  const openCreate = () => { setEditId(null); setFormOpen(true); };
  const openEdit = (id: string) => { setEditId(id); setFormOpen(true); };
  const openLabels = (p: ProductListItem) =>
    setLabelItems([{ product: toLabelProduct(p, currencies.toBase), quantity: 1 }]);

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
            <Button size="sm" variant="secondary" onClick={() => setLabelItems([])}>
              <Tag className="h-4 w-4 mr-1" /> Etiketka
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setScannerOpen(true)}>
              <ScanBarcode className="h-4 w-4 mr-1" /> Skaner
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleImportFile}
            />
            {perms.create && (
              <Button
                size="sm"
                variant="secondary"
                disabled={importing}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4 mr-1" /> {importing ? "Import..." : "Import"}
              </Button>
            )}
            <Button size="sm" variant="secondary" disabled={exporting} onClick={() => { void handleExport(); }}>
              <Download className="h-4 w-4 mr-1" /> {exporting ? "Export..." : "Export"}
            </Button>
            {perms.create && (
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4 mr-1" /> Mahsulot qo'shish
              </Button>
            )}
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
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
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
        {productsQuery.isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : productsQuery.isError ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <h3 className="font-semibold">Mahsulotlarni yuklab bo'lmadi</h3>
            <p className="text-sm text-muted-foreground mt-1">{errorMessage(productsQuery.error)}</p>
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
            {perms.create && (
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4 mr-1" /> Mahsulot qo'shish
              </Button>
            )}
          </div>
        ) : viewMode === "table" ? (
          <ProductTable
            products={results}
            perms={perms}
            onView={(id) => setDetailId(id)}
            onEdit={openEdit}
            onDelete={handleDelete}
            onLabel={openLabels}
          />
        ) : (
          <ProductGrid
            products={results}
            perms={perms}
            onView={(id) => setDetailId(id)}
            onEdit={openEdit}
            onDelete={handleDelete}
            onLabel={openLabels}
          />
        )}

        {productsQuery.hasNextPage && (
          <div className="flex justify-center mt-6">
            <Button
              variant="secondary"
              size="sm"
              disabled={productsQuery.isFetchingNextPage}
              onClick={() => { void productsQuery.fetchNextPage(); }}
            >
              {productsQuery.isFetchingNextPage ? "Yuklanmoqda..." : "Ko'proq yuklash"}
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
          canEdit={perms.edit}
          onClose={() => setDetailId(null)}
          onEdit={(id) => { setDetailId(null); openEdit(id); }}
        />
      )}

      {/* Etiketka chop etish */}
      {labelItems && (
        <LabelPrintDialog initialItems={labelItems} onClose={() => setLabelItems(null)} />
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

type Perms = { create: boolean; edit: boolean; delete: boolean };

type ProductActionsProps = {
  product: ProductListItem;
  perms: Perms;
  onView: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onLabel: (p: ProductListItem) => void;
};

function ProductActions({ product, perms, onView, onEdit, onDelete, onLabel }: ProductActionsProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onView(product.id)} className="cursor-pointer">
          <Eye className="mr-2 h-4 w-4" /> Ko'rish
        </DropdownMenuItem>
        {perms.edit && (
          <DropdownMenuItem onClick={() => onEdit(product.id)} className="cursor-pointer">
            <Edit className="mr-2 h-4 w-4" /> Tahrirlash
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => onLabel(product)} className="cursor-pointer">
          <Tag className="mr-2 h-4 w-4" /> Etiketka chop etish
        </DropdownMenuItem>
        {perms.delete && product.isActive && (
          <>
            <DropdownMenuSeparator />
            {/* Server o'chirmaydi — faolsizlantiradi (tarix saqlanadi) */}
            <DropdownMenuItem
              onClick={() => onDelete(product.id)}
              className="cursor-pointer text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" /> O'chirish
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type ListProps = {
  products: ProductListItem[];
  perms: Perms;
  onView: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onLabel: (p: ProductListItem) => void;
};

function ProductTable({ products, perms, onView, onEdit, onDelete, onLabel }: ListProps) {
  const { base } = useCurrencies();
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
              key={p.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: Math.min(i, 20) * 0.02 }}
              className="hover:bg-muted/30 cursor-pointer"
              onClick={() => onView(p.id)}
            >
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <ProductImage
                    productId={p.id}
                    imageKey={p.imageKey}
                    alt={p.name}
                    className="h-9 w-9 rounded-md border border-border shrink-0"
                    fallback={
                      <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                        <Package className="h-4 w-4 text-primary" />
                      </div>
                    }
                  />
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
                <span className="text-xs font-medium">{formatMoney(p.purchasePrice, p.purchaseCurrency ?? base)}</span>
              </td>
              <td className="px-4 py-3 text-right">
                <span className="text-sm font-bold text-primary">{formatMoney(p.salesPrice, p.salesCurrency ?? base)}</span>
              </td>
              <td className="px-4 py-3 text-center hidden lg:table-cell">
                <span className="text-xs">{formatQty(p.minStock)} {p.baseUnitName}</span>
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
                <ProductActions product={p} perms={perms} onView={onView} onEdit={onEdit} onDelete={onDelete} onLabel={onLabel} />
              </td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProductGrid({ products, perms, onView, onEdit, onDelete, onLabel }: ListProps) {
  const { base } = useCurrencies();
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-4">
      {products.map((p, i) => (
        <motion.div
          key={p.id}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: Math.min(i, 20) * 0.03 }}
        >
          <Card
            className="hover:shadow-md transition-shadow cursor-pointer pt-0 overflow-hidden"
            onClick={() => onView(p.id)}
          >
            <div className="bg-muted/50 flex items-center justify-center h-32">
              <ProductImage
                productId={p.id}
                imageKey={p.imageKey}
                alt={p.name}
                className="h-full w-full"
                fallback={<Package className="h-10 w-10 text-muted-foreground/40" />}
              />
            </div>
            <CardContent className="p-3">
              <p className="font-medium text-xs leading-tight line-clamp-2 mb-1">{p.name}</p>
              {p.categoryName && (
                <p className="text-[10px] text-muted-foreground mb-2">{p.categoryName}</p>
              )}
              <p className="text-sm font-bold text-primary">{formatMoney(p.salesPrice, p.salesCurrency ?? base)}</p>
              <div className="flex items-center justify-between mt-2" onClick={(e) => e.stopPropagation()}>
                <span className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                  p.isActive ? "text-green-600 bg-green-50 dark:bg-green-900/30" : "text-muted-foreground bg-muted"
                )}>
                  {p.isActive ? "Faol" : "Nofaol"}
                </span>
                <ProductActions product={p} perms={perms} onView={onView} onEdit={onEdit} onDelete={onDelete} onLabel={onLabel} />
              </div>
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}
