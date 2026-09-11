/**
 * `/api/catalog` javob turlari (apps/api/src/modules/catalog). Pul va miqdor — numeric satr,
 * sanalar — ISO satr. Hisob-kitob va ko'rsatish uchungina `Number()` ga o'giriladi.
 */

export type Unit = {
  id: string;
  name: string;
  shortName: string;
  isBase: boolean;
  isActive: boolean;
};

export type Category = {
  id: string;
  name: string;
  parentId: string | null;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
};

export type Brand = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
};

export type CostingMethod = "average" | "fifo" | "fefo" | "manual";

export type Product = {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  qrCode: string | null;
  description: string | null;
  /** Saqlashdagi rasm kaliti — ko'rish `GET /api/files/url` orqali. */
  imageKey: string | null;
  categoryId: string | null;
  brandId: string | null;
  manufacturer: string | null;
  baseUnitId: string;
  purchaseUnitId: string | null;
  salesUnitId: string | null;
  purchasePrice: string;
  salesPrice: string;
  wholesalePrice: string | null;
  retailPrice: string | null;
  promoPrice: string | null;
  promoPriceEnd: string | null;
  taxRate: string;
  taxIncluded: boolean;
  minStock: string;
  maxStock: string | null;
  reorderPoint: string | null;
  trackBatch: boolean;
  trackExpiry: boolean;
  shelfLifeDays: number | null;
  costingMethod: CostingMethod;
  isActive: boolean;
  isSaleable: boolean;
  isPurchaseable: boolean;
  isManufactured: boolean;
  weight: string | null;
  weightUnit: string | null;
  createdAt: string;
};

export type ProductListItem = Product & {
  categoryName: string | null;
  brandName: string | null;
  baseUnitName: string;
};

export type ProductListResponse = {
  products: ProductListItem[];
  nextCursor: string | null;
};

export type Batch = {
  id: string;
  productId: string;
  batchNumber: string;
  supplierId: string | null;
  warehouseId: string | null;
  manufacturedDate: string | null;
  expiryDate: string | null;
  quantity: string;
  unitId: string;
  costPrice: string;
  notes: string | null;
  createdAt: string;
};

export type ProductDetail = ProductListItem & {
  purchaseUnitName: string | null;
  salesUnitName: string | null;
  batches: Batch[];
};

export type ImportResult = {
  created: number;
  errors: { row: number; sku: string | null; message: string }[];
};

export function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function formatSom(value: string | number | null | undefined): string {
  return new Intl.NumberFormat("uz-UZ").format(toNumber(value)) + " so'm";
}

/** "12.5000" → "12,5" (ortiqcha nollarsiz). */
export function formatQty(value: string | number | null | undefined): string {
  return new Intl.NumberFormat("uz-UZ", { maximumFractionDigits: 4 }).format(toNumber(value));
}
