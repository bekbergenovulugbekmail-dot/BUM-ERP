import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { motion, AnimatePresence } from "motion/react";
import {
  X, Edit, Package, Tag, Boxes, AlertTriangle, CheckCircle,
  ScanBarcode, Calendar, DollarSign, TrendingUp, Hash,
} from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { cn } from "@/lib/utils.ts";
import type { Id } from "@/convex/_generated/dataModel.d.ts";

type Props = {
  productId: Id<"products">;
  onClose: () => void;
  onEdit: (id: Id<"products">) => void;
};

function InfoRow({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between py-2 border-b border-border/50 last:border-0", className)}>
      <span className="text-xs text-muted-foreground shrink-0 mr-4">{label}</span>
      <span className="text-xs font-medium text-right">{value}</span>
    </div>
  );
}

export default function ProductDetailDrawer({ productId, onClose, onEdit }: Props) {
  const product = useQuery(api.products.products.getById, { id: productId });

  const formatPrice = (n: number) => new Intl.NumberFormat("uz-UZ").format(n) + " so'm";

  const margin = product
    ? (((product.salesPrice - product.purchasePrice) / product.salesPrice) * 100).toFixed(1)
    : "0";

  const daysUntilExpiry = (date: string) => {
    const diff = Math.ceil((new Date(date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return diff;
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex justify-end">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.4 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black"
          onClick={onClose}
        />
        <motion.div
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="relative w-full max-w-md bg-card border-l border-border flex flex-col h-full overflow-hidden z-10"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
            <h2 className="font-semibold text-sm">Mahsulot tafsilotlari</h2>
            <div className="flex items-center gap-2">
              {product && (
                <Button size="sm" onClick={() => onEdit(productId)}>
                  <Edit className="h-3.5 w-3.5 mr-1" /> Tahrirlash
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {!product ? (
              <div className="p-5 space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-8 bg-muted animate-pulse rounded" />
                ))}
              </div>
            ) : (
              <div>
                {/* Hero */}
                <div className="p-5 flex gap-4">
                  {product.imageUrl ? (
                    <img src={product.imageUrl} alt={product.name} className="h-20 w-20 rounded-xl object-cover border border-border shrink-0" />
                  ) : (
                    <div className="h-20 w-20 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                      <Package className="h-9 w-9 text-primary" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-base leading-tight">{product.name}</h3>
                    {product.brandName && (
                      <p className="text-sm text-muted-foreground">{product.brandName}</p>
                    )}
                    <div className="flex flex-wrap gap-1 mt-2">
                      {product.categoryName && (
                        <Badge variant="secondary" className="text-xs">{product.categoryName}</Badge>
                      )}
                      {product.trackBatch && <Badge variant="secondary" className="text-xs">Partiya</Badge>}
                      {product.trackExpiry && <Badge variant="secondary" className="text-xs">Muddat</Badge>}
                      <Badge className={cn("text-xs", product.isActive ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400" : "bg-muted text-muted-foreground")}>
                        {product.isActive ? "Faol" : "Nofaol"}
                      </Badge>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Identifiers */}
                <div className="px-5 py-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Identifikatorlar</p>
                  <InfoRow label="SKU" value={<span className="font-mono">{product.sku}</span>} />
                  {product.barcode && (
                    <InfoRow label="Barcode" value={
                      <span className="flex items-center gap-1 font-mono">
                        <ScanBarcode className="h-3 w-3" /> {product.barcode}
                      </span>
                    } />
                  )}
                  {product.manufacturer && <InfoRow label="Ishlab chiqaruvchi" value={product.manufacturer} />}
                </div>

                <Separator />

                {/* Pricing */}
                <div className="px-5 py-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Narxlar</p>
                  <InfoRow label="Xarid narxi" value={formatPrice(product.purchasePrice)} />
                  <InfoRow label="Sotuv narxi" value={<span className="font-bold text-primary">{formatPrice(product.salesPrice)}</span>} />
                  {product.wholesalePrice && <InfoRow label="Ulgurji narx" value={formatPrice(product.wholesalePrice)} />}
                  {product.retailPrice && <InfoRow label="Chakana narx" value={formatPrice(product.retailPrice)} />}
                  {product.promoPrice && <InfoRow label="Aksiya narxi" value={<span className="text-destructive">{formatPrice(product.promoPrice)}</span>} />}
                  <InfoRow label="Marja" value={<span className="text-green-600 font-bold">{margin}%</span>} />
                  <InfoRow label="Soliq" value={`${product.taxRate}% ${product.taxIncluded ? "(narxga kiritilgan)" : ""}`} />
                </div>

                <Separator />

                {/* Stock info */}
                <div className="px-5 py-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Zaxira sozlamalari</p>
                  <InfoRow label="Minimal zaxira" value={`${product.minStock} ${product.baseUnitName ?? ""}`} />
                  {product.maxStock && <InfoRow label="Maksimal zaxira" value={`${product.maxStock} ${product.baseUnitName ?? ""}`} />}
                  <InfoRow label="Tannarx usuli" value={product.costingMethod.toUpperCase()} />
                  <InfoRow label="Asosiy o'lchov" value={product.baseUnitName ?? "—"} />
                </div>

                {/* Batches */}
                {product.trackBatch && product.batches.length > 0 && (
                  <>
                    <Separator />
                    <div className="px-5 py-3">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                        Partiyalar ({product.batches.length})
                      </p>
                      <div className="space-y-2">
                        {product.batches.map((b) => {
                          const days = b.expiryDate ? daysUntilExpiry(b.expiryDate) : null;
                          return (
                            <div key={b._id} className="border border-border rounded-lg p-3">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs font-mono font-medium">{b.batchNumber}</span>
                                <span className="text-xs font-bold">{b.quantity} {product.baseUnitName}</span>
                              </div>
                              {b.expiryDate && (
                                <div className={cn(
                                  "flex items-center gap-1 text-[11px]",
                                  days !== null && days <= 30 ? "text-amber-600" : "text-muted-foreground"
                                )}>
                                  {days !== null && days <= 30 && <AlertTriangle className="h-3 w-3" />}
                                  <Calendar className="h-3 w-3" />
                                  Muddat: {b.expiryDate}
                                  {days !== null && ` (${days} kun)`}
                                </div>
                              )}
                              <div className="text-[11px] text-muted-foreground mt-0.5">
                                Narx: {formatPrice(b.costPrice)}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}

                {product.description && (
                  <>
                    <Separator />
                    <div className="px-5 py-3">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Tavsif</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">{product.description}</p>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
