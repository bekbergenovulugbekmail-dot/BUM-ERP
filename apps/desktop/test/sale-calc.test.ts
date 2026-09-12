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

  it("aralash to'lov: 7 kombinatsiya, qoldiq usuli, ortiqcha karta/bank, qaytim faqat naqddan, qarz, takroriy usul", () => {
    const sale = (payments: SaleCalcInput["payments"], extra: Partial<SaleCalcInput> = {}) => computeSale(input({ lines: [line("1000000")], payments, ...extra }));
    const combos: [NonNullable<SaleCalcInput["payments"]>, Record<string, bigint>][] = [
      [[{ method: "cash", amount: "1000000" }], { cash: 100_000_000n }],
      [[{ method: "card", amount: "1000000" }], { card: 100_000_000n }],
      [[{ method: "bank", amount: "1000000" }], { bank: 100_000_000n }],
      [[{ method: "cash", amount: "400000" }, { method: "card", amount: "600000" }], { cash: 40_000_000n, card: 60_000_000n }],
      [[{ method: "cash", amount: "300000" }, { method: "bank", amount: "700000" }], { cash: 30_000_000n, bank: 70_000_000n }],
      [[{ method: "card", amount: "500000" }, { method: "bank", amount: "500000" }], { card: 50_000_000n, bank: 50_000_000n }],
      [[{ method: "cash", amount: "300000" }, { method: "card", amount: "400000" }, { method: "bank", amount: "300000" }], { cash: 30_000_000n, card: 40_000_000n, bank: 30_000_000n }],
    ];
    for (const [payments, expected] of combos) {
      const calc = sale(payments);
      expect(calc.errors).toEqual([]);
      expect(calc).toMatchObject({ paid: 100_000_000n, change: 0n, debt: 0n });
      expect(Object.fromEntries(calc.payments.map((part) => [part.method, part.paid]))).toEqual(expected);
    }
    // null — qolgan summa shu usulga
    expect(sale([{ method: "card", amount: "400000" }, { method: "cash", amount: null }]).payments).toEqual([
      { method: "card", tendered: 40_000_000n, paid: 40_000_000n },
      { method: "cash", tendered: 60_000_000n, paid: 60_000_000n },
    ]);
    // Naqd ortiqcha — qaytim (faqat naqddan); karta/bank ortiqcha — xato
    expect(sale([{ method: "cash", amount: "500000" }, { method: "card", amount: "700000" }])).toMatchObject({ paid: 100_000_000n, cashPaid: 30_000_000n, change: 20_000_000n, errors: [] });
    expect(sale([{ method: "card", amount: "700000" }, { method: "bank", amount: "400000" }]).errors).toContain("Karta yoki bank to'lovi chek summasidan oshmasligi kerak");
    // Qoldiq > 0: mijozsiz — yakunlanmaydi; mijoz bilan — qarzga
    expect(sale([{ method: "cash", amount: "300000" }, { method: "card", amount: "400000" }]).errors).toContain("Mijozsiz sotuvda chek to'liq to'lanishi kerak");
    expect(sale([{ method: "cash", amount: "300000" }], { customer: { balance: "0", cashbackBalance: "0" } })).toMatchObject({ debt: 70_000_000n, errors: [] });
    expect(sale([{ method: "cash", amount: "1000000" }, { method: "cash", amount: "1" }]).errors).toContain("Naqd to'lovi bir marta kiritiladi");
    expect(sale([{ method: "cash", amount: null }, { method: "card", amount: null }]).errors).toContain("Qoldiq faqat bitta to'lov usuliga yoziladi");
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
