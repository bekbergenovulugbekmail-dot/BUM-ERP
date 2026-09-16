/**
 * Web kassa mahsulot kartasi: rasm/bosh harflar, bosish — savatga, qoldiq tugaganda bloklash,
 * batafsil oyna (o'ng tugma va ⓘ) va miqdor steppery.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProductCard, ProductDetailDialog, type PosCardItem } from "./product-card.tsx";
import { productInitials, stockState } from "../_lib/product-display.ts";
import type { ProductOption } from "@/pages/sales/_lib/types.ts";

// Rasm URL'i `/api/files/url` dan keladi — testda tarmoqqa chiqmaymiz
const imageState = vi.hoisted(() => ({ url: undefined as string | undefined }));
vi.mock("@/pages/products/_lib/product-files.ts", () => ({
  useProductImageUrl: () => imageState.url,
}));

const product: ProductOption = {
  id: "p1",
  name: "Non (tandir)",
  sku: "NON-1",
  barcode: "4780001",
  baseUnitId: "u1",
  salesPrice: "5000",
  salesCurrency: null,
  taxRate: "0",
  taxIncluded: false,
  isActive: true,
  isSaleable: true,
  imageKey: null,
  baseUnitName: "d",
  minStock: "5",
};

const item = (overrides: Partial<PosCardItem> = {}): PosCardItem => ({
  product,
  price: 5000,
  regularPrice: null,
  stock: 12,
  showStock: true,
  inCart: 0,
  currencyNote: null,
  ...overrides,
});

describe("productInitials va stockState", () => {
  it("bosh harflar faqat harf/raqamdan olinadi", () => {
    expect(productInitials("Non (tandir)")).toBe("NT");
    expect(productInitials("Coca-Cola 1.5 l")).toBe("C1");
    expect(productInitials("!!!")).toBe("?");
  });

  it("qoldiq holati: tugagan, kam va bor", () => {
    expect(stockState(0, 5)).toBe("out");
    expect(stockState(-2, 5)).toBe("out");
    expect(stockState(3, 5)).toBe("low");
    expect(stockState(12, 5)).toBe("ok");
    expect(stockState(12, 0)).toBe("ok");
  });
});

describe("ProductCard", () => {
  it("rasm yo'q bo'lsa bosh harflar, nom, SKU, narx va qoldiq ko'rinadi", () => {
    imageState.url = undefined;
    const { container } = render(<ProductCard item={item()} onAdd={vi.fn()} onDetails={vi.fn()} />);

    expect(screen.getByText("NT")).toBeInTheDocument();
    expect(screen.getByText("Non (tandir)")).toBeInTheDocument();
    expect(screen.getByText("NON-1")).toBeInTheDocument();
    expect(screen.getByText("5 000")).toBeInTheDocument();
    expect(screen.getByText(/Bor · 12 d/)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("rasm bo'lsa img ko'rsatiladi", () => {
    imageState.url = "https://example.test/non.jpg";
    const { container } = render(
      <ProductCard item={item({ product: { ...product, imageKey: "product-image/p1.jpg" } })} onAdd={vi.fn()} onDetails={vi.fn()} />,
    );
    expect(container.querySelector("img")).not.toBeNull();
  });

  it("bosilganda savatga qo'shiladi; qoldiq tugagan bo'lsa bosilmaydi", () => {
    imageState.url = undefined;
    const onAdd = vi.fn();
    const { unmount } = render(<ProductCard item={item()} onAdd={onAdd} onDetails={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /savatga qo'shish/ }));
    expect(onAdd).toHaveBeenCalledWith(product);
    unmount();

    const blocked = vi.fn();
    render(<ProductCard item={item({ stock: 0 })} onAdd={blocked} onDetails={vi.fn()} />);
    const soldOut = screen.getByRole("button", { name: /savatga qo'shish/ });
    expect(soldOut).toBeDisabled();
    fireEvent.click(soldOut);
    expect(blocked).not.toHaveBeenCalled();
    expect(screen.getByText(/Tugagan/)).toBeInTheDocument();
  });

  it("ⓘ tugmasi va o'ng tugma batafsil oynani ochadi", () => {
    imageState.url = undefined;
    const onDetails = vi.fn();
    const onAdd = vi.fn();
    render(<ProductCard item={item()} onAdd={onAdd} onDetails={onDetails} />);

    fireEvent.click(screen.getByRole("button", { name: /batafsil/ }));
    expect(onDetails).toHaveBeenCalledWith(product);

    fireEvent.contextMenu(screen.getByRole("button", { name: /savatga qo'shish/ }));
    expect(onDetails).toHaveBeenCalledTimes(2);
    // O'ng tugma savatga qo'shmaydi
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("savatdagi miqdor va aksiya belgisi ko'rinadi", () => {
    imageState.url = undefined;
    render(<ProductCard item={item({ inCart: 3, regularPrice: 6000 })} onAdd={vi.fn()} onDetails={vi.fn()} />);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Aksiya")).toBeInTheDocument();
    expect(screen.getByText("6 000")).toBeInTheDocument();
  });
});

describe("ProductDetailDialog", () => {
  it("miqdorni oshirib savatga qo'shadi", () => {
    imageState.url = undefined;
    const onAdd = vi.fn();
    render(<ProductDetailDialog item={item()} onClose={vi.fn()} onAdd={onAdd} />);

    expect(screen.getByText(/shtrix-kod 4780001/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ko'paytirish" }));
    fireEvent.click(screen.getByRole("button", { name: "Savatga" }));
    expect(onAdd).toHaveBeenCalledWith(product, 2);
  });

  it("qoldiq tugagan bo'lsa savatga qo'shib bo'lmaydi", () => {
    imageState.url = undefined;
    const onAdd = vi.fn();
    render(<ProductDetailDialog item={item({ stock: 0 })} onClose={vi.fn()} onAdd={onAdd} />);
    const button = screen.getByRole("button", { name: "Omborda yo'q" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("item null bo'lsa hech narsa chizmaydi", () => {
    const { container } = render(<ProductDetailDialog item={null} onClose={vi.fn()} onAdd={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
