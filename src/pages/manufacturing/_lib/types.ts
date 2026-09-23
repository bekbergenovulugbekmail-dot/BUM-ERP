/**
 * `/api/manufacturing/*` javob turlari (apps/api/src/modules/manufacturing/*.service.ts).
 * Miqdor va summalar — numeric satr.
 */
import { useQuery } from "@tanstack/react-query";
import { api, type ApiError } from "@/lib/api.ts";

/** Tannarx maydonlari (`totalCost`, `unitCost`, `completedCost` ...) `products.view_cost` ruxsatisiz `null` keladi. */
export type Bom = {
  id: string;
  productId: string;
  name: string;
  version: string;
  quantity: string;
  unitId: string;
  isActive: boolean;
  notes: string | null;
  productName: string;
  unitName: string;
  itemCount: number;
};

export type BomItem = {
  id: string;
  bomId: string;
  productId: string;
  quantity: string;
  unitId: string;
  scrapPercent: string;
  notes: string | null;
  componentName: string;
  componentSku: string | null;
  /** Taxminiy narx — mahsulotning xarid narxi (haqiqiy tannarx buyurtma yaratilganda AVCO dan). */
  purchasePrice: string;
  unitName: string;
};

export type BomDetail = Omit<Bom, "itemCount"> & { items: BomItem[] };

export type WorkCenterType = "machine" | "labor" | "subcontract";

export type WorkCenter = {
  id: string;
  name: string;
  code: string;
  type: WorkCenterType;
  costPerHour: string | null;
  isActive: boolean;
};

export type ProductionStatus = "draft" | "confirmed" | "in_progress" | "completed" | "cancelled";

export type ProductionOrder = {
  id: string;
  number: string;
  bomId: string;
  productId: string;
  warehouseId: string;
  plannedQty: string;
  producedQty: string;
  status: ProductionStatus;
  plannedDate: string;
  startedAt: string | null;
  completedAt: string | null;
  totalMaterialCost: string | null;
  totalLaborCost: string | null;
  totalCost: string | null;
  unitCost: string | null;
  notes: string | null;
  productName: string;
  warehouseName: string;
  bomName: string;
};

export type ProductionMaterial = {
  id: string;
  orderId: string;
  productId: string;
  plannedQty: string;
  actualQty: string;
  unitId: string;
  unitCost: string | null;
  totalCost: string | null;
  componentName: string;
  componentSku: string | null;
  unitName: string;
};

export type ProductionTimeLine = {
  id: string;
  orderId: string;
  workCenterId: string;
  plannedHours: string;
  actualHours: string;
  costPerHour: string | null;
  totalCost: string | null;
  workCenterName: string;
};

export type ProductionOrderDetail = ProductionOrder & {
  productSku: string | null;
  materials: ProductionMaterial[];
  timeLines: ProductionTimeLine[];
};

export type ProductionStats = {
  total: number;
  completedCost: string | null;
  completedThisMonth: number;
  byStatus: { status: ProductionStatus; count: number }[];
};

export type ProductOption = {
  id: string;
  name: string;
  sku: string | null;
  baseUnitId: string;
  isManufactured: boolean;
};

export type UnitOption = { id: string; name: string; shortName: string };
export type WarehouseOption = { id: string; name: string };

/** Numeric satr → son (faqat ko'rsatish uchun). */
export const num = (value: string | number | null | undefined): number => Number(value ?? 0) || 0;

const PRODUCT_PAGE = 200;
const MAX_PAGES = 20;

/** Faol mahsulotlar to'liq ro'yxati (API sahifasi ko'pi bilan 200 ta — kursor bilan yig'iladi). */
export function useActiveProducts() {
  return useQuery<ProductOption[], ApiError>({
    queryKey: ["/api/catalog/products", { isActive: true, all: true }],
    queryFn: async ({ signal }) => {
      const all: ProductOption[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const result = await api.get<{ products: ProductOption[]; nextCursor: string | null }>(
          "/api/catalog/products",
          { isActive: true, limit: PRODUCT_PAGE, cursor },
          signal,
        );
        all.push(...result.products);
        if (!result.nextCursor) break;
        cursor = result.nextCursor;
      }
      return all;
    },
  });
}
