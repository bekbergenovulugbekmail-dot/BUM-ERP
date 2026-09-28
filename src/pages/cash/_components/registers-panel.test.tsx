/**
 * Kassalar: manfiy qoldiqli kassa darhol ko'rinadi. Manfiy qoldiqda server naqd amallarni rad etadi
 * ("Kassada yetarli mablag' yo'q"), shuning uchun rahbar sababni kassa oynasida ko'rishi kerak.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CashRegister } from "../_lib/types.ts";

const state = vi.hoisted(() => ({ registers: [] as CashRegister[] }));

vi.mock("@/hooks/use-company.ts", () => ({ usePermissions: () => ({ can: () => false }) }));
vi.mock("@/lib/query.ts", () => ({
  // Faqat kassalar ro'yxati kerak; hisobot va hujjatlar so'rovlari yuklanmoqda holatida qoladi
  useApiQuery: (path: string | null) =>
    path === "/api/finance/cash/registers"
      ? { data: { registers: state.registers, scope: "all" }, isLoading: false, error: null }
      : { data: undefined, isLoading: true, error: null },
  useApiMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("./cash-document-dialog.tsx", () => ({ default: () => null }));
vi.mock("./pos-kassa-board.tsx", () => ({ default: () => null }));

const { default: RegistersPanel } = await import("./registers-panel.tsx");

const register = (overrides: Partial<CashRegister> = {}): CashRegister =>
  ({
    id: "r1",
    name: "Asosiy kassa",
    type: "cash",
    currency: "UZS",
    balance: "150000.00",
    isDefault: true,
    employeeId: null,
    employeeName: null,
    ...overrides,
  }) as CashRegister;

describe("Kassalar — manfiy qoldiq", () => {
  it("musbat qoldiqda ogohlantirish yo'q", () => {
    state.registers = [register()];
    render(<RegistersPanel />);
    expect(screen.queryByTestId("registers-negative-alert")).toBeNull();
  });

  it("manfiy qoldiqda kassa nomi bilan ogohlantirish va qizil summa", () => {
    state.registers = [register(), register({ id: "r2", name: "K03 kassa", balance: "-77520.00", isDefault: false })];
    render(<RegistersPanel />);
    const alert = screen.getByTestId("registers-negative-alert");
    expect(alert.textContent).toContain("K03 kassa");
    expect(alert.textContent).not.toContain("Asosiy kassa");
    expect(screen.getByTestId("register-balance-r2").className).toContain("text-destructive");
    expect(screen.getByTestId("register-balance-r1").className).not.toContain("text-destructive");
  });
});
