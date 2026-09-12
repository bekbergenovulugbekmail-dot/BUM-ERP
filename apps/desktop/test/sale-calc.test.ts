import { describe, expect, it } from "vitest";
import { computeSale, listPrice, unitFactor, type SaleCalcInput } from "../src/shared/sale-calc.js";

const input = (overrides: Partial<SaleCalcInput>): SaleCalcInput => ({
  lines: [],
  baseCurrency: "UZS",
  rates: { USD: "12650.0000" },
  saleCurrencies: ["UZS"],
  customer: null,
  cashback: null,
  paymentMethod: "cash",
  amountPaid: null,
  cashbackAmount: null,
  balanceAmount: null,
  changeToBalance: false,
  currencyPayments: [],
  ...overrides,
});

const line = (unitPrice: string, extra: Partial<SaleCalcInput["lines"][number]> = {}) => ({
  productId: "p1",
  quantity: "1",
  unitPrice,
  discountPercent: "0",
  taxRate: "0",
  taxIncluded: false,
  salesCurrency: null,
  ...extra,
});

describe("Chek hisobi (serverdagi completeSale bilan bir xil)", () => {
  it("asosiy valyuta: qaytim, keshbek chegarasi, mijozsiz qarz va karta ortiqcha to'lovi xato", () => {
    const cash = computeSale(input({ lines: [line("100000")], amountPaid: "120000" }));
    expect(cash).toMatchObject({ total: 10_000_000n, paid: 10_000_000n, change: 2_000_000n, debt: 0n, errors: [] });

    const cashback = computeSale(
      input({
        lines: [line("100000")],
        customer: { balance: "0", cashbackBalance: "50000" },
        cashback: { enabled: true, maxUsagePercent: 10 },
        cashbackAmount: "",
      }),
    );
    expect(cashback).toMatchObject({ cashbackLimit: 1_000_000n, cashbackUsed: 1_000_000n, due: 9_000_000n });

    expect(computeSale(input({ lines: [line("100000")], amountPaid: "50000" })).errors).toContain("Mijozsiz sotuvda chek to'liq to'lanishi kerak");
    expect(computeSale(input({ lines: [line("100000")], paymentMethod: "card", amountPaid: "150000" })).errors).toContain(
      "Karta yoki bank to'lovi chek summasidan oshmasligi kerak",
    );
    // Soliq narx ichida: 112000 × 12% / 112% = 12000
    expect(computeSale(input({ lines: [line("112000", { taxRate: "12", taxIncluded: true })] }))).toMatchObject({ total: 11_200_000n, tax: 1_200_000n });
  });

  it("chet valyuta: qator valyutasi, balans avval asosiy qismni, qolgani valyuta qismini yopadi", () => {
    const usd = line("126500", { salesCurrency: "USD" });
    const paid = computeSale(input({ lines: [usd], saleCurrencies: ["UZS", "USD"], currencyPayments: [{ currency: "USD", amount: "20", method: "cash" }] }));
    expect(paid.hasBaseBucket).toBe(false);
    expect(paid.lines[0]).toMatchObject({ currency: "USD", currencyTotal: 1000n });
    expect(paid.foreign[0]).toMatchObject({ currency: "USD", due: 1000n, paid: 1000n, change: 1000n, paidBase: 12_650_000n });
    expect(paid).toMatchObject({ debt: 0n, errors: [] });

    const withBalance = computeSale(
      input({ lines: [usd], saleCurrencies: ["UZS", "USD"], customer: { balance: "50000", cashbackBalance: "0" }, balanceAmount: "" }),
    );
    expect(withBalance.balanceUsed).toBe(5_000_000n);
    expect(withBalance.foreign[0]).toMatchObject({ dueBase: 7_650_000n, due: 605n, paid: 605n, paidBase: 7_650_000n });
    expect(withBalance.debt).toBe(0n);
  });

  it("birlik koeffitsienti va narx valyutasi", () => {
    const product = { id: "p1", name: "Cola", baseUnitId: "dona", salesPrice: "10", salesCurrency: "USD", taxRate: "0", taxIncluded: false, categoryId: null };
    const conversions = [
      { fromUnitId: "quti", toUnitId: "dona", factor: "12", productId: null },
      { fromUnitId: "quti", toUnitId: "dona", factor: "6", productId: "p1" },
    ];
    expect(unitFactor(product, "quti", conversions)).toBe("6");
    expect(unitFactor(product, "litr", conversions)).toBeNull();
    expect(listPrice(product, "6", "UZS", { USD: "12650.0000" })).toBe("759000.0000");
    expect(listPrice(product, "1", "UZS", {})).toBeNull();
  });
});
