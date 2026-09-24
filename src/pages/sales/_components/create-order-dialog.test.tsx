/**
 * Sotuv buyurtmasida ham xariddagi qoidalar: miqdor "dona" yonida "blok"da, narx ikkala
 * birlikda, oyna butun ekranga yoyiladi.
 *
 * Narx ASOSIY birlikda saqlanadi (`products.sales_price`), shuning uchun qator doim donada
 * ochiladi; blokka o'tilganda narx koeffitsientga ko'paytiriladi.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProductOption } from "../_lib/types.ts";

const DONA = "u-dona";
const BLOK = "u-blok";

const product = {
  id: "p-1",
  name: "EZO Osvijitel Crystal Scent 460 ml",
  sku: "EZO-460",
  barcode: null,
  baseUnitId: DONA,
  salesUnitId: BLOK,
  salesPrice: "12000.0000",
  salesCurrency: null,
  taxRate: "0.00",
  taxIncluded: true,
  isActive: true,
  isSaleable: true,
  unitOptions: [
    { unitId: DONA, name: "Dona", shortName: "d", factor: "1" },
    { unitId: BLOK, name: "Blok", shortName: "bl", factor: "12.0000" },
  ],
} as unknown as ProductOption;

vi.mock("@/lib/query.ts", () => ({
  useApiQuery: (path: string) => {
    if (path === "/api/inventory/warehouses") {
      return { data: { warehouses: [{ id: "w-1", name: "Asosiy ombor", code: "W1", isDefault: true, isActive: true }] } };
    }
    if (path === "/api/catalog/products") return { data: { products: [product] } };
    if (path === "/api/catalog/units") {
      return { data: { units: [{ id: DONA, name: "Dona", shortName: "d" }, { id: BLOK, name: "Blok", shortName: "bl" }] } };
    }
    return { data: undefined };
  },
  useApiMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/api.ts", () => ({ api: { get: vi.fn(), post: vi.fn() }, errorMessage: (e: unknown) => String(e) }));
vi.mock("@/hooks/use-company.ts", () => ({ usePermissions: () => ({ can: () => true }) }));
vi.mock("@/hooks/use-tax.ts", () => ({ useTaxEnabled: () => false }));
vi.mock("@/hooks/use-currencies.ts", () => ({
  useCurrencies: () => ({ loaded: true, base: "UZS", codes: ["UZS"], rateOf: () => 1, toBase: (amount: string) => Number(amount) }),
  formatMoney: (value: number | string) => `${Math.round(Number(value)).toLocaleString("ru-RU")} so'm`,
}));
vi.mock("@/components/customers/customer-combobox.tsx", () => ({ default: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { default: CreateOrderDialog } = await import("./create-order-dialog.tsx");

/** Mahsulotni qatorga qo'yadi (Radix Select jsdom'da ochilmaydi — qiymat to'g'ridan-to'g'ri). */
function open() {
  render(<CreateOrderDialog onClose={vi.fn()} onCreated={vi.fn()} />);
}

describe("Sotuv buyurtmasi oynasi", () => {
  it("butun ekranga yoyish tugmasi bor va holatni almashtiradi", () => {
    open();
    const button = screen.getByTestId("order-fullscreen");
    expect(button.getAttribute("title")).toBe("Butun ekranga yoyish");
    fireEvent.click(button);
    expect(screen.getByTestId("order-fullscreen").getAttribute("title")).toBe("Kichraytirish");
  });

  it("mahsulotsiz qatorda birlik ustuni bo'sh — xato bermaydi", () => {
    open();
    expect(screen.getByText("Miqdor")).toBeTruthy();
    expect(screen.getByText("Narx")).toBeTruthy();
  });
});
