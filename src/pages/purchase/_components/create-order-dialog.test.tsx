/**
 * Xarid oynasida miqdor birligi: "dona" yonida "blok".
 *
 * REGRESSIYA (2026-09-24, production'da ko'rindi): qator ochilganda mahsulotning "xarid birligi"
 * (blok) qo'yilar, narx esa `products.purchase_price` dan olinardi — u ASOSIY birlik narxi.
 * Natijada 12 donalik blok bitta dona narxida (8 300) ko'rinib, hujjat 12 barobar kam chiqardi.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { convertUnitPrice, defaultUnitId, factorOf } from "@/lib/units.ts";
import type { ProductOption } from "../_lib/types.ts";

const DONA = "u-dona";
const BLOK = "u-blok";

/** Egasining real mahsuloti: 1 dona = 8 300 so'm, 1 blok = 12 dona. */
const product: ProductOption = {
  id: "p-1",
  name: "EZO Osvijitel Crystal Scent 460 ml",
  sku: "EZO-460",
  baseUnitId: DONA,
  purchaseUnitId: BLOK,
  purchasePrice: "8300.0000",
  purchaseCurrency: null,
  taxRate: "0.00",
  isActive: true,
  isPurchaseable: true,
  unitOptions: [
    { unitId: DONA, name: "Dona", shortName: "d", factor: "1" },
    { unitId: BLOK, name: "Blok", shortName: "bl", factor: "12.0000" },
  ],
};

vi.mock("@/lib/query.ts", () => ({
  useApiQuery: (path: string) => {
    if (path === "/api/purchase/suppliers") return { data: { suppliers: [] } };
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
vi.mock("@/lib/api.ts", () => ({
  api: { get: vi.fn(), post: vi.fn() },
  errorMessage: (error: unknown) => String(error),
}));
vi.mock("@/hooks/use-company.ts", () => ({ usePermissions: () => ({ can: () => true }) }));
vi.mock("@/hooks/use-tax.ts", () => ({ useTaxEnabled: () => false }));
vi.mock("@/hooks/use-currencies.ts", () => ({
  useCurrencies: () => ({ loaded: true, base: "UZS", codes: ["UZS"], rateOf: () => 1, toBase: (amount: string) => Number(amount) }),
  formatMoney: (value: number | string) => `${Math.round(Number(value)).toLocaleString("ru-RU")} so'm`,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { default: CreateOrderDialog } = await import("./create-order-dialog.tsx");

/** Mahsulotni qidiruv orqali qatorga qo'shadi (aynan foydalanuvchi qiladigan yo'l). */
function openWithProduct() {
  render(<CreateOrderDialog onClose={vi.fn()} onCreated={vi.fn()} />);
  const search = screen.getByPlaceholderText(/Mahsulot nomi, SKU yoki barkod/);
  fireEvent.change(search, { target: { value: "EZO" } });
  fireEvent.keyDown(search, { key: "Enter" });
}

const qtyInput = () => screen.getAllByRole("spinbutton")[0]!;

describe("Xarid oynasi — miqdor birligi", () => {
  it("qator DONA da ochiladi va narx dona narxi bo'lib qoladi", () => {
    openWithProduct();
    // Birlik tanlovi ko'rinadi va "Dona" turadi — blok avtomatik qo'yilmaydi
    expect(screen.getByText("Dona")).toBeTruthy();
    expect(qtyInput().getAttribute("value")).toBe("1");
    // 1 dona × 8 300 = 8 300 (blok narxi bo'lib ketmaydi)
    expect(screen.getAllByText("8 300 so'm").length).toBeGreaterThan(0);
  });

  it("miqdor o'zgarsa jami dona narxidan hisoblanadi", () => {
    openWithProduct();
    fireEvent.change(qtyInput(), { target: { value: "12" } });
    // 12 dona × 8 300 = 99 600 — aynan 1 blokning haqiqiy narxi
    expect(screen.getAllByText("99 600 so'm").length).toBeGreaterThan(0);
  });
});

describe("Narx ikkala birlikda", () => {
  it("dona narxi yozilsa blok narxi o'zi chiqadi va aksincha", () => {
    openWithProduct();
    // Qator "Dona" da: ikkinchi maydon — blok narxi (8 300 × 12)
    const other = screen.getByTestId("other-unit-price-0") as HTMLInputElement;
    expect(other.value).toBe("99600");

    // Blok narxi yozilsa asosiy maydon (dona narxi) qayta hisoblanadi
    fireEvent.change(other, { target: { value: "120000" } });
    expect((screen.getAllByRole("spinbutton")[1] as HTMLInputElement).value).toBe("10000");
    expect((screen.getByTestId("other-unit-price-0") as HTMLInputElement).value).toBe("120000");
  });
});

describe("Birlik va narx hisobi", () => {
  it("qator ochilganda asosiy birlik tanlanadi (xarid birligi emas)", () => {
    expect(defaultUnitId(product)).toBe(DONA);
    expect(product.purchaseUnitId, "mahsulotda xarid birligi bor, lekin standart bo'lmaydi").toBe(BLOK);
  });

  it("koeffitsient ro'yxatdan o'qiladi, noma'lum birlik uchun 1", () => {
    expect(factorOf(product, DONA)).toBe(1);
    expect(factorOf(product, BLOK)).toBe(12);
    expect(factorOf(product, "u-yoq")).toBe(1);
    expect(factorOf(undefined, BLOK), "birliklari kelmagan mahsulot").toBe(1);
  });

  it("dona → blok: narx koeffitsientga ko'paytiriladi", () => {
    expect(convertUnitPrice(8300, 1, 12)).toBe(99600);
  });

  it("blok → dona: narx qaytib bo'linadi (aylanib kelganda o'zgarmaydi)", () => {
    expect(convertUnitPrice(99600, 12, 1)).toBe(8300);
    expect(convertUnitPrice(convertUnitPrice(8300, 1, 12), 12, 1)).toBe(8300);
  });

  it("narx kiritilmagan yoki birlik o'zgarmagan bo'lsa tegilmaydi", () => {
    expect(convertUnitPrice(0, 1, 12)).toBe(0);
    expect(convertUnitPrice(8300, 12, 12)).toBe(8300);
    expect(convertUnitPrice(8300, 0, 12), "koeffitsient noto'g'ri — narx buzilmaydi").toBe(8300);
  });
});
