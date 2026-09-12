import type { PullCursor, PullEntity, PullResponse } from "../src/shared/sync-types.js";
import { PULL_ENTITIES } from "../src/shared/sync-types.js";

export const company = { id: "c0000000-0000-4000-8000-000000000001", name: "Bonnu", currency: "UZS" };
export const deviceInfo = { id: "d0000000-0000-4000-8000-000000000001", name: "Kassa 1", code: "K01", warehouseId: "w1", warehouseName: "Asosiy" };

type Pages = Partial<Record<PullEntity, { rows: Record<string, unknown>[]; cursor?: PullCursor | null; more?: boolean }>>;

export function pullResponse(pages: Pages, previous: Partial<Record<PullEntity, PullCursor>> = {}): PullResponse {
  const entities = {} as PullResponse["entities"];
  for (const entity of PULL_ENTITIES) {
    const page = pages[entity];
    entities[entity] = {
      rows: page?.rows ?? [],
      cursor: page?.cursor === undefined ? (previous[entity] ?? null) : page.cursor,
      more: page?.more ?? false,
    };
  }
  return {
    serverTime: "2026-09-12T10:00:00.000Z",
    company,
    device: deviceInfo,
    entities,
    more: Object.values(entities).some((page) => page.more),
    config: null,
  };
}

export const product = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  sku: name.toUpperCase().replace(/\s+/g, "-"),
  barcode: null,
  categoryId: null,
  baseUnitId: "unit-d",
  salesPrice: "10000.0000",
  salesCurrency: null,
  taxRate: "0.00",
  taxIncluded: false,
  isActive: true,
  isSaleable: true,
  ...extra,
});
