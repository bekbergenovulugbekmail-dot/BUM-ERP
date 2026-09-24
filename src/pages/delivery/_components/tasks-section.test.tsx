/**
 * "Nakladnoy" tugmasi yetkazma belgilanganda YONISHI kerak.
 *
 * Regressiya (2026-09-24): ikkita alohida tugma bor edi — "Nakladnoy" faqat agent + bitta kun
 * filtri bilan yonardi, belgilanganlar uchun esa "Belgilanganlar (N)" degan boshqa tugma edi.
 * Egasi qatorni belgilab "Nakladnoy" ni kutdi, u esa o'chiq turdi va sababi ko'rinmasdi.
 *
 * Shu bilan birga bu fayl TDZ regressiyasini ham qulflaydi: ro'yxatda YO'LGA CHIQAYOTGAN
 * yetkazma bo'lsa komponent yiqilmasligi kerak (oq ekran aynan shundan bo'lgan).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EMPTY_FILTERS } from "../_lib/filters.ts";

const task = (id: string, number: string, status: string) => ({
  id,
  number,
  status,
  deliveryDate: "2026-09-25",
  customerName: "Test Market",
  customerAddress: null,
  customerPhone: null,
  orderNumber: "SO-2026-0004",
  agentName: "Ramatov Rasul",
  deliveryAgentId: "a-1",
  priority: "normal",
  windowStart: null,
  windowEnd: null,
  totalAmount: "42200.00",
  collectedAmount: "0.00",
  isLate: false,
  returnPending: false,
});

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@tanstack/react-query", () => ({
  useInfiniteQuery: () => ({
    data: { pages: [{ tasks: [task("t-1", "DL-2026-0005", "assigned"), task("t-2", "DL-2026-0003", "cancelled")] }] },
    isLoading: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    isFetchingNextPage: false,
  }),
}));
vi.mock("@/lib/query.ts", () => ({ useApiQuery: () => ({ data: { agents: [] } }) }));
vi.mock("@/lib/api.ts", () => ({ api: { get: vi.fn(), post: vi.fn() }, errorMessage: (e: unknown) => String(e) }));
vi.mock("@/hooks/use-company.ts", () => ({ useActiveCompany: () => ({ data: { company: { name: "BUM" } } }) }));
vi.mock("@/hooks/use-auth.ts", () => ({ useCurrentUser: () => ({ name: "Egasi" }) }));
vi.mock("@/lib/delivery/realtime.ts", () => ({ useLiveInterval: () => false }));
vi.mock("@/lib/pdf/delivery-waybill-pdf.ts", () => ({
  generateBulkDeliveryWaybillsPDF: vi.fn(),
  generateDeliveryWaybillPDF: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { default: TasksSection } = await import("./tasks-section.tsx");

const open = () =>
  render(<TasksSection filters={EMPTY_FILTERS} onFiltersChange={vi.fn()} money={(v) => String(v)} onOpenTask={vi.fn()} />);

describe("Yetkazmalar ro'yxati — Nakladnoy tugmasi", () => {
  it("yo'lga chiqayotgan yetkazma bo'lsa ro'yxat yiqilmaydi (TDZ regressiyasi)", () => {
    open();
    expect(screen.getByText("DL-2026-0005")).toBeTruthy();
  });

  it("hech narsa belgilanmagan va filtr yo'q — tugma o'chiq, sababi tooltipda", () => {
    open();
    const button = screen.getByTestId("waybill-print");
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("title")).toContain("Yetkazmalarni belgilang");
  });

  it("qator belgilansa tugma YONADI va sonini ko'rsatadi", () => {
    open();
    fireEvent.click(screen.getByLabelText("DL-2026-0005 — nakladnoy uchun belgilash"));
    const button = screen.getByTestId("waybill-print");
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(button.textContent).toContain("Nakladnoy (1)");
    expect(button.getAttribute("title")).toContain("1 ta yetkazma");
  });

  it("bekor qilingan yetkazma belgilanmaydi — nakladnoyga tushmaydi", () => {
    open();
    expect((screen.getByLabelText("DL-2026-0003 — nakladnoy uchun belgilash") as HTMLButtonElement).disabled).toBe(true);
  });
});
