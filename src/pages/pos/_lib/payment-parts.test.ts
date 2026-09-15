import { describe, expect, it } from "vitest";
import { addPart, parseMinor, paymentsBody, previewPayment, removePart, suggestAmount, type PayOption } from "./payment-parts.ts";

const cash: PayOption = { key: "cash", method: "cash", terminalId: null, cashAccountId: null, label: "Naqd" };
const uzcard: PayOption = { key: "t:1", method: "card", terminalId: "1", cashAccountId: null, label: "UZCARD" };
const bank: PayOption = { key: "a:9", method: "bank", terminalId: null, cashAccountId: "9", label: "Kapitalbank" };

describe("kassa to'lov qismlari (Saqlash / Yakunlash)", () => {
  it("summani o'qish: bo'shliq, vergul, 2 xonagacha; noto'g'ri — null", () => {
    expect(parseMinor("25 000")).toBe(2_500_000n);
    expect(parseMinor("25000,5")).toBe(2_500_050n);
    expect(parseMinor("0.01")).toBe(1n);
    for (const bad of ["", "abc", "1.234", "-5", "1e3"]) expect(parseMinor(bad)).toBeNull();
  });

  it("rasmdagi misol: 52 000 chek — naqd 25 000 saqlash, UZCARD 27 000 saqlash → qoldiq 0, qaytim 0; qismlar tartibda", () => {
    const due = 5_200_000n;
    let parts = addPart([], cash, 2_500_000n);
    expect(previewPayment(parts, due)).toMatchObject({ remaining: 2_700_000n, change: 0n });
    expect(suggestAmount(parts, uzcard, due)).toEqual({ amount: 2_700_000n, max: 5_200_000n });
    parts = addPart(parts, uzcard, 2_700_000n);
    expect(previewPayment(parts, due)).toMatchObject({ paid: due, remaining: 0n, change: 0n, nonCashOver: false });
    expect(paymentsBody(parts)).toEqual([
      { method: "cash", amount: "25000.00" },
      { method: "card", amount: "27000.00", terminalId: "1" },
    ]);
  });

  it("bir xil usul qayta saqlansa qo'shiladi; o'chirish; nol summa qo'shilmaydi", () => {
    let parts = addPart([], cash, 1_000_000n);
    parts = addPart(parts, cash, 500_000n);
    parts = addPart(parts, bank, 0n);
    expect(parts).toEqual([{ ...cash, amount: 1_500_000n }]);
    expect(removePart(parts, "cash")).toEqual([]);
  });

  it("qaytim faqat naqddan; karta/bank chek summasidan oshmaydi (taklif chegarasi va belgi)", () => {
    const due = 7_000_000n;
    const parts = addPart(addPart([], cash, 6_000_000n), uzcard, 2_000_000n);
    expect(previewPayment(parts, due)).toMatchObject({ tendered: 8_000_000n, paid: due, change: 1_000_000n, remaining: 0n });
    // Karta 50 000 bo'lsa bank uchun ko'pi bilan 20 000
    expect(suggestAmount(addPart([], uzcard, 5_000_000n), bank, due)).toEqual({ amount: 2_000_000n, max: 2_000_000n });
    expect(previewPayment(addPart(addPart([], uzcard, 5_000_000n), bank, 3_000_000n), due).nonCashOver).toBe(true);
    // Naqd ko'p berilsa ham qaytim naqddan oshmaydi
    expect(previewPayment(addPart([], cash, 10_000_000n), due)).toMatchObject({ change: 3_000_000n, paid: due });
  });
});
