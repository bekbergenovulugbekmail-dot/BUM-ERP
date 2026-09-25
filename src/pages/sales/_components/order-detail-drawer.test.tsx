/**
 * Nakladnoy detali: foydalanuvchi butun hujjatni emas, AYNAN kerakli mahsulot va miqdorni qaytara olishi kerak.
 *
 * Regressiya: ilgari faqat "Buyurtmani qaytarish" tugmasi bor edi va u hamma qatorni qaytarardi —
 * dostavchi 5 tadan 2 tasini olib kelganda ham butun nakladnoyni qaytarishga majbur edik.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const post = vi.fn();
const mutateAsync = vi.fn();

const item = (id: string, productName: string, productSku: string, quantity: string, returnedQty: string, unitPrice: string) => ({
  id,
  productId: `p-${id}`,
  unitId: "u-1",
  quantity,
  unitPrice,
  taxRate: "0.00",
  discountPercent: "0.00",
  lineTotal: String(Number(quantity) * Number(unitPrice)),
  costPrice: "0",
  priceCurrency: null,
  priceRate: "1",
  currencyTotal: "0",
  notes: null,
  productName,
  productSku,
  unitName: "d",
  returnedQty,
  reservedQty: "0",
});

const order = {
  id: "o-1",
  number: "SO-2026-0001",
  customerId: "c-1",
  customerName: "Do'kon",
  customerPhone: null,
  warehouseId: "w-1",
  warehouseName: "Asosiy ombor",
  status: "completed",
  orderDate: "2026-09-22",
  deliveryDate: null,
  deliveryStatus: null,
  currency: "UZS",
  exchangeRate: "1",
  subtotal: "220000.00",
  taxAmount: "0.00",
  discountAmount: "0.00",
  totalAmount: "220000.00",
  paidAmount: "0.00",
  paymentStatus: "unpaid",
  isPos: false,
  notes: null,
  createdAt: "2026-09-22T10:00:00.000Z",
  currencyTotals: [],
  cashbackEarned: "0.00",
  items: [
    item("i-1", "Coca Cola 1L", "COLA", "10", "0", "10000"),
    item("i-2", "Pechenye", "PECH", "5", "0", "6000"),
    item("i-3", "Shampun", "SHAM", "3", "1", "30000"),
  ],
  payments: [],
  returns: [
    {
      id: "r-1",
      number: "QR-2026-0001",
      totalAmount: "30000.00",
      refundMethod: "cash",
      refundAmount: "0.00",
      reason: "Sifat",
      createdAt: "2026-09-22T11:00:00.000Z",
      createdByName: "Menejer",
      items: [{ orderItemId: "i-3", productId: "p-i-3", productName: "Shampun", quantity: "1.0000", lineTotal: "30000.00" }],
    },
  ],
};

vi.mock("@/lib/query.ts", () => ({
  useApiQuery: () => ({ data: { order }, isLoading: false }),
  useApiMutation: (fn: (body: unknown) => unknown) => ({
    mutateAsync: (body: unknown) => {
      mutateAsync(body);
      void fn(body);
      return Promise.resolve({ return: { number: "QR-2026-0002", refundAmount: "0.00" } });
    },
    isPending: false,
  }),
}));
vi.mock("@/lib/api.ts", () => ({
  api: {
    post: (url: string, body: unknown) => {
      post(url, body);
      return Promise.resolve({});
    },
  },
  errorMessage: (error: unknown) => String(error),
}));
// Hujjatni kim chiqarayotgani hisob-fakturada ko'rsatiladi
vi.mock("@/hooks/use-auth.ts", () => ({ useCurrentUser: () => ({ name: "Menejer" }) }));
vi.mock("@/hooks/use-company.ts", () => ({
  usePermissions: () => ({ can: () => true }),
  useActiveCompany: () => ({ name: "BUM", currency: "UZS" }),
}));
vi.mock("@/hooks/use-currencies.ts", () => ({
  useCurrencies: () => ({ loaded: true, base: "UZS", codes: ["UZS"], rateOf: () => 1, toBase: (amount: string) => Number(amount) }),
  formatMoney: (value: string) => String(value),
}));
vi.mock("@/lib/pdf/invoice-pdf.ts", () => ({ generateSalesInvoicePDF: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { default: OrderDetailDrawer } = await import("./order-detail-drawer.tsx");

const openReturnPanel = () => {
  render(<OrderDetailDrawer orderId="o-1" onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /Qaytarish/ }));
};

describe("Nakladnoy detali — qatorlar bo'yicha qaytarish", () => {
  it("har qator uchun berilgan, qaytarilgan va qolgan miqdor ko'rinadi", () => {
    openReturnPanel();
    const row = screen.getByTestId("return-qty-SHAM").closest("tr")!;
    // Shampun: 3 berilgan, 1 qaytarilgan → 2 qolgan
    expect(within(row).getByText("3 d")).toBeTruthy();
    expect(within(row).getByText("1")).toBeTruthy();
    expect(within(row).getByText("2")).toBeTruthy();
    expect(screen.getByTestId("return-qty-SHAM").getAttribute("max")).toBe("2");
  });

  it("faqat belgilangan qatorlar yuboriladi — butun nakladnoy emas", () => {
    openReturnPanel();
    fireEvent.change(screen.getByTestId("return-qty-PECH"), { target: { value: "2" } });
    fireEvent.change(screen.getByTestId("return-qty-SHAM"), { target: { value: "1" } });

    const submit = screen.getByTestId("submit-return");
    expect(submit.textContent).toContain("2 qatorni qaytarish");
    fireEvent.click(submit);

    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          { orderItemId: "i-2", quantity: "2" },
          { orderItemId: "i-3", quantity: "1" },
        ],
      }),
    );
    // Coca Cola (i-1) yuborilmadi
    const sent = mutateAsync.mock.calls.at(-1)![0] as { items: { orderItemId: string }[] };
    expect(sent.items.some((line) => line.orderItemId === "i-1")).toBe(false);
  });

  it("qolganidan ko'p miqdor yuborilmaydi", () => {
    openReturnPanel();
    fireEvent.change(screen.getByTestId("return-qty-SHAM"), { target: { value: "3" } });
    const submit = screen.getByTestId("submit-return");
    expect(submit.hasAttribute("disabled"), "chegaradan oshgan miqdorda tugma yopiq").toBe(true);
    expect(screen.getByText(/qolganidan ko'p/)).toBeTruthy();
  });

  it("miqdor kiritilmasa tugma ishlamaydi", () => {
    openReturnPanel();
    const submit = screen.getByTestId("submit-return");
    expect(submit.textContent).toContain("Miqdorni kiriting");
    expect(submit.hasAttribute("disabled")).toBe(true);
  });

  it("to'liq qaytarilgan qator kiritishga yopiq", () => {
    render(<OrderDetailDrawer orderId="o-1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Qaytarish/ }));
    fireEvent.click(screen.getByRole("button", { name: "Hammasini tanlash" }));
    const submit = screen.getByTestId("submit-return");
    // 10 + 5 + 2 = uchala qator (Shampunda 2 ta qolgan)
    expect(submit.textContent).toContain("3 qatorni qaytarish");
  });

  it("qaytarish tarixi: hujjat, kim va qaysi mahsulotdan qancha", () => {
    render(<OrderDetailDrawer orderId="o-1" onClose={vi.fn()} />);
    expect(screen.getByText("QR-2026-0001")).toBeTruthy();
    expect(screen.getByText(/Menejer/)).toBeTruthy();
    expect(screen.getByText(/Sifat/)).toBeTruthy();
    expect(screen.getAllByText("Shampun").length).toBeGreaterThan(0);
  });
});
