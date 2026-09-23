/**
 * `/api/inventory` javob turlari (apps/api/src/modules/inventory). Miqdor va narx — numeric satr,
 * vaqtlar — ISO satr.
 */

export type WarehouseItem = {
  id: string;
  name: string;
  code: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  managerId: string | null;
  branchId: string | null;
  isDefault: boolean;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
};

/** `totalValue` — tannarxdan hisoblanadi: `products.view_cost` ruxsatisiz server `null` yuboradi. */
export type WarehouseStats = {
  totalValue: string | null;
  totalItems: number;
  lowStockCount: number;
  zeroStockCount: number;
};

export type StockRow = {
  id: string;
  productId: string;
  warehouseId: string;
  quantity: string;
  reservedQty: string;
  availableQty: string;
  /** Tannarx: `products.view_cost` ruxsatisiz server `null` yuboradi. */
  avgCostPrice: string | null;
  productName: string;
  productSku: string;
  productBarcode: string | null;
  minStock: string;
  maxStock: string | null;
  unitName: string;
  isLow: boolean;
  isOverstock: boolean;
  updatedAt: string;
};

export type MovementType =
  | "receive" | "issue" | "transfer_out" | "transfer_in" | "adjust"
  | "writeoff" | "return_in" | "return_out" | "count";

export type StockMovement = {
  id: string;
  type: MovementType;
  productId: string;
  warehouseId: string;
  zoneId: string | null;
  batchId: string | null;
  /** Ishorali: kirim musbat, chiqim manfiy. */
  quantity: string;
  unitId: string;
  costPrice: string;
  referenceType: string | null;
  referenceId: string | null;
  notes: string | null;
  performedBy: string | null;
  occurredAt: string;
  createdAt: string;
  productName: string;
  productSku: string;
  warehouseName: string;
  unitName: string;
};

export type MovementsResponse = { movements: StockMovement[]; nextCursor: string | null };

export type CountStatus = "draft" | "in_progress" | "completed" | "cancelled";

export type InventoryCount = {
  id: string;
  warehouseId: string;
  name: string;
  status: CountStatus;
  countedBy: string | null;
  startedAt: string | null;
  completedAt: string | null;
  adjustmentsMade: boolean;
  notes: string | null;
  createdAt: string;
};

export type InventoryCountListItem = InventoryCount & {
  warehouseName: string;
  itemCount: number;
  countedItems: number;
};

export type InventoryCountItem = {
  id: string;
  countId: string;
  productId: string;
  expectedQty: string;
  countedQty: string | null;
  difference: string | null;
  notes: string | null;
  productName: string;
  productSku: string;
  unitName: string;
};

export type InventoryCountDetail = InventoryCount & {
  warehouseName: string | null;
  /**
   * Jarayon ko'rsatkichlari SERVERDA sanaladi — `items` qidiruv/chegara bilan kelgani uchun
   * ularni ekrandagi qatorlardan hisoblab bo'lmaydi.
   */
  itemCount: number;
  countedItems: number;
  surplusItems: number;
  shortageItems: number;
  /** Ko'rsatish uchun qatorlar: qidiruvga mos va chegaralangan qism. */
  items: InventoryCountItem[];
};
